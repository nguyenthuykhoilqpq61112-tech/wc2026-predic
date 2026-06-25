"""Shared knockout tie resolver: 90' → extra time → modeled shootout.

ONE source of truth for "who advances in a knockout tie", used by BOTH:

  * the displayed bracket (`app.knockout_engine` → `ml.match_flow.simulate_tie`),
    which runs a rich per-tie Monte-Carlo, and
  * the tournament Monte-Carlo (`ml.simulate`), which resolves ~31 ties per run
    across tens of thousands of runs.

Before this module the two disagreed: the bracket folded in extra time and a
GK/composure-weighted shootout, while the tournament sim took a single 90'
scoreline and, on a draw, flipped an Elo-only coin. That made the modal bracket
and the title/survival percentages inconsistent. Both now share the SAME extra
time + shootout logic here, so they agree by construction.

The per-tie `match_flow` engine keeps its full narrative simulation, but imports
`shootout()` and `ET_RATE_FACTOR` from here so the decisive legs are identical.

Pure numpy; no extra dependencies.
"""
from __future__ import annotations

from typing import Any

import numpy as np

import config

# How much of the regulation scoring rate carries into a 30' extra-time period,
# before fatigue. 30/90 of the match length, nudged up slightly for the tired,
# stretched, end-to-end football that defines extra time. Single source — both
# this module and match_flow use it.
ET_RATE_FACTOR = 30.0 / 90.0 * 1.10


# ─────────────────────────────────────────────────────────────────────────────
# Penalty shootout (factored out of match_flow so both engines share it)
# ─────────────────────────────────────────────────────────────────────────────
def shootout(conv_h: float, conv_a: float, rng: np.random.Generator) -> bool:
    """One alternating shootout. Returns True if HOME wins. Best-of-5 then
    sudden death. (Slight first-kicker edge is left out — neutral coin-flip on
    who shoots first, averaged out over the Monte-Carlo.)"""
    home_first = rng.random() < 0.5
    sh, sa = 0, 0
    # Regulation 5 kicks each, with early-stop short-circuit on decisiveness.
    for k in range(5):
        rem_after = 4 - k
        if home_first:
            sh += rng.random() < conv_h
            if sh > sa + rem_after + 1:    # away cannot catch up
                return True
            sa += rng.random() < conv_a
            if sa > sh + rem_after:        # home cannot catch up
                return False
        else:
            sa += rng.random() < conv_a
            if sa > sh + rem_after + 1:
                return False
            sh += rng.random() < conv_h
            if sh > sa + rem_after:
                return True
    # Sudden death
    while True:
        h_made = rng.random() < conv_h
        a_made = rng.random() < conv_a
        if h_made != a_made:
            return h_made


def pen_conversion(comp: float, attack: float, opp_gk: float,
                   avail: float) -> float:
    """Penalty conversion probability for one side, mirroring
    `match_flow._side_profile`: 40% composure · 20% penalty skill · 15% beating
    the opponent keeper · 10% fatigue · 10% crowd · 5% weather (crowd/weather
    neutral at 0.5 for a neutral-venue knockout). Band 0.60–0.88."""
    pen_skill = min(1.0, attack / 2.2)
    gk_beaten = 1.0 - opp_gk
    pen_score = (0.40 * comp + 0.20 * pen_skill + 0.15 * gk_beaten +
                 0.10 * avail + 0.10 * 0.5 + 0.05 * 0.5)
    return float(np.clip(0.62 + 0.27 * pen_score, 0.60, 0.88))


# ─────────────────────────────────────────────────────────────────────────────
# Monte-Carlo parameters (built once per run, shared across all ties)
# ─────────────────────────────────────────────────────────────────────────────
def _expected_goals(probs: np.ndarray, n: int) -> tuple[float, float]:
    """Expected (home, away) goals from a flattened score-probability grid."""
    grid = probs.reshape(-1, n)
    rows = grid.sum(axis=1)
    cols = grid.sum(axis=0)
    eh = float((np.arange(grid.shape[0]) * rows).sum())
    ea = float((np.arange(n) * cols).sum())
    return eh, ea


def build_ko_params(model: Any, field: list[str], cond: Any | None = None,
                    coef: float = None) -> dict[str, Any]:
    """Pre-compute knockout-resolution inputs for the whole field, ONCE.

    Returns a dict with:
      * ``cache`` – {(home, away): (probs_flat, n_cols, exp_home, exp_away)}
        knockout 90' score grids (KO_GOAL_SCALE applied, condition-tilted), plus
        each side's expected goals for the extra-time leg.
      * ``pen``   – {team: (composure, attack_rating, gk_quality, availability)}
        for the shootout conversion model.
    Mirrors `ml.simulate._build_score_cache` so the knockout 90' distribution
    matches the group sim's tilt — just goal-suppressed for the knockout stage.
    """
    # Local import to avoid a hard dependency cycle (simulate imports this).
    from simulate import _condition_tilt, CONDITION_COEF
    coef = CONDITION_COEF if coef is None else coef

    cache: dict[tuple[str, str], tuple[np.ndarray, int, float, float]] = {}
    for h in field:
        for a in field:
            if h == a:
                continue
            mat = model.score_matrix(h, a, neutral=True,
                                     goal_scale=config.KO_GOAL_SCALE)
            if cond is not None:
                adj = cond.match_condition_adjustment(h, a, include_momentum=False)
                mat = _condition_tilt(mat, coef * adj["logit_shift"])
            flat = mat.ravel()
            flat = flat / flat.sum()
            n = mat.shape[1]
            eh, ea = _expected_goals(flat, n)
            cache[(h, a)] = (flat, n, eh, ea)

    pen: dict[str, tuple[float, float, float, float]] = {}
    for t in field:
        if cond is not None:
            c = cond.team_condition(t)
        else:
            c = {"condition_score": 0.65, "form_rating": 7.0,
                 "attack_rating": 1.4, "gk_quality": 0.55,
                 "availability_pct": 1.0}
        comp = 0.5 * c.get("condition_score", 0.65) + \
            0.5 * (c.get("form_rating", 7.0) / 10.0)
        pen[t] = (comp, c.get("attack_rating", 1.4),
                  c.get("gk_quality", 0.55), c.get("availability_pct", 1.0))
    return {"cache": cache, "pen": pen}


def resolve_ko(params: dict[str, Any], rng: np.random.Generator,
               a: str, b: str) -> str:
    """Resolve one knockout tie. Returns the advancing team name.

    90' scoreline → (if level) extra time → (if still level) shootout. Uses the
    shared shootout/conversion model rather than an Elo coin-flip, so the
    tournament sim advances teams the same way the displayed bracket does.
    """
    cache = params["cache"]
    probs, n, ea_h, ea_a = cache[(a, b)]
    idx = rng.choice(len(probs), p=probs)
    ga, gb = idx // n, idx % n
    if ga > gb:
        return a
    if gb > ga:
        return b

    # Level after 90' → extra time (low-rate Poisson off each side's xG).
    et_a = rng.poisson(ea_h * ET_RATE_FACTOR)
    et_b = rng.poisson(ea_a * ET_RATE_FACTOR)
    if et_a > et_b:
        return a
    if et_b > et_a:
        return b

    # Still level → shootout via the GK/composure conversion model.
    pen = params["pen"]
    comp_a, att_a, gk_a, av_a = pen[a]
    comp_b, att_b, gk_b, av_b = pen[b]
    conv_a = pen_conversion(comp_a, att_a, gk_b, av_a)
    conv_b = pen_conversion(comp_b, att_b, gk_a, av_b)
    return a if shootout(conv_a, conv_b, rng) else b
