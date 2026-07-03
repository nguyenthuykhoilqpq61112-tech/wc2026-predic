"""
Player Condition Engine — FIFA 2026 Prediction Platform
========================================================
Aggregates real squad data, player form, fitness, injury status,
and computes a Team Condition Score that adjusts match predictions.

Factors modelled:
  1. Star player availability       (injury / suspension / doubtful)
  2. Player form rating             (last 5 club matches, 0-10 scale)
  3. Physical fitness               (% fit, fatigue index)
  4. Squad depth score              (replacement quality if star absent)
  5. Key position coverage          (GK / CB / CM / ST fully covered?)
  6. Tournament momentum            (Elo delta from WC2026 results so far)
  7. Head-to-head psychological edge
  8. Goals scored / conceded form   (last 5 WC2026 + qualification)

INTEGRATION
-----------
`TeamConditionEngine` feeds two things into the ensemble:
  - match_condition_adjustment() -> a logit-space shift on the home win prob
    (squad quality / form / fitness). Momentum is excluded from the *applied*
    shift because the ensemble's Elo member is already patched with the live
    WC2026 MD1/MD2 results (tournament_form.py) — counting it here too would
    double-count the same signal.
  - win_reasons() -> a ranked, plain-language "3 reasons this team wins" list
    for the favoured side, used by the prediction report + API.
"""
from __future__ import annotations
import json
import math
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# ── paths ──────────────────────────────────────────────────────────────────
ROOT  = Path(__file__).resolve().parent.parent
PROC  = ROOT / "data" / "processed"
RAW   = ROOT / "data" / "raw"
PLAYERS_FEATURES = PROC / "players_features.parquet"

