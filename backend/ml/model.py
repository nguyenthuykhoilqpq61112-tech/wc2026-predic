"""Dixon-Coles bivariate-Poisson match model with time decay.

Fits per-team attack & defense strengths plus a home advantage and the
low-score correlation correction (rho). Teams with sparse history fall back
to an Elo-derived expected-goals prior so the full 48-team field is covered.
"""
from __future__ import annotations

import pickle
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import poisson

from config import DC_XI, DC_MAX_GOALS, DC_RHO_BOUNDS, GOAL_SCALE, PROC


@dataclass
class DCModel:
    teams: list[str]
    attack: dict[str, float]
    defense: dict[str, float]
    home_adv: float
    rho: float
    base_mu: float                       # league avg goals (per side) baseline
    elo: dict[str, float] = field(default_factory=dict)

    # ---- scoreline probabilities -------------------------------------
    def _lambdas(self, home: str, away: str, neutral: bool,
                 goal_scale: float = 1.0) -> tuple[float, float]:
        ha = 0.0 if neutral else self.home_adv
        if home in self.attack and away in self.attack:
            lh = np.exp(np.clip(self.base_mu + ha + self.attack[home] + self.defense[away], -4.0, 3.0))
            la = np.exp(np.clip(self.base_mu + self.attack[away] + self.defense[home], -4.0, 3.0))
        else:
            lh, la = self._elo_lambdas(home, away, ha)
        # tournament goal calibration (config.GOAL_SCALE) × optional caller scale
        # (e.g. config.KO_GOAL_SCALE for knockout-stage goal suppression).
        scale = getattr(self, "goal_scale", GOAL_SCALE) * goal_scale
        return float(lh) * scale, float(la) * scale

    def _elo_lambdas(self, home: str, away: str, ha: float) -> tuple[float, float]:
        """Fallback: map Elo diff -> expected goals when team unseen in fit."""
        rh = self.elo.get(home, 1500.0) + (ha / self.home_adv * 65 if self.home_adv else 0)
        ra = self.elo.get(away, 1500.0)
        diff = (rh - ra) / 400.0
        tot = np.exp(self.base_mu) * 2          # expected total goals
        ph = 1.0 / (1.0 + 10 ** (-diff))        # win-ish share
        lh = tot * (0.30 + 0.40 * ph)
        la = tot * (0.30 + 0.40 * (1 - ph))
        return lh, la

    def score_matrix(self, home: str, away: str, neutral: bool = True,
                     goal_scale: float = 1.0) -> np.ndarray:
        lh, la = self._lambdas(home, away, neutral, goal_scale)
        ph = poisson.pmf(np.arange(DC_MAX_GOALS + 1), lh)
        pa = poisson.pmf(np.arange(DC_MAX_GOALS + 1), la)
        mat = np.outer(ph, pa)
        # Dixon-Coles low-score dependency correction
        tau = np.ones((DC_MAX_GOALS + 1, DC_MAX_GOALS + 1))
        tau[0, 0] = 1 - lh * la * self.rho
        tau[0, 1] = 1 + lh * self.rho
        tau[1, 0] = 1 + la * self.rho
        tau[1, 1] = 1 - self.rho
        mat = mat * tau
        return mat / mat.sum()

    def outcome_probs(self, home: str, away: str, neutral: bool = True) -> tuple[float, float, float]:
        m = self.score_matrix(home, away, neutral)
        p_home = np.tril(m, -1).sum()
        p_draw = np.trace(m)
        p_away = np.triu(m, 1).sum()
        return float(p_home), float(p_draw), float(p_away)


def _decay_weights(dates: pd.Series, xi: float) -> np.ndarray:
    age_days = (dates.max() - dates).dt.days.to_numpy()
    return np.exp(-xi * age_days)


