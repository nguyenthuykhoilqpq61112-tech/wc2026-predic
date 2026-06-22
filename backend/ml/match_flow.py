"""Knockout match-flow simulation engine.

Where `ensemble.predict` answers "who is more likely to win", this module
simulates the *whole* knockout tie from kickoff to the final whistle and beyond:

    regulation (90')  ->  extra time (120')  ->  penalty shootout

over a Monte-Carlo of full-match runs, and turns the run distribution into the
rich knockout report the engine spec asks for:

  * regulation win / draw / loss probabilities
  * probability the tie reaches extra time
  * probability the tie reaches a shootout
  * conditional shootout winner probabilities (kick-by-kick simulation)
  * expected & most-likely scorelines, expected goals
  * a minute-by-minute match-flow narrative with turning points
  * key players (likely to score / decide the shootout)
  * risk factors and an explainability layer

HYBRID WEIGHTING
----------------
The match probabilities inherit the platform's ensemble blend (Elo/Dixon-Coles
+ market + player-condition). On top of that the shootout and extra-time legs
add the psychology / penalty model the spec calls for. The conceptual weighting
surfaced in `explainability.model_weights` is:

    40% statistical / Elo (Dixon-Coles + Elo member)
    25% player form & fitness (squad-condition engine)
    15% tactical matchup (attack vs defence, manager record)
    10% weather / location (neutral venue here -> small)
    10% psychology & penalty (composure, GK, shootout sim)

Everything is seeded from the matchup so a given tie always renders the same
simulation. Pure numpy; no extra dependencies.
"""
from __future__ import annotations

import math
import zlib
from typing import Any

import numpy as np

# How much of the regulation scoring rate carries into a 30' extra-time period,
# before fatigue. 30/90 of the match length, nudged up slightly for the tired,
# stretched end-to-end football that defines extra time.
ET_RATE_FACTOR = 30.0 / 90.0 * 1.10

# Strength of the squad-condition tilt on the regulation goal rates (mirrors
# ensemble.CONDITION_COEF in spirit; kept gentle so the DC rates still lead).
COND_TILT = 0.9

# Strength of the in-tournament FORM tilt. The Dixon-Coles goal rates are fit on
# pre-tournament history, so without this the knockout sim would ignore how each
# side actually played MD1/MD2. We re-rate the goal rates by the Elo movement the
# group games produced (tournament_form.WC2026_PLAYED): a side that won big is
# boosted, one that was beaten is dimmed. ~40 Elo of net swing ≈ a 5% tilt.
FORM_COEF = 0.55

N_SIMS = 6000

# Conceptual hybrid weighting (see module docstring) — surfaced for the UI.
MODEL_WEIGHTS = {
    "statistical_elo": 0.40,
    "player_form": 0.25,
    "tactical_matchup": 0.15,
    "weather_location": 0.10,
    "psychology_penalty": 0.10,
}


def _seed(home: str, away: str) -> int:
    return zlib.adler32(f"{home}|{away}".encode()) & 0x7FFFFFFF


# ─────────────────────────────────────────────────────────────────────────────
# in-tournament form (MD1/MD2): how each side actually responded
# ─────────────────────────────────────────────────────────────────────────────
def _form_deltas(engine) -> dict[str, float]:
    """Elo movement each team has banked from the played WC2026 group games.

    delta = adjusted_elo - base_elo, where adjusted folds in MD1/MD2 results
    (tournament_form.WC2026_PLAYED) and base is the pre-tournament rating.
    """
    base = dict(engine.dc.elo) if (engine.dc and engine.dc.elo) else dict(engine.elo)
    if not base:
        return {}
    import tournament_form as tf
    adj = tf.get_adjusted_elo(base)
    return {t: round(adj.get(t, r) - r, 1) for t, r in base.items()}


