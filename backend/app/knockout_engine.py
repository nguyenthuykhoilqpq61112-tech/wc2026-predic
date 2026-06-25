"""Knockout bracket projection.

Resolves the official 48-team knockout bracket (`knockout.json`, R32 -> Final)
into concrete projected teams and per-tie predictions:

  1. project_group_standings() - final group tables. PLAYED group matches use real
     scores; UNPLAYED matches use `services.predict` expected points + expected GD.
  2. best_eight_thirds()      - rank the 12 third-placed teams, take the top 8.
  3. assign_third_slots()     - place the 8 qualifying thirds into the R32 "3rd
     Group X/Y/..." slots (backtracking perfect matching, greedy fallback).
  4. resolve_bracket()        - fill R32 from the group projection, then walk
     R16 -> QF -> SF -> Third/Final resolving "Winner/Loser Match N" from prior
     ties. Each tie is run through `services.predict` (neutral); the higher
     win-prob side advances (knockouts have no draw).

Everything is resolved at runtime (never mutates knockout.json) so the bracket
re-projects automatically as MD2/MD3 results land. The whole resolution is
memoised; call `invalidate()` after new results are ingested.
"""
from __future__ import annotations

import re
from functools import lru_cache

from . import fixtures, services


def _bracket_rows() -> list[dict]:
    # fixtures.knockout() carries real venue/city/kickoff + original slot labels.
    return fixtures.knockout()


def _flag(team: str | None) -> str:
    code = fixtures.FLAG.get(team or "", "")
    return f"https://flagcdn.com/96x72/{code}.png" if code else ""


def _title_odds() -> dict[str, float]:
    """team -> Monte-Carlo champion probability (0-1) from the latest sim."""
    from . import ml_engine
    return {r["team"]: r.get("Champion", 0.0) for r in ml_engine.sim_table()}


# Per-stage reach probabilities from the Monte-Carlo, surfaced on each bracket
# node so the UI can show that the modal bracket is one path, not a certainty.
_SURVIVAL_STAGES = ("R32", "R16", "QF", "SF", "Final", "Champion")

# bracket node type -> (stage a side must reach to PLAY this tie, stage it
# reaches by WINNING it). 3rd-place play-off is between the two SF losers.
_SURVIVAL_STAGE = {
    "r32": ("R32", "R16"), "r16": ("R16", "QF"), "qf": ("QF", "SF"),
    "sf": ("SF", "Final"), "final": ("Final", "Champion"), "third": ("SF", None),
}


def _survival_odds() -> dict[str, dict[str, float]]:
    """team -> {stage: reach probability (0-1)} from the latest sim."""
    from . import ml_engine
    return {r["team"]: {s: r.get(s, 0.0) for s in _SURVIVAL_STAGES}
            for r in ml_engine.sim_table()}


def _node_survival(survival: dict, node_type: str,
                   home: str, away: str) -> dict:
    """Per-side reach/advance probabilities for one bracket tie, from the sim.

    ``reach`` = P(side plays this round); ``advance`` = P(side reaches the next
    round). These come from the Monte-Carlo, NOT the deterministic modal path —
    they communicate how likely this exact tie is and that an upset is live.
    """
    reach, adv = _SURVIVAL_STAGE.get(node_type, (None, None))

    def side(team: str) -> dict:
        s = survival.get(team, {})
        return {"reach": round(s.get(reach, 0.0), 4) if reach else None,
                "advance": round(s.get(adv, 0.0), 4) if adv else None}

    return {"home": side(home), "away": side(away),
            "reach_stage": reach, "advance_stage": adv}


