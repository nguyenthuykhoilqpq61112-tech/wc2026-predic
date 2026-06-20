"""Model retraining pipeline.

Idempotent, safe to run on a schedule (cron / Celery beat / Admin button):
  1. ingest latest international results
  2. recompute Elo
  3. refit Dixon-Coles
  4. train XGBoost  (skipped if xgboost missing)
  5. train Neural Net (skipped if torch missing)
  6. run Monte Carlo tournament sim
  7. write freshness + accuracy metadata (data/processed/meta.json)

Each step is wrapped so one optional failure (e.g. no torch) doesn't abort
the run. Returns a summary dict the Admin API surfaces.
"""
from __future__ import annotations

import json
import pickle
import time
import traceback
from datetime import datetime, timezone

import pandas as pd

from config import PROC
import ingest, elo as elo_mod, model as model_mod, simulate, xgb_model, nn_model
import backtest

META = PROC / "meta.json"


def _step(name, fn, log):
    t0 = time.time()
    try:
        fn()
        log[name] = {"ok": True, "secs": round(time.time() - t0, 1)}
    except Exception as e:  # optional members may legitimately fail
        log[name] = {"ok": False, "error": f"{type(e).__name__}: {e}",
                     "secs": round(time.time() - t0, 1)}
        traceback.print_exc()


def run(force_download: bool = True) -> dict:
    log: dict = {"started": datetime.now(timezone.utc).isoformat()}
    state: dict = {}

    def _ingest():
        df = ingest.clean(ingest.download_results(force=force_download))
        df.to_parquet(PROC / "results_clean.parquet")
        state["df"] = df
        log["n_matches"] = len(df)
        log["latest_match"] = str(df["date"].max().date())

    def _players():
        # Non-fatal enrichment: uses cached Kaggle data when available and
        # keeps retrain deterministic if Kaggle/network is unavailable.
        players = ingest.sync_players_dataset(force=False)
        log["n_players"] = int(len(players))

    def _elo():
        ratings, enriched = elo_mod.compute(state["df"])
        enriched.to_parquet(PROC / "results_elo.parquet")
        pd.Series(ratings).sort_values(ascending=False).to_frame("elo") \
            .to_parquet(PROC / "elo_ratings.parquet")
        state["ratings"] = ratings
        state["enriched"] = enriched

    def _dc():
        modern = state["enriched"][state["enriched"].date >= "2010-01-01"]
        m = model_mod.fit(modern, elo=state["ratings"])
        with open(PROC / "dc_model.pkl", "wb") as f:
            pickle.dump(m, f)

    def _xgb():
        xgb_model.train(state["enriched"])

    def _nn():
        nn_model.train(state["enriched"])

    def _sim():
        with open(PROC / "dc_model.pkl", "rb") as f:
            m = pickle.load(f)
        table = simulate.run(m)
        # Archives prior sim_results before overwriting (see simulate.save_results).
        simulate.save_results(table)

    def _calibrate():
        # Walk-forward backtest -> per-member metrics + fit calibrator + dynamic
        # weights. Writes member_metrics.json / reliability.json / calibrator.json.
        report = backtest.run()
        log["calibration"] = report.get("after_val") if isinstance(report, dict) \
            else None

    _step("ingest", _ingest, log)
    _step("players", _players, log)
    _step("elo", _elo, log)
    _step("dixon_coles", _dc, log)
    _step("xgboost", _xgb, log)
    _step("neural_net", _nn, log)
    _step("simulate", _sim, log)
    _step("calibrate", _calibrate, log)

    log["finished"] = datetime.now(timezone.utc).isoformat()
    META.write_text(json.dumps(log, indent=2))
    print(json.dumps(log, indent=2))
    return log


if __name__ == "__main__":
    run()
