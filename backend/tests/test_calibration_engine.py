"""Tests for backend/ml/calibration.py — the offline fit-side toolkit.

Covers metric sanity, temperature/vector calibrator fitting + apply, and
dynamic-weight computation under missing / invalid / low-sample metrics.

Runnable via pytest or standalone:
    python backend/tests/test_calibration_engine.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ML = Path(__file__).resolve().parents[1] / "ml"
sys.path.insert(0, str(ML))

import calibration as C  # noqa: E402


def _synth(n=600, seed=0):
    """Synthetic but learnable 3-class problem with miscalibrated probs."""
    rng = np.random.default_rng(seed)
    y = rng.integers(0, 3, size=n)
    P = np.full((n, 3), 0.2)
    P[np.arange(n), y] = 0.6                 # correct class favoured...
    P = P / P.sum(1, keepdims=True)
    # overconfidence: push toward the argmax so it needs softening (T>1)
    P = C.apply_temperature(P, 0.5)
    # flip 25% of labels so the 0.6 confidence is not actually earned
    flip = rng.random(n) < 0.25
    y[flip] = (y[flip] + 1) % 3
    return P, y


def test_metrics_ranges_and_perfect_case():
    P, y = _synth()
    assert C.log_loss(P, y) > 0
    assert 0 <= C.rps(P, y) <= 1
    assert 0 <= C.brier(P, y) <= 2
    assert 0 <= C.ece(P, y) <= 1
    assert 0 <= C.top1_acc(P, y) <= 1
    # a perfect, certain forecast scores ~0 loss and ~0 ECE
    n = 30
    yy = np.arange(n) % 3
    PP = np.full((n, 3), 1e-9)
    PP[np.arange(n), yy] = 1.0
    assert C.log_loss(PP, yy) < 1e-3
    assert C.ece(PP, yy) < 1e-6


def test_apply_temperature_normalized_finite_positive():
    P, _ = _synth(50)
    for T in (0.4, 1.0, 2.5):
        Q = C.apply_temperature(P, T)
        assert np.allclose(Q.sum(1), 1.0)
        assert np.all(np.isfinite(Q)) and np.all(Q > 0)


def test_fit_temperature_reduces_logloss_on_overconfident_data():
    P, y = _synth()
    T = C.fit_temperature(P, y)
    assert T > 1.0                           # overconfident -> soften
    assert C.log_loss(C.apply_temperature(P, T), y) <= C.log_loss(P, y)


def test_vector_temperature_runs_and_normalizes():
    P, y = _synth()
    Tv = C.fit_vector_temperature(P, y)
    assert len(Tv) == 3 and all(t > 0 for t in Tv)
    Q = C.apply_vector_temperature(P, Tv)
    assert np.allclose(Q.sum(1), 1.0)


def test_select_calibrator_never_worse_than_identity():
    P, y = _synth(800, seed=3)
    half = len(y) // 2
    cal = C.select_calibrator(P[:half], y[:half], P[half:], y[half:])
    assert cal["method"] in ("temperature", "vector_temperature")
    base = C.log_loss(P[half:], y[half:])
    after = C.log_loss(C.apply_calibrator(P[half:], cal), y[half:])
    assert after <= base + 1e-6


DEFAULT_W = {"market": 0.35, "dc": 0.22, "xgb": 0.18,
             "elo": 0.10, "poisson": 0.07, "nn": 0.08}


def test_dynamic_weights_fallback_when_no_or_thin_metrics():
    # no metrics
    assert C.fit_dynamic_weights({}, {}, DEFAULT_W, 0.03, 0.45) == DEFAULT_W
    # all below min_samples -> fallback
    ll = {k: 1.0 for k in DEFAULT_W}
    n = {k: 5 for k in DEFAULT_W}
    assert C.fit_dynamic_weights(ll, n, DEFAULT_W, 0.03, 0.45,
                                 min_samples=30) == DEFAULT_W


def test_dynamic_weights_ignore_invalid_and_respect_caps():
    ll = {"market": 0.5, "dc": 0.9, "elo": 1.0, "poisson": 0.0,  # 0 invalid
          "xgb": float("nan")}                                   # nan invalid
    n = {"market": 200, "dc": 200, "elo": 200, "poisson": 200, "xgb": 200}
    w = C.fit_dynamic_weights(ll, n, DEFAULT_W, 0.03, 0.45, min_samples=30)
    assert np.isclose(sum(w.values()), 1.0)
    assert all(0.03 - 1e-9 <= v <= 0.45 + 1e-9 for v in w.values())
    assert w["market"] > w["elo"]            # lower log loss => more weight


def _run_all():
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    bad = 0
    for fn in fns:
        try:
            fn(); print(f"PASS {fn.__name__}")
        except AssertionError as e:
            bad += 1; print(f"FAIL {fn.__name__}: {e!r}")
    print(f"\n{len(fns) - bad}/{len(fns)} passed")
    return bad


if __name__ == "__main__":
    sys.exit(1 if _run_all() else 0)
