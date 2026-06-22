
"""Ensemble match predictor.

Blends every available member into one calibrated forecast and explains it:

  members  = Dixon-Coles, independent Poisson, Elo, XGBoost, Neural Net
  outputs  = win/draw/loss probs, expected goals, top-3 scorelines,
             confidence score, upset probability, plain-language explanation

Members that aren't trained yet (missing artifact) are skipped and the weights
renormalize over what's present, so the engine degrades gracefully.
"""
from __future__ import annotations

import json
import pickle
from dataclasses import dataclass

import numpy as np
import pandas as pd

from config import PROC
import poisson as poisson_mod
import xgb_model
import nn_model
import odds as odds_mod
from model import DCModel
from features import make_feature_vector
from tournament_form import get_adjusted_elo

try:
    from player_condition import TeamConditionEngine
except Exception:        # optional dependency — degrade gracefully
    TeamConditionEngine = None

# default blend weights (renormalized over available members).
# `market` (de-vigged betting odds) is the strongest single signal, so it
# carries the most weight when present; it drops out cleanly when absent.
WEIGHTS = {"market": 0.35, "dc": 0.22, "xgb": 0.18,
           "elo": 0.10, "poisson": 0.07, "nn": 0.08}

# Total number of ensemble member slots — used to scale confidence "coverage".
# (Replaces a hard-coded 5; there are six members in WEIGHTS.)
TOTAL_MEMBERS = len(WEIGHTS)

# Reliability-aware artifacts (all optional, written by the backtest pipeline).
# Every loader degrades to a safe neutral default when the file is missing or
# corrupt, so the engine never hard-depends on them.
CALIBRATOR_FILE = "calibrator.json"        # {"temperature": float}
MEMBER_METRICS_FILE = "member_metrics.json"  # {member: {"log_loss": float}}
RELIABILITY_FILE = "reliability.json"      # {"ece": float, "brier": float}

# Caps on any single dynamic member weight (post-normalization), so one member
# with a freakishly good backtest can't dominate or vanish.
WEIGHT_MIN, WEIGHT_MAX = 0.03, 0.45
# Neutral reliability used when no backtest reliability artifact is present —
# chosen so confidence is essentially unchanged versus the legacy formula.
RELIABILITY_DEFAULT = 0.70
# A member's recent metric is only trusted once it has at least this many
# out-of-sample matches behind it; below that we keep its static weight.
MIN_MEMBER_SAMPLES = 30
# Synthetic-market handling: when the market member is Elo-synthesised (no real
# book), shrink its effective blend weight by this factor and dock a few points
# of confidence so the engine doesn't overtrust a fabricated "market".
SYNTH_MARKET_WEIGHT_PENALTY = 0.25    # 0..1; shrinks the synthetic market weight
SYNTH_MARKET_CONF_PENALTY = 4         # confidence points removed when synthetic

# Confidence display rescale. The raw 4-ingredient score is calibrated but, for
# football's 3-way W/D/L outcome (frequent draws cap a single-match favourite
# near ~70%), realistically lands in a compressed ~27..58 band — so the bar
# never looks "full" even for the clearest games. Stretch that band onto a full
# 0..100 scale for display. Monotonic + order-preserving; underlying
# probabilities and calibration are untouched (presentation only).
CONF_DISPLAY_LO = 27
CONF_DISPLAY_HI = 58

# Draw-call threshold for predicted_winner. The DC/ensemble draw probability for
# 3-way football tops out ~0.28, so a raw argmax almost never returns a draw.
# Emit "Draw" only when the draw outcome is genuinely competitive: its prob clears
# DRAW_PROB_MIN AND the home/away sides are within DRAW_BALANCE of each other.
# Defaults tuned on played WC matches to convert true draws without flipping any
# correct home/away winner pick.
DRAW_PROB_MIN = 0.27       # draw prob must be at least this to consider "Draw"
DRAW_BALANCE = 0.08        # |p_home - p_away| must be within this for a "Draw"


