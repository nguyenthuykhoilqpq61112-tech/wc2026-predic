"""Calibration + reliability toolkit for the ensemble.

Pure, dependency-light functions that:
  * score 3-outcome (H/D/A) probability forecasts (LogLoss, RPS, Brier, ECE,
    top-1 accuracy, confidence-bucket hit-rates),
  * fit post-hoc probability calibrators (scalar + per-class temperature),
  * derive per-member out-of-sample metrics + dynamic ensemble weights,
  * assemble the three runtime artifacts the engine consumes:
        member_metrics.json   per-member log_loss / rps / brier / sample_count
        reliability.json      ece / brier / confidence_bucket_stats
        calibrator.json       fitted calibrator params + provenance metadata

The runtime apply-side lives in `ensemble.py` (`Calibrator`); this module is the
FIT side, called offline from the backtest / retrain pipeline. Keeping them in
separate files means importing the engine never drags in SciPy's optimizers.

Outcome index convention everywhere: 0=Home, 1=Draw, 2=Away.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

EPS = 1e-12


# ───────────────────────────────── metrics ─────────────────────────────────
def _clip_norm(P: np.ndarray) -> np.ndarray:
    P = np.clip(np.asarray(P, dtype=float), EPS, 1.0)
    return P / P.sum(axis=1, keepdims=True)


def log_loss(P: np.ndarray, y: np.ndarray) -> float:
    P = _clip_norm(P)
    return float(-np.log(P[np.arange(len(y)), y]).mean())


def rps(P: np.ndarray, y: np.ndarray) -> float:
    """Mean Ranked Probability Score for ordered 3-outcome forecasts."""
    P = _clip_norm(P)
    obs = np.zeros_like(P)
    obs[np.arange(len(y)), y] = 1.0
    cp = np.cumsum(P, axis=1)
    co = np.cumsum(obs, axis=1)
    return float((((cp - co) ** 2).sum(axis=1) / (P.shape[1] - 1)).mean())


def brier(P: np.ndarray, y: np.ndarray) -> float:
    """Multiclass Brier score: mean squared error vs one-hot (range 0..2)."""
    P = _clip_norm(P)
    obs = np.zeros_like(P)
    obs[np.arange(len(y)), y] = 1.0
    return float(((P - obs) ** 2).sum(axis=1).mean())


def top1_acc(P: np.ndarray, y: np.ndarray) -> float:
    return float((np.asarray(P).argmax(axis=1) == y).mean())


def ece(P: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    """Expected Calibration Error on the top-1 (confidence) prediction."""
    P = _clip_norm(P)
    conf = P.max(axis=1)
    correct = (P.argmax(axis=1) == y).astype(float)
    edges = np.linspace(0.0, 1.0, bins + 1)
    idx = np.clip(np.digitize(conf, edges) - 1, 0, bins - 1)
    n = len(y)
    e = 0.0
    for b in range(bins):
        m = idx == b
        if not m.any():
            continue
        e += (m.sum() / n) * abs(correct[m].mean() - conf[m].mean())
    return float(e)


def confidence_buckets(P: np.ndarray, y: np.ndarray, bins: int = 10) -> list[dict]:
    """Reliability table on top-1 confidence: per bucket n / avg_conf / hit_rate."""
    P = _clip_norm(P)
    conf = P.max(axis=1)
    correct = (P.argmax(axis=1) == y).astype(float)
    edges = np.linspace(0.0, 1.0, bins + 1)
    idx = np.clip(np.digitize(conf, edges) - 1, 0, bins - 1)
    out = []
    for b in range(bins):
        m = idx == b
        if not m.any():
            continue
        out.append({
            "bucket": f"{edges[b]:.1f}-{edges[b+1]:.1f}",
            "n": int(m.sum()),
            "avg_conf": round(float(conf[m].mean()), 4),
            "hit_rate": round(float(correct[m].mean()), 4),
            "gap": round(float(conf[m].mean() - correct[m].mean()), 4),
        })
    return out


def all_metrics(P: np.ndarray, y: np.ndarray) -> dict:
    return {
        "log_loss": round(log_loss(P, y), 4),
        "rps": round(rps(P, y), 4),
        "brier": round(brier(P, y), 4),
        "ece": round(ece(P, y), 4),
        "acc": round(top1_acc(P, y), 4),
        "n": int(len(y)),
    }


# ───────────────────────────── calibrators (fit) ───────────────────────────
def apply_temperature(P: np.ndarray, T: float) -> np.ndarray:
    """Scalar temperature scaling in log space: softmax(log P / T)."""
    P = np.clip(np.asarray(P, dtype=float), EPS, 1.0)
    z = np.log(P) / float(T)
    z -= z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def apply_vector_temperature(P: np.ndarray, T: np.ndarray) -> np.ndarray:
    """Per-class temperature: each outcome's log-prob divided by its own T."""
    P = np.clip(np.asarray(P, dtype=float), EPS, 1.0)
    T = np.asarray(T, dtype=float).reshape(1, -1)
    z = np.log(P) / T
    z -= z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def fit_temperature(P: np.ndarray, y: np.ndarray) -> float:
    """Fit scalar T minimizing NLL. Bounded golden-section search (no SciPy dep
    required, but uses SciPy when present for robustness)."""
    def nll(T):
        return log_loss(apply_temperature(P, T), y)
    try:
        from scipy.optimize import minimize_scalar
        r = minimize_scalar(nll, bounds=(0.3, 5.0), method="bounded")
        return float(np.clip(r.x, 0.3, 5.0))
    except Exception:
        grid = np.linspace(0.3, 5.0, 95)
        return float(grid[int(np.argmin([nll(t) for t in grid]))])