def _form_record(team: str) -> dict[str, Any]:
    """W-D-L + goals for a team across the played WC2026 group games."""
    import tournament_form as tf
    w = d = l = gf = ga = 0
    log: list[str] = []
    for home, away, hs, as_, _neu in tf.WC2026_PLAYED:
        if team == home:
            gf += hs; ga += as_
            res = "W" if hs > as_ else "D" if hs == as_ else "L"
            log.append(f"{res} {hs}-{as_} v {away}")
        elif team == away:
            gf += as_; ga += hs
            res = "W" if as_ > hs else "D" if hs == as_ else "L"
            log.append(f"{res} {as_}-{hs} v {home}")
        else:
            continue
        w += res == "W"; d += res == "D"; l += res == "L"
    return {"played": w + d + l, "w": w, "d": d, "l": l,
            "gf": gf, "ga": ga, "record": f"{w}W-{d}D-{l}L", "log": log}


# ─────────────────────────────────────────────────────────────────────────────
# team profiles (regulation rates + penalty / fatigue inputs)
# ─────────────────────────────────────────────────────────────────────────────
def _profiles(engine, home: str, away: str,
              neutral: bool = True) -> dict[str, Any]:
    """Pull regulation goal rates and condition inputs for both sides."""
    dc = engine.dc
    if dc is not None:
        lh, la = dc._lambdas(home, away, neutral=neutral)
    else:                                   # Elo-only fallback
        eh = engine.elo.get(home, 1500.0); ea = engine.elo.get(away, 1500.0)
        diff = (eh - ea) / 400.0
        ph = 1.0 / (1.0 + 10 ** (-diff))
        lh, la = 1.35 * (0.6 + 0.6 * ph), 1.35 * (0.6 + 0.6 * (1 - ph))

    cond = engine.cond
    if cond is not None:
        hc = cond.team_condition(home)
        ac = cond.team_condition(away)
        adj = cond.match_condition_adjustment(home, away)
    else:
        hc = ac = {"condition_score": 0.65, "form_rating": 7.0,
                   "availability_pct": 1.0, "gk_quality": 0.55,
                   "attack_rating": 1.4, "momentum": 0.0, "key_players": []}
        adj = {"logit_shift": 0.0}

    # In-tournament form: re-rate goal rates by MD1/MD2 Elo movement.
    deltas = _form_deltas(engine)
    fd_h = deltas.get(home, 0.0)
    fd_a = deltas.get(away, 0.0)
    form_shift = FORM_COEF * (fd_h - fd_a) / 100.0

    # Condition tilt (form/fitness/manager/GK) + form tilt: both shift goal
    # rates toward the side in better shape / better current form.
    shift = COND_TILT * float(adj.get("logit_shift", 0.0)) + form_shift
    lh *= math.exp(shift * 0.5)
    la *= math.exp(-shift * 0.5)

    return {
        "home": _side_profile(home, hc, ac, lh, fd_h),
        "away": _side_profile(away, ac, hc, la, fd_a),
        "adj": adj,
        "form_shift": round(form_shift, 4),
    }


