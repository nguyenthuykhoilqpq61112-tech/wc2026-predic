"""Monte Carlo simulation of the 2026 World Cup (48-team format).

Draws groups, plays group stage (3 pts win / 1 draw), ranks, advances top 2
per group + 8 best third-placed teams to a 32-team knockout bracket, then
simulates single-elimination to a champion. Aggregates per-team probabilities
of reaching each stage over N_SIMS runs.

PERFORMANCE NOTE
----------------
score_matrix() calls scipy.stats.poisson.pmf — expensive. For 50k sims with
~103 matches each that's 5M+ scipy calls. Fix: pre-cache all N*(N-1) pairwise
matrices once before the loop. Each simulation then only does rng.choice()
dict lookups — reducing scipy calls from 5M to 2,256 (one-time).
Expected speedup: ~40x (5 min → ~8 sec on M-series Mac).
"""
from __future__ import annotations

import math
import pickle
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from config import (N_GROUPS, TEAMS_PER_GROUP, N_THIRD_PLACE_ADVANCE,
                    N_SIMS, PROC, PROJECTED_FIELD, REAL_GROUPS_2026)
import knockout_resolve
from model import DCModel
from tournament_form import get_adjusted_elo

try:
    from player_condition import TeamConditionEngine
except Exception:        # optional dependency — sim still runs without it
    TeamConditionEngine = None

# Squad-condition strength in the sim. Matches ensemble.CONDITION_COEF so a
# match sampled here tilts the same way the match-level prediction does.
# Momentum is excluded from the tilt (model.elo is already tournament-patched).
CONDITION_COEF = 1.35

# Type alias for the pre-computed cache
# {(home, away): (probs_flat, n_cols, elo_home, elo_away)}
ScoreCache = dict[tuple[str, str], tuple[np.ndarray, int]]


# ─────────────────────────────────────────────────────────────────────────────
# CACHE BUILDER  (called ONCE per run() invocation)
# ─────────────────────────────────────────────────────────────────────────────

def _condition_tilt(mat: np.ndarray, shift: float) -> np.ndarray:
    """Tilt a score matrix toward the squad-condition favourite.

    Reweights home-win cells (i>j) by e^shift and away-win cells (i<j) by
    e^-shift, leaving draws (i==j) untouched, then renormalizes. This shifts the
    win/draw/loss outcome mass exactly like ensemble._condition_shift while
    preserving the conditional scoreline shape within each outcome.
    """
    if abs(shift) < 1e-9:
        return mat
    n, m = mat.shape
    i = np.arange(n)[:, None]
    j = np.arange(m)[None, :]
    w = np.ones_like(mat)
    w[i > j] = math.exp(shift)
    w[i < j] = math.exp(-shift)
    out = mat * w
    return out / out.sum()


def _build_score_cache(model: DCModel, field: list[str],
                       cond: Any | None = None,
                       coef: float = CONDITION_COEF) -> ScoreCache:
    """Pre-compute all pairwise score-distribution vectors for the tournament field.

    Returns a dict mapping (home, away) -> (probability_vector, n_cols) so that
    sampling during simulation is a pure rng.choice() call with no scipy overhead.
    When `cond` is supplied, each pairing is tilted by that matchup's squad-
    condition logit shift (form / fitness / availability) before normalizing.
    """
    cache: ScoreCache = {}
    for h in field:
        for a in field:
            if h == a:
                continue
            mat = model.score_matrix(h, a, neutral=True)
            if cond is not None:
                adj = cond.match_condition_adjustment(h, a, include_momentum=False)
                mat = _condition_tilt(mat, coef * adj["logit_shift"])
            flat = mat.ravel()
            total = flat.sum()
            cache[(h, a)] = (flat / total, mat.shape[1])
    return cache


# ─────────────────────────────────────────────────────────────────────────────
# INNER-LOOP HELPERS  (cache-aware, no scipy calls)
# ─────────────────────────────────────────────────────────────────────────────

def _sample_score(cache: ScoreCache, rng: np.random.Generator,
                  home: str, away: str) -> tuple[int, int]:
    probs, n = cache[(home, away)]
    idx = rng.choice(len(probs), p=probs)
    return idx // n, idx % n


# Knockout ties are resolved by `knockout_resolve.resolve_ko` (shared with the
# displayed bracket): a knockout-suppressed 90' scoreline → extra time → a
# GK/composure-weighted shootout. The old Elo-coin-flip on a draw is gone so the
# title/survival percentages agree with the bracket the UI renders. The helper
# below is only a fallback for when KO params can't be built (no condition
# engine): it keeps the legacy 90'-or-Elo-coin behaviour so the sim never breaks.
def _ko_winner_fallback(cache: ScoreCache, elo: dict[str, float],
                        rng: np.random.Generator, a: str, b: str) -> str:
    ga, gb = _sample_score(cache, rng, a, b)
    if ga > gb:
        return a
    if gb > ga:
        return b
    sa = elo.get(a, 1500.0)
    sb = elo.get(b, 1500.0)
    pa = 1.0 / (1.0 + 10 ** ((sb - sa) / 400.0))
    return a if rng.random() < pa else b


def _draw_groups(rng: np.random.Generator, field: list[str]) -> list[list[str]]:
    teams = list(field)
    rng.shuffle(teams)
    groups = [teams[i::N_GROUPS] for i in range(N_GROUPS)]
    return [g[:TEAMS_PER_GROUP] for g in groups]


