"""Tournament momentum: apply WC 2026 in-tournament micro-Elo updates.

As group-stage matches are played, we update each team's Elo rating on top of
the trained baseline using the ACTUAL WC2026 results. This means:

  - A 3-0 Argentina win vs Algeria immediately boosts Argentina's rating
  - A shock loss by a favourite immediately deflates that team's rating
  - All ensemble members (Elo, DC's attack/defence rates proxy, XGBoost) get
    more accurate team-strength estimates for remaining matches

The updates use the same FiveThirtyEight-style formula as elo.py but with a
SMALLER K (= 20 instead of 40) since WC group matches have high variance and
we don't want to over-react to a single result.

Usage:
    from tournament_form import apply_tournament_updates
    adjusted_elo = apply_tournament_updates(base_elo_dict)
"""
from __future__ import annotations

import math
from functools import lru_cache
from typing import Any

# Lighter K-factor for in-tournament updates (base elo.py uses 40)
TOURNEY_K = 20.0
ELO_HOME_ADV = 65.0   # same as elo.py; all WC matches are effectively neutral


def _expected(r_a: float, r_b: float) -> float:
    return 1.0 / (1.0 + 10 ** ((r_b - r_a) / 400.0))


def _mov_mult(goal_diff: int, elo_diff: float) -> float:
    """Margin-of-victory multiplier (FiveThirtyEight-style)."""
    gd = abs(goal_diff)
    if gd <= 1:
        return 1.0
    return math.log(gd + 1) * (2.2 / (0.001 * abs(elo_diff) + 2.2))


# ---------------------------------------------------------------------------
# WC 2026 MD1 results (played June 11-19, 2026)
# Format: (home, away, home_score, away_score, neutral)
# ---------------------------------------------------------------------------
# Mirrors the canonical played group games in app/fixtures.py (MD1 + the
# played MD2 fixtures). Kept in lock-step with that schedule — if you mark a new
# result there, add the same (home, away, hs, as, neutral) row here so the form
# /Elo engine and the standings never diverge. neutral=False only when a host
# nation (USA / Mexico / Canada) plays at home.
WC2026_PLAYED: list[tuple[str, str, int, int, bool]] = [
    # ── Matchday 1 ──
    ("Mexico",          "South Africa",            2, 0, False),
    ("South Korea",     "Czech Republic",          2, 1, True),
    ("Canada",          "Bosnia and Herzegovina",  1, 1, False),
    ("United States",   "Paraguay",                4, 1, False),
    ("Qatar",           "Switzerland",             1, 1, True),
    ("Brazil",          "Morocco",                 1, 1, True),
    ("Haiti",           "Scotland",                0, 1, True),
    ("Australia",       "Turkey",                  2, 0, True),
    ("Germany",         "Curaçao",                 7, 1, True),
    ("Netherlands",     "Japan",                   2, 2, True),
    ("Ivory Coast",     "Ecuador",                 1, 0, True),
    ("Sweden",          "Tunisia",                 5, 1, True),
    ("Spain",           "Cape Verde",              0, 0, True),
    ("Belgium",         "Egypt",                   1, 1, True),
    ("Saudi Arabia",    "Uruguay",                 1, 1, True),
    ("Iran",            "New Zealand",             2, 2, True),
    ("France",          "Senegal",                 3, 1, True),
    ("Iraq",            "Norway",                  1, 4, True),
    ("Argentina",       "Algeria",                 3, 0, True),
    ("Austria",         "Jordan",                  3, 1, True),
    ("Portugal",        "DR Congo",                1, 1, True),
    ("England",         "Croatia",                 4, 2, True),
    ("Ghana",           "Panama",                  1, 0, True),
    ("Uzbekistan",      "Colombia",                1, 3, True),
    # ── Matchday 2 (played so far) ──
    ("Czech Republic",  "South Africa",            1, 1, True),
    ("Switzerland",     "Bosnia and Herzegovina",  4, 1, True),
    ("Canada",          "Qatar",                   6, 0, False),
    ("Mexico",          "South Korea",             1, 0, False),
    ("United States",   "Australia",               2, 0, False),
    ("Scotland",        "Morocco",                 0, 1, True),
    ("Brazil",          "Haiti",                   3, 0, True),
    ("Paraguay",        "Turkey",                  1, 0, True),
    ("Netherlands",     "Sweden",                  5, 1, True),
    ("Germany",         "Ivory Coast",             2, 1, True),
    ("Ecuador",         "Curaçao",                 0, 0, True),
    ("Tunisia",         "Japan",                   0, 4, True),
    ("Spain",           "Saudi Arabia",            4, 0, True),
    ("Belgium",         "Iran",                    0, 0, True),
    ("Uruguay",         "Cape Verde",              2, 2, True),
]


@lru_cache(maxsize=1)
def apply_tournament_updates(base_elo: tuple[tuple[str, float], ...]) -> dict[str, float]:
    """Apply WC2026 in-tournament results on top of trained Elo.

    Args:
        base_elo: tuple of (team, rating) pairs (hashable for lru_cache).

    Returns:
        Updated ratings dict {team: elo}.
    """
    ratings: dict[str, float] = dict(base_elo)

    for home, away, hs, as_, neutral in WC2026_PLAYED:
        rh = ratings.get(home, 1500.0)
        ra = ratings.get(away, 1500.0)

        adv = 0.0 if neutral else ELO_HOME_ADV
        exp_h = _expected(rh + adv, ra)
        score_h = 1.0 if hs > as_ else 0.5 if hs == as_ else 0.0

        gd = hs - as_
        k = TOURNEY_K * _mov_mult(gd, (rh + adv) - ra)
        delta = k * (score_h - exp_h)

        ratings[home] = rh + delta
        ratings[away] = ra - delta

    return ratings


def get_adjusted_elo(base_elo: dict[str, float]) -> dict[str, float]:
    """Convenience wrapper that accepts a plain dict."""
    return apply_tournament_updates(tuple(sorted(base_elo.items())))


def print_changes(base_elo: dict[str, float]) -> None:
    """Debug: print Elo movement for all WC2026 teams."""
    updated = get_adjusted_elo(base_elo)
    teams = sorted(updated.keys(), key=lambda t: updated[t] - base_elo.get(t, 1500.0), reverse=True)
    print(f"{'Team':<24} {'Before':>7} {'After':>7} {'Δ':>7}")
    print("-" * 48)
    for t in teams:
        if t in base_elo:
            before = base_elo[t]
            after = updated[t]
            delta = after - before
            if abs(delta) > 0.5:
                print(f"{t:<24} {before:>7.1f} {after:>7.1f} {delta:>+7.1f}")


if __name__ == "__main__":
    # Quick smoke test
    import sys
    sys.path.insert(0, ".")
    import pandas as pd
    from config import PROC
    base = pd.read_parquet(PROC / "elo_ratings.parquet")["elo"].to_dict()
    print_changes(base)