def _side_profile(team: str, own: dict, opp: dict, reg_rate: float,
                  form_delta: float = 0.0) -> dict:
    """Per-side inputs for the simulation, including a penalty conversion prob.

    Penalty conversion follows the engine spec's weighting:
        40% composure · 20% penalty skill · 15% GK beaten ·
        10% fatigue · 10% crowd · 5% weather
    mapped onto a realistic ~0.70-0.82 conversion band. Crowd & weather are
    neutral for a World Cup knockout at a neutral venue, so they sit at 0.5.
    """
    composure = 0.5 * own.get("condition_score", 0.65) + \
        0.5 * (own.get("form_rating", 7.0) / 10.0)
    pen_skill = min(1.0, own.get("attack_rating", 1.4) / 2.2)
    gk_beaten = 1.0 - opp.get("gk_quality", 0.55)       # vs opponent keeper
    fatigue = own.get("availability_pct", 1.0)          # fresher squad = higher
    crowd = weather = 0.5                               # neutral venue

    pen_score = (0.40 * composure + 0.20 * pen_skill + 0.15 * gk_beaten +
                 0.10 * fatigue + 0.10 * crowd + 0.05 * weather)
    # 0.62 floor, ~0.86 ceiling — keeps the shootout realistic.
    conversion = float(np.clip(0.62 + 0.27 * pen_score, 0.60, 0.88))

    return {
        "team": team,
        "reg_rate": float(max(0.15, reg_rate)),
        "composure": round(composure, 3),
        "pen_conversion": round(conversion, 3),
        "fatigue_factor": float(np.clip(0.80 + 0.20 * fatigue, 0.75, 1.0)),
        "gk_quality": round(own.get("gk_quality", 0.55), 3),
        "attack_rating": round(own.get("attack_rating", 1.4), 3),
        "momentum": round(own.get("momentum", 0.0), 2),
        "form_delta": round(form_delta, 1),       # MD1/MD2 Elo movement
        "form": _form_record(team),               # W-D-L + goals so far
        "key_players": own.get("key_players", []),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Monte-Carlo: regulation -> extra time -> shootout
# ─────────────────────────────────────────────────────────────────────────────
def _simulate(prof: dict, rng: np.random.Generator,
              knockout: bool = True, n: int = N_SIMS) -> dict[str, Any]:
    """Monte-Carlo a full match.

    knockout=True  -> a draw at 90' goes to extra time then a shootout, so the
                      tie always has a winner (p_extra_time / p_shootout > 0).
    knockout=False -> a group/league fixture: a 90' draw is a valid result and
                      no extra time / shootout is played.
    """
    h, a = prof["home"], prof["away"]

    # Regulation
    gh = rng.poisson(h["reg_rate"], n)
    ga = rng.poisson(a["reg_rate"], n)

    home_90 = gh > ga
    away_90 = ga > gh
    drawn = ~(home_90 | away_90)

    # Aggregate regulation scoreline distribution for "most likely scores"
    pairs = {}
    for x, y in zip(gh.tolist(), ga.tolist()):
        pairs[(x, y)] = pairs.get((x, y), 0) + 1
    top_scores = sorted(pairs.items(), key=lambda kv: kv[1], reverse=True)[:4]
    common = {
        "p_home_90": float(home_90.mean()),
        "p_draw_90": float(drawn.mean()),
        "p_away_90": float(away_90.mean()),
        "exp_goals_home": float(gh.mean()),
        "exp_goals_away": float(ga.mean()),
        "top_scores": [{"score": f"{x}-{y}", "prob": round(c / n, 3)}
                       for (x, y), c in top_scores],
        "modal_score": (top_scores[0][0] if top_scores else (0, 0)),
    }

    if not knockout:                       # group/league: draw is a real result
        return {**common,
                "p_home_win": float(home_90.mean()),
                "p_draw": float(drawn.mean()),
                "p_away_win": float(away_90.mean()),
                "p_extra_time": 0.0, "p_shootout": 0.0,
                "p_home_pens": 0.5, "p_away_pens": 0.5}

    # Knockout: extra time for the drawn subset
    et_h = np.zeros(n, dtype=int)
    et_a = np.zeros(n, dtype=int)
    idx = np.where(drawn)[0]
    if idx.size:
        et_h[idx] = rng.poisson(h["reg_rate"] * ET_RATE_FACTOR *
                                h["fatigue_factor"], idx.size)
        et_a[idx] = rng.poisson(a["reg_rate"] * ET_RATE_FACTOR *
                                a["fatigue_factor"], idx.size)

    th, ta = gh + et_h, ga + et_a
    et_home = drawn & (th > ta)
    et_away = drawn & (ta > th)
    shootout = drawn & (th == ta)

    # Shootout for the still-level subset
    so_home = np.zeros(n, dtype=bool)
    sidx = np.where(shootout)[0]
    for i in sidx:
        so_home[i] = _shootout(h["pen_conversion"], a["pen_conversion"], rng)

    win_home = home_90 | et_home | (shootout & so_home)
    n_pens = int(shootout.sum())
    return {**common,
            "p_home_win": float(win_home.mean()),
            "p_draw": 0.0,
            "p_away_win": float((~win_home).mean()),
            "p_extra_time": float(drawn.mean()),
            "p_shootout": float(shootout.mean()),
            "p_home_pens": float(so_home[sidx].mean()) if n_pens else 0.5,
            "p_away_pens": float((~so_home[sidx]).mean()) if n_pens else 0.5}


def _shootout(conv_h: float, conv_a: float, rng: np.random.Generator) -> bool:
    """One alternating shootout. Returns True if HOME wins. Best-of-5 then
    sudden death. (Slight first-kicker edge is left out — neutral coin-flip on
    who shoots first, averaged out over the Monte-Carlo.)"""
    home_first = rng.random() < 0.5
    sh, sa = 0, 0
    # Regulation 5 kicks each, with early-stop short-circuit on decisiveness.
    for k in range(5):
        rem_after = 4 - k
        if home_first:
            sh += rng.random() < conv_h
            if sh > sa + rem_after + 1:    # away cannot catch up
                return True
            sa += rng.random() < conv_a
            if sa > sh + rem_after:        # home cannot catch up
                return False
        else:
            sa += rng.random() < conv_a
            if sa > sh + rem_after + 1:
                return False
            sh += rng.random() < conv_h
            if sh > sa + rem_after:
                return True
    # Sudden death
    while True:
        h_made = rng.random() < conv_h
        a_made = rng.random() < conv_a
        if h_made != a_made:
            return h_made


# ─────────────────────────────────────────────────────────────────────────────
# narrative, turning points, key players, risk factors, explainability
# ─────────────────────────────────────────────────────────────────────────────
def _narrative(prof: dict, sim: dict, winner: str | None,
               rng: np.random.Generator, knockout: bool = True
               ) -> tuple[list[dict], list[str]]:
    """Minute-by-minute flow for the modal scoreline, plus the path to the
    result (ET / pens) when the tie is projected to go the distance."""
    h, a = prof["home"], prof["away"]
    home, away = h["team"], a["team"]
    gh, ga = sim["modal_score"]

    def _scorer(side: dict) -> str:
        kps = [p for p in side["key_players"]
               if p.get("pos") in ("FW", "CM", "MF")] or side["key_players"]
        return kps[0]["name"] if kps else f"{side['team']} forward"

    events: list[dict] = []
    minutes = sorted(rng.integers(6, 89, size=gh + ga).tolist())
    home_left, away_left = gh, ga
    for mnt in minutes:
        # alternate by remaining, weighted to the higher-xG side
        if home_left and (not away_left or rng.random() < 0.55):
            events.append({"minute": int(mnt), "team": home,
                           "type": "goal", "text": f"{_scorer(h)} strikes for {home}"})
            home_left -= 1
        elif away_left:
            events.append({"minute": int(mnt), "team": away,
                           "type": "goal", "text": f"{_scorer(a)} levels for {away}"})
            away_left -= 1
    # tactical beat
    events.append({"minute": 64, "team": None, "type": "tactical",
                   "text": "Attacking substitutions as both benches go for it"})
    events.sort(key=lambda e: e["minute"])

    # Extra-time / shootout path — knockout only, when it's a likely outcome
    extra = []
    if knockout and winner and (sim["p_shootout"] >= 0.33 or (gh == ga)):
        extra.append({"minute": 90, "team": None, "type": "phase",
                      "text": f"Level at full time {gh}-{ga} — into extra time"})
        if sim["p_shootout"] >= sim["p_extra_time"] * 0.5:
            extra.append({"minute": 120, "team": None, "type": "phase",
                          "text": "Still level after 120' — penalty shootout"})
            extra.append({"minute": 121, "team": winner, "type": "shootout",
                          "text": f"{winner} hold their nerve from the spot"})
        else:
            extra.append({"minute": 113, "team": winner, "type": "goal",
                          "text": f"Fatigue tells — {winner} find a winner in extra time"})
    events.extend(extra)

    turning_points = [e["text"] for e in events
                      if e["type"] in ("goal", "shootout", "phase")][:5]
    return events, turning_points


def _key_players(prof: dict) -> dict:
    def pick(side: dict) -> dict:
        kps = side["key_players"]
        scorer = next((p for p in kps if p.get("pos") in ("FW", "CM")), None) \
            or (kps[0] if kps else None)
        decider = max(kps, key=lambda p: p.get("form", 0), default=None)
        return {
            "likely_scorer": scorer["name"] if scorer else None,
            "penalty_decider": decider["name"] if decider else None,
            "watch": [p["name"] for p in kps[:3]],
        }
    return {prof["home"]["team"]: pick(prof["home"]),
            prof["away"]["team"]: pick(prof["away"])}


def _risk_factors(prof: dict, sim: dict, conf: int | None,
                  knockout: bool = True) -> list[str]:
    h, a = prof["home"], prof["away"]
    risks: list[str] = []
    if knockout and sim["p_shootout"] >= 0.25:
        risks.append(
            f"High shootout risk ({sim['p_shootout']*100:.0f}%) — a coin-flip "
            f"finish; penalty composure decides it.")
    if knockout and sim["p_extra_time"] >= 0.40:
        risks.append(
            f"Likely to go beyond 90' ({sim['p_extra_time']*100:.0f}%) — squad "
            f"depth and fitness become pivotal.")
    if not knockout and sim["p_draw_90"] >= 0.28:
        risks.append(
            f"Honours-even risk ({sim['p_draw_90']*100:.0f}% draw) — a tight, "
            f"low-margin game; points could be shared.")
    edge = abs(sim["p_home_win"] - sim["p_away_win"])
    if edge <= 0.12:
        risks.append("Margins are razor-thin — a single moment likely settles it.")
    if conf is not None and conf < 55:
        risks.append(f"Model confidence is modest ({conf}/100) — wide outcome spread.")
    wk = h if h["gk_quality"] < a["gk_quality"] else a
    if wk["gk_quality"] < 0.55:
        risks.append(f"{wk['team']}'s goalkeeping is a relative weak point under pressure.")
    return risks[:5] or ["No standout risk factors — a clean form-vs-form tie."]


def _explainability(prof: dict, sim: dict, base: dict, favored: str,
                    knockout: bool = True) -> dict:
    reasons: list[str] = []
    h, a = prof["home"], prof["away"]
    w = h if favored == h["team"] else a
    l = a if favored == h["team"] else h
    if w["attack_rating"] > l["attack_rating"]:
        reasons.append(
            f"{w['team']} carries the sharper attack "
            f"({w['attack_rating']:.2f} vs {l['attack_rating']:.2f} xG/match).")
    if w["composure"] > l["composure"]:
        reasons.append(
            f"{w['team']} grades higher on form & big-match composure "
            f"({w['composure']:.0%} vs {l['composure']:.0%}).")
    if w["pen_conversion"] > l["pen_conversion"]:
        reasons.append(
            f"Edge from the spot: {w['team']} convert ~{w['pen_conversion']:.0%} "
            f"vs {l['team']} ~{l['pen_conversion']:.0%} — decisive if it goes to pens.")
    # In-tournament form (how each side responded over the first 2 games)
    if w["form"]["played"] and abs(w["form_delta"] - l["form_delta"]) > 8:
        reasons.append(
            f"Current form favours {w['team']} — group record {w['form']['record']} "
            f"({w['form_delta']:+.0f} Elo) vs {l['team']} {l['form']['record']} "
            f"({l['form_delta']:+.0f}).")
    elif l["form"]["played"] and (l["form_delta"] - w["form_delta"]) > 8:
        reasons.append(
            f"Form is the counter-argument: {l['team']} have actually been "
            f"sharper so far ({l['form']['record']}, {l['form_delta']:+.0f} Elo) — "
            f"a live upset angle.")

    if knockout:
        why_pens = (
            f"Both sides are closely matched, so {sim['p_shootout']*100:.0f}% of "
            f"simulations finish level after 120'."
            if sim["p_shootout"] >= 0.2 else
            f"A shootout is unlikely ({sim['p_shootout']*100:.0f}%) — one side "
            f"should settle it inside 120'.")
    else:
        why_pens = (
            f"A draw is live at {sim['p_draw_90']*100:.0f}% — neither side is "
            f"clear enough to bank on three points."
            if sim["p_draw_90"] >= 0.25 else
            f"{favored} are favoured to take all three points "
            f"({max(sim['p_home_win'], sim['p_away_win'])*100:.0f}%).")
    return {
        "model_weights": MODEL_WEIGHTS,
        "reasons": reasons or base.get("win_reasons", []),
        "why_penalties": why_pens,
        "what_could_change": (
            f"An early goal swings momentum; an injury to {favored}'s key "
            f"creator, or {l['team']} stealing a set-piece, flips it."),
        "confidence": base.get("confidence"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# public entry point
# ─────────────────────────────────────────────────────────────────────────────
def simulate_tie(engine, home: str, away: str, base: dict | None = None,
                 knockout: bool = True, neutral: bool = True) -> dict[str, Any]:
    """Full match-flow simulation report for a single fixture.

    knockout=True  -> single-elimination tie: 90' -> ET -> shootout, always a
                      winner. neutral venue assumed.
    knockout=False -> group / league fixture: a 90' draw is a valid result and
                      `home_advantage` applies when `neutral` is False.

    `base` is the ensemble.predict() output (re-used for confidence / reasons);
    if None, only the simulation-derived fields are populated.
    """
    base = base or {}
    rng = np.random.default_rng(_seed(home, away) + (0 if knockout else 1))
    prof = _profiles(engine, home, away, neutral=neutral)
    sim = _simulate(prof, rng, knockout=knockout)

    # Favoured side (ignores draw) — used for reasons/narrative framing.
    favored = home if sim["p_home_win"] >= sim["p_away_win"] else away
    if knockout:
        winner = favored
        loser = away if winner == home else home
        predicted = winner
        win_prob = max(sim["p_home_win"], sim["p_away_win"])
    else:
        outcomes = {home: sim["p_home_win"], "Draw": sim["p_draw"],
                    away: sim["p_away_win"]}
        predicted = max(outcomes, key=outcomes.get)
        winner = None if predicted == "Draw" else predicted
        loser = (None if predicted == "Draw"
                 else (away if winner == home else home))
        win_prob = outcomes[predicted]

    pen_winner = (home if sim["p_home_pens"] >= sim["p_away_pens"] else away)
    events, turning_points = _narrative(prof, sim, winner, rng, knockout=knockout)
    gh, ga = sim["modal_score"]

    return {
        "engine": "match_flow_montecarlo",
        "n_sims": N_SIMS,
        "mode": "knockout" if knockout else "group",
        "home_team": home, "away_team": away,
        "winner": winner, "loser": loser,
        "predicted_winner": predicted,
        "win_probability": round(win_prob, 4),
        "predicted_score": f"{gh}-{ga}",
        "shootout": knockout and sim["p_shootout"] >= 0.5,
        # outcome probability ladder
        "probabilities": {
            "home_win": round(sim["p_home_win"], 4),
            "away_win": round(sim["p_away_win"], 4),
            "regulation": {
                "home": round(sim["p_home_90"], 4),
                "draw": round(sim["p_draw_90"], 4),
                "away": round(sim["p_away_90"], 4),
            },
            "extra_time": round(sim["p_extra_time"], 4),
            "shootout": round(sim["p_shootout"], 4),
            "shootout_winner": {
                "home": round(sim["p_home_pens"], 4),
                "away": round(sim["p_away_pens"], 4),
                "predicted": pen_winner,
            },
        },
        "expected_goals": {"home": round(sim["exp_goals_home"], 2),
                           "away": round(sim["exp_goals_away"], 2)},
        # In-tournament form folded into the simulation (MD1/MD2).
        "tournament_form": {
            home: {"form_delta": prof["home"]["form_delta"],
                   **prof["home"]["form"]},
            away: {"form_delta": prof["away"]["form_delta"],
                   **prof["away"]["form"]},
            "form_shift": prof.get("form_shift", 0.0),
        },
        "most_likely_scores": sim["top_scores"],
        "match_flow": events,
        "turning_points": turning_points,
        "key_players": _key_players(prof),
        "risk_factors": _risk_factors(prof, sim, base.get("confidence"),
                                      knockout=knockout),
        "explainability": _explainability(prof, sim, base, favored,
                                          knockout=knockout),
        "confidence": base.get("confidence"),
    }
