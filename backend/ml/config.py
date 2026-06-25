
"""Project config: paths, 2026 World Cup format, qualified/projected teams."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
PROC = DATA / "processed"
for _d in (RAW, PROC):
    _d.mkdir(parents=True, exist_ok=True)

# International results CSV (martj42 dataset, mirrored on GitHub).
RESULTS_URL = (
    "https://raw.githubusercontent.com/martj42/international_results/"
    "master/results.csv"
)
RESULTS_CSV = RAW / "results.csv"

# --- 2026 World Cup format -------------------------------------------------
# 48 teams, 12 groups of 4. Top 2 of each group + 8 best 3rd-place advance
# to a 32-team knockout round.
N_GROUPS = 12
TEAMS_PER_GROUP = 4
N_THIRD_PLACE_ADVANCE = 8  # best 8 of 12 third-placed teams

# Elo model params
ELO_START = 1500.0
ELO_K = 40.0          # base K-factor
ELO_HOME_ADV = 65.0   # rating points added to home side
ELO_MOV = True        # scale K by margin of victory

# Dixon-Coles params
DC_XI = 0.0018        # time-decay (per day); ~0.5 weight at ~1 year
DC_MAX_GOALS = 10     # truncate Poisson grid
# rho (low-score correlation) is fit by MLE but bounded so a sparse/odd training
# slice can't drive an extreme low-score correction that over-damps high scores.
DC_RHO_BOUNDS = (-0.15, 0.10)

# --- Goal calibration ------------------------------------------------------
# Multiplicative scale on modeled expected goals. The team-strength priors come
# from all 2010+ internationals (~2.6 goals/match), but a 48-team World Cup runs
# hotter (WC2026 group stage ~3.0 goals/match) thanks to strength mismatches.
# Calibrated on the played WC2026 games: actual/modeled total = 1.155. Lifts both
# lambdas so the scoreline grid (and totals/over-under) tracks reality without
# distorting per-team attack/defense identifiability.
GOAL_SCALE = 1.15

# Independent-Poisson member shape: how goal supremacy and total goals respond to
# the Elo gap. Without these the member was flat (every match -> 2.70 total,
# per-team capped 0.81-1.89) and could never represent a blowout.
POISSON_SUP_K = 1.10     # goal supremacy (favourite - underdog) per unit Elo diff
POISSON_TOT_GAMMA = 0.55  # total-goals lift as the mismatch widens
POISSON_GOAL_FLOOR = 0.18  # min per-team lambda

# --- Knockout-stage calibration -------------------------------------------
# Knockout football is cagier and lower-scoring than the group stage (teams sit
# deeper, the cost of conceding is elimination). Multiplicative suppression on
# the regulation goal rates in the knockout path only (group games untouched).
# ~0.92 ≈ a half-goal-per-tie reduction vs group expectation; re-tune from
# backtest.scoreline_calibration() once real WC2026 knockout games land.
KO_GOAL_SCALE = 0.92

# Host-nation home edge in the knockouts: when a host (USA / Canada / Mexico)
# plays a knockout tie inside its own country it keeps the standard home
# advantage (the tie is flagged non-neutral, so the DC model's home_adv applies)
# instead of the default neutral venue. See app.knockout_engine._resolve_tie and
# fixtures.host_at_home.

# Monte Carlo
N_SIMS = 50000

# Real 2026 World Cup group draw (5 Dec 2025) — used by simulate.py so the MC
# runs within the ACTUAL bracket, not a random re-draw each simulation.
REAL_GROUPS_2026: list[list[str]] = [
    ["Mexico", "South Africa", "South Korea", "Czech Republic"],
    ["Canada", "Bosnia and Herzegovina", "Qatar", "Switzerland"],
    ["Brazil", "Morocco", "Haiti", "Scotland"],
    ["United States", "Paraguay", "Australia", "Turkey"],
    ["Germany", "Curaçao", "Ivory Coast", "Ecuador"],
    ["Netherlands", "Japan", "Sweden", "Tunisia"],
    ["Belgium", "Egypt", "Iran", "New Zealand"],
    ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
    ["France", "Senegal", "Iraq", "Norway"],
    ["Argentina", "Algeria", "Austria", "Jordan"],
    ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
    ["England", "Croatia", "Ghana", "Panama"],
]

# Real 2026 World Cup field — the 48 qualified teams (final draw, 5 Dec 2025).
# Canonical names match the martj42/Kaggle results dataset for Elo/DC lookups.
PROJECTED_FIELD = [
    "Mexico", "South Africa", "South Korea", "Czech Republic",
    "Canada", "Bosnia and Herzegovina", "Qatar", "Switzerland",
    "Brazil", "Morocco", "Haiti", "Scotland",
    "United States", "Paraguay", "Australia", "Turkey",
    "Germany", "Curaçao", "Ivory Coast", "Ecuador",
    "Netherlands", "Japan", "Sweden", "Tunisia",
    "Belgium", "Egypt", "Iran", "New Zealand",
    "Spain", "Cape Verde", "Saudi Arabia", "Uruguay",
    "France", "Senegal", "Iraq", "Norway",
    "Argentina", "Algeria", "Austria", "Jordan",
    "Portugal", "DR Congo", "Uzbekistan", "Colombia",
    "England", "Croatia", "Ghana", "Panama",
]