# ─────────────────────────── reliability helpers ───────────────────────────
# These are pure (file -> value) so they can be unit-tested without artifacts
# or a full Ensemble. Each `_load_*` reads PROC; each `_*_from_*` is the pure
# core that the loaders and the tests both call.
def _read_json(path) -> dict | None:
    """Best-effort JSON read. Returns None on missing/unreadable/corrupt file."""
    try:
        with open(path) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else None
    except Exception:
        return None


def _sanitize_temp(t, default: float = 1.0) -> float:
    """Coerce a temperature to a finite positive float, else `default`."""
    try:
        t = float(t)
    except (TypeError, ValueError):
        return default
    return t if np.isfinite(t) and t > 1e-3 else default


class Calibrator:
    """Post-blend probability calibrator on H/D/A probabilities.

    Two strategies, selected by the fitted artifact's ``method`` field:

      * ``"temperature"`` — scalar temperature scaling, ``softmax(log p / T)``.
      * ``"vector_temperature"`` — one temperature per outcome class.

    Both operate in log space and are the identity when their temperature(s)
    equal 1, which is also the safe fallback when no (or a corrupt) artifact
    exists. Scalar temperature never reorders outcomes; the per-class variant
    can correct asymmetric miscalibration (e.g. chronic draw under-confidence)
    while still producing a normalized, finite, strictly-positive distribution.
    """

    def __init__(self, temperature: float = 1.0,
                 method: str = "temperature",
                 temperature_vector: list | None = None):
        self.method = method if method in ("temperature", "vector_temperature") \
            else "temperature"
        self.T = _sanitize_temp(temperature)
        if temperature_vector is None:
            self.Tvec = None
        else:
            self.Tvec = np.array([_sanitize_temp(t) for t in temperature_vector],
                                 dtype=float)
        # degrade to scalar if a vector artifact is malformed
        if self.method == "vector_temperature" and (
                self.Tvec is None or self.Tvec.size == 0):
            self.method = "temperature"

    def __call__(self, probs: np.ndarray) -> np.ndarray:
        p = np.clip(np.asarray(probs, dtype=float), 1e-9, 1.0)
        if self.method == "vector_temperature" and self.Tvec is not None \
                and self.Tvec.size == p.size:
            z = np.log(p) / self.Tvec
        elif abs(self.T - 1.0) < 1e-9:
            return p / p.sum()
        else:
            z = np.log(p) / self.T
        z -= z.max()                      # numerical stability
        e = np.exp(z)
        out = e / e.sum()
        # guarantee finite, strictly-positive, normalized output
        if not np.all(np.isfinite(out)):
            return p / p.sum()
        return out

    @classmethod
    def from_dict(cls, d: dict | None) -> "Calibrator":
        if not d:
            return cls(1.0)
        return cls(temperature=d.get("temperature", 1.0),
                   method=d.get("method", "temperature"),
                   temperature_vector=d.get("temperature_vector"))

    @classmethod
    def load(cls) -> "Calibrator":
        return cls.from_dict(_read_json(PROC / CALIBRATOR_FILE))


def _weights_from_metrics(default: dict, metrics: dict | None) -> dict:
    """Inverse-log-loss member weights, normalized + capped.

    Members with a valid recent `log_loss` get weight ∝ 1/log_loss (lower loss
    -> more trust). Members without a metric keep their *default* weight, scaled
    onto the same magnitude so the two sources mix sanely. Falls back entirely
    to `default` when fewer than two members have usable metrics.
    """
    if not metrics:
        return dict(default)
    inv: dict[str, float] = {}
    for k in default:
        rec = metrics.get(k) or {}
        ll = rec.get("log_loss")
        n = rec.get("sample_count", 0)
        if ll is None:
            continue
        ll = float(ll)
        if not np.isfinite(ll) or ll <= 0:
            continue
        if float(n) < MIN_MEMBER_SAMPLES:   # too little OOS evidence to trust
            continue
        inv[k] = 1.0 / ll
    if len(inv) < 2:                       # not enough signal to trust
        return dict(default)
    # put uncovered members' default weights on the inverse-loss scale
    scale = sum(inv.values()) / sum(default[k] for k in inv)
    raw = {k: inv.get(k, default[k] * scale) for k in default}
    s = sum(raw.values())
    w = {k: v / s for k, v in raw.items()}
    w = {k: min(max(v, WEIGHT_MIN), WEIGHT_MAX) for k, v in w.items()}
    s = sum(w.values())
    return {k: v / s for k, v in w.items()}