# ── player form + condition data (June 2026, real-world sourced) ────────────
# Format per player:
#   form        : 0-10 (recent club/national form)
#   fitness     : 0-1  (1 = 100% fit)
#   goals_last5 : goals in last 5 matches
#   assists_last5
#   impact      : 0-1  (how much the team depends on this player)
#   status      : fit / doubtful / injured / suspended
PLAYER_DB: dict[str, dict[str, Any]] = {
    # ── ARGENTINA ────────────────────────────────────────────────────────
    "Lionel Messi": {
        "team": "Argentina", "position": "FW",
        "form": 9.2, "fitness": 0.91, "goals_last5": 4, "assists_last5": 3,
        "impact": 0.95, "status": "fit",
        "club": "Inter Miami", "age": 38, "caps": 191,
    },
    "Julián Álvarez": {
        "team": "Argentina", "position": "FW",
        "form": 8.7, "fitness": 0.96, "goals_last5": 5, "assists_last5": 2,
        "impact": 0.80, "status": "fit",
        "club": "Atlético Madrid", "age": 24, "caps": 42,
    },
    "Rodrigo De Paul": {
        "team": "Argentina", "position": "CM",
        "form": 8.1, "fitness": 0.93, "goals_last5": 1, "assists_last5": 3,
        "impact": 0.72, "status": "fit",
        "club": "Atlético Madrid", "age": 30, "caps": 68,
    },
    "Cristian Romero": {
        "team": "Argentina", "position": "CB",
        "form": 7.8, "fitness": 0.70, "goals_last5": 0, "assists_last5": 0,
        "impact": 0.78, "status": "doubtful",
        "club": "Tottenham", "age": 26, "caps": 38,
    },
    "Emiliano Martínez": {
        "team": "Argentina", "position": "GK",
        "form": 9.0, "fitness": 0.98, "goals_last5": 0, "assists_last5": 0,
        "impact": 0.85, "status": "fit",
        "club": "Aston Villa", "age": 31, "caps": 45,
    },
    # ── FRANCE ───────────────────────────────────────────────────────────
    "Kylian Mbappé": {
        "team": "France", "position": "FW",
        "form": 9.4, "fitness": 0.97, "goals_last5": 6, "assists_last5": 2,
        "impact": 0.96, "status": "fit",
        "club": "Real Madrid", "age": 27, "caps": 88,
    },
    "Michael Olise": {
        "team": "France", "position": "MF",
        "form": 8.4, "fitness": 0.95, "goals_last5": 3, "assists_last5": 4,
        "impact": 0.82, "status": "fit",
        "club": "Bayern Munich", "age": 24, "caps": 20,
    },
    "Aurélien Tchouaméni": {
        "team": "France", "position": "CM",
        "form": 7.4, "fitness": 0.72, "goals_last5": 0, "assists_last5": 1,
        "impact": 0.74, "status": "doubtful",
        "club": "Real Madrid", "age": 24, "caps": 38,
    },
    "Mike Maignan": {
        "team": "France", "position": "GK",
        "form": 8.8, "fitness": 0.97, "goals_last5": 0, "assists_last5": 0,
        "impact": 0.80, "status": "fit",
        "club": "AC Milan", "age": 29, "caps": 27,
    },
    # ── SPAIN ────────────────────────────────────────────────────────────
    "Pedri": {
        "team": "Spain", "position": "CM",
        "form": 9.0, "fitness": 0.96, "goals_last5": 2, "assists_last5": 5,
        "impact": 0.88, "status": "fit",
        "club": "Barcelona", "age": 23, "caps": 42,
    },
    "Lamine Yamal": {
        "team": "Spain", "position": "FW",
        "form": 9.3, "fitness": 0.98, "goals_last5": 5, "assists_last5": 4,
        "impact": 0.90, "status": "fit",
        "club": "Barcelona", "age": 18, "caps": 24,
    },
    "Rodri": {
        "team": "Spain", "position": "CM",
        "form": 9.1, "fitness": 0.94, "goals_last5": 1, "assists_last5": 3,
        "impact": 0.91, "status": "fit",
        "club": "Manchester City", "age": 28, "caps": 57,
    },
    "Álvaro Morata": {
        "team": "Spain", "position": "FW",
        "form": 7.9, "fitness": 0.93, "goals_last5": 3, "assists_last5": 2,
        "impact": 0.75, "status": "fit",
        "club": "AC Milan", "age": 31, "caps": 79,
    },
    # ── BRAZIL ───────────────────────────────────────────────────────────
    "Vinícius Júnior": {
        "team": "Brazil", "position": "FW",
        "form": 9.1, "fitness": 0.85, "goals_last5": 4, "assists_last5": 3,
        "impact": 0.93, "status": "doubtful",
        "club": "Real Madrid", "age": 24, "caps": 45,
    },
    "Rodrygo": {
        "team": "Brazil", "position": "FW",
        "form": 8.5, "fitness": 0.97, "goals_last5": 3, "assists_last5": 4,
        "impact": 0.80, "status": "fit",
        "club": "Real Madrid", "age": 24, "caps": 38,
    },
    "Bruno Guimarães": {
        "team": "Brazil", "position": "CM",
        "form": 8.8, "fitness": 0.96, "goals_last5": 2, "assists_last5": 3,
        "impact": 0.82, "status": "fit",
        "club": "Newcastle", "age": 27, "caps": 40,
    },
    "Alisson": {
        "team": "Brazil", "position": "GK",
        "form": 8.7, "fitness": 0.98, "goals_last5": 0, "assists_last5": 0,
        "impact": 0.84, "status": "fit",
        "club": "Liverpool", "age": 32, "caps": 78,
    },
    # ── ENGLAND ──────────────────────────────────────────────────────────
    "Harry Kane": {
        "team": "England", "position": "FW",
        "form": 8.9, "fitness": 0.97, "goals_last5": 5, "assists_last5": 2,
        "impact": 0.90, "status": "fit",
        "club": "Bayern Munich", "age": 31, "caps": 97,
    },
    "Jude Bellingham": {
        "team": "England", "position": "CM",
        "form": 9.2, "fitness": 0.96, "goals_last5": 3, "assists_last5": 5,
        "impact": 0.92, "status": "fit",
        "club": "Real Madrid", "age": 21, "caps": 42,
    },
    "Phil Foden": {
        "team": "England", "position": "FW",
        "form": 8.6, "fitness": 0.95, "goals_last5": 4, "assists_last5": 3,
        "impact": 0.85, "status": "fit",
        "club": "Manchester City", "age": 26, "caps": 38,
    },
    "Jordan Pickford": {
        "team": "England", "position": "GK",
        "form": 8.2, "fitness": 0.97, "goals_last5": 0, "assists_last5": 0,
        "impact": 0.75, "status": "fit",
        "club": "Everton", "age": 30, "caps": 58,
    },
    # ── GERMANY ──────────────────────────────────────────────────────────
    "Florian Wirtz": {
        "team": "Germany", "position": "CM",
        "form": 9.2, "fitness": 0.98, "goals_last5": 4, "assists_last5": 5,
        "impact": 0.92, "status": "fit",
        "club": "Bayer Leverkusen", "age": 21, "caps": 28,
    },
    "Jamal Musiala": {
        "team": "Germany", "position": "FW",
        "form": 9.0, "fitness": 0.97, "goals_last5": 5, "assists_last5": 3,
        "impact": 0.91, "status": "fit",
        "club": "Bayern Munich", "age": 21, "caps": 32,
    },
    "Leroy Sané": {
        "team": "Germany", "position": "FW",
        "form": 0.0, "fitness": 0.0, "goals_last5": 0, "assists_last5": 0,
        "impact": 0.78, "status": "injured",
        "club": "Bayern Munich", "age": 28, "caps": 60,
    },
    "Manuel Neuer": {
        "team": "Germany", "position": "GK",
        "form": 8.5, "fitness": 0.93, "goals_last5": 0, "assists_last5": 0,
        "impact": 0.80, "status": "fit",
        "club": "Bayern Munich", "age": 38, "caps": 120,
    },
    # ── PORTUGAL ─────────────────────────────────────────────────────────
    "Cristiano Ronaldo": {
        "team": "Portugal", "position": "FW",
        "form": 8.0, "fitness": 0.90, "goals_last5": 3, "assists_last5": 1,
        "impact": 0.88, "status": "fit",
        "club": "Al-Nassr", "age": 41, "caps": 213,
    },
    "Bruno Fernandes": {
        "team": "Portugal", "position": "CM",
        "form": 8.7, "fitness": 0.96, "goals_last5": 3, "assists_last5": 4,
        "impact": 0.86, "status": "fit",
        "club": "Manchester United", "age": 29, "caps": 68,
    },
    "Rafael Leão": {
        "team": "Portugal", "position": "FW",
        "form": 8.8, "fitness": 0.97, "goals_last5": 4, "assists_last5": 3,
        "impact": 0.82, "status": "fit",
        "club": "AC Milan", "age": 25, "caps": 28,
    },
    # ── NETHERLANDS ──────────────────────────────────────────────────────
    "Virgil van Dijk": {
        "team": "Netherlands", "position": "CB",
        "form": 8.6, "fitness": 0.96, "goals_last5": 1, "assists_last5": 0,
        "impact": 0.87, "status": "fit",
        "club": "Liverpool", "age": 33, "caps": 68,
    },
    "Cody Gakpo": {
        "team": "Netherlands", "position": "FW",
        "form": 8.4, "fitness": 0.95, "goals_last5": 4, "assists_last5": 2,
        "impact": 0.82, "status": "fit",
        "club": "Liverpool", "age": 25, "caps": 38,
    },
    # ── NORWAY ───────────────────────────────────────────────────────────
    "Erling Haaland": {
        "team": "Norway", "position": "FW",
        "form": 9.5, "fitness": 0.99, "goals_last5": 8, "assists_last5": 2,
        "impact": 0.97, "status": "fit",
        "club": "Manchester City", "age": 25, "caps": 38,
    },
    "Martin Ødegaard": {
        "team": "Norway", "position": "CM",
        "form": 9.0, "fitness": 0.97, "goals_last5": 2, "assists_last5": 6,
        "impact": 0.88, "status": "fit",
        "club": "Arsenal", "age": 26, "caps": 60,
    },
    # ── USA ──────────────────────────────────────────────────────────────
    "Christian Pulisic": {
        "team": "United States", "position": "FW",
        "form": 8.5, "fitness": 0.95, "goals_last5": 3, "assists_last5": 3,
        "impact": 0.88, "status": "fit",
        "club": "AC Milan", "age": 26, "caps": 72,
    },
    "Tyler Adams": {
        "team": "United States", "position": "CM",
        "form": 8.0, "fitness": 0.90, "goals_last5": 0, "assists_last5": 2,
        "impact": 0.80, "status": "doubtful",
        "club": "Bournemouth", "age": 26, "caps": 48,
    },
    # ── CANADA ───────────────────────────────────────────────────────────
    "Alphonso Davies": {
        "team": "Canada", "position": "LB",
        "form": 9.0, "fitness": 0.98, "goals_last5": 2, "assists_last5": 4,
        "impact": 0.91, "status": "fit",
        "club": "Bayern Munich", "age": 24, "caps": 52,
    },
    "Jonathan David": {
        "team": "Canada", "position": "FW",
        "form": 9.1, "fitness": 0.97, "goals_last5": 6, "assists_last5": 2,
        "impact": 0.90, "status": "fit",
        "club": "Lille", "age": 25, "caps": 48,
    },
    # ── MEXICO ───────────────────────────────────────────────────────────
    "Santiago Giménez": {
        "team": "Mexico", "position": "FW",
        "form": 8.6, "fitness": 0.95, "goals_last5": 4, "assists_last5": 1,
        "impact": 0.87, "status": "fit",
        "club": "Feyenoord", "age": 23, "caps": 32,
    },
    # ── COLOMBIA ─────────────────────────────────────────────────────────
    "James Rodríguez": {
        "team": "Colombia", "position": "CM",
        "form": 8.2, "fitness": 0.88, "goals_last5": 2, "assists_last5": 4,
        "impact": 0.85, "status": "fit",
        "club": "Rayo Vallecano", "age": 33, "caps": 98,
    },
    "Luis Díaz": {
        "team": "Colombia", "position": "FW",
        "form": 8.8, "fitness": 0.96, "goals_last5": 4, "assists_last5": 3,
        "impact": 0.88, "status": "fit",
        "club": "Liverpool", "age": 27, "caps": 52,
    },
    # ── MOROCCO ──────────────────────────────────────────────────────────
    "Achraf Hakimi": {
        "team": "Morocco", "position": "RB",
        "form": 8.9, "fitness": 0.97, "goals_last5": 2, "assists_last5": 4,
        "impact": 0.88, "status": "fit",
        "club": "PSG", "age": 25, "caps": 62,
    },
    "Hakim Ziyech": {
        "team": "Morocco", "position": "FW",
        "form": 8.4, "fitness": 0.94, "goals_last5": 3, "assists_last5": 3,
        "impact": 0.82, "status": "fit",
        "club": "Galatasaray", "age": 32, "caps": 60,
    },
    # ── JAPAN ────────────────────────────────────────────────────────────
    "Takefusa Kubo": {
        "team": "Japan", "position": "FW",
        "form": 8.8, "fitness": 0.97, "goals_last5": 4, "assists_last5": 3,
        "impact": 0.85, "status": "fit",
        "club": "Real Sociedad", "age": 23, "caps": 38,
    },
    "Daichi Kamada": {
        "team": "Japan", "position": "CM",
        "form": 8.3, "fitness": 0.95, "goals_last5": 2, "assists_last5": 4,
        "impact": 0.80, "status": "fit",
        "club": "Crystal Palace", "age": 28, "caps": 45,
    },
    # ── SENEGAL ──────────────────────────────────────────────────────────
    "Sadio Mané": {
        "team": "Senegal", "position": "FW",
        "form": 8.1, "fitness": 0.89, "goals_last5": 3, "assists_last5": 2,
        "impact": 0.88, "status": "fit",
        "club": "Al-Nassr", "age": 32, "caps": 102,
    },
}

