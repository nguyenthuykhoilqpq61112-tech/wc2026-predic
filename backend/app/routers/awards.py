"""Awards: Golden Boot / Golden Glove / Golden Ball leaderboards.

Pulls the model-side payload from `ml/awards.py` and decorates each player row
with a flag + headshot URL (which live in `fixtures`).
"""
from fastapi import APIRouter

from .. import fixtures, ml_engine  # noqa: F401  (ml_engine adds ml/ to sys.path)

import awards as awards_mod  # flat ml module

router = APIRouter(prefix="/api/awards", tags=["awards"])


def _decorate(rows: list[dict]) -> list[dict]:
    idx = fixtures.team_index()
    for r in rows:
        team = r.get("team", "")
        r["flag_url"] = (idx.get(team) or {}).get("flag_url", "")
        r["photo_url"] = fixtures.player_photo(r.get("player", ""))
    return rows


@router.get("")
def get_awards():
    data = awards_mod.build()
    for key in ("golden_boot", "golden_glove", "golden_ball"):
        _decorate(data.get(key, []))
    return data