def _load_dynamic_weights(default: dict) -> dict:
    return _weights_from_metrics(default, _read_json(PROC / MEMBER_METRICS_FILE))


def _reliability_from_metrics(d: dict | None) -> float:
    """Map recent *calibration* quality to a 0..1 reliability scalar (1 = best).

    Reliability is about whether stated probabilities match observed
    frequencies, so it keys off calibration error — ECE plus the mean absolute
    confidence-bucket gap — not raw Brier (a multiclass Brier mixes in
    irreducible outcome uncertainty and would unfairly tank a well-calibrated
    but inherently uncertain forecast). Both error terms use a 0.15 reference
    scale (≈ a clearly miscalibrated model). Neutral default when no artifact
    is present so confidence matches the legacy behavior.
    """
    if not d:
        return RELIABILITY_DEFAULT
    REF = 0.15
    terms = []
    ece = d.get("ece")
    if ece is not None and np.isfinite(float(ece)):
        terms.append(1.0 - min(float(ece) / REF, 1.0))
    buckets = d.get("confidence_bucket_stats")
    if isinstance(buckets, list) and buckets:
        gaps = [abs(float(b.get("gap", 0.0))) for b in buckets
                if np.isfinite(float(b.get("gap", 0.0)))]
        if gaps:
            terms.append(1.0 - min(float(np.mean(gaps)) / REF, 1.0))
    if not terms:
        return RELIABILITY_DEFAULT
    return float(np.clip(np.mean(terms), 0.0, 1.0))


def _load_reliability() -> float:
    return _reliability_from_metrics(_read_json(PROC / RELIABILITY_FILE))

# How hard live availability (injuries/suspensions) nudges the blend. The
# trained members barely weight `avail_diff` (history has no injury signal),
# so this applies a transparent post-blend logit shift on the win probs.
AVAIL_COEF = 1.8
# Location stats are deliberately down-weighted: in a neutral-venue tournament
# the squad signal (form / combination / manager) should dominate the result,
# not where the game is played. Travel + weather are halved from their
# historical defaults; the Elo home-advantage is also softened (see _elo_probs).
# Travel fatigue: max logit shift when one side has travelled far more.
TRAVEL_COEF = 0.08
# Weather leveller: harsh heat/altitude pulls prob mass to the draw / underdog
# (tournament conditions raise variance). Max draw boost at severity 1.
WEATHER_COEF = 0.035
# Squad-condition leveller: form/fitness/availability/combination + manager of
# the actual squads (player_condition.py). Applied as a logit shift on the win
# probs and PRIORITISED over location stats. Momentum is deliberately excluded
# from this shift (the Elo member is already patched with live WC2026 results —
# see tournament_form.py — so it would double-count).
CONDITION_COEF = 1.75


@dataclass
class MatchContext:
    """Latest team-news deltas (home minus away), all default neutral."""
    form_pts_diff: float = 0.0
    form_gd_diff: float = 0.0
    rest_diff: float = 0.0
    h2h_home_rate: float = 0.5
    avail_diff: float = 0.0          # squad availability % (injuries/suspensions)
    squad_val_diff: float = 0.0      # market value, scaled
    market_home_edge: float = 0.0    # implied edge from betting odds
    market_probs: list | None = None  # de-vigged [pH,pD,pA] from bookmakers
    travel_diff_km: float = 0.0      # home_travel - away_travel (km); + penalises home
    weather_severity: float = 0.0    # 0..1 harsh-conditions leveller


