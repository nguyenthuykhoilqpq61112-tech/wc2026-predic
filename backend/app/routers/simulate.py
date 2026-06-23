"""Tournament simulator: standings, bracket odds, champion probabilities."""
from fastapi import APIRouter, Query

from .. import fixtures, knockout_engine, ml_engine

router = APIRouter(prefix="/api/simulate", tags=["simulate"])


@router.get("")
def simulation(top: int = Query(48, le=48)):
    table = ml_engine.sim_table(top=top)
    return {
        "champion_odds": [{"team": r["team"],
                           "Champion": round(r.get("Champion", 0), 4),
                           "Final": round(r.get("Final", 0), 4),
                           "SF": round(r.get("SF", 0), 4),
                           "QF": round(r.get("QF", 0), 4),
                           "R32": round(r.get("R32", 0), 4)} for r in table],
        "dark_horses": ml_engine.dark_horses(6),
    }


@router.get("/champion-trend")
def champion_trend(top: int = Query(6, le=12)):
    """Per-day title-winner probability for the current top teams (from the
    sim archive) — drives the champion % trend chart."""
    import champion_trend as ct  # flat ml module (ml_engine put ml/ on sys.path)
    return ct.build(top=top)


@router.get("/groups")
def group_standings():
    """Live group standings (MP/W/D/L/GF/GA/GD/Pts from played matches) merged
    with simulated advancement + title probability. Ordered by actual points."""
    tables = fixtures.group_tables()
    sim = {r["team"]: r for r in ml_engine.sim_table()}
    tidx = fixtures.team_index()
    # Projected FINAL points: played pts + expected pts (3*p_win + p_draw) from
    # each team's remaining group games. Explains why a strong side on few points
    # can still have a high advance %.
    proj: dict[str, float] = {}
    try:
        for rows in knockout_engine.project_group_standings().values():
            for r in rows:
                proj[r["team"]] = round(r["pts"], 1)
    except Exception:  # noqa: BLE001 — projection is non-fatal enrichment
        proj = {}
    out = {}
    for g, rows in tables.items():
        out[g] = [{**r,
                   "flag_url": tidx.get(r["team"], {}).get("flag_url", ""),
                   "proj_pts": proj.get(r["team"]),
                   "advance_prob": round(sim.get(r["team"], {}).get("R32", 0), 3),
                   "win_title": round(sim.get(r["team"], {}).get("Champion", 0), 3)}
                  for r in rows]
    return out