def fit(df: pd.DataFrame, elo: dict[str, float] | None = None,
        xi: float = DC_XI, min_matches: int = 8) -> DCModel:
    """Fit Dixon-Coles by weighted maximum likelihood."""
    # keep teams with enough recent matches; rest use Elo fallback
    counts = pd.concat([df.home_team, df.away_team]).value_counts()
    teams = sorted(counts[counts >= min_matches].index)
    tidx = {t: i for i, t in enumerate(teams)}
    n = len(teams)

    sub = df[df.home_team.isin(tidx) & df.away_team.isin(tidx)].copy()
    w = _decay_weights(sub.date, xi)
    hi = sub.home_team.map(tidx).to_numpy()
    ai = sub.away_team.map(tidx).to_numpy()
    hg = sub.home_score.to_numpy()
    ag = sub.away_score.to_numpy()
    neutral = sub.neutral.to_numpy()

    base_mu = np.log(max((hg.mean() + ag.mean()) / 2, 0.3))

    # params: [attack(n), defense(n), home_adv, rho]
    x0 = np.concatenate([np.zeros(n), np.zeros(n), [0.25], [-0.05]])

    def unpack(x):
        return x[:n], x[n:2 * n], x[2 * n], x[2 * n + 1]

    def nll(x):
        att, dfn, ha, rho = unpack(x)
        adv = np.where(neutral, 0.0, ha)
        # clip linear predictor -> lambda in (~0.02, ~20); avoids exp overflow
        # when SLSQP probes extreme attack/defense on small training sets
        lh = np.exp(np.clip(base_mu + adv + att[hi] + dfn[ai], -4.0, 3.0))
        la = np.exp(np.clip(base_mu + att[ai] + dfn[hi], -4.0, 3.0))
        ll = w * (poisson.logpmf(hg, lh) + poisson.logpmf(ag, la))
        # DC correction on 0-0,1-0,0-1,1-1
        corr = np.ones_like(lh)
        m00 = (hg == 0) & (ag == 0); corr[m00] = 1 - lh[m00] * la[m00] * rho
        m01 = (hg == 0) & (ag == 1); corr[m01] = 1 + lh[m01] * rho
        m10 = (hg == 1) & (ag == 0); corr[m10] = 1 + la[m10] * rho
        m11 = (hg == 1) & (ag == 1); corr[m11] = 1 - rho
        corr = np.clip(corr, 1e-6, None)
        ll = ll + w * np.log(corr)
        return -ll.sum()

    # sum-to-zero on attack for identifiability
    cons = {"type": "eq", "fun": lambda x: x[:n].sum()}
    # bound rho so an odd training slice can't over-damp high scores; leave the
    # attack/defense/home_adv params free.
    bounds = [(None, None)] * (2 * n + 1) + [DC_RHO_BOUNDS]
    res = minimize(nll, x0, method="SLSQP", constraints=cons, bounds=bounds,
                   options={"maxiter": 200, "ftol": 1e-6})
    att, dfn, ha, rho = unpack(res.x)

    return DCModel(
        teams=teams,
        attack={t: float(att[i]) for t, i in tidx.items()},
        defense={t: float(dfn[i]) for t, i in tidx.items()},
        home_adv=float(ha),
        rho=float(rho),
        base_mu=float(base_mu),
        elo=elo or {},
    )


def main() -> None:
    df = pd.read_parquet(PROC / "results_elo.parquet")
    # train on modern era for relevance
    df = df[df.date >= "2010-01-01"]
    try:
        elo = pd.read_parquet(PROC / "elo_ratings.parquet")["elo"].to_dict()
    except FileNotFoundError:
        elo = {}
    m = fit(df, elo=elo)
    with open(PROC / "dc_model.pkl", "wb") as f:
        pickle.dump(m, f)
    print(f"[model] fit {len(m.teams)} teams, home_adv={m.home_adv:.3f}, rho={m.rho:.3f}")
    # sanity: a marquee tie
    print("Argentina vs Brazil (neutral):",
          tuple(round(p, 3) for p in m.outcome_probs("Argentina", "Brazil")))


if __name__ == "__main__":
    main()
