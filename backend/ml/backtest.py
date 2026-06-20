"""Walk-forward backtest of the Dixon-Coles match model.

For each target tournament (e.g. World Cups 2014/2018/2022) the model is
refit on ONLY the matches that happened strictly before the tournament's
first match — no leakage — then used to predict every match in that
tournament. Scored with proper metrics and compared against baselines.

Metrics
-------
- RPS  : Ranked Probability Score (lower=better). Standard for ordered
         3-outcome football forecasts; rewards getting the *order* right.
- LogLoss : multiclass cross-entropy (lower=better).
- Acc  : top-pick accuracy (higher=better).
- Calibration: predicted-vs-observed in probability bins.

Baselines
---------
- elo   : outcome probs straight from leak-free Elo (no DC fit).
- base  : historical H/D/A base rates (no team info).
- unif  : 1/3 each.

Usage
-----
    python src/backtest.py
    python src/backtest.py --tournament "FIFA World Cup" --years 2014 2018 2022
"""
from __future__ import annotations

import argparse
import numpy as np
import pandas as pd

from config import PROC
import elo as elo_mod
import model as model_mod
import poisson as poisson_mod
import calibration as calib

# outcome index convention: 0=Home, 1=Draw, 2=Away
_OUT = {"H": 0, "D": 1, "A": 2}


# --------------------------------------------------------------------- metrics
def rps(probs: np.ndarray, outcome: int) -> float:
    """Ranked Probability Score for one ordered 3-outcome prediction."""
    obs = np.zeros(3)
    obs[outcome] = 1.0
    cp = np.cumsum(probs)
    co = np.cumsum(obs)
    return float(np.sum((cp - co) ** 2) / (len(probs) - 1))


def log_loss(probs: np.ndarray, outcome: int, eps: float = 1e-15) -> float:
    return float(-np.log(np.clip(probs[outcome], eps, 1.0)))


def summarize(preds: pd.DataFrame, prob_cols: list[str]) -> dict:
    P = preds[prob_cols].to_numpy()
    y = preds["y"].to_numpy()
    rps_v = np.mean([rps(P[i], y[i]) for i in range(len(P))])
    ll_v = np.mean([log_loss(P[i], y[i]) for i in range(len(P))])
    acc = float(np.mean(P.argmax(1) == y))
    return {"n": len(P), "RPS": round(rps_v, 4),
            "LogLoss": round(ll_v, 4), "Acc": round(acc, 4)}


def calibration(preds: pd.DataFrame, bins: int = 5) -> pd.DataFrame:
    """Reliability table: for the model's home-win prob, observed home rate."""
    p = preds["p_home"].to_numpy()
    hit = (preds["y"].to_numpy() == 0).astype(float)
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    rows = []
    for b in range(bins):
        m = idx == b
        if m.sum() == 0:
            continue
        rows.append({"bin": f"{edges[b]:.1f}-{edges[b+1]:.1f}",
                     "n": int(m.sum()),
                     "pred_home": round(float(p[m].mean()), 3),
                     "obs_home": round(float(hit[m].mean()), 3)})
    return pd.DataFrame(rows)


# ------------------------------------------------------------------- baselines
def _base_rates(train: pd.DataFrame) -> np.ndarray:
    vc = train["result"].value_counts(normalize=True)
    return np.array([vc.get("H", 1/3), vc.get("D", 1/3), vc.get("A", 1/3)])


def _elo_outcome(rh: float, ra: float, neutral: bool,
                 home_adv: float = 65.0) -> np.ndarray:
    """Crude Elo->H/D/A: win prob from Elo, draw carved from closeness."""
    adv = 0.0 if neutral else home_adv
    p_h_win = 1.0 / (1.0 + 10 ** ((ra - (rh + adv)) / 400.0))
    # draw share peaks when evenly matched; ~0.27 max
    draw = 0.27 * (1.0 - abs(2 * p_h_win - 1.0))
    p_h = p_h_win * (1 - draw)
    p_a = (1 - p_h_win) * (1 - draw)
    return np.array([p_h, draw, p_a])


# ------------------------------------------------------------------- core loop
def backtest_tournament(full: pd.DataFrame, name: str, year: int,
                        train_years: int = 12) -> pd.DataFrame | None:
    """Refit pre-tournament, predict the tournament's matches."""
    mask = (full["tournament"] == name) & (full["date"].dt.year == year)
    target = full[mask].copy()
    if target.empty:
        print(f"[backtest] no matches for {name} {year}")
        return None

    start = target["date"].min()
    train = full[full["date"] < start].copy()
    # leak-free Elo as of tournament start
    ratings, train_elo = elo_mod.compute(train)

    fit_lo = pd.Timestamp(start) - pd.DateOffset(years=train_years)
    fit_df = train_elo[train_elo["date"] >= fit_lo]
    m = model_mod.fit(fit_df, elo=ratings)

    base = _base_rates(train)

    rows = []
    for r in target.itertuples(index=False):
        y = _OUT[r.result]
        ph, pdr, pa = m.outcome_probs(r.home_team, r.away_team, neutral=r.neutral)
        rh = ratings.get(r.home_team, 1500.0)
        ra = ratings.get(r.away_team, 1500.0)
        e = _elo_outcome(rh, ra, r.neutral)
        # independent-Poisson ensemble member (leak-free Elo driven)
        po = poisson_mod.outcome_probs(rh, ra, r.neutral)
        # synthetic market member: Elo-implied odds shrunk 10% toward uniform
        # (matches ensemble.py's no-real-book fallback) — lets the backtest
        # score the market slot out-of-sample even with no historical book.
        mk = 0.90 * e + 0.10 * np.array([1/3, 1/3, 1/3])
        rows.append({
            "tournament": f"{name} {year}",
            "date": r.date, "home": r.home_team, "away": r.away_team,
            "score": f"{r.home_score}-{r.away_score}", "y": y,
            "p_home": ph, "p_draw": pdr, "p_away": pa,
            "elo_home": e[0], "elo_draw": e[1], "elo_away": e[2],
            "poisson_home": po[0], "poisson_draw": po[1], "poisson_away": po[2],
            "market_home": mk[0], "market_draw": mk[1], "market_away": mk[2],
            "base_home": base[0], "base_draw": base[1], "base_away": base[2],
            "unif_home": 1/3, "unif_draw": 1/3, "unif_away": 1/3,
        })
    return pd.DataFrame(rows)


