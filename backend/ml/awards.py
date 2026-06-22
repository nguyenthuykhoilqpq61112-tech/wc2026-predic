"""Tournament awards: Golden Boot / Golden Glove / Golden Ball.

Golden Boot is computed live from the real ESPN scorer feed
(`tournament_stats.player_goals`); the scorer's country comes from the same
`data/raw/match_events.json`. The Golden Glove and Golden Ball have no scrapable
per-player feed (keeper save counts, assist credits, media votes), so their
ranked contender lists are curated from the web in `data/raw/awards.json`
(refreshed by hand like `post_match.json`) and enriched here with the app's own
live numbers: team clean sheets / goals-against for keepers, real tournament
goals for outfield players.

This module stays presentation-agnostic — no flags/photos. The router layer
(`app/routers/awards.py`) decorates rows with flag + headshot URLs, since those
live in `app/fixtures.py`.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import tournament_stats as ts

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
_EVENTS = RAW / "match_events.json"
_AWARDS = RAW / "awards.json"


@lru_cache(maxsize=1)
def _scorer_team() -> dict[str, str]:
    """player name -> team, from the real scorer feed (own goals skipped)."""
    try:
        events = json.loads(_EVENTS.read_text())
    except Exception:  # noqa: BLE001
        return {}
    m: dict[str, str] = {}
    for rec in events.values():
        for side in ("home", "away"):
            team = rec.get(side)
            for sc in rec.get("scorers", {}).get(side, []):
                if sc.get("type") == "own goal":
                    continue
                nm = sc.get("player")
                if nm and nm != "Unknown" and team:
                    m.setdefault(nm, team)
    return m


def _curated() -> dict:
    try:
        return json.loads(_AWARDS.read_text())
    except Exception:  # noqa: BLE001
        return {}


def build() -> dict:
    """Full awards payload. Boot is live; glove/ball are curated + enriched."""
    cur = _curated()
    goals = ts.player_goals()
    scorer_team = _scorer_team()
    assists = cur.get("golden_boot_assists", {})

    # ── Golden Boot: real goals, tiebreak goals -> assists -> name ──
    boot = [{"player": nm, "team": scorer_team.get(nm, ""),
             "goals": g, "assists": int(assists.get(nm, 0))}
            for nm, g in goals.items()]
    boot.sort(key=lambda r: (-r["goals"], -r["assists"], r["player"]))
    for i, r in enumerate(boot, 1):
        r["rank"] = i

    # ── Golden Glove: curated keepers + live team clean sheets/GA ──
    tstats = ts.team_stats()
    glove = []
    for order, e in enumerate(cur.get("golden_glove", [])):
        team = e.get("team", "")
        st = tstats.get(team, {})
        glove.append({"player": e["player"], "team": team,
                      "note": e.get("note", ""),
                      "clean_sheets": st.get("cs", 0),
                      "goals_against": st.get("ga", 0),
                      "played": st.get("played", 0),
                      "_order": order})
    # most clean sheets, then fewest conceded, then the curated (bookmaker) order
    glove.sort(key=lambda r: (-r["clean_sheets"], r["goals_against"], r["_order"]))
    for i, r in enumerate(glove, 1):
        r["rank"] = i
        r.pop("_order", None)

    # ── Golden Ball: curated media power ranking + real goals ──
    ball = []
    for e in cur.get("golden_ball", []):
        nm = e["player"]
        ball.append({"rank": e.get("rank"), "player": nm, "team": e.get("team", ""),
                     "goals": int(goals.get(nm, 0)), "note": e.get("note", "")})
    ball.sort(key=lambda r: (r["rank"] is None, r["rank"] or 0))

    return {
        "as_of": cur.get("as_of", ""),
        "sources": cur.get("sources", []),
        "golden_boot": boot,
        "golden_glove": glove,
        "golden_ball": ball,
    }


def invalidate() -> None:
    _scorer_team.cache_clear()
