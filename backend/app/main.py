"""FastAPI entrypoint — FIFA World Cup 2026 prediction API."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import admin, awards, matches, players, predictions, simulate, teams

settings = get_settings()
app = FastAPI(title=settings.app_name, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

for r in (predictions, matches, teams, players, simulate, awards, admin):
    app.include_router(r.router)


@app.get("/api/news")
def news():
    from . import news as news_mod
    return news_mod.build()


@app.get("/api/health")
def health():
    return {"ok": True, "environment": settings.environment}


@app.get("/api/health/model")
def health_model():
    from . import ml_engine
    e = ml_engine.engine()
    return {"ok": True, "environment": settings.environment,
            "members_loaded": {
                "dixon_coles": e.dc is not None,
                "elo": bool(e.elo),
                "xgboost": e.xgb is not None,
                "neural_net": e.nn is not None,
            }}


@app.on_event("startup")
def _startup():
    if settings.use_db:
        from .db import init_db
        init_db()
