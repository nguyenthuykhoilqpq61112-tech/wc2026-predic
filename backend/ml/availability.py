"""Suspensions & cumulative fatigue for the knockout stage (data-gated).

Deep in a tournament, who is *available* swings tight ties more than the
pre-tournament ratings do. Two effects this module models:

  1. **Suspensions** — yellow-card accumulation and red cards. FIFA World Cup
     rule: two yellows ⇒ a one-match ban; a straight red ⇒ (at least) a one-match
     ban; the yellow slate is wiped after the quarter-finals so it can't carry a
     player out of a final on a soft early booking.
  2. **Cumulative fatigue** — a small, monotonic stamina decrement for each extra
     knockout round a side plays (more minutes in the legs, less recovery).

Both are driven by a curated `data/raw/cards.json` feed (same hand-maintained,
web-sourced cadence as `match_events.json`). **Until that feed has entries this
module is a no-op** — `suspended()` returns an empty set and the fatigue factor
is 1.0 — so wiring it in cannot regress predictions before any knockout card
data exists. The integration point is the squad loader in `player_condition`:
flip a returned player's ``status`` to ``"suspended"`` (a status the condition
engine already understands) when `suspended()` lists them.

Pure-stdlib; no heavy deps so it is cheap to import inside the sim.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_CARDS_PATH = Path(__file__).resolve().parent.parent / "data" / "raw" / "cards.json"

# Match order of the knockout rounds, used to know which bookings precede a tie
# and when the yellow slate resets (after the QF).
_KO_ROUNDS = ("R32", "R16", "QF", "SF", "Final", "3rd")
_YELLOW_RESET_AFTER = "QF"


@lru_cache(maxsize=1)
def _load() -> dict:
    try:
        with open(_CARDS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"matches": {}}


def invalidate() -> None:
    """Drop the cached cards feed (call after editing cards.json)."""
    _load.cache_clear()


def _all_cards() -> list[dict]:
    """Flat list of every card event across the feed."""
    out: list[dict] = []
    for key, rec in _load().get("matches", {}).items():
        for c in rec.get("cards", []):
            out.append({**c, "match": key, "date": rec.get("date")})
    return out


def suspended(team: str, before_round: str | None = None) -> set[str]:
    """Players from `team` banned for their tie in `before_round`.

    A ban is incurred by the second yellow (and every even yellow after a wipe)
    or by a red card. With an empty feed this is always an empty set, so callers
    are safe to consult it unconditionally.
    """
    yellows: dict[str, int] = {}
    banned: set[str] = set()
    reset_done = False
    for c in _all_cards():
        if (c.get("team") != team) or not c.get("player"):
            continue
        # Yellow slate wipes once after the quarter-finals.
        if (not reset_done and before_round in ("SF", "Final", "3rd")):
            yellows.clear()
            reset_done = True
        player = c["player"]
        if c.get("type") == "red":
            banned.add(player)
        elif c.get("type") == "yellow":
            yellows[player] = yellows.get(player, 0) + 1
            if yellows[player] % 2 == 0:
                banned.add(player)
    return banned


def fatigue_factor(team: str, rounds_played: int) -> float:
    """Multiplicative stamina factor (<=1) for a side `rounds_played` knockout
    rounds deep. ~1.5% per round, floored — kept tiny and tune from backtest."""
    return max(0.94, 1.0 - 0.015 * max(0, rounds_played))
