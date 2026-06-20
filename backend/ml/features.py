"""Match feature builder for the ML ensemble members (XGBoost / NN).

Turns the raw match history into a leak-free feature row per match:
Elo diff, recent form (rolling points & goal diff), rest days, head-to-head,
and contextual flags (neutral). Latest team-news features (injuries,
suspensions, squad strength, market odds) are merged in when present in the
DB; for pure-history training they default to neutral values.
"""
from __future__ import annotations

import json
import warnings
from collections import defaultdict, deque

import numpy as np
import pandas as pd

try:
    from config import PROC
except Exception:                       # config import optional for pure use
    PROC = None

FORM_WINDOW = 5

# Per-feature "neutral" value — the value a feature takes when its signal is
# absent. Used by the coverage report to detect features that are effectively
# dead in training (always neutral) and would therefore be a train/inference
# mismatch if they carry real signal at predict time.
NEUTRAL_VALUES = {
    "h2h_home_rate": 0.5,
    "neutral": None,                    # structural flag, not a signal feature
    "elo_home": None, "elo_away": None,
}
# Features that are filled from live team-news at predict time but default to
# neutral during pure-history training — the ones most at risk of mismatch.
TEAM_NEWS_FEATURES = ["avail_diff", "squad_val_diff", "market_home_edge"]


def feature_coverage_report(frame: pd.DataFrame, cols: list[str],
                            persist: bool = True) -> dict:
    """Fraction of rows where each feature deviates from its neutral value.

    A feature stuck at neutral for the whole training set carries no signal the
    model can learn, yet may be populated live — a silent train/inference skew.
    We surface those, warn, and (optionally) persist a coverage report artifact.
    """
    report: dict = {"n_rows": int(len(frame)), "features": {}, "dead": []}
    for c in cols:
        if c not in frame.columns:
            continue
        neutral = NEUTRAL_VALUES.get(c, 0.0)
        if neutral is None:             # structural — coverage not meaningful
            cov = 1.0
        else:
            cov = float((np.abs(frame[c].to_numpy(dtype=float) - neutral)
                         > 1e-9).mean())
        report["features"][c] = round(cov, 4)
        if cov < 0.01:
            report["dead"].append(c)

    dead_news = [c for c in report["dead"] if c in TEAM_NEWS_FEATURES]
    if dead_news:
        warnings.warn(
            "feature coverage: "
            f"{dead_news} are neutral across the entire training set but are "
            "filled live at predict time — backfill them historically or "
            "downweight/remove them to avoid train/inference skew.",
            RuntimeWarning, stacklevel=2)
        report["recommendation"] = (
            "backfill historical values for these features, or drop them from "
            "FEATURE_COLS until a historical source exists")

    if persist and PROC is not None:
        try:
            (PROC / "feature_coverage.json").write_text(json.dumps(report, indent=2))
        except Exception:
            pass
    return report

FEATURE_COLS = [
    "elo_diff", "elo_home", "elo_away",
    "form_pts_diff", "form_gd_diff",
    "rest_diff", "h2h_home_rate",
    "neutral",
    # team-news features (default 0 when unknown; filled at predict time)
    "avail_diff", "squad_val_diff", "market_home_edge",
]


def build_training_frame(df: pd.DataFrame) -> pd.DataFrame:
    """df must have home/away Elo attached (results_elo) + result label.

    Returns one row per match with FEATURE_COLS + target y (0=H,1=D,2=A).
    All features use only information available BEFORE the match.
    """
    df = df.sort_values("date").reset_index(drop=True)
    last_pts: dict[str, deque] = defaultdict(lambda: deque(maxlen=FORM_WINDOW))
    last_gd: dict[str, deque] = defaultdict(lambda: deque(maxlen=FORM_WINDOW))
    last_date: dict[str, pd.Timestamp] = {}
    h2h: dict[tuple, list] = defaultdict(list)   # (a,b)->[home wins for a]

    rows = []
    for r in df.itertuples(index=False):
        h, a = r.home_team, r.away_team
        fp_h = np.mean(last_pts[h]) if last_pts[h] else 1.0
        fp_a = np.mean(last_pts[a]) if last_pts[a] else 1.0
        gd_h = np.mean(last_gd[h]) if last_gd[h] else 0.0
        gd_a = np.mean(last_gd[a]) if last_gd[a] else 0.0
        rest_h = (r.date - last_date[h]).days if h in last_date else 30
        rest_a = (r.date - last_date[a]).days if a in last_date else 30
        key = tuple(sorted((h, a)))
        past = h2h[key]
        h2h_rate = np.mean(past) if past else 0.5

        y = {"H": 0, "D": 1, "A": 2}[r.result]
        rows.append({
            "date": r.date, "home_team": h, "away_team": a,
            "elo_home": r.home_elo, "elo_away": r.away_elo,
            "elo_diff": r.home_elo - r.away_elo,
            "form_pts_diff": fp_h - fp_a,
            "form_gd_diff": gd_h - gd_a,
            "rest_diff": np.clip(rest_h - rest_a, -30, 30),
            "h2h_home_rate": h2h_rate if key[0] == h else 1 - h2h_rate,
            "neutral": int(bool(r.neutral)),
            "avail_diff": 0.0, "squad_val_diff": 0.0, "market_home_edge": 0.0,
            "y": y,
        })

        # update state AFTER recording (no leakage)
        pts_h = 3 if r.result == "H" else 1 if r.result == "D" else 0
        pts_a = 3 if r.result == "A" else 1 if r.result == "D" else 0
        last_pts[h].append(pts_h); last_pts[a].append(pts_a)
        last_gd[h].append(r.home_score - r.away_score)
        last_gd[a].append(r.away_score - r.home_score)
        last_date[h] = r.date; last_date[a] = r.date
        h2h[key].append(1 if r.result == "H" and key[0] == h
                        else 1 if r.result == "A" and key[0] == a else 0)

    out = pd.DataFrame(rows)
    # emit a train/inference feature-coverage report (warns on dead features)
    feature_coverage_report(out, FEATURE_COLS, persist=True)
    return out


def make_feature_vector(*, elo_home: float, elo_away: float, neutral: bool,
                        form_pts_diff: float = 0.0, form_gd_diff: float = 0.0,
                        rest_diff: float = 0.0, h2h_home_rate: float = 0.5,
                        avail_diff: float = 0.0, squad_val_diff: float = 0.0,
                        market_home_edge: float = 0.0) -> np.ndarray:
    """Single prediction-time feature vector in FEATURE_COLS order."""
    vals = {
        "elo_diff": elo_home - elo_away, "elo_home": elo_home, "elo_away": elo_away,
        "form_pts_diff": form_pts_diff, "form_gd_diff": form_gd_diff,
        "rest_diff": np.clip(rest_diff, -30, 30), "h2h_home_rate": h2h_home_rate,
        "neutral": int(bool(neutral)),
        "avail_diff": avail_diff, "squad_val_diff": squad_val_diff,
        "market_home_edge": market_home_edge,
    }
    return np.array([vals[c] for c in FEATURE_COLS], dtype=float)
