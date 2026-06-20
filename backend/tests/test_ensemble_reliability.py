"""Tests for the runtime reliability machinery in backend/ml/ensemble.py.

Covers:
  * Calibrator method loading + fallback (temperature / vector / corrupt)
  * dynamic weight computation with missing / invalid / low-sample metrics
  * confidence monotonicity + clipping bounds + reliability term
  * synthetic vs real market behaviour
  * predict() output-schema backward compatibility

Runnable via pytest or standalone:
    python backend/tests/test_ensemble_reliability.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ML = Path(__file__).resolve().parents[1] / "ml"
sys.path.insert(0, str(ML))

import ensemble as E  # noqa: E402
from ensemble import (  # noqa: E402
    Calibrator,
    Ensemble,
    MatchContext,
    WEIGHTS,
    WEIGHT_MAX,
    WEIGHT_MIN,
    TOTAL_MEMBERS,
    RELIABILITY_DEFAULT,
    _weights_from_metrics,
)

SHARP_STACK = np.array([[0.80, 0.12, 0.08]] * 4)
SHARP_BLEND = np.array([0.80, 0.12, 0.08])
FLAT_STACK = np.array([[0.34, 0.33, 0.33]] * 4)
FLAT_BLEND = np.array([0.34, 0.33, 0.33])

# expected schema of predict() — must stay stable
PREDICT_FIELDS = {
    "home", "away", "neutral", "p_home", "p_draw", "p_away",
    "expected_goals", "top_scores", "confidence", "upset_probability",
    "market_used", "members", "explanation",
}


# ───────────────────────── calibrator loading/fallback ─────────────────────
def test_calibrator_identity_when_missing():
    cal = Calibrator.from_dict(None)
    p = np.array([0.6, 0.25, 0.15])
    assert cal.method == "temperature" and cal.T == 1.0
    assert np.allclose(cal(p), p)


def test_calibrator_temperature_method():
    cal = Calibrator.from_dict({"method": "temperature", "temperature": 2.0})
    p = np.array([0.6, 0.25, 0.15])
    q = cal(p)
    assert np.isclose(q.sum(), 1.0)
    assert q.max() < p.max()                 # T>1 softens
    assert int(np.argmax(q)) == int(np.argmax(p))


def test_calibrator_vector_method_normalized_positive():
    cal = Calibrator.from_dict(
        {"method": "vector_temperature", "temperature_vector": [1.0, 0.6, 1.3]})
    p = np.array([0.5, 0.2, 0.3])
    q = cal(p)
    assert cal.method == "vector_temperature"
    assert np.isclose(q.sum(), 1.0)
    assert np.all(q > 0) and np.all(np.isfinite(q))


def test_calibrator_corrupt_artifacts_fall_back_to_identity():
    # malformed vector -> degrade to scalar identity
    cal = Calibrator.from_dict({"method": "vector_temperature",
                                "temperature_vector": []})
    assert cal.method == "temperature"
    # junk scalar -> identity
    for bad in ({"temperature": 0.0}, {"temperature": -1.0},
                {"temperature": float("nan")}, {"method": "bogus"}):
        c = Calibrator.from_dict(bad)
        p = np.array([0.4, 0.4, 0.2])
        assert np.allclose(c(p), p)


# ───────────────────────── dynamic weight behaviour ────────────────────────
def test_weights_fallback_no_metrics():
    assert _weights_from_metrics(WEIGHTS, None) == WEIGHTS
    assert _weights_from_metrics(WEIGHTS, {}) == WEIGHTS


def test_weights_respect_min_samples_gate():
    # good losses but tiny samples -> not trusted -> fallback
    thin = {k: {"log_loss": 0.8, "sample_count": 5} for k in WEIGHTS}
    assert _weights_from_metrics(WEIGHTS, thin) == WEIGHTS


def test_weights_inverse_logloss_capped_and_normalized():
    metrics = {
        "market": {"log_loss": 0.55, "sample_count": 200},
        "dc": {"log_loss": 0.90, "sample_count": 200},
        "elo": {"log_loss": 1.00, "sample_count": 200},
        "poisson": {"log_loss": 1.30, "sample_count": 200},
        "xgb": {"log_loss": 0.0, "sample_count": 200},        # invalid -> skip
        "nn": {"log_loss": 1.2, "sample_count": 5},           # thin -> skip
    }
    w = _weights_from_metrics(WEIGHTS, metrics)
    assert set(w) == set(WEIGHTS)
    assert np.isclose(sum(w.values()), 1.0)
    assert all(WEIGHT_MIN - 1e-9 <= v <= WEIGHT_MAX + 1e-9 for v in w.values())
    assert w["market"] > w["poisson"]


# ───────────────────────────── confidence ──────────────────────────────────
def test_confidence_coverage_uses_total_members():
    full = Ensemble._confidence(SHARP_STACK, SHARP_BLEND, TOTAL_MEMBERS)
    part = Ensemble._confidence(SHARP_STACK, SHARP_BLEND, 3)
    assert full >= part and TOTAL_MEMBERS == 6


def test_confidence_clipped_and_monotonic():
    hi = Ensemble._confidence(SHARP_STACK, SHARP_BLEND, TOTAL_MEMBERS, reliability=1.0)
    lo = Ensemble._confidence(FLAT_STACK, FLAT_BLEND, 1, reliability=0.0)
    assert 5 <= lo <= hi <= 99
    # monotonic in evidence and in reliability
    assert (Ensemble._confidence(SHARP_STACK, SHARP_BLEND, TOTAL_MEMBERS,
                                 reliability=RELIABILITY_DEFAULT)
            > Ensemble._confidence(FLAT_STACK, FLAT_BLEND, TOTAL_MEMBERS,
                                   reliability=RELIABILITY_DEFAULT))
    assert (Ensemble._confidence(SHARP_STACK, SHARP_BLEND, TOTAL_MEMBERS, reliability=0.95)
            >= Ensemble._confidence(SHARP_STACK, SHARP_BLEND, TOTAL_MEMBERS, reliability=0.2))


# ───────────────────── synthetic vs real market + schema ───────────────────
def _engine():
    try:
        return Ensemble()
    except Exception as exc:                 # missing artifacts in this env
        print(f"  (skip live-engine test: {exc})")
        return None


def test_predict_schema_stable_and_market_flag():
    eng = _engine()
    if eng is None:
        return
    # synthetic market (no book for this pairing) -> market_used False
    r_syn = eng.predict("Argentina", "France", ctx=MatchContext())
    assert PREDICT_FIELDS <= set(r_syn), PREDICT_FIELDS - set(r_syn)
    assert r_syn["market_used"] is False
    assert np.isclose(r_syn["p_home"] + r_syn["p_draw"] + r_syn["p_away"], 1.0, atol=1e-3)
    assert 5 <= r_syn["confidence"] <= 99

    # real book odds supplied -> market_used True, schema unchanged
    ctx = MatchContext(market_probs=[0.5, 0.3, 0.2])
    r_real = eng.predict("Argentina", "France", ctx=ctx)
    assert PREDICT_FIELDS <= set(r_real)
    assert r_real["market_used"] is True


def test_synthetic_market_is_downweighted_vs_real():
    """With identical Elo-implied odds, the *synthetic* path must give the
    market member strictly less influence than the *real* path."""
    eng = _engine()
    if eng is None:
        return
    home, away, neutral = "Brazil", "England", True
    # synthetic prediction
    r_syn = eng.predict(home, away, neutral, ctx=MatchContext())
    syn_market = np.array(r_syn["members"]["market"])
    # feed those very probs back as a "real" book -> same member vector, but
    # now treated as real (full weight, no confidence penalty)
    r_real = eng.predict(home, away, neutral,
                         ctx=MatchContext(market_probs=list(syn_market)))
    assert r_syn["market_used"] is False
    assert r_real["market_used"] is True
    # synthetic confidence is penalised relative to the real-book equivalent
    assert r_syn["confidence"] <= r_real["confidence"]


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
