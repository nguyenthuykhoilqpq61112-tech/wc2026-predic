"""Tests for the shared knockout resolver + knockout realism + availability.

Run: python backend/ml/tests/test_knockout_resolve.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import availability  # noqa: E402
import config  # noqa: E402
import knockout_resolve as kr  # noqa: E402

PASS = 0
FAIL = 0


def check(name: str, cond: bool) -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"PASS {name}")
    else:
        FAIL += 1
        print(f"FAIL {name}")


# ── shootout: stronger converter wins more, but it's not deterministic ───────
def test_shootout_edge():
    rng = np.random.default_rng(0)
    wins = sum(kr.shootout(0.85, 0.65, rng) for _ in range(4000))
    rate = wins / 4000
    # better penalty side wins clearly more than half, but short of certain
    # (a 20-pt conversion gap empirically lands ~0.82).
    check("shootout favours stronger converter", 0.60 < rate < 0.90)


def test_shootout_even():
    rng = np.random.default_rng(1)
    wins = sum(kr.shootout(0.75, 0.75, rng) for _ in range(4000))
    check("even shootout is ~coin-flip", 0.45 < wins / 4000 < 0.55)


# ── pen_conversion stays in the realistic band and reacts to GK quality ──────
def test_pen_conversion_band():
    lo = kr.pen_conversion(0.4, 1.0, opp_gk=0.9, avail=0.8)
    hi = kr.pen_conversion(0.9, 2.0, opp_gk=0.4, avail=1.0)
    check("conversion within 0.60-0.88 band", 0.60 <= lo <= hi <= 0.88)
    check("weaker keeper raises conversion", hi > lo)


# ── resolve_ko: a level 90' goes to ET then shootout; never a draw ───────────
def test_resolve_ko_decides():
    # Force a guaranteed 90' draw (only the 0-0 cell has mass), equal teams.
    probs = np.zeros(9)
    probs[0] = 1.0  # index 0 -> (0,0) draw with n=3 cols
    params = {
        "cache": {("A", "B"): (probs, 3, 0.0, 0.0),
                  ("B", "A"): (probs, 3, 0.0, 0.0)},
        "pen": {"A": (0.7, 1.4, 0.55, 1.0), "B": (0.7, 1.4, 0.55, 1.0)},
    }
    rng = np.random.default_rng(3)
    outs = [kr.resolve_ko(params, rng, "A", "B") for _ in range(200)]
    # Always returns a finalist, never None / a draw.
    check("resolve_ko always yields a winner", all(o in ("A", "B") for o in outs))
    check("resolve_ko both sides can win", set(outs) == {"A", "B"})


# ── KO goal suppression: knockout lambdas are lower than group ───────────────
def test_ko_goal_scale():
    check("KO_GOAL_SCALE suppresses goals", 0.80 <= config.KO_GOAL_SCALE < 1.0)


# ── availability: empty feed is a no-op; accumulation rule bans on 2nd yellow ─
def test_availability_noop():
    availability.invalidate()
    check("empty cards feed -> no suspensions",
          availability.suspended("Argentina") == set())
    check("fatigue factor <= 1 and floored",
          0.94 <= availability.fatigue_factor("Brazil", 3) <= 1.0)


def test_suspension_rule():
    # Monkeypatch the loaded feed: one player on two yellows must be banned.
    availability._load.cache_clear()
    availability._load = (lambda: {  # type: ignore
        "matches": {
            "X|Y": {"date": "20260628", "cards": [
                {"player": "P", "team": "X", "type": "yellow", "minute": 30}]},
            "X|Z": {"date": "20260702", "cards": [
                {"player": "P", "team": "X", "type": "yellow", "minute": 70},
                {"player": "Q", "team": "X", "type": "red", "minute": 80}]},
        }})
    banned = availability.suspended("X", before_round="QF")
    check("two yellows -> banned", "P" in banned)
    check("red card -> banned", "Q" in banned)


if __name__ == "__main__":
    test_shootout_edge()
    test_shootout_even()
    test_pen_conversion_band()
    test_resolve_ko_decides()
    test_ko_goal_scale()
    test_availability_noop()
    test_suspension_rule()
    print(f"\n{PASS}/{PASS + FAIL} passed")
    sys.exit(1 if FAIL else 0)