def fit_vector_temperature(P: np.ndarray, y: np.ndarray) -> list[float]:
    """Fit a 3-vector temperature minimizing NLL (Nelder-Mead, SciPy)."""
    def nll(logT):
        T = np.exp(logT)                      # keep T>0 via log-param
        return log_loss(apply_vector_temperature(P, T), y)
    try:
        from scipy.optimize import minimize
        x0 = np.zeros(P.shape[1])
        r = minimize(nll, x0, method="Nelder-Mead",
                     options={"xatol": 1e-3, "fatol": 1e-4, "maxiter": 500})
        T = np.clip(np.exp(r.x), 0.3, 5.0)
        return [float(t) for t in T]
    except Exception:
        t = fit_temperature(P, y)
        return [t, t, t]


def select_calibrator(P_tr, y_tr, P_va, y_va) -> dict:
    """Fit both calibrator families on train, pick the one with the lowest
    validation NLL (ties / no-improvement -> identity temperature=1)."""
    base = log_loss(P_va, y_va)
    T = fit_temperature(P_tr, y_tr)
    ll_t = log_loss(apply_temperature(P_va, T), y_va)
    Tv = fit_vector_temperature(P_tr, y_tr)
    ll_v = log_loss(apply_vector_temperature(P_va, Tv), y_va)

    best = {"method": "temperature", "temperature": 1.0, "_val_nll": base}
    if ll_t < best["_val_nll"] - 1e-6:
        best = {"method": "temperature", "temperature": round(T, 4), "_val_nll": ll_t}
    if ll_v < best["_val_nll"] - 1e-6:
        best = {"method": "vector_temperature",
                "temperature_vector": [round(t, 4) for t in Tv], "_val_nll": ll_v}
    best.pop("_val_nll")
    return best


def apply_calibrator(P: np.ndarray, cal: dict) -> np.ndarray:
    """Apply a fitted calibrator dict (mirrors ensemble.Calibrator runtime)."""
    method = (cal or {}).get("method", "temperature")
    if method == "vector_temperature":
        T = cal.get("temperature_vector", [1.0, 1.0, 1.0])
        return apply_vector_temperature(P, T)
    return apply_temperature(P, cal.get("temperature", 1.0))


# ──────────────────────────── dynamic weights ──────────────────────────────
def fit_dynamic_weights(member_ll: dict, sample_counts: dict, default: dict,
                        wmin: float, wmax: float, min_samples: int = 30) -> dict:
    """Inverse-log-loss weights over members that clear `min_samples`.

    Uncovered members keep their default weight (scaled onto the inverse-loss
    magnitude). Normalized, capped to [wmin, wmax], renormalized. Falls back to
    `default` when fewer than two members are trustworthy.
    """
    inv = {}
    for k in default:
        ll = member_ll.get(k)
        n = sample_counts.get(k, 0)
        if ll is None or not np.isfinite(ll) or ll <= 0 or n < min_samples:
            continue
        inv[k] = 1.0 / ll
    if len(inv) < 2:
        return dict(default)
    scale = sum(inv.values()) / sum(default[k] for k in inv)
    raw = {k: inv.get(k, default[k] * scale) for k in default}
    s = sum(raw.values())
    w = {k: v / s for k, v in raw.items()}
    w = {k: min(max(v, wmin), wmax) for k, v in w.items()}
    s = sum(w.values())
    return {k: round(v / s, 4) for k, v in w.items()}


# ───────────────────────── artifact assembly ───────────────────────────────
def _stack(df, cols):
    return df[cols].to_numpy(dtype=float)