# ── 1. group standings projection ───────────────────────────────────────────
def project_group_standings() -> dict[str, list[dict]]:
    """Per group, ranked list of teams with projected pts + GD.

    Real (played) results contribute exact pts/GD; unplayed matches contribute
    expected pts (3*p_win + p_draw) and expected GD (xg_home - xg_away).
    """
    stats: dict[str, dict] = {}
    for g, teams in fixtures.REAL_GROUPS.items():
        for t in teams:
            stats[t] = {"team": t, "group": g, "pts": 0.0, "gd": 0.0,
                        "played": 0, "projected": 0}

    for m in fixtures.schedule():
        if m["stage"] != "group":
            continue
        h, a = m["home_team"], m["away_team"]
        if h not in stats or a not in stats:
            continue
        if m["played"]:
            hs, as_ = m["home_score"], m["away_score"]
            gd = hs - as_
            stats[h]["gd"] += gd
            stats[a]["gd"] -= gd
            stats[h]["pts"] += 3 if hs > as_ else (1 if hs == as_ else 0)
            stats[a]["pts"] += 3 if as_ > hs else (1 if hs == as_ else 0)
            stats[h]["played"] += 1
            stats[a]["played"] += 1
        else:
            p = services.predict(h, a, neutral=True, match=None)
            ph, pd_, pa = p["p_home"], p["p_draw"], p["p_away"]
            eg = p.get("expected_goals", {})
            egd = float(eg.get("home", 0.0)) - float(eg.get("away", 0.0))
            stats[h]["pts"] += 3 * ph + pd_
            stats[a]["pts"] += 3 * pa + pd_
            stats[h]["gd"] += egd
            stats[a]["gd"] -= egd
            stats[h]["projected"] += 1
            stats[a]["projected"] += 1

    tables: dict[str, list[dict]] = {}
    for g, teams in fixtures.REAL_GROUPS.items():
        rows = sorted((stats[t] for t in teams),
                      key=lambda s: (s["pts"], s["gd"]), reverse=True)
        for i, r in enumerate(rows):
            r["rank"] = i + 1
        tables[g] = rows
    return tables


# ── 2 + 3. third-place qualification + slot assignment ──────────────────────
def best_eight_thirds(tables: dict[str, list[dict]]) -> list[dict]:
    thirds = [tbl[2] for tbl in tables.values()]
    thirds.sort(key=lambda s: (s["pts"], s["gd"]), reverse=True)
    return thirds[:8]


def _allowed_groups(label: str) -> set[str]:
    # "3rd Group A/B/C/D/F" -> {"A","B","C","D","F"}
    m = re.search(r"3rd Group ([A-L/]+)", label)
    return set(m.group(1).split("/")) if m else set()


def assign_third_slots(third_slots: list[dict],
                       qualifying: list[dict]) -> dict[int, dict]:
    """Match the 8 qualifying thirds to the 8 R32 third-place slots.

    Backtracking perfect matching, slots ordered fewest-options-first. Falls
    back to greedy-by-rank if no perfect matching exists.
    """
    by_group = {t["group"]: t for t in qualifying}
    qual_groups = set(by_group)

    slots = sorted(third_slots,
                   key=lambda s: len(_allowed_groups(s["away_label"]) & qual_groups))
    assignment: dict[int, str] = {}
    used: set[str] = set()

    def backtrack(i: int) -> bool:
        if i == len(slots):
            return True
        slot = slots[i]
        options = sorted((_allowed_groups(slot["away_label"]) & qual_groups) - used)
        for grp in options:
            assignment[slot["id"]] = grp
            used.add(grp)
            if backtrack(i + 1):
                return True
            used.discard(grp)
            del assignment[slot["id"]]
        return False

    if backtrack(0):
        return {sid: by_group[g] for sid, g in assignment.items()}

    # Greedy fallback: strongest third to the most-constrained slot it can fill.
    result: dict[int, dict] = {}
    pool = list(qualifying)
    for slot in slots:
        allowed = _allowed_groups(slot["away_label"])
        pick = next((t for t in pool if t["group"] in allowed), None)
        if pick:
            result[slot["id"]] = pick
            pool.remove(pick)
    return result


