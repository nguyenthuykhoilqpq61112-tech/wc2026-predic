"""Bridge between the FastAPI app and the `ml/` package.

Owns the singleton ensemble, wraps predictions in Redis caching, and exposes
tournament sim + insights. The `ml/` dir is added to sys.path so its flat
modules (ensemble, simulate, insights, config) import unchanged.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
ML_DIR = BACKEND / "ml"
sys.path.insert(0, str(ML_DIR))

from . import cache  # noqa: E402

_engine = None


def engine():
    global _engine
    if _engine is None:
        import ensemble  # noqa
        _engine = ensemble.get_engine()
    return _engine


def reload_engine():
    global _engine
    _engine = None
    return engine()


def predict_match(home: str, away: str, neutral: bool = True,
                  ctx: dict | None = None) -> dict:
    key = f"pred:{home}:{away}:{int(neutral)}:{json.dumps(ctx, sort_keys=True)}"
    hit = cache.get(key)
    if hit:
        return hit
    import ensemble
    mc = ensemble.MatchContext(**(ctx or {}))
    res = engine().predict(home, away, neutral, mc)
    cache.set(key, res)
    return res


def match_flow(home: str, away: str, base: dict | None = None,
               knockout: bool = True, neutral: bool = True) -> dict:
    """Full match-flow simulation.

    knockout=True  -> regulation -> extra time -> shootout (always a winner).
    knockout=False -> group/league game where a draw is a valid result.
    """
    key = f"flow:{home}:{away}:{int(knockout)}:{int(neutral)}"
    hit = cache.get(key)
    if hit:
        return hit
    import match_flow as mf
    res = mf.simulate_tie(engine(), home, away, base,
                          knockout=knockout, neutral=neutral)
    cache.set(key, res)
    return res


def sim_table(top: int | None = None) -> list[dict]:
    p = ML_DIR.parent / "data" / "processed" / "sim_results.json"
    if not p.exists():
        return []
    rows = json.loads(p.read_text())
    rows.sort(key=lambda r: r.get("Champion", 0), reverse=True)
    return rows[:top] if top else rows


def dark_horses(n: int = 6) -> list[dict]:
    import insights
    return insights.dark_horses(n)


def upset_alerts(fixtures: list[dict], threshold: float = 0.33) -> list[dict]:
    import insights
    return insights.upset_alerts(fixtures, engine(), threshold)


def meta() -> dict:
    p = ML_DIR.parent / "data" / "processed" / "meta.json"
    return json.loads(p.read_text()) if p.exists() else {}


# ---------------------------------------------------------------- injuries feed
def injuries_report(team: str) -> list[dict]:
    import injuries
    return injuries.report(team)


def team_availability(team: str, squad: list[dict]) -> float:
    import injuries
    return injuries.availability_factor(team, squad)


def squad_with_injuries(team: str, squad: list[dict]) -> list[dict]:
    import injuries
    return injuries.apply_to_squad(team, squad)


def refresh_injuries() -> int:
    import injuries
    n = injuries.fetch_api_football()
    injuries.reload_book()
    cache.clear("pred:")
    return n