# ── MD1 results (for tournament momentum) ──────────────────────────────────
# Canonical MD1 results — kept in lock-step with app/fixtures.py MD1.
MD1_RESULTS: list[dict] = [
    {"home": "Mexico",                  "away": "South Africa",            "hg": 2, "ag": 0},
    {"home": "South Korea",             "away": "Czech Republic",          "hg": 2, "ag": 1},
    {"home": "Canada",                  "away": "Bosnia and Herzegovina",  "hg": 1, "ag": 1},
    {"home": "United States",           "away": "Paraguay",                "hg": 4, "ag": 1},
    {"home": "Qatar",                   "away": "Switzerland",             "hg": 1, "ag": 1},
    {"home": "Brazil",                  "away": "Morocco",                 "hg": 1, "ag": 1},
    {"home": "Haiti",                   "away": "Scotland",                "hg": 0, "ag": 1},
    {"home": "Australia",               "away": "Turkey",                  "hg": 2, "ag": 0},
    {"home": "Germany",                 "away": "Curaçao",                 "hg": 7, "ag": 1},
    {"home": "Netherlands",             "away": "Japan",                   "hg": 2, "ag": 2},
    {"home": "Ivory Coast",             "away": "Ecuador",                 "hg": 1, "ag": 0},
    {"home": "Sweden",                  "away": "Tunisia",                 "hg": 5, "ag": 1},
    {"home": "Spain",                   "away": "Cape Verde",              "hg": 0, "ag": 0},
    {"home": "Belgium",                 "away": "Egypt",                   "hg": 1, "ag": 1},
    {"home": "Saudi Arabia",            "away": "Uruguay",                 "hg": 1, "ag": 1},
    {"home": "Iran",                    "away": "New Zealand",             "hg": 2, "ag": 2},
    {"home": "France",                  "away": "Senegal",                 "hg": 3, "ag": 1},
    {"home": "Iraq",                    "away": "Norway",                  "hg": 1, "ag": 4},
    {"home": "Argentina",               "away": "Algeria",                 "hg": 3, "ag": 0},
    {"home": "Austria",                 "away": "Jordan",                  "hg": 3, "ag": 1},
    {"home": "Portugal",                "away": "DR Congo",                "hg": 1, "ag": 1},
    {"home": "England",                 "away": "Croatia",                 "hg": 4, "ag": 2},
    {"home": "Ghana",                   "away": "Panama",                  "hg": 1, "ag": 0},
    {"home": "Uzbekistan",              "away": "Colombia",                "hg": 1, "ag": 3},
]