class Ensemble:
    def __init__(self):
        self.dc: DCModel | None = self._load_pickle("dc_model.pkl")
        self.elo = self._load_elo()
        self.xgb = xgb_model.load()
        self.nn = nn_model.load()
        self.cond = TeamConditionEngine() if TeamConditionEngine else None
        # reliability-aware components (all degrade to safe defaults)
        self.weights = _load_dynamic_weights(WEIGHTS)
        self.calibrator = Calibrator.load()
        self.reliability = _load_reliability()

    @staticmethod
    def _load_pickle(name):
        p = PROC / name
        if not p.exists():
            return None
        with open(p, "rb") as f:
            return pickle.load(f)

    @staticmethod
    def _load_elo() -> dict:
        p = PROC / "elo_ratings.parquet"
        if not p.exists():
            return {}
        base = pd.read_parquet(p)["elo"].to_dict()
        # Apply live WC2026 in-tournament micro-Elo updates (MD1/MD2 results)
        return get_adjusted_elo(base)

    # ---------------------------------------------------------------- members
    def _member_probs(self, home, away, neutral, ctx: MatchContext):
        out: dict[str, np.ndarray] = {}
        eh = self.elo.get(home, 1500.0)
        ea = self.elo.get(away, 1500.0)

        if self.dc is not None:
            out["dc"] = np.array(self.dc.outcome_probs(home, away, neutral))
        out["poisson"] = np.array(poisson_mod.outcome_probs(eh, ea, neutral))
        out["elo"] = self._elo_probs(eh, ea, neutral)

        # market member: prefer probs passed in ctx, else look up the odds book,
        # else synthesise Elo-implied odds (discounted weight via WEIGHTS_NO_MARKET).
        # This guarantees the market slot is ALWAYS filled so its 35% weight
        # never silently shifts onto Dixon-Coles alone.
        mkt = ctx.market_probs
        if mkt is None:
            book = odds_mod.get_book().lookup(home, away)
            mkt = book["probs"] if book else None
        if mkt is not None:
            out["market"] = np.array(mkt, dtype=float)
            out["_market_real"] = np.array([1.0])   # sentinel: real book odds
        else:
            # Synthetic market: Elo-derived probs shrunk 10% toward 1/3 each
            # to reflect the extra uncertainty absent real odds imply.
            elo_p = self._elo_probs(eh, ea, neutral)
            out["market"] = 0.90 * elo_p + 0.10 * np.array([1/3, 1/3, 1/3])
            out["_market_real"] = np.array([0.0])   # sentinel: synthetic

        if self.xgb is not None or self.nn is not None:
            fx = make_feature_vector(
                elo_home=eh, elo_away=ea, neutral=neutral,
                form_pts_diff=ctx.form_pts_diff, form_gd_diff=ctx.form_gd_diff,
                rest_diff=ctx.rest_diff, h2h_home_rate=ctx.h2h_home_rate,
                avail_diff=ctx.avail_diff, squad_val_diff=ctx.squad_val_diff,
                market_home_edge=ctx.market_home_edge)
            if self.xgb is not None:
                out["xgb"] = xgb_model.predict_proba(self.xgb, fx)
            if self.nn is not None:
                out["nn"] = nn_model.predict_proba(self.nn, fx)
        return out

    @staticmethod
    def _availability_adjust(probs: np.ndarray, avail_diff: float) -> np.ndarray:
        """Shift win probs by relative squad availability (injuries/suspensions).

        avail_diff>0 means home is healthier -> nudge home win up, away down,
        in log space, leaving draw mass to renormalize.
        """
        if abs(avail_diff) < 1e-6:
            return probs
        ph, pd_, pa = probs
        ph = np.exp(np.log(max(ph, 1e-9)) + AVAIL_COEF * avail_diff)
        pa = np.exp(np.log(max(pa, 1e-9)) - AVAIL_COEF * avail_diff)
        out = np.array([ph, pd_, pa])
        return out / out.sum()

    @staticmethod
    def _conditions_adjust(probs: np.ndarray, ctx: "MatchContext") -> np.ndarray:
        """Travel fatigue (logit shift) + weather leveller (draw boost)."""
        ph, pd_, pa = probs
        # travel: positive travel_diff means home travelled more -> penalise home
        if abs(ctx.travel_diff_km) > 1:
            t = TRAVEL_COEF * np.tanh(ctx.travel_diff_km / 2500.0)
            ph = np.exp(np.log(max(ph, 1e-9)) - t)
            pa = np.exp(np.log(max(pa, 1e-9)) + t)
            s = ph + pd_ + pa
            ph, pd_, pa = ph / s, pd_ / s, pa / s
        # weather: harsh conditions move mass from the favourite to the draw
        sev = ctx.weather_severity
        if sev > 0.01:
            boost = WEATHER_COEF * sev
            if ph >= pa:
                ph = max(0.0, ph - boost)
            else:
                pa = max(0.0, pa - boost)
            pd_ += boost
            s = ph + pd_ + pa
            ph, pd_, pa = ph / s, pd_ / s, pa / s
        return np.array([ph, pd_, pa])

    @staticmethod
    def _condition_shift(probs: np.ndarray, logit_shift: float) -> np.ndarray:
        """Apply the squad-condition logit shift to the win probs.

        logit_shift>0 favours the home side. Symmetric in log space; draw mass
        renormalizes. No-op when the condition engine is absent or neutral.
        """
        if abs(logit_shift) < 1e-6:
            return probs
        ph, pd_, pa = probs
        ph = np.exp(np.log(max(ph, 1e-9)) + CONDITION_COEF * logit_shift)
        pa = np.exp(np.log(max(pa, 1e-9)) - CONDITION_COEF * logit_shift)
        out = np.array([ph, pd_, pa])
        return out / out.sum()

    @staticmethod
    def _elo_probs(eh, ea, neutral, home_adv=35.0):  # softened: location de-prioritised
        adv = 0.0 if neutral else home_adv
        pw = 1.0 / (1.0 + 10 ** ((ea - (eh + adv)) / 400.0))
        draw = 0.27 * (1.0 - abs(2 * pw - 1.0))
        return np.array([pw * (1 - draw), draw, (1 - pw) * (1 - draw)])

    # ---------------------------------------------------------------- predict
    def predict(self, home: str, away: str, neutral: bool = True,
                ctx: MatchContext | None = None) -> dict:
        ctx = ctx or MatchContext()
        members_raw = self._member_probs(home, away, neutral, ctx)

        # strip internal sentinels before blending
        market_real = bool(members_raw.pop("_market_real", np.array([0.0]))[0])
        members = members_raw

        # Effective weights: when the market member is synthetic (Elo-derived,
        # not a real book) shrink its weight so a fabricated "market" can't
        # dominate the blend.
        eff_w = dict(self.weights)
        if not market_real and "market" in members:
            eff_w["market"] = eff_w.get("market", 0.0) * SYNTH_MARKET_WEIGHT_PENALTY
        w = np.array([eff_w.get(k, 0.0) for k in members])
        w = w / w.sum()
        stack = np.vstack([members[k] for k in members])
        blended = (w[:, None] * stack).sum(0)
        blended = blended / blended.sum()
        # post-blend calibration (temperature scaling; identity if unfitted)
        blended = self.calibrator(blended)
        blended = self._availability_adjust(blended, ctx.avail_diff)
        blended = self._conditions_adjust(blended, ctx)

        # Squad-condition shift (player form/fitness/availability). Momentum is
        # excluded here — the Elo member already carries the live WC2026 results.
        cond_info = None
        if self.cond is not None:
            cond_info = self.cond.match_condition_adjustment(
                home, away, include_momentum=False)
            blended = self._condition_shift(blended, cond_info["logit_shift"])

        ph, pd_, pa = (float(x) for x in blended)

        scores, xg_home, xg_away, p_over = self._scorelines(home, away, neutral)
        conf = self._confidence(stack, blended, len(members),
                                TOTAL_MEMBERS, self.reliability)
        # Don't report book-grade confidence off a synthetic market. Penalty is
        # applied in the raw scale, before the display stretch.
        if not market_real:
            conf = int(np.clip(conf - SYNTH_MARKET_CONF_PENALTY, 5, 99))
        conf = self._display_confidence(conf)
        upset = self._upset(home, away, blended)
        market = members.get("market")
        expl = self._explain(home, away, blended, xg_home, xg_away, ctx, conf,
                             market if market_real else None)

        # Plain-language "why the favourite wins" (squad-condition driven).
        win_reasons = None
        if self.cond is not None:
            win_reasons = self.cond.win_reasons(
                home, away, ph, pd_, pa, xg_home, xg_away)

        out = {
            "home": home, "away": away, "neutral": neutral,
            "p_home": round(ph, 4), "p_draw": round(pd_, 4), "p_away": round(pa, 4),
            "expected_goals": {"home": round(xg_home, 2), "away": round(xg_away, 2)},
            "total_goals": round(xg_home + xg_away, 2),
            "over_2_5": round(p_over, 4),
            "top_scores": scores,
            "confidence": conf,
            "upset_probability": round(upset, 4),
            "market_used": market_real,       # True only when real book odds exist
            "members": {k: [round(float(v), 4) for v in p] for k, p in members.items()},
            "explanation": expl,
        }
        if cond_info is not None:
            out["condition"] = cond_info
        # Draw-aware outcome pick: "Draw" when the draw is competitive, else the
        # higher of home/away. Decoupled from win_reasons (which always names the
        # stronger side for the narrative, even when the call is a draw).
        if pd_ >= DRAW_PROB_MIN and abs(ph - pa) <= DRAW_BALANCE:
            out["predicted_winner"] = "Draw"
        else:
            out["predicted_winner"] = home if ph >= pa else away
        if win_reasons is not None:
            out["favored_team"] = win_reasons["team"]
            out["win_reasons"] = win_reasons["reasons"]
        return out

    def _scorelines(self, home, away, neutral, k: int = 3):
        if self.dc is not None:
            m = self.dc.score_matrix(home, away, neutral)
        else:
            eh = self.elo.get(home, 1500.0); ea = self.elo.get(away, 1500.0)
            m = poisson_mod.score_matrix(eh, ea, neutral)
        idx = np.dstack(np.unravel_index(np.argsort(m.ravel())[::-1], m.shape))[0]
        scores = [{"score": f"{int(i)}-{int(j)}", "prob": round(float(m[i, j]), 4)}
                  for i, j in idx[:k]]
        goals = np.arange(m.shape[0])
        xg_home = float((m.sum(1) * goals).sum())
        xg_away = float((m.sum(0) * goals).sum())
        # P(total goals >= 3) i.e. over 2.5, summed over the scoreline grid
        tot = goals[:, None] + goals[None, :]
        p_over = float(m[tot >= 3].sum())
        return scores, xg_home, xg_away, p_over

    @staticmethod
    def _confidence(stack: np.ndarray, blended: np.ndarray, n_members: int,
                    total_members: int = TOTAL_MEMBERS,
                    reliability: float = RELIABILITY_DEFAULT) -> int:
        """Reliability-aware confidence in 0..100.

        Four monotonic ingredients, each in 0..1:
          - agreement    : how tightly the members concur (low cross-member std)
          - decisiveness : how far the favourite sits above a 3-way coin flip
          - coverage     : fraction of the member roster actually present
          - reliability  : recent out-of-sample calibration quality (ECE/Brier)

        `reliability` is the anti-inflation term: a sharp, unanimous prediction
        from a model that has been *badly calibrated* lately is discounted, so
        confidence tracks real reliability rather than mere internal certainty.
        Increasing any ingredient never lowers the score (monotonic); result is
        clipped to 5..99.
        """
        disagreement = float(stack.std(0).mean())          # ~0..0.25
        agreement = max(0.0, 1.0 - disagreement / 0.20)
        decisiveness = float(blended.max() - 1 / 3) / (1 - 1 / 3)  # 0..1
        coverage = min(1.0, n_members / max(total_members, 1))
        reliability = float(np.clip(reliability, 0.0, 1.0))
        score = 100 * (0.35 * agreement + 0.35 * decisiveness +
                       0.12 * coverage + 0.18 * reliability)
        return int(round(np.clip(score, 5, 99)))

    @staticmethod
    def _display_confidence(raw: int) -> int:
        """Stretch the calibrated raw score onto a full 0..100 display scale.

        Maps the realistic football band [CONF_DISPLAY_LO, CONF_DISPLAY_HI] to
        1..100 (clipped). Monotonic, so ordering between matches is preserved —
        a clearer game still outranks a coin-flip; only the spread widens.
        """
        lo, hi = CONF_DISPLAY_LO, CONF_DISPLAY_HI
        return int(np.clip(round((raw - lo) / (hi - lo) * 100), 1, 99))

    def _upset(self, home, away, blended) -> float:
        """P(pre-match underdog wins outright), by Elo."""
        eh = self.elo.get(home, 1500.0); ea = self.elo.get(away, 1500.0)
        return float(blended[2]) if eh >= ea else float(blended[0])

    @staticmethod
    def _explain(home, away, blended, xg_h, xg_a, ctx: MatchContext, conf: int,
                 market=None) -> str:
        ph, pd_, pa = blended
        fav, fav_p = (home, ph) if ph >= pa else (away, pa)
        dog = away if fav == home else home
        parts = [f"{fav} is favoured ({fav_p*100:.0f}% to win) over {dog}, "
                 f"with a {pd_*100:.0f}% chance of a draw."]
        if abs(xg_h - xg_a) >= 0.3:
            sharper = home if xg_h > xg_a else away
            parts.append(f"{sharper} projects to create more "
                         f"(xG {max(xg_h,xg_a):.1f} vs {min(xg_h,xg_a):.1f}).")
        else:
            parts.append(f"Both sides project similar output "
                         f"(xG {xg_h:.1f} vs {xg_a:.1f}) — a tight game.")
        if ctx.form_pts_diff >= 0.4:
            parts.append(f"{home} carries stronger recent form.")
        elif ctx.form_pts_diff <= -0.4:
            parts.append(f"{away} carries stronger recent form.")
        if ctx.avail_diff >= 0.05:
            parts.append(f"{home} is closer to full strength; {away} is carrying "
                         f"notable injuries/suspensions.")
        elif ctx.avail_diff <= -0.05:
            parts.append(f"{away} is closer to full strength; {home} is carrying "
                         f"notable injuries/suspensions.")
        if abs(ctx.travel_diff_km) >= 1500:
            tired = home if ctx.travel_diff_km > 0 else away
            parts.append(f"{tired} carries a heavier travel load "
                         f"(~{abs(int(ctx.travel_diff_km))} km more) into this match.")
        if ctx.weather_severity >= 0.3:
            parts.append("Demanding match conditions add variance and modestly "
                         "level the tie.")
        if market is not None:
            m_fav, m_p = (home, market[0]) if market[0] >= market[2] else (away, market[2])
            agree = m_fav == fav
            parts.append(
                f"The betting market {'agrees' if agree else 'leans the other way'}, "
                f"pricing {m_fav} at {m_p*100:.0f}% to win"
                + ("." if agree else f" against the model's {fav}."))
        # Cutoffs in the display scale; Low (<26) aligns with the UI TOSS-UP flag.
        tone = ("High" if conf >= 55 else "Moderate" if conf >= 26 else "Low")
        parts.append(f"{tone} confidence ({conf}/100): "
                     + ("models broadly agree." if conf >= 55
                        else "models partly disagree — treat as a coin-flippy tie."
                        if conf < 26 else "reasonable agreement across models."))
        return " ".join(parts)


def get_engine() -> Ensemble:
    return Ensemble()


def main():
    e = get_engine()
    import json
    print(json.dumps(e.predict("Argentina", "France"), indent=2))


if __name__ == "__main__":
    main()
