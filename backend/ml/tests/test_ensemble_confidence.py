"""Unit tests for the reliability-aware confidence machinery in ensemble.py.

Targets the pure pieces (no artifacts, no model load needed):
  - Ensemble._confidence : coverage scaling, monotonicity, clipping, reliability
  - Calibrator           : identity fallback + temperature behaviour
  - _weights_from_metrics : dynamic weighting + graceful fallback
  - _reliability_from_metrics : ECE/Brier -> 0..1 + neutral default

Runnable two ways:
    pytest backend/ml/tests/test_ensemble_confidence.py
    python backend/ml/tests/test_ensemble_confidence.py     # standalone
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

# allow `import ensemble` when run as a plain script from anywhere
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import ensemble as E
from ensemble import (
    Calibrator,
    Ensemble,
    WEIGHTS,
    WEIGHT_MAX,
    WEIGHT_MIN,
    RELIABILITY_DEFAULT,
    TOTAL_MEMBERS,
    _reliability_from_metrics,
    _weights_from_metrics,
)

# a decisive, unanimous member stack (all members agree on a strong home win)
SHARP_STACK = np.array([[0.80, 0.12, 0.08]] * 4)
SHARP_BLEND = np.array([0.80, 0.12, 0.08])
# a muddy, contradictory stack centred near the 1/3 coin flip
FLAT_STACK = np.array([[0.34, 0.33, 0.33], [0.33, 0.34, 0.33],
                       [0.33, 0.33, 0.34], [0.34, 0.33, 0.33]])
FLAT_BLEND = np.array([0.34, 0.33, 0.33])


# ───────────────────────────── _confidence ─────────────────────────────────
def test_coverage_uses_total_member_count_not_five():
    """Full roster (6/6) must score >= a partial roster (3/6); the old /5 bug
    let 5 members already saturate coverage."""
    full = Ensemble._confidence(SHARP_STACK, SHARP_BLEND, TOTAL_MEMBERS)
    partial = Ensemble._confidence(SHARP_STACK, SHARP_BLEND, 3)
    assert full >= partial
    # coverage is no longer saturated at 5 members
    assert TOTAL_MEMBERS == len(WEIGHTS) == 6


def test_confidence_clipped_to_5_99():
    hi = Ensemble._confidence(SHARP_STACK, SHARP_BLEND, TOTAL_MEMBERS,
                              reliability=1.0)
    lo = Ensemble._confidence(FLAT_STACK, FLAT_BLEND, 1, reliability=0.0)
    assert 5 <= lo <= hi <= 99


def test_confidence_monotonic_in_reliability():
    base = dict(stack=SHARP_STACK, blended=SHARP_BLEND, n_members=TOTAL_MEMBERS)
    low = Ensemble._confidence(**base, reliability=0.2)
    high = Ensemble._confidence(**base, reliability=0.95)
    assert high >= low


def test_confidence_monotonic_in_evidence():
    """Sharper + more unanimous evidence => not-lower confidence."""
    weak = Ensemble._confidence(FLAT_STACK, FLAT_BLEND, TOTAL_MEMBERS,
                                reliability=RELIABILITY_DEFAULT)
    strong = Ensemble._confidence(SHARP_STACK, SHARP_BLEND, TOTAL_MEMBERS,
                                  reliability=RELIABILITY_DEFAULT)
    assert strong > weak


def test_reliability_actually_moves_confidence():
    """The anti-inflation property: identical sharp prediction scores lower when
    recent calibration is poor."""
    well_cal = Ensemble._confidence(SHARP_STACK, SHARP_BLEND, TOTAL_MEMBERS,
                                    reliability=1.0)
    poorly_cal = Ensemble._confidence(SHARP_STACK, SHARP_BLEND, TOTAL_MEMBERS,
                                      reliability=0.0)
    assert well_cal > poorly_cal


# ───────────────────────────── Calibrator ──────────────────────────────────
def test_calibrator_identity_fallback():
    cal = Calibrator.from_dict(None)            # missing artifact
    assert cal.T == 1.0
    p = np.array([0.6, 0.25, 0.15])
    assert np.allclose(cal(p), p)


def test_calibrator_junk_temperature_falls_back_to_identity():
    for bad in ({"temperature": 0.0}, {"temperature": -2.0},
                {"temperature": float("nan")}):
        assert Calibrator.from_dict(bad).T == 1.0


def test_calibrator_softening_and_sharpening_preserve_argmax_and_sum():
    p = np.array([0.6, 0.25, 0.15])
    soft = Calibrator(2.0)(p)     # T>1 pulls toward uniform
    sharp = Calibrator(0.5)(p)    # T<1 pushes toward the favourite
    for q in (soft, sharp):
        assert np.isclose(q.sum(), 1.0)
        assert int(np.argmax(q)) == int(np.argmax(p))   # no reordering
    assert soft.max() < p.max() < sharp.max()


# ─────────────────────── dynamic member weighting ──────────────────────────
def test_weights_fallback_when_no_metrics():
    assert _weights_from_metrics(WEIGHTS, None) == WEIGHTS
    assert _weights_from_metrics(WEIGHTS, {}) == WEIGHTS


def test_weights_fallback_when_insufficient_signal():
    # only one member has a usable metric -> not enough to trust -> default
    metrics = {"market": {"log_loss": 0.9}}
    assert _weights_from_metrics(WEIGHTS, metrics) == WEIGHTS


def test_weights_inverse_logloss_normalized_and_capped():
    metrics = {
        "market": {"log_loss": 0.50},   # best -> most weight
        "dc": {"log_loss": 0.90},
        "xgb": {"log_loss": 1.10},
        "elo": {"log_loss": 1.00},
        "poisson": {"log_loss": 1.30},
        "nn": {"log_loss": 1.20},
    }
    w = _weights_from_metrics(WEIGHTS, metrics)
    assert set(w) == set(WEIGHTS)
    assert np.isclose(sum(w.values()), 1.0)
    assert all(WEIGHT_MIN - 1e-9 <= v <= WEIGHT_MAX + 1e-9 for v in w.values())
    # lower log loss => higher weight
    assert w["market"] > w["poisson"]


def test_weights_ignore_garbage_metric_values():
    metrics = {
        "market": {"log_loss": 0.0},        # invalid (<=0) -> ignored
        "dc": {"log_loss": float("nan")},   # invalid -> ignored
        "xgb": {"log_loss": 0.8},
        "elo": {"log_loss": 1.0},
    }
    w = _weights_from_metrics(WEIGHTS, metrics)
    assert np.isclose(sum(w.values()), 1.0)
    assert w["xgb"] > w["elo"]              # 0.8 < 1.0 log loss


# ─────────────────────────── reliability map ───────────────────────────────
def test_reliability_neutral_default_when_missing():
    assert _reliability_from_metrics(None) == RELIABILITY_DEFAULT
    assert _reliability_from_metrics({}) == RELIABILITY_DEFAULT
    assert _reliability_from_metrics({"unrelated": 1}) == RELIABILITY_DEFAULT


def test_reliability_perfect_vs_poor_calibration():
    perfect = _reliability_from_metrics({"ece": 0.0, "brier": 0.0})
    poor = _reliability_from_metrics({"ece": 0.30, "brier": 0.40})
    assert perfect > poor
    assert 0.0 <= poor <= perfect <= 1.0
    assert perfect == 1.0


# ───────────────────────────── standalone ──────────────────────────────────
def _run_all():
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"FAIL {fn.__name__}: {exc!r}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return failed


if __name__ == "__main__":
    sys.exit(1 if _run_all() else 0)