def _group_table(cache: ScoreCache, rng: np.random.Generator,
                 group: list[str]) -> list[tuple[str, int, int]]:
    """Round-robin. Returns ranked [(team, pts, goal_diff)]."""
    pts: dict[str, int] = defaultdict(int)
    gd: dict[str, int] = defaultdict(int)
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            a, b = group[i], group[j]
            ga, gb = _sample_score(cache, rng, a, b)
            gd[a] += ga - gb
            gd[b] += gb - ga
            if ga > gb:
                pts[a] += 3
            elif gb > ga:
                pts[b] += 3
            else:
                pts[a] += 1
                pts[b] += 1
    ranked = sorted(group, key=lambda t: (pts[t], gd[t], rng.random()), reverse=True)
    return [(t, pts[t], gd[t]) for t in ranked]


def simulate_once(cache: ScoreCache, elo: dict[str, float],
                  rng: np.random.Generator, field: list[str],
                  fixed_groups: list[list[str]] | None = None,
                  ko_params: dict[str, Any] | None = None) -> dict[str, str]:
    """One full tournament. Returns {team: furthest_stage_reached}."""
    stage: dict[str, str] = {t: "group" for t in field}
    groups = fixed_groups if fixed_groups is not None else _draw_groups(rng, field)

    advancers: list[str] = []
    thirds: list[tuple[str, int, int]] = []
    for g in groups:
        table = _group_table(cache, rng, g)
        advancers += [table[0][0], table[1][0]]
        if len(table) > 2:
            thirds.append(table[2])

    thirds.sort(key=lambda x: (x[1], x[2], rng.random()), reverse=True)
    advancers += [t[0] for t in thirds[:N_THIRD_PLACE_ADVANCE]]
    for t in advancers:
        stage[t] = "R32"

    rng.shuffle(advancers)
    bracket = advancers
    stage_names = ["R16", "QF", "SF", "Final", "Champion"]
    si = 0
    while len(bracket) > 1:
        nxt = []
        for i in range(0, len(bracket) - 1, 2):
            if ko_params is not None:
                w = knockout_resolve.resolve_ko(ko_params, rng,
                                                bracket[i], bracket[i + 1])
            else:  # Elo fallback if KO params unavailable
                w = _ko_winner_fallback(cache, elo, rng,
                                        bracket[i], bracket[i + 1])
            nxt.append(w)
        if len(bracket) % 2 == 1:
            nxt.append(bracket[-1])
        label = stage_names[min(si, len(stage_names) - 1)]
        for t in nxt:
            stage[t] = label
        bracket = nxt
        si += 1
    return stage


_ORDER = ["group", "R32", "R16", "QF", "SF", "Final", "Champion"]


def run(model: DCModel, field: list[str] | None = None,
        fixed_groups: list[list[str]] | None = None,
        n_sims: int = N_SIMS, seed: int = 42,
        use_condition: bool = True) -> pd.DataFrame:
    """Run Monte Carlo tournament simulation with pre-cached score matrices.

    use_condition: tilt each pairing by squad form/fitness/availability
    (player_condition.py). Defaults on; no-ops if the engine is unavailable.
    """
    field = field or list(PROJECTED_FIELD)
    if fixed_groups is None and set(field) == set(PROJECTED_FIELD):
        fixed_groups = REAL_GROUPS_2026

    cond = (TeamConditionEngine() if use_condition and TeamConditionEngine
            else None)
    tag = "with squad condition" if cond else "Elo+DC only"
    print(f"[sim] Pre-computing {len(field)*(len(field)-1)} score matrices "
          f"({tag}) ... ", end="", flush=True)
    cache = _build_score_cache(model, field, cond=cond)
    # Shared knockout-resolution params (KO-suppressed 90' grids + penalty model)
    # so the MC advances ties exactly like the displayed bracket.
    ko_params = knockout_resolve.build_ko_params(model, field, cond=cond)
    print("done.")

    rng = np.random.default_rng(seed)
    reached = {t: defaultdict(int) for t in field}

    for i in range(n_sims):
        res = simulate_once(cache, model.elo, rng, field,
                            fixed_groups=fixed_groups, ko_params=ko_params)
        for t, st in res.items():
            hi = _ORDER.index(st)
            for k in range(hi + 1):
                reached[t][_ORDER[k]] += 1
        if (i + 1) % 10000 == 0:
            print(f"[sim] {i+1}/{n_sims} completed ...", flush=True)

    rows = []
    for t in field:
        row = {"team": t}
        for st in _ORDER:
            row[st] = reached[t][st] / n_sims
        rows.append(row)
    out = pd.DataFrame(rows).sort_values("Champion", ascending=False)
    return out.reset_index(drop=True)


def save_results(table: pd.DataFrame) -> None:
    """Archive the previous sim_results before overwriting (so champion-odds
    impact can be diffed across re-sims), then write the new parquet + json."""
    prev = PROC / "sim_results.json"
    if prev.exists():
        arch = PROC / "sim_archive"
        arch.mkdir(exist_ok=True)
        ts = datetime.fromtimestamp(
            prev.stat().st_mtime, timezone.utc).strftime("%Y%m%dT%H%M%S")
        shutil.copy2(prev, arch / f"sim_results_{ts}.json")
    table.to_parquet(PROC / "sim_results.parquet")
    table.to_json(PROC / "sim_results.json", orient="records")


def main() -> None:
    with open(PROC / "dc_model.pkl", "rb") as f:
        model: DCModel = pickle.load(f)

    # Patch Elo with live WC2026 in-tournament results (MD1/MD2)
    model.elo = get_adjusted_elo(model.elo)
    print(f"[sim] Elo patched with WC2026 MD1/MD2 tournament results")

    table = run(model)
    save_results(table)
    print(f"[sim] {N_SIMS} tournaments complete. Title odds (top 15):")
    show = table[["team", "Champion", "Final", "SF"]].head(15).copy()
    show[["Champion", "Final", "SF"]] = (show[["Champion", "Final", "SF"]] * 100).round(1)
    print(show.to_string(index=False))


if __name__ == "__main__":
    main()