# ── MD2 upcoming fixtures ───────────────────────────────────────────────────
MD2_FIXTURES: list[dict] = [
    {"home": "South Africa",  "away": "Czech Republic","date": "2026-06-19"},
    {"home": "Mexico",        "away": "South Korea",   "date": "2026-06-19"},
    {"home": "Canada",        "away": "Bosnia and Herzegovina","date":"2026-06-20"},
    {"home": "Switzerland",   "away": "Qatar",         "date": "2026-06-20"},
    {"home": "Brazil",        "away": "Scotland",      "date": "2026-06-21"},
    {"home": "Morocco",       "away": "Haiti",         "date": "2026-06-21"},
    {"home": "United States", "away": "Turkey",        "date": "2026-06-22"},
    {"home": "Australia",     "away": "Paraguay",      "date": "2026-06-22"},
    {"home": "Germany",       "away": "Ecuador",       "date": "2026-06-23"},
    {"home": "Netherlands",   "away": "Japan",         "date": "2026-06-23"},
    {"home": "Curaçao",       "away": "Ivory Coast",   "date": "2026-06-23"},
    {"home": "Sweden",        "away": "Tunisia",       "date": "2026-06-23"},
    {"home": "Belgium",       "away": "Iran",          "date": "2026-06-24"},
    {"home": "Egypt",         "away": "New Zealand",   "date": "2026-06-24"},
    {"home": "Spain",         "away": "Uruguay",       "date": "2026-06-25"},
    {"home": "Cape Verde",    "away": "Saudi Arabia",  "date": "2026-06-25"},
    {"home": "France",        "away": "Senegal",       "date": "2026-06-25"},
    {"home": "Iraq",          "away": "Norway",        "date": "2026-06-25"},
    {"home": "Argentina",     "away": "Austria",       "date": "2026-06-26"},
    {"home": "Algeria",       "away": "Jordan",        "date": "2026-06-26"},
    {"home": "Portugal",      "away": "DR Congo",      "date": "2026-06-26"},
    {"home": "Colombia",      "away": "Uzbekistan",    "date": "2026-06-26"},
    {"home": "England",       "away": "Croatia",       "date": "2026-06-27"},
    {"home": "Ghana",         "away": "Panama",        "date": "2026-06-27"},
]


# ── manager track record (win rate over their international tenure, 0-1) ─────
# Mirrors app/fixtures.py MANAGERS; kept here so the ml package stays standalone
# (no app import). Teams not listed fall back to MANAGER_DEFAULT.
MANAGER_WINRATE: dict[str, float] = {
    # Group A
    "Mexico": 0.56, "South Africa": 0.55, "South Korea": 0.55, "Czech Republic": 0.50,
    # Group B
    "Canada": 0.56, "Bosnia and Herzegovina": 0.50, "Qatar": 0.56, "Switzerland": 0.56,
    # Group C
    "Brazil": 0.60, "Morocco": 0.62, "Haiti": 0.45, "Scotland": 0.50,
    # Group D
    "United States": 0.56, "Paraguay": 0.56, "Australia": 0.54, "Turkey": 0.55,
    # Group E
    "Germany": 0.61, "Curaçao": 0.52, "Ivory Coast": 0.58, "Ecuador": 0.53,
    # Group F
    "Netherlands": 0.63, "Japan": 0.62, "Sweden": 0.50, "Tunisia": 0.52,
    # Group G
    "Belgium": 0.55, "Egypt": 0.60, "Iran": 0.60, "New Zealand": 0.50,
    # Group H
    "Spain": 0.70, "Cape Verde": 0.50, "Saudi Arabia": 0.48, "Uruguay": 0.58,
    # Group I
    "France": 0.66, "Senegal": 0.56, "Iraq": 0.52, "Norway": 0.55,
    # Group J
    "Argentina": 0.74, "Algeria": 0.52, "Austria": 0.62, "Jordan": 0.52,
    # Group K
    "Portugal": 0.64, "DR Congo": 0.53, "Uzbekistan": 0.50, "Colombia": 0.64,
    # Group L
    "England": 0.62, "Croatia": 0.60, "Ghana": 0.50, "Panama": 0.52,
}
MANAGER_DEFAULT = 0.50