def build_artifacts(preds, *, default_weights: dict, wmin: float, wmax: float,
                    min_samples: int = 30, synth_market_penalty: float = 0.25,
                    write_dir=None) -> dict:
    """Compute metrics + fit calibrator/weights from an out-of-sample backtest.

    `preds` is the backtest predictions frame: an integer `y` column (0/1/2)
    plus per-member probability triplets `<member>_home/draw/away`.

    Honest before/after framing (no in-sample overfitting):
      * BASELINE  — the legacy default-weight blend, uncalibrated.
      * PRODUCTION — the same blend with the *synthetic* market member
        de-trusted (weight × `synth_market_penalty`, since it is a strictly
        degraded Elo clone and pure redundant noise), then passed through a
        calibrator that is fit on the earlier tournaments and only adopted if
        it beats identity on the held-out latest tournament (else identity).

    Returns a report dict; if `write_dir` is given, also writes the three JSON
    artifacts (member_metrics / reliability / calibrator) there.
    """
    MEMBER_COLS = {
        "dc":      ["p_home", "p_draw", "p_away"],
        "elo":     ["elo_home", "elo_draw", "elo_away"],
        "poisson": ["poisson_home", "poisson_draw", "poisson_away"],
        "market":  ["market_home", "market_draw", "market_away"],
    }
    members = {k: c for k, c in MEMBER_COLS.items()
               if all(col in preds.columns for col in c)}
    avail = list(members)
    y = preds["y"].to_numpy(dtype=int)

    # 1) per-member out-of-sample metrics --------------------------------------
    member_metrics, member_ll, member_n = {}, {}, {}
    for k, cols in members.items():
        m = all_metrics(_stack(preds, cols), y)
        member_metrics[k] = {"log_loss": m["log_loss"], "rps": m["rps"],
                             "brier": m["brier"], "sample_count": m["n"]}
        member_ll[k], member_n[k] = m["log_loss"], m["n"]

    weights = fit_dynamic_weights(member_ll, member_n, default_weights,
                                  wmin, wmax, min_samples)

    def _blend(wmap):
        w = np.array([wmap.get(k, 0.0) for k in avail], dtype=float)
        w = w / w.sum()
        stk = np.stack([_stack(preds, members[k]) for k in avail])  # (M,N,3)
        B = (w[:, None, None] * stk).sum(0)
        return B / B.sum(axis=1, keepdims=True)

    # BASELINE: legacy default-weight blend
    base_blend = _blend(default_weights)

    # PRODUCTION weights: default with the synthetic market de-trusted
    prod_w = {k: (default_weights[k] * synth_market_penalty if k == "market"
                  else default_weights[k]) for k in avail}
    prod_blend = _blend(prod_w)

    # 2) calibrator: fit earlier WCs, adopt only if it beats identity on latest -
    years = preds["tournament"].str.extract(r"(\d{4})").astype(int)[0].to_numpy()
    uniq = sorted(set(years))
    if len(uniq) >= 2:
        tr, va = years != uniq[-1], years == uniq[-1]
    else:
        cut = int(len(y) * 0.7)
        tr = np.zeros(len(y), bool); tr[:cut] = True; va = ~tr
    cal = select_calibrator(prod_blend[tr], y[tr], prod_blend[va], y[va])
    after_blend = apply_calibrator(prod_blend, cal)

    # 3) metrics: full-pool + honest held-out (latest tournament) --------------
    before_full, after_full = all_metrics(base_blend, y), all_metrics(after_blend, y)
    before_val = all_metrics(base_blend[va], y[va])
    after_val = all_metrics(apply_calibrator(prod_blend[va], cal), y[va])

    def _rel(a, b):
        return None if not a else round(100 * (a - b) / a, 2)
    deltas = {m: _rel(before_full[m], after_full[m])
              for m in ("log_loss", "ece", "rps", "brier")}

    member_metrics["_meta"] = {
        "fitted_at": datetime.now(timezone.utc).isoformat(),
        "min_samples": min_samples, "fitted_weights": weights,
        "production_weights": {k: round(v, 4) for k, v in prod_w.items()},
        "synth_market_penalty": synth_market_penalty,
        "members_scored": avail,
    }
    calibrator_artifact = {
        **cal,
        "metadata": {
            "fitted_at": datetime.now(timezone.utc).isoformat(),
            "n_samples": int(len(y)),
            "val_year": int(uniq[-1]) if len(uniq) >= 2 else None,
            "members": avail, "synth_market_penalty": synth_market_penalty,
            "val_before": before_val, "val_after": after_val,
        },
    }
    reliability_artifact = {
        "ece": round(ece(after_blend, y), 4),
        "brier": round(brier(after_blend, y), 4),
        "confidence_bucket_stats": confidence_buckets(after_blend, y),
        "fitted_at": datetime.now(timezone.utc).isoformat(),
        "n_samples": int(len(y)),
    }
    report = {
        "members_scored": avail,
        "fitted_weights": weights, "production_weights": prod_w,
        "before_full": before_full, "after_full": after_full,
        "before_val": before_val, "after_val": after_val,
        "rel_improve_full": deltas, "calibrator_method": cal["method"],
    }

    if write_dir is not None:
        from pathlib import Path
        d = Path(write_dir)
        (d / "member_metrics.json").write_text(json.dumps(member_metrics, indent=2))
        (d / "reliability.json").write_text(json.dumps(reliability_artifact, indent=2))
        (d / "calibrator.json").write_text(json.dumps(calibrator_artifact, indent=2))

    return report
