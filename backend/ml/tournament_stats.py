"""In-tournament evidence from the WC2026 games played so far.

Turns the actual results (tournament_form.WC2026_PLAYED) + the real goalscorer
feed (data/raw/match_events.json) into the form signals the prediction system
should react to once games are on the board:

  * team_stats()    -> per team: played, W-D-L, GF, GA, clean sheets, points/game
  * gk_form()       -> per team: a goalkeeping/defence form score (0-1) from the
                       goals a side has actually conceded + clean-sheet rate
  * manager_form()  -> per team: a manager-form score (0-1) from points/game,
                       i.e. how well the side has been set up & managed in-game
  * player_goals()  -> per player: goals scored in the tournament (real feed)

These are blended (weighted by games played) on top of the curated pre-tournament
tables in player_condition.py, so early on the curated priors lead and the
tournament evidence takes over as more games are played.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from tournament_form import WC2026_PLAYED

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
_EVENTS = RAW / "match_events.json"


@lru_cache(maxsize=1)
def team_stats() -> dict[str, dict]:
    """Per-team record across all played WC2026 games."""
    s: dict[str, dict] = {}

    def row(t: str) -> dict:
        return s.setdefault(t, {"played": 0, "w": 0, "d": 0, "l": 0,
                                "gf": 0, "ga": 0, "cs": 0, "pts": 0})

    for home, away, hg, ag, _neu in WC2026_PLAYED:
        rh, ra = row(home), row(away)
        rh["played"] += 1; ra["played"] += 1
        rh["gf"] += hg; rh["ga"] += ag
        ra["gf"] += ag; ra["ga"] += hg
        if ag == 0:
            rh["cs"] += 1
        if hg == 0:
            ra["cs"] += 1
        if hg > ag:
            rh["w"] += 1; ra["l"] += 1; rh["pts"] += 3
        elif ag > hg:
            ra["w"] += 1; rh["l"] += 1; ra["pts"] += 3
        else:
            rh["d"] += 1; ra["d"] += 1; rh["pts"] += 1; ra["pts"] += 1

    for t, r in s.items():
        p = max(r["played"], 1)
        r["ppg"] = round(r["pts"] / p, 3)
        r["ga_pg"] = round(r["ga"] / p, 3)
        r["cs_rate"] = round(r["cs"] / p, 3)
    return s


def evidence_weight(team: str, full_at: int = 3) -> float:
    """0-1 trust placed in the tournament evidence vs the curated prior.

    Scales with games played: 0 games -> 0, `full_at` games -> ~0.5 (we never
    fully discard the pre-tournament prior on a 3-game sample)."""
    pld = team_stats().get(team, {}).get("played", 0)
    return pld / (pld + full_at) if pld else 0.0


def gk_form(team: str) -> float | None:
    """Goalkeeping/defence form (0-1) from goals conceded + clean sheets.

    None when the team hasn't played. A clean-sheet-heavy, low-concession side
    scores high; a leaky side scores low. Centred near 0.55 (== neutral prior)."""
    r = team_stats().get(team)
    if not r or not r["played"]:
        return None
    score = 0.55 + 0.18 * r["cs_rate"] - 0.13 * (r["ga_pg"] - 1.0)
    return float(max(0.20, min(0.95, score)))


def manager_form(team: str) -> float | None:
    """Manager form (0-1) from points/game — how well the side is being set up
    and managed in-game (incl. substitutions/game-state management). None when
    the team hasn't played."""
    r = team_stats().get(team)
    if not r or not r["played"]:
        return None
    return float(max(0.20, min(0.92, 0.35 + 0.45 * (r["ppg"] / 3.0))))


@lru_cache(maxsize=1)
def player_goals() -> dict[str, int]:
    """name -> goals scored in the tournament (real ESPN scorer feed).

    Own goals are excluded (they don't reflect the scorer's attacking form)."""
    try:
        events = json.loads(_EVENTS.read_text())
    except Exception:  # noqa: BLE001
        return {}
    goals: dict[str, int] = {}
    for rec in events.values():
        for side in ("home", "away"):
            for sc in rec.get("scorers", {}).get(side, []):
                if sc.get("type") == "own goal":
                    continue
                nm = sc.get("player")
                if nm and nm != "Unknown":
                    goals[nm] = goals.get(nm, 0) + 1
    return goals


def invalidate() -> None:
    team_stats.cache_clear()
    player_goals.cache_clear()