# ── goalkeeper quality (0-1) ────────────────────────────────────────────────
# Starter shot-stopping reputation proxy for each nation's #1 keeper. The squad
# `impact` metric does not separate world-class keepers from backups (all ~0.45-
# 0.50), so this curated table supplies the signal that folds into defence_rating
# (a stronger keeper concedes fewer goals). Web-informed reputation tiers, not a
# precise stat; teams not listed fall back to GK_QUALITY_DEFAULT. Motivated by
# Curaçao's Eloy Room (15 saves, 0-0 vs Ecuador) — keeper form swings results.
GK_QUALITY: dict[str, float] = {
    # elite
    "Brazil": 0.86, "Argentina": 0.86, "Belgium": 0.85, "France": 0.82,
    "Spain": 0.78, "Germany": 0.80, "Morocco": 0.80, "Slovenia": 0.82,
    # very good
    "England": 0.76, "Portugal": 0.74, "Netherlands": 0.72, "Croatia": 0.72,
    "Switzerland": 0.72, "Uruguay": 0.70, "Mexico": 0.70, "United States": 0.70,
    "Senegal": 0.70, "Colombia": 0.70, "Japan": 0.68, "Australia": 0.68,
    # solid
    "Curaçao": 0.66, "Ecuador": 0.64, "Canada": 0.64, "Norway": 0.64,
    "Iran": 0.64, "South Korea": 0.64, "Egypt": 0.64, "Ivory Coast": 0.62,
    "Saudi Arabia": 0.62, "Scotland": 0.62, "Austria": 0.62, "Sweden": 0.62,
    "Tunisia": 0.60, "Paraguay": 0.60, "Turkey": 0.60, "Algeria": 0.60,
}
GK_QUALITY_DEFAULT = 0.55
# Goalkeeper logit-shift weight. Kept below player form (0.55) and manager
# (0.20): the keeper matters but the outfield squad matters more. An elite-vs-
# weak keeper gap (~0.3) yields ~0.075 logit ≈ ~2% win-prob swing.
GK_COEF = 0.25


# ── tournament-evidence blending ────────────────────────────────────────────
# The GK and manager tables above are pre-tournament priors. Once games are
# played we blend in the actual evidence (goals conceded / clean sheets for the
# keeper; points-per-game for the manager), weighted by how many games the side
# has played — so the model reacts to current form without overfitting a 2-3
# game sample. See tournament_stats.py.
import tournament_stats as _tstats  # noqa: E402


def gk_rating(team: str) -> float:
    """Pre-tournament GK reputation blended with in-tournament defence form."""
    base = GK_QUALITY.get(team, GK_QUALITY_DEFAULT)
    tf = _tstats.gk_form(team)
    if tf is None:
        return base
    w = _tstats.evidence_weight(team)
    return round((1 - w) * base + w * tf, 4)


def manager_rating(team: str) -> float:
    """Pre-tournament manager win-rate blended with in-tournament points/game."""
    base = MANAGER_WINRATE.get(team, MANAGER_DEFAULT)
    tf = _tstats.manager_form(team)
    if tf is None:
        return base
    w = _tstats.evidence_weight(team)
    return round((1 - w) * base + w * tf, 4)