# ── 4. bracket resolution ───────────────────────────────────────────────────
def _consistent_score(home: str, away: str, winner: str) -> tuple[str | None, bool]:
    """Most-likely scoreline that is consistent with `winner` advancing.

    A knockout has no draw on the night, but the single likeliest exact score can
    be a draw or even favour the side we tip to lose (members disagree on a near
    coin-flip). We never show a scoreline where the *loser* outscores the winner:
    pick the highest-probability cell that is a draw or a winner-win. If the pick
    is a draw, the tie is decided on penalties (shootout=True).
    Returns (\"home-away\", shootout).
    """
    from . import ml_engine
    import numpy as np
    e = ml_engine.engine()
    if e.dc is None:
        return None, False
    m = e.dc.score_matrix(home, away, neutral=True)
    best = None  # (prob, i, j, shootout)
    for (i, j), pr in np.ndenumerate(m):
        if i == j:                       # draw -> winner takes it on pens
            cand = (pr, i, j, True)
        elif (i > j) == (winner == home):  # decisive, consistent with winner
            cand = (pr, i, j, False)
        else:
            continue                     # loser-win: never displayed
        if best is None or cand[0] > best[0]:
            best = cand
    if best is None:
        return None, False
    _, i, j, shootout = best
    return f"{int(i)}-{int(j)}", shootout


def _resolve_tie(home: str, away: str, rows_by_id: dict, match_id: int) -> dict:
    from . import ml_engine

    # Host-nation home edge: a knockout tie is non-neutral when the home-seeded
    # side is a host (USA/Canada/Mexico) playing in its own country. (When only
    # the AWAY side is the host-at-home we keep it neutral — a deliberate
    # simplification that avoids re-orienting the bracket's home/away slots; in
    # practice host nations are usually the higher seed and take the home slot.)
    city = rows_by_id.get(match_id, {}).get("city")
    neutral = not fixtures.host_at_home(home, city)

    p = services.predict(home, away, neutral=neutral, match=None)
    ph, pa = p["p_home"], p["p_away"]

    # Full match-flow simulation (90' -> ET -> shootout). It is the source of
    # truth for who advances in a knockout tie: the Monte-Carlo folds in extra
    # time and penalties, which a 90'-only win prob cannot. Fall back to the
    # ensemble's post-draw win prob if the simulation errors.
    flow = None
    try:
        flow = ml_engine.match_flow(home, away, p, neutral=neutral)
    except Exception:  # noqa: BLE001 - never break the bracket on a sim error
        flow = None

    if flow:
        winner = flow["winner"]
        loser = flow["loser"]
        win_p_norm = flow["win_probability"]
        score = flow["predicted_score"]
        shootout = flow["shootout"]
    else:
        # No draws in knockout: pick the higher post-draw win prob.
        winner = home if ph >= pa else away
        loser = away if winner == home else home
        win_p = ph if winner == home else pa
        win_p_norm = round(win_p / (ph + pa), 4) if (ph + pa) else 0.5
        score, shootout = _consistent_score(home, away, winner)
    cond = p.get("condition", {}) or {}
    analysis = {
        # player squad condition composite (0-1) per side
        "home_condition": cond.get("home_cond"),
        "away_condition": cond.get("away_cond"),
        # manager track-record proxy (0-1) per side
        "home_manager_wr": cond.get("home_manager_wr"),
        "away_manager_wr": cond.get("away_manager_wr"),
        # goalkeeper quality (0-1) per side
        "home_gk_quality": cond.get("home_gk_quality"),
        "away_gk_quality": cond.get("away_gk_quality"),
        "home_momentum": cond.get("home_momentum"),
        "away_momentum": cond.get("away_momentum"),
        # expected goals
        "expected_goals": p.get("expected_goals"),
    }
    return {
        "winner": winner, "loser": loser,
        "home_team": home, "away_team": away,
        "prediction": {
            "p_home": round(ph, 4), "p_draw": round(p["p_draw"], 4),
            "p_away": round(pa, 4),
        },
        "predicted_winner": winner,
        "win_probability": win_p_norm,
        "predicted_score": score,
        "shootout": shootout,
        "confidence": p.get("confidence"),
        "reasons": p.get("win_reasons", []),
        "analysis": analysis,
        "flow": flow,
    }


