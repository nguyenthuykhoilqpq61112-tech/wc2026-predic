"""Data-driven top news ticker.

Built from live state so it refreshes on every result ingest / re-sim — no hand
editing. Items: current matchday, latest results (with a standout scorer), the
Golden Boot leader, the model's projected champion, and outcome accuracy.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import fixtures, ml_engine, services

PROC = Path(__file__).resolve().parent.parent / "data" / "processed"
RAW = Path(__file__).resolve().parent.parent / "data" / "raw"


def _flag(team: str) -> str:
    code = fixtures.FLAG.get(team, "")
    if len(code) == 2 and code.isalpha():
        return "".join(chr(0x1F1E6 + ord(c) - 97) for c in code.lower())
    return "⚽"


def _match_events() -> dict:
    try:
        return json.loads((RAW / "match_events.json").read_text())
    except Exception:  # noqa: BLE001
        return {}


def _match_top_scorer(events: dict, home: str, away: str) -> str | None:
    rec = events.get(f"{home}|{away}") or events.get(f"{away}|{home}")
    if not rec:
        return None
    score = rec.get("score") or [0, 0]
    # Prefer the winning side's scorer (a draw falls back to either side).
    win_side = "home" if score[0] > score[1] else "away" if score[1] > score[0] else None

    def tally(sides) -> dict[str, int]:
        t: dict[str, int] = {}
        for side in sides:
            for sc in rec.get("scorers", {}).get(side, []):
                if sc.get("type") == "own goal":  # not the scorer's credit
                    continue
                nm = sc.get("player")
                if nm and nm != "Unknown":
                    t[nm] = t.get(nm, 0) + 1
        return t

    t = tally([win_side]) if win_side else {}
    if not t:  # draw, or winner scored only via own goal
        t = tally(["home", "away"])
    if not t:
        return None
    name, n = max(t.items(), key=lambda kv: kv[1])
    return f"{name} {'⚽' * min(n, 3)}" if n >= 2 else name


def _actual_winner(m: dict) -> str:
    if m["home_score"] > m["away_score"]:
        return m["home_team"]
    if m["away_score"] > m["home_score"]:
        return m["away_team"]
    return "Draw"


def build(max_results: int = 6) -> dict:
    sched = fixtures.schedule()
    played = sorted([m for m in sched if m["played"]],
                    key=lambda m: m["kickoff"], reverse=True)
    events = _match_events()
    items: list[str] = []

    # ── current matchday ──
    md = played[0]["matchday"] if played else "MD1"
    items.append(f"🏆 FIFA World Cup 2026 · {md} latest")

    # ── latest results (most recent first) ──
    for m in played[:max_results]:
        h, a = m["home_team"], m["away_team"]
        line = f"{_flag(h)} {h} {m['home_score']}-{m['away_score']} {a}"
        star = _match_top_scorer(events, h, a)
        if star:
            line += f" — {star}"
        items.append(line)

    # ── Golden Boot leader(s) ──
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ml"))
        import tournament_stats as ts
        goals = ts.player_goals()
        if goals:
            top_g = max(goals.values())
            leaders = [n for n, g in goals.items() if g == top_g]
            who = leaders[0] if len(leaders) == 1 else f"{len(leaders)}-way tie"
            items.append(f"👟 Golden Boot: {who} ({top_g} goals)")
    except Exception:  # noqa: BLE001
        pass

    # ── projected champion ──
    try:
        table = ml_engine.sim_table()
        if table:
            top = max(table, key=lambda r: r.get("Champion", 0))
            items.append(f"📊 CAI projects {_flag(top['team'])} {top['team']} "
                         f"champions ({top['Champion'] * 100:.1f}%)")
    except Exception:  # noqa: BLE001
        pass

    # ── outcome accuracy across played matches ──
    try:
        hits = n = 0
        for m in played:
            p = services.predict(m["home_team"], m["away_team"], neutral=m["neutral"])
            pw = p.get("predicted_winner")
            if pw:
                n += 1
                hits += int(pw == _actual_winner(m))
        if n:
            items.append(f"🎯 Model outcome accuracy: {hits}/{n} ({round(hits / n * 100)}%)")
    except Exception:  # noqa: BLE001
        pass

    items.append("🤖 CAI Ensemble: Dixon-Coles + Elo + XGBoost + Market")
    return {"items": items, "n_played": len(played)}