_MODELS = {
    "dixon_coles": ["p_home", "p_draw", "p_away"],
    "elo":         ["elo_home", "elo_draw", "elo_away"],
    "base_rate":   ["base_home", "base_draw", "base_away"],
    "uniform":     ["unif_home", "unif_draw", "unif_away"],
}


def fit_reliability_artifacts(preds: pd.DataFrame | None = None) -> dict:
    """Score the held-out backtest, fit calibrator + dynamic weights, and write
    member_metrics.json / reliability.json / calibrator.json into PROC.

    Safe to call standalone (loads backtest_preds.parquet when `preds` is None),
    so the retrain pipeline can refresh artifacts without re-running the full
    walk-forward. Returns the before/after report.
    """
    if preds is None:
        p = PROC / "backtest_preds.parquet"
        if not p.exists():
            print("[calib] no backtest_preds.parquet — skipping artifact fit")
            return {}
        preds = pd.read_parquet(p)

    # pull blend defaults + caps + synthetic-market penalty from the engine so
    # there's a single source of truth.
    from ensemble import (WEIGHTS, WEIGHT_MIN, WEIGHT_MAX,
                          SYNTH_MARKET_WEIGHT_PENALTY)

    report = calib.build_artifacts(
        preds, default_weights=WEIGHTS, wmin=WEIGHT_MIN, wmax=WEIGHT_MAX,
        synth_market_penalty=SYNTH_MARKET_WEIGHT_PENALTY, write_dir=PROC)

    b, a, d = report["before_full"], report["after_full"], report["rel_improve_full"]
    print("\n=== Calibration / reliability fit (pooled held-out backtest) ===")
    print(f"members scored : {report['members_scored']}")
    print(f"calibrator     : {report['calibrator_method']}  "
          f"(adopted only if it beats identity on the held-out latest WC)")
    print(f"BASELINE (legacy default blend): "
          f"LL={b['log_loss']:.4f} ECE={b['ece']:.4f} RPS={b['rps']:.4f}")
    print(f"AFTER (synth de-trust + calib) : "
          f"LL={a['log_loss']:.4f} ECE={a['ece']:.4f} RPS={a['rps']:.4f}")
    print(f"rel improvement : LogLoss {d['log_loss']:+.1f}%  "
          f"ECE {d['ece']:+.1f}%  RPS {d['rps']:+.1f}%")
    return report


def run(name: str = "FIFA World Cup",
        years: list[int] | None = None,
        train_years: int = 12) -> pd.DataFrame:
    years = years or [2014, 2018, 2022]
    full = pd.read_parquet(PROC / "results_clean.parquet")

    frames = [backtest_tournament(full, name, y, train_years) for y in years]
    preds = pd.concat([f for f in frames if f is not None], ignore_index=True)
    preds.to_parquet(PROC / "backtest_preds.parquet")

    # fit + persist calibration / reliability / dynamic-weight artifacts
    calib_report = fit_reliability_artifacts(preds)

    # per-model metrics over the pooled held-out matches
    summary = []
    for mdl, cols in _MODELS.items():
        # alias this model's home-prob col to p_home for the calibration path
        s = summarize(preds.assign(p_home=preds[cols[0]]), cols)
        summary.append({"model": mdl, **s})
    summ = pd.DataFrame(summary)

    # per-tournament Dixon-Coles breakdown
    per = []
    for t, g in preds.groupby("tournament"):
        s = summarize(g, _MODELS["dixon_coles"])
        per.append({"tournament": t, **s})
    per_df = pd.DataFrame(per)

    print("\n=== Backtest: pooled held-out matches ===")
    print(summ.to_string(index=False))
    print("\n=== Dixon-Coles per tournament ===")
    print(per_df.to_string(index=False))
    print("\n=== Calibration (Dixon-Coles home-win prob) ===")
    print(calibration(preds).to_string(index=False))
    print("\nLower RPS/LogLoss = better. DC should beat elo > base_rate > uniform.")

    summ.to_json(PROC / "backtest_summary.json", orient="records")
    return calib_report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tournament", default="FIFA World Cup")
    ap.add_argument("--years", nargs="*", type=int, default=[2014, 2018, 2022])
    ap.add_argument("--train-years", type=int, default=12)
    a = ap.parse_args()
    run(a.tournament, a.years, a.train_years)


if __name__ == "__main__":
    main()