@lru_cache(maxsize=1)
def resolve_bracket() -> dict:
    rows = _bracket_rows()
    rows_by_id = {m["id"]: m for m in rows}

    tables = project_group_standings()
    winners = {g: tbl[0]["team"] for g, tbl in tables.items()}
    runners = {g: tbl[1]["team"] for g, tbl in tables.items()}

    third_slots = [m for m in rows
                   if m["type"] == "r32" and m["away_label"].startswith("3rd Group")]
    qualifying = best_eight_thirds(tables)
    third_by_slot = assign_third_slots(third_slots, qualifying)

    results: dict[int, dict] = {}
    title = _title_odds()
    survival = _survival_odds()

    def resolve_label(label: str, slot_id: int) -> str | None:
        if label.startswith("Winner Group "):
            return winners.get(label.split()[-1])
        if label.startswith("Runner-up Group "):
            return runners.get(label.split()[-1])
        if label.startswith("3rd Group "):
            t = third_by_slot.get(slot_id)
            return t["team"] if t else None
        m = re.match(r"(Winner|Loser) Match (\d+)", label)
        if m:
            ref = results.get(int(m.group(2)))
            if not ref:
                return None
            return ref["winner"] if m.group(1) == "Winner" else ref["loser"]
        return None

    enriched: list[dict] = []
    # Process in bracket order so "Winner/Loser Match N" references resolve first.
    order = {"r32": 0, "r16": 1, "qf": 2, "sf": 3, "third": 4, "final": 5}
    for m in sorted(rows, key=lambda x: (order.get(x["type"], 9), x["id"])):
        home = resolve_label(m["home_label"], m["id"])
        away = resolve_label(m["away_label"], m["id"])
        row = dict(m)  # keep original labels + venue/city/kickoff
        if home and away:
            tie = _resolve_tie(home, away, rows_by_id, m["id"])
            results[m["id"]] = tie
            row.update({
                "home_team": home, "away_team": away,
                "home_flag": _flag(home), "away_flag": _flag(away),
                "home_title_pct": round(title.get(home, 0.0), 4),
                "away_title_pct": round(title.get(away, 0.0), 4),
                "prediction": tie["prediction"],
                "predicted_winner": tie["predicted_winner"],
                "win_probability": tie["win_probability"],
                "predicted_score": tie["predicted_score"],
                "shootout": tie["shootout"],
                "confidence": tie["confidence"],
                "reasons": tie["reasons"],
                "analysis": tie["analysis"],
                "flow": tie["flow"],
                "survival": _node_survival(survival, m["type"], home, away),
                "modal_path": True,
                "resolved": True,
            })
        else:
            row.update({"home_team": None, "away_team": None, "resolved": False})
        enriched.append(row)

    final = results.get(104)
    champion = final["winner"] if final else None
    runner_up = final["loser"] if final else None
    third = results.get(103, {}).get("winner")

    def _podium(team: str | None) -> dict | None:
        if not team:
            return None
        return {"team": team, "flag": _flag(team),
                "title_pct": round(title.get(team, 0.0), 4)}

    rounds: dict[str, list] = {}
    for m in enriched:
        rounds.setdefault(m["round"], []).append(m)

    return {
        "projected": True,
        "modal_path_note": (
            "Most likely bracket — one illustrative path, not a certainty. "
            "Each tie carries per-team survival % from the Monte-Carlo; upsets "
            "are live and cascade through the draw."),
        "champion": champion,
        "runner_up": runner_up,
        "third_place_winner": third,
        "podium": {"champion": _podium(champion),
                   "runner_up": _podium(runner_up),
                   "third": _podium(third)},
        "rounds": [{"round": r, "matches": ms} for r, ms in rounds.items()],
        "matches": enriched,
    }


def invalidate() -> None:
    """Drop the memoised bracket (call after ingesting new results)."""
    resolve_bracket.cache_clear()