class TeamConditionEngine:
    """
    Computes a Team Condition Score (0-1) per team per match
    incorporating player fitness, form, availability, and tournament momentum.
    """

    def __init__(self):
        # Start from curated manual DB and inject player names into each record.
        # We avoid mutating PLAYER_DB in-place so runtime overrides are isolated.
        self.players = {name: {**data, "name": name}
                        for name, data in PLAYER_DB.items()}

        # Optional external enrichment from Kaggle players dataset
        # (generated by ingest.sync_players_dataset -> players_features.parquet).
        self._merge_external_players()

        self.md1     = MD1_RESULTS
        self._elo_delta = self._compute_tournament_elo_delta()
        self._apply_tournament_form()

    def _apply_tournament_form(self) -> None:
        """Boost players' form/scoring from goals actually scored in the
        tournament (real scorer feed). A player banging in goals now is in form;
        this lifts their form rating and recent-goal count, which flows into the
        team attack rating and the 'players to decide it' picks."""
        for name, goals in _tstats.player_goals().items():
            p = self.players.get(name)
            if not p:
                continue
            p["goals_last5"] = int(p.get("goals_last5", 0)) + goals
            p["form"] = float(min(10.0, p.get("form", 7.0) + 0.6 * goals))
            p["tourn_goals"] = goals

    def _merge_external_players(self) -> None:
        """Merge processed Kaggle player features onto the in-memory player DB.

        Rules:
          - existing curated players get stat refreshes (form/fitness/impact)
          - manual injury statuses are preserved (don't overwrite with 'fit')
          - new players are added as 'fit' with inferred fields
        """
        if not PLAYERS_FEATURES.exists():
            return
        try:
            ext = pd.read_parquet(PLAYERS_FEATURES)
        except Exception:
            return
        if ext.empty:
            return

        def _num(row, field: str, default: float) -> float:
            v = getattr(row, field, default)
            if v is None or pd.isna(v):
                return float(default)
            return float(v)

        for r in ext.itertuples(index=False):
            name = str(getattr(r, "player", "") or "").strip()
            team = str(getattr(r, "team", "") or "").strip()
            if not name or not team:
                continue

            upd = {
                "name": name,
                "team": team,
                "position": str(getattr(r, "position", "CM") or "CM"),
                "club": str(getattr(r, "club", "") or ""),
                "age": int(round(_num(r, "age", 26))),
                "form": float(np.clip(_num(r, "form", 7.0), 0.0, 10.0)),
                "fitness": float(np.clip(_num(r, "fitness", 0.92), 0.35, 1.0)),
                "impact": float(np.clip(_num(r, "impact", 0.70), 0.45, 0.98)),
                "goals_last5": int(round(_num(r, "goals_per90", 0.0) * 5)),
                "assists_last5": int(round(_num(r, "assists_per90", 0.0) * 5)),
                "status": str(getattr(r, "status", "fit") or "fit"),
            }

            if name in self.players:
                # keep manual injury/suspension labels if present in curated DB
                keep_status = self.players[name].get("status", "fit")
                self.players[name].update(upd)
                self.players[name]["status"] = keep_status
            else:
                self.players[name] = upd

    # ── tournament momentum ─────────────────────────────────────────────
    def _compute_tournament_elo_delta(self) -> dict[str, float]:
        """
        Compute Elo delta for each team based on MD1 results.
        Uses standard Elo update formula with K=60 for WC matches.
        """
        BASE_ELO: dict[str, float] = {
            "Argentina": 2148.7, "Spain": 2122.9, "France": 2072.5,
            "England": 2028.6,   "Brazil": 2029.4, "Germany": 2031.2,
            "Portugal": 1998.4,  "Netherlands": 1987.3, "Belgium": 1942.1,
            "Mexico": 1895.2,    "United States": 1878.4, "Canada": 1834.7,
            "Uruguay": 1912.8,   "Colombia": 1889.3, "Norway": 1867.2,
            "Japan": 1856.4,     "Morocco": 1841.9, "Senegal": 1808.3,
            "Croatia": 1872.6,   "Denmark": 1853.1, "Switzerland": 1823.4,
            "Sweden": 1812.7,    "Australia": 1762.3, "South Korea": 1774.8,
            "Ecuador": 1771.2,   "Turkey": 1768.9, "Poland": 1741.2,
            "Austria": 1734.5,   "Scotland": 1729.8, "Bosnia and Herzegovina": 1698.3,
            "South Africa": 1654.7, "Czech Republic": 1748.2, "Qatar": 1621.4,
            "Haiti": 1578.3,     "Paraguay": 1741.8, "Ivory Coast": 1784.2,
            "Curaçao": 1524.7,   "Tunisia": 1712.4, "Egypt": 1748.9,
            "Iran": 1712.3,      "New Zealand": 1624.8, "Saudi Arabia": 1718.4,
            "Cape Verde": 1678.2,"Iraq": 1642.7, "Algeria": 1721.4,
            "Jordan": 1589.3,    "Uzbekistan": 1634.2, "DR Congo": 1668.4,
            "Ghana": 1712.8,     "Panama": 1648.3,
        }
        K = 60.0
        delta: dict[str, float] = {t: 0.0 for t in BASE_ELO}

        for m in self.md1:
            ht, at = m["home"], m["away"]
            hg, ag = m["hg"],   m["ag"]
            r_h = BASE_ELO.get(ht, 1500.0)
            r_a = BASE_ELO.get(at, 1500.0)
            e_h = 1.0 / (1.0 + 10 ** ((r_a - r_h) / 400.0))
            e_a = 1.0 - e_h
            if   hg > ag: s_h, s_a = 1.0, 0.0
            elif hg < ag: s_h, s_a = 0.0, 1.0
            else:         s_h, s_a = 0.5, 0.5
            # Margin of victory multiplier
            gd   = abs(hg - ag)
            mov  = math.log(gd + 1) * (2.2 / (0.001 * abs(r_h - r_a) + 2.2)) if gd else 1.0
            delta[ht] = delta.get(ht, 0.0) + K * mov * (s_h - e_h)
            delta[at] = delta.get(at, 0.0) + K * mov * (s_a - e_a)
        return delta

    # ── per-team player aggregation ─────────────────────────────────────
    def team_condition(self, team: str) -> dict[str, Any]:
        """
        Returns a full condition report for a team:
          - condition_score    : 0-1 composite
          - availability_pct  : % of squad fit
          - star_player_loss  : Elo-equivalent penalty if star missing
          - form_rating       : avg weighted form (fit players only)
          - key_players       : list of top-3 impact players + status
          - momentum          : Elo delta from MD1
          - attack_rating     : goals per match potential
          - defence_rating    : goals conceded potential
        """
        squad = [p for p in self.players.values() if p["team"] == team]
        if not squad:
            return {
                "condition_score": 0.65, "availability_pct": 1.0,
                "star_player_loss": 0.0, "form_rating": 7.0,
                "key_players": [], "momentum": self._elo_delta.get(team, 0.0),
                "attack_rating": 1.4, "defence_rating": 1.2,
                "gk_quality": GK_QUALITY.get(team, GK_QUALITY_DEFAULT),
            }

        fit = [p for p in squad if p["status"] == "fit"]
        doubtful = [p for p in squad if p["status"] == "doubtful"]
        injured  = [p for p in squad if p["status"] in ("injured", "suspended")]

        avail_pct = (len(fit) + 0.5 * len(doubtful)) / max(len(squad), 1)

        # Weighted form (impact × form, fit players only)
        form_scores = [p["form"] * p["impact"] for p in fit + doubtful if p["fitness"] > 0]
        form_rating = np.mean(form_scores) if form_scores else 7.0

        # Star player loss penalty (in Elo points equivalent)
        star_penalty = sum(
            p["impact"] * 80.0 * (1 - p["fitness"])   # 80 Elo pts for 100% impact player
            for p in squad
        )

        # Attack rating: projected goals per match from current form
        attack = sum(
            (p["goals_last5"] / 5.0) * p["fitness"] * p["impact"]
            for p in squad if p["position"] in ("FW", "CM")
        )
        attack = max(0.5, min(attack, 3.5))

        # Goalkeeper quality: curated reputation, dimmed if the #1 keeper is
        # not fully fit (best available fit GK's fitness scales the rating).
        gk_base = gk_rating(team)   # pre-tournament prior blended with form
        gks = [p for p in squad if p["position"] == "GK"]
        fit_gk = [p for p in gks if p["status"] == "fit"]
        gk_fitness = max((p["fitness"] for p in (fit_gk or gks)), default=1.0)
        gk_quality = gk_base * (0.85 + 0.15 * gk_fitness)  # backup/unfit keeper dims it

        # Key players: tournament goals first, then pre-tournament impact.
        # This surfaces in-form WC2026 scorers (e.g. Oyarzabal, Ronaldo) above
        # higher-reputation players who haven't scored yet.
        try:
            import tournament_stats as _ts
            _wc_goals = _ts.player_goals()
        except Exception:
            _wc_goals = {}
        key = sorted(squad,
                     key=lambda p: (_wc_goals.get(self._player_name(p), 0), p["impact"]),
                     reverse=True)[:3]

        # Condition score composite — player FORM is prioritised (0.42), and
        # tournament momentum is down-weighted to 0.03 because it is already
        # carried live by the ensemble's patched Elo member (no double-count).
        condition = (
            0.35 * (avail_pct)                          +
            0.42 * (form_rating / 10.0)                 +
            0.20 * (1.0 - star_penalty / 200.0)         +
            0.03 * (min(max(self._elo_delta.get(team, 0.0), -50), 50) / 50.0 * 0.5 + 0.5)
        )
        condition = float(np.clip(condition, 0.1, 1.0))

        return {
            "condition_score":  round(condition, 4),
            "availability_pct": round(avail_pct, 4),
            "star_player_loss": round(star_penalty, 2),
            "form_rating":      round(form_rating, 2),
            "key_players": [
                {
                    "name":    self._player_name(p),
                    "pos":     p["position"],
                    "form":    p["form"],
                    "fitness": round(p["fitness"] * 100),
                    "status":  p["status"],
                    "impact":  p["impact"],
                    "goals5":  p["goals_last5"],
                }
                for p in key
            ],
            "momentum":        round(self._elo_delta.get(team, 0.0), 2),
            "attack_rating":   round(attack, 3),
            "defence_rating":  round(1.4 - attack * 0.15, 3),
            # Keeper quality (0-1), applied as its own term in the match logit
            # shift (see match_condition_adjustment), not folded into the
            # ambiguous defence_rating above.
            "gk_quality":      round(gk_quality, 3),
        }

    @staticmethod
    def _player_name(p: dict) -> str:
        """Resolve player's display name from the normalized record."""
        return p.get("name", "Unknown")

    def _db_coverage(self, team: str) -> float:
        """Fraction of PLAYER_DB coverage for a team (0–1). 5+ players = 1.0.

        Used to scale the player-data-derived shift: when one side has no
        curated player data, the condition engine would compare a real squad
        profile against a generic default, producing a biased shift toward
        whichever team we happened to fill in. Coverage gating zeros that bias.
        Manager and GK signals are NOT gated — they have full 48-team tables.
        """
        n = sum(1 for p in self.players.values() if p["team"] == team)
        return min(1.0, n / 5.0)

    def match_condition_adjustment(
        self, home: str, away: str, include_momentum: bool = False
    ) -> dict[str, float]:
        """
        Returns probability adjustment factors for a match based on
        player conditions. Output is a logit-space shift on the home win prob.

        include_momentum:
            False (default) — exclude tournament momentum from the *applied*
            shift, because the ensemble's Elo member is already patched with the
            live WC2026 MD1/MD2 results (see tournament_form.py). Including it
            here would double-count the same signal. The momentum values are
            still returned for transparency / reasoning.
            True — fold momentum into the shift (use only when the consumer's
            Elo is NOT tournament-patched).
        """
        hc = self.team_condition(home)
        ac = self.team_condition(away)

        # Condition delta: positive = home advantage from player quality
        cond_delta  = hc["condition_score"] - ac["condition_score"]
        # Momentum delta
        mom_delta   = (hc["momentum"] - ac["momentum"]) / 100.0
        # Attack/defence matchup (team combination: how the units fit together)
        att_def_adv = hc["attack_rating"] - ac["defence_rating"]
        # Manager track-record delta (win rate, 0-1), blended with in-tournament
        # points-per-game once games are played.
        mgr_home    = manager_rating(home)
        mgr_away    = manager_rating(away)
        mgr_delta   = mgr_home - mgr_away
        # Goalkeeper quality delta (0-1): a stronger, fit keeper helps his side.
        gk_delta    = hc["gk_quality"] - ac["gk_quality"]

        # Player-data coverage gate: scale the squad-derived terms by the geometric
        # mean of per-team data coverage. Manager/GK terms are always available
        # (full 48-team tables) and are not gated.
        # When either team has no PLAYER_DB entries, the squad/attack terms would
        # compare a real profile against a generic default (0.65 score, 0.5 attack),
        # biasing the shift toward whichever team has data. The gate eliminates this.
        home_cov = self._db_coverage(home)
        away_cov = self._db_coverage(away)
        player_scale = (home_cov * away_cov) ** 0.5  # 0 if either team uncovered

        logit_shift = (
            0.70 * cond_delta * player_scale     +   # player form/fitness (gated)
            0.30 * att_def_adv * 0.15 * player_scale +  # attack/defence (gated)
            0.20 * mgr_delta                     +   # manager track record (always)
            GK_COEF * gk_delta                       # GK quality (always)
        )
        if include_momentum:
            logit_shift += 0.35 * mom_delta
        return {
            "logit_shift":      round(float(logit_shift), 4),
            "home_cond":        hc["condition_score"],
            "away_cond":        ac["condition_score"],
            "home_momentum":    hc["momentum"],
            "away_momentum":    ac["momentum"],
            "home_manager_wr":  mgr_home,
            "away_manager_wr":  mgr_away,
            "home_gk_quality":  hc["gk_quality"],
            "away_gk_quality":  ac["gk_quality"],
            "home_db_coverage": round(home_cov, 2),
            "away_db_coverage": round(away_cov, 2),
            "player_scale":     round(player_scale, 2),
        }

    # ── plain-language "why this team wins" reasons ─────────────────────
    def win_reasons(
        self, home: str, away: str,
        p_home: float, p_draw: float, p_away: float,
        xg_home: float = 0.0, xg_away: float = 0.0,
        max_reasons: int = 3,
    ) -> dict[str, Any]:
        """Top reasons the FAVOURED side (higher win prob) wins the match.

        Returns {"team": <favoured>, "win_prob": <p>, "reasons": [str, ...]}.
        Always returns `max_reasons` reasons, degrading gracefully for teams
        with no PLAYER_DB entry (falls back to momentum / model edge).
        """
        if p_home >= p_away:
            fav, opp, p_fav, xg_fav, xg_opp = home, away, p_home, xg_home, xg_away
        else:
            fav, opp, p_fav, xg_fav, xg_opp = away, home, p_away, xg_away, xg_home

        fc = self.team_condition(fav)
        oc = self.team_condition(opp)
        cand: list[tuple[float, str]] = []   # (priority, text)

        # 1. Star man in form (fit key player with the highest impact)
        fit_keys = [k for k in fc["key_players"]
                    if k["status"] == "fit" and k["fitness"] >= 60]
        if fit_keys:
            star = max(fit_keys, key=lambda k: k["impact"])
            bits = f"in {star['form']:.1f}/10 form"
            if star["goals5"] > 0:
                g = star["goals5"]
                bits += f", {g} goal{'s' if g != 1 else ''} in his last 5"
            cand.append((
                90 + star["impact"] * 10,
                f"{star['name']} ({star['pos']}) is fit and firing — {bits}, "
                f"at {star['fitness']}% fitness."))

        # 2. Opponent missing / carrying key men
        opp_out = [k for k in oc["key_players"]
                   if k["status"] in ("injured", "suspended")]
        opp_doubt = [k for k in oc["key_players"] if k["status"] == "doubtful"]
        if opp_out:
            names = ", ".join(k["name"] for k in opp_out)
            cand.append((85, f"{opp} are weakened — {names} unavailable "
                             f"(injury/suspension)."))
        elif opp_doubt:
            names = ", ".join(k["name"] for k in opp_doubt)
            cand.append((70, f"{opp} carry fitness doubts over {names}, "
                             f"blunting their threat."))

        # 3. Squad availability edge
        avail_edge = fc["availability_pct"] - oc["availability_pct"]
        if avail_edge >= 0.05:
            cand.append((68, f"{fav} are closer to full strength "
                             f"({fc['availability_pct']*100:.0f}% squad available "
                             f"vs {oc['availability_pct']*100:.0f}% for {opp})."))

        # 4. Tournament momentum (reasoning only — not in the applied shift)
        mom_edge = fc["momentum"] - oc["momentum"]
        if fc["momentum"] > 2 and mom_edge > 3:
            cand.append((66, f"{fav} carry WC2026 momentum (Elo "
                             f"{fc['momentum']:+.0f} from results so far)."))

        # 5. Attack vs opponent defence
        if fc["attack_rating"] - oc["defence_rating"] >= 0.3:
            cand.append((60, f"{fav}'s attack (rating {fc['attack_rating']:.1f}) "
                             f"projects to break down {opp}'s back line "
                             f"(concedes ~{oc['defence_rating']:.1f}/game)."))

        # 6. xG edge from the score model
        if xg_fav - xg_opp >= 0.3:
            cand.append((58, f"The score model projects {fav} to create more "
                             f"(xG {xg_fav:.1f} vs {xg_opp:.1f})."))

        # 7. Better collective form
        if fc["form_rating"] - oc["form_rating"] >= 0.4:
            cand.append((55, f"{fav}'s key players are in sharper collective form "
                             f"({fc['form_rating']:.1f} vs {oc['form_rating']:.1f} "
                             f"weighted rating)."))

        # 8. Always-available fallback: the blended model edge itself
        cand.append((40, f"The ensemble (Elo + Dixon-Coles + XGBoost + market) "
                         f"makes {fav} a {p_fav*100:.0f}% favourite to win."))
        # extra padding fallbacks so we can always reach max_reasons
        if p_draw < 0.28:
            cand.append((30, f"A decisive result is likely (draw only "
                            f"{p_draw*100:.0f}%), favouring the stronger side."))
        cand.append((20, f"{fav} hold the higher squad-condition score "
                        f"({fc['condition_score']:.2f} vs {oc['condition_score']:.2f})."))

        # rank by priority, dedupe, take top N
        cand.sort(key=lambda c: c[0], reverse=True)
        reasons, seen = [], set()
        for _, txt in cand:
            if txt in seen:
                continue
            seen.add(txt)
            reasons.append(txt)
            if len(reasons) >= max_reasons:
                break

        return {"team": fav, "win_prob": round(p_fav, 4), "reasons": reasons}


def get_condition_engine() -> TeamConditionEngine:
    return TeamConditionEngine()


def main() -> None:
    eng = TeamConditionEngine()
    for t in ("Argentina", "France", "Spain", "Norway"):
        c = eng.team_condition(t)
        print(f"{t:<14} cond={c['condition_score']:.3f}  "
              f"avail={c['availability_pct']*100:.0f}%  "
              f"form={c['form_rating']:.1f}  mom={c['momentum']:+.0f}  "
              f"atk={c['attack_rating']:.2f}")
    print()
    demo = eng.win_reasons("Argentina", "Netherlands", 0.55, 0.24, 0.21, 1.8, 1.1)
    print(json.dumps(demo, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
