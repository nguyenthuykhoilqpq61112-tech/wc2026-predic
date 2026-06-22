"""Real 2026 FIFA World Cup data provider.

Groups + Matchday-1 results are the actual draw (5 Dec 2025) and real results
(11-17 Jun 2026); Matchday 2 & 3 fixtures are the deterministic group round-robin
with venue/date slots assigned. Team names use the martj42/Kaggle canonical
spelling so Elo / Dixon-Coles lookups line up with the trained models.

The production path (Postgres, see models.py + seed) can replace this provider;
predictions are computed live by the ensemble regardless.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent.parent / "ml"
sys.path.insert(0, str(ML_DIR))

import pandas as pd  # noqa: E402
from config import PROC  # noqa: E402

GROUPS = "ABCDEFGHIJKL"

# --- real final draw (canonical names matching the results dataset) ---------
REAL_GROUPS: dict[str, list[str]] = {
    "A": ["Mexico", "South Africa", "South Korea", "Czech Republic"],
    "B": ["Canada", "Bosnia and Herzegovina", "Qatar", "Switzerland"],
    "C": ["Brazil", "Morocco", "Haiti", "Scotland"],
    "D": ["United States", "Paraguay", "Australia", "Turkey"],
    "E": ["Germany", "Curaçao", "Ivory Coast", "Ecuador"],
    "F": ["Netherlands", "Japan", "Sweden", "Tunisia"],
    "G": ["Belgium", "Egypt", "Iran", "New Zealand"],
    "H": ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
    "I": ["France", "Senegal", "Iraq", "Norway"],
    "J": ["Argentina", "Algeria", "Austria", "Jordan"],
    "K": ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
    "L": ["England", "Croatia", "Ghana", "Panama"],
}

# --- real Matchday-1 results (kickoff ET, home, away, hs, as, city) ----------
# Kickoff times verified vs published 2026 schedule (Eastern, -04:00 EDT).
MD1: list[tuple] = [
    ("2026-06-11T16:00:00-04:00", "Mexico", "South Africa", 2, 0, "Mexico City"),
    ("2026-06-11T18:00:00-04:00", "South Korea", "Czech Republic", 2, 1, "Guadalajara"),
    ("2026-06-12T20:00:00-04:00", "Canada", "Bosnia and Herzegovina", 1, 1, "Toronto"),
    ("2026-06-12T22:00:00-04:00", "United States", "Paraguay", 4, 1, "Los Angeles"),
    ("2026-06-13T13:00:00-04:00", "Haiti", "Scotland", 0, 1, "Boston"),
    ("2026-06-13T15:00:00-04:00", "Brazil", "Morocco", 1, 1, "New York/NJ"),
    ("2026-06-13T17:00:00-04:00", "Qatar", "Switzerland", 1, 1, "San Francisco"),
    ("2026-06-13T17:00:00-04:00", "Australia", "Turkey", 2, 0, "Vancouver"),
    ("2026-06-14T14:00:00-04:00", "Germany", "Curaçao", 7, 1, "Houston"),
    ("2026-06-14T15:00:00-04:00", "Netherlands", "Japan", 2, 2, "Dallas"),
    ("2026-06-14T15:00:00-04:00", "Ivory Coast", "Ecuador", 1, 0, "Philadelphia"),
    ("2026-06-14T17:00:00-04:00", "Sweden", "Tunisia", 5, 1, "Monterrey"),
    ("2026-06-15T13:00:00-04:00", "Spain", "Cape Verde", 0, 0, "Atlanta"),
    ("2026-06-15T15:00:00-04:00", "Belgium", "Egypt", 1, 1, "Seattle"),
    ("2026-06-15T17:00:00-04:00", "Saudi Arabia", "Uruguay", 1, 1, "Miami"),
    ("2026-06-15T19:00:00-04:00", "Iran", "New Zealand", 2, 2, "Los Angeles"),
    ("2026-06-16T16:00:00-04:00", "France", "Senegal", 3, 1, "New York/NJ"),
    ("2026-06-16T17:00:00-04:00", "Iraq", "Norway", 1, 4, "Boston"),
    ("2026-06-16T19:00:00-04:00", "Argentina", "Algeria", 3, 0, "Kansas City"),
    ("2026-06-16T19:00:00-04:00", "Austria", "Jordan", 3, 1, "San Francisco"),
    ("2026-06-17T14:00:00-04:00", "Portugal", "DR Congo", 1, 1, "Houston"),
    ("2026-06-17T16:00:00-04:00", "England", "Croatia", 4, 2, "Dallas"),
    ("2026-06-17T20:00:00-04:00", "Ghana", "Panama", 1, 0, "Toronto"),
    ("2026-06-17T22:00:00-04:00", "Uzbekistan", "Colombia", 1, 3, "Mexico City"),
]

# --- real Matchday 2 & 3 fixtures (official schedule, ET kick-offs, venues) ---
# (kickoff ET, group, matchday, home, away, home_score, away_score, host_city)
# Scores filled only for games already played (Jun 18); the rest are None and
# shown as predictions. Dates/times/pairings/venues are web-verified vs the
# published 2026 schedule. host_city maps to the geo/climate table in venues.py
# (e.g. Inglewood->Los Angeles/SoFi, Santa Clara->San Francisco/Levi's,
# Zapopan->Guadalajara/Akron, Guadalupe->Monterrey/BBVA, Foxborough->Boston,
# Arlington->Dallas, East Rutherford->New York/NJ, Miami Gardens->Miami).
MD23: list[tuple] = [
    # ---- Matchday 2 (Jun 18-23) ----
    ("2026-06-18T13:00:00-04:00", "A", "MD2", "Czech Republic", "South Africa", 1, 1, "Atlanta"),
    ("2026-06-18T15:00:00-04:00", "B", "MD2", "Switzerland", "Bosnia and Herzegovina", 4, 1, "Los Angeles"),
    ("2026-06-18T21:00:00-04:00", "B", "MD2", "Canada", "Qatar", 6, 0, "Vancouver"),
    ("2026-06-18T21:00:00-04:00", "A", "MD2", "Mexico", "South Korea", 1, 0, "Guadalajara"),
    ("2026-06-19T15:00:00-04:00", "D", "MD2", "United States", "Australia", 2, 0, "Seattle"),
    ("2026-06-19T18:00:00-04:00", "C", "MD2", "Scotland", "Morocco", 0, 1, "Boston"),
    ("2026-06-19T21:00:00-04:00", "C", "MD2", "Brazil", "Haiti", 3, 0, "Philadelphia"),
    ("2026-06-20T00:00:00-04:00", "D", "MD2", "Paraguay", "Turkey", 1, 0, "San Francisco"),
    ("2026-06-20T13:00:00-04:00", "F", "MD2", "Netherlands", "Sweden", 5, 1, "Houston"),
    ("2026-06-20T16:00:00-04:00", "E", "MD2", "Germany", "Ivory Coast", 2, 1, "Toronto"),
    ("2026-06-20T20:00:00-04:00", "E", "MD2", "Ecuador", "Curaçao", 0, 0, "Kansas City"),
    ("2026-06-21T00:00:00-04:00", "F", "MD2", "Tunisia", "Japan", 0, 4, "Monterrey"),
    ("2026-06-21T12:00:00-04:00", "H", "MD2", "Spain", "Saudi Arabia", 4, 0, "Atlanta"),
    ("2026-06-21T15:00:00-04:00", "G", "MD2", "Belgium", "Iran", 0, 0, "Los Angeles"),
    ("2026-06-21T18:00:00-04:00", "H", "MD2", "Uruguay", "Cape Verde", 2, 2, "Miami"),
    ("2026-06-21T21:00:00-04:00", "G", "MD2", "New Zealand", "Egypt", None, None, "Vancouver"),
    ("2026-06-22T13:00:00-04:00", "J", "MD2", "Argentina", "Austria", None, None, "Dallas"),
    ("2026-06-22T17:00:00-04:00", "I", "MD2", "France", "Iraq", None, None, "Philadelphia"),
    ("2026-06-22T20:00:00-04:00", "I", "MD2", "Norway", "Senegal", None, None, "New York/NJ"),
    ("2026-06-22T23:00:00-04:00", "J", "MD2", "Jordan", "Algeria", None, None, "San Francisco"),
    ("2026-06-23T13:00:00-04:00", "K", "MD2", "Portugal", "Uzbekistan", None, None, "Houston"),
    ("2026-06-23T16:00:00-04:00", "L", "MD2", "England", "Ghana", None, None, "Boston"),
    ("2026-06-23T19:00:00-04:00", "L", "MD2", "Panama", "Croatia", None, None, "Toronto"),
    ("2026-06-23T22:00:00-04:00", "K", "MD2", "Colombia", "DR Congo", None, None, "Guadalajara"),
    # ---- Matchday 3 (Jun 24-27) ----
    ("2026-06-24T15:00:00-04:00", "B", "MD3", "Switzerland", "Canada", None, None, "Vancouver"),
    ("2026-06-24T15:00:00-04:00", "B", "MD3", "Bosnia and Herzegovina", "Qatar", None, None, "Seattle"),
    ("2026-06-24T18:00:00-04:00", "C", "MD3", "Scotland", "Brazil", None, None, "Miami"),
    ("2026-06-24T18:00:00-04:00", "C", "MD3", "Morocco", "Haiti", None, None, "Atlanta"),
    ("2026-06-24T21:00:00-04:00", "A", "MD3", "Czech Republic", "Mexico", None, None, "Mexico City"),
    ("2026-06-24T21:00:00-04:00", "A", "MD3", "South Africa", "South Korea", None, None, "Monterrey"),
    ("2026-06-25T16:00:00-04:00", "E", "MD3", "Ecuador", "Germany", None, None, "New York/NJ"),
    ("2026-06-25T16:00:00-04:00", "E", "MD3", "Curaçao", "Ivory Coast", None, None, "Philadelphia"),
    ("2026-06-25T19:00:00-04:00", "F", "MD3", "Japan", "Sweden", None, None, "Dallas"),
    ("2026-06-25T19:00:00-04:00", "F", "MD3", "Tunisia", "Netherlands", None, None, "Kansas City"),
    ("2026-06-25T22:00:00-04:00", "D", "MD3", "Turkey", "United States", None, None, "Los Angeles"),
    ("2026-06-25T22:00:00-04:00", "D", "MD3", "Paraguay", "Australia", None, None, "San Francisco"),
    ("2026-06-26T15:00:00-04:00", "I", "MD3", "Norway", "France", None, None, "Boston"),
    ("2026-06-26T15:00:00-04:00", "I", "MD3", "Senegal", "Iraq", None, None, "Toronto"),
    ("2026-06-26T20:00:00-04:00", "H", "MD3", "Cape Verde", "Saudi Arabia", None, None, "Houston"),
    ("2026-06-26T20:00:00-04:00", "H", "MD3", "Uruguay", "Spain", None, None, "Guadalajara"),
    ("2026-06-26T23:00:00-04:00", "G", "MD3", "Egypt", "Iran", None, None, "Seattle"),
    ("2026-06-26T23:00:00-04:00", "G", "MD3", "New Zealand", "Belgium", None, None, "Vancouver"),
    ("2026-06-27T17:00:00-04:00", "L", "MD3", "Panama", "England", None, None, "New York/NJ"),
    ("2026-06-27T17:00:00-04:00", "L", "MD3", "Croatia", "Ghana", None, None, "Philadelphia"),
    ("2026-06-27T19:30:00-04:00", "K", "MD3", "Colombia", "Portugal", None, None, "Miami"),
    ("2026-06-27T19:30:00-04:00", "K", "MD3", "DR Congo", "Uzbekistan", None, None, "Atlanta"),
    ("2026-06-27T22:00:00-04:00", "J", "MD3", "Algeria", "Austria", None, None, "Kansas City"),
    ("2026-06-27T22:00:00-04:00", "J", "MD3", "Jordan", "Argentina", None, None, "Dallas"),
]

FIELD = [t for ts in REAL_GROUPS.values() for t in ts]
HOSTS = {"United States", "Canada", "Mexico"}

CITY_VENUE = {
    "New York/NJ": "MetLife Stadium", "Los Angeles": "SoFi Stadium",
    "Dallas": "AT&T Stadium", "Atlanta": "Mercedes-Benz Stadium",
    "Houston": "NRG Stadium", "Kansas City": "Arrowhead Stadium",
    "Philadelphia": "Lincoln Financial Field", "San Francisco": "Levi's Stadium",
    "Seattle": "Lumen Field", "Miami": "Hard Rock Stadium",
    "Boston": "Gillette Stadium", "Mexico City": "Estadio Azteca",
    "Toronto": "BMO Field", "Vancouver": "BC Place",
    "Guadalajara": "Estadio Akron", "Monterrey": "Estadio BBVA",
}
CITIES = list(CITY_VENUE)

FLAG = {
    "Mexico": "mx", "South Africa": "za", "South Korea": "kr", "Czech Republic": "cz",
    "Canada": "ca", "Bosnia and Herzegovina": "ba", "Qatar": "qa", "Switzerland": "ch",
    "Brazil": "br", "Morocco": "ma", "Haiti": "ht", "Scotland": "gb-sct",
    "United States": "us", "Paraguay": "py", "Australia": "au", "Turkey": "tr",
    "Germany": "de", "Curaçao": "cw", "Ivory Coast": "ci", "Ecuador": "ec",
    "Netherlands": "nl", "Japan": "jp", "Sweden": "se", "Tunisia": "tn",
    "Belgium": "be", "Egypt": "eg", "Iran": "ir", "New Zealand": "nz",
    "Spain": "es", "Cape Verde": "cv", "Saudi Arabia": "sa", "Uruguay": "uy",
    "France": "fr", "Senegal": "sn", "Iraq": "iq", "Norway": "no",
    "Argentina": "ar", "Algeria": "dz", "Austria": "at", "Jordan": "jo",
    "Portugal": "pt", "DR Congo": "cd", "Uzbekistan": "uz", "Colombia": "co",
    "England": "gb-eng", "Croatia": "hr", "Ghana": "gh", "Panama": "pa",
}
# All 48 WC2026 head coaches (names web-verified June 2026, FIFPlay/Bolavip/FIFA).
# Second value = manager international win-rate proxy (0-1), used as a low-weight
# signal in the prediction model (see ml/player_condition.MANAGER_WINRATE — kept
# in sync). Win-rate is an approximate career-with-nation proxy, not a live stat.
MANAGERS = {
    # Group A
    "Mexico": ("Javier Aguirre", 0.56), "South Africa": ("Hugo Broos", 0.55),
    "South Korea": ("Hong Myung-bo", 0.55), "Czech Republic": ("Miroslav Koubek", 0.50),
    # Group B
    "Canada": ("Jesse Marsch", 0.56), "Bosnia and Herzegovina": ("Sergej Barbarez", 0.50),
    "Qatar": ("Julen Lopetegui", 0.56), "Switzerland": ("Murat Yakin", 0.56),
    # Group C
    "Brazil": ("Carlo Ancelotti", 0.60), "Morocco": ("Mohamed Ouahbi", 0.62),
    "Haiti": ("Sébastien Migné", 0.45), "Scotland": ("Steve Clarke", 0.50),
    # Group D
    "United States": ("Mauricio Pochettino", 0.56), "Paraguay": ("Gustavo Alfaro", 0.56),
    "Australia": ("Tony Popovic", 0.54), "Turkey": ("Vincenzo Montella", 0.55),
    # Group E
    "Germany": ("Julian Nagelsmann", 0.61), "Curaçao": ("Dick Advocaat", 0.52),
    "Ivory Coast": ("Emerse Faé", 0.58), "Ecuador": ("Sebastián Beccacece", 0.53),
    # Group F
    "Netherlands": ("Ronald Koeman", 0.63), "Japan": ("Hajime Moriyasu", 0.62),
    "Sweden": ("Graham Potter", 0.50), "Tunisia": ("Sami Trabelsi", 0.52),
    # Group G
    "Belgium": ("Rudi Garcia", 0.55), "Egypt": ("Hossam Hassan", 0.60),
    "Iran": ("Amir Ghalenoei", 0.60), "New Zealand": ("Darren Bazeley", 0.50),
    # Group H
    "Spain": ("Luis de la Fuente", 0.70), "Cape Verde": ("Bubista", 0.50),
    "Saudi Arabia": ("Giorgos Donis", 0.48), "Uruguay": ("Marcelo Bielsa", 0.58),
    # Group I
    "France": ("Didier Deschamps", 0.66), "Senegal": ("Pape Thiaw", 0.56),
    "Iraq": ("Graham Arnold", 0.52), "Norway": ("Ståle Solbakken", 0.55),
    # Group J
    "Argentina": ("Lionel Scaloni", 0.74), "Algeria": ("Vladimir Petković", 0.52),
    "Austria": ("Ralf Rangnick", 0.62), "Jordan": ("Jamal Sellami", 0.52),
    # Group K
    "Portugal": ("Roberto Martínez", 0.64), "DR Congo": ("Sébastien Desabre", 0.53),
    "Uzbekistan": ("Fabio Cannavaro", 0.50), "Colombia": ("Néstor Lorenzo", 0.64),
    # Group L
    "England": ("Thomas Tuchel", 0.62), "Croatia": ("Zlatko Dalić", 0.60),
    "Ghana": ("Otto Addo", 0.50), "Panama": ("Thomas Christiansen", 0.52),
}

# Curated squads for marquee teams (rest get a generic squad).
SQUADS = {
    "Argentina": [
        ("Lionel Messi", "FW", "Inter Miami", 6, 5, 4.8, 4.1, 95, "fit"),
        ("Lautaro Martínez", "FW", "Inter", 8, 2, 7.2, 1.6, 88, "fit"),
        ("Julián Álvarez", "FW", "Atlético Madrid", 7, 4, 6.1, 3.0, 86, "fit"),
        ("Enzo Fernández", "MF", "Chelsea", 3, 6, 2.1, 4.4, 84, "fit"),
        ("Cristian Romero", "DF", "Tottenham", 1, 0, 0.7, 0.3, 85, "fit"),
        ("Emiliano Martínez", "GK", "Aston Villa", 0, 0, 0.0, 0.0, 89, "fit"),
    ],
    "France": [
        ("Kylian Mbappé", "FW", "Real Madrid", 9, 3, 8.4, 2.2, 94, "fit"),
        ("Antoine Griezmann", "MF", "Atlético Madrid", 5, 6, 4.0, 5.1, 86, "fit"),
        ("Ousmane Dembélé", "FW", "PSG", 6, 5, 5.0, 4.0, 85, "fit"),
        ("Aurélien Tchouaméni", "MF", "Real Madrid", 1, 2, 0.6, 1.4, 84, "fit"),
        ("William Saliba", "DF", "Arsenal", 1, 0, 0.5, 0.2, 86, "fit"),
        ("Mike Maignan", "GK", "AC Milan", 0, 0, 0.0, 0.0, 87, "fit"),
    ],
    "Brazil": [
        ("Vinícius Júnior", "FW", "Real Madrid", 8, 6, 7.0, 4.5, 92, "fit"),
        ("Rodrygo", "FW", "Real Madrid", 6, 5, 5.2, 3.8, 86, "fit"),
        ("Raphinha", "FW", "Barcelona", 7, 7, 6.0, 5.5, 88, "fit"),
        ("Bruno Guimarães", "MF", "Newcastle", 2, 3, 1.2, 2.0, 84, "fit"),
        ("Marquinhos", "DF", "PSG", 1, 0, 0.6, 0.2, 84, "fit"),
        ("Alisson", "GK", "Liverpool", 0, 0, 0.0, 0.0, 88, "fit"),
    ],
    "England": [
        ("Harry Kane", "FW", "Bayern Munich", 10, 3, 9.1, 2.4, 90, "fit"),
        ("Jude Bellingham", "MF", "Real Madrid", 7, 6, 5.8, 4.6, 91, "fit"),
        ("Bukayo Saka", "FW", "Arsenal", 6, 7, 5.0, 5.2, 88, "fit"),
        ("Phil Foden", "MF", "Man City", 6, 5, 4.8, 4.0, 87, "fit"),
        ("John Stones", "DF", "Man City", 1, 1, 0.5, 0.6, 83, "doubt"),
        ("Jordan Pickford", "GK", "Everton", 0, 0, 0.0, 0.0, 84, "fit"),
    ],
    "Spain": [
        ("Lamine Yamal", "FW", "Barcelona", 7, 9, 5.5, 6.8, 92, "fit"),
        ("Nico Williams", "FW", "Athletic Club", 6, 5, 4.6, 4.0, 87, "fit"),
        ("Rodri", "MF", "Man City", 3, 4, 1.8, 2.6, 90, "fit"),
        ("Pedri", "MF", "Barcelona", 3, 5, 1.9, 3.8, 88, "fit"),
        ("Robin Le Normand", "DF", "Atlético Madrid", 1, 0, 0.4, 0.2, 83, "fit"),
        ("Unai Simón", "GK", "Athletic Club", 0, 0, 0.0, 0.0, 84, "fit"),
    ],
    "Portugal": [
        ("Cristiano Ronaldo", "FW", "Al Nassr", 7, 1, 6.5, 1.0, 84, "fit"),
        ("Rafael Leão", "FW", "AC Milan", 6, 5, 5.0, 4.2, 86, "fit"),
        ("Bruno Fernandes", "MF", "Man Utd", 6, 8, 4.4, 6.0, 88, "fit"),
        ("Bernardo Silva", "MF", "Man City", 4, 6, 2.8, 4.6, 86, "fit"),
        ("Rúben Dias", "DF", "Man City", 1, 0, 0.5, 0.3, 86, "fit"),
        ("Diogo Costa", "GK", "Porto", 0, 0, 0.0, 0.0, 85, "fit"),
    ],
}
_POS_CYCLE = ["FW", "FW", "MF", "MF", "DF", "GK"]


@lru_cache
def _elo() -> dict:
    p = PROC / "elo_ratings.parquet"
    if not p.exists():
        return {t: 1500.0 for t in FIELD}
    return pd.read_parquet(p)["elo"].to_dict()


@lru_cache
def _draw() -> dict[str, list[str]]:
    return {g: list(ts) for g, ts in REAL_GROUPS.items()}


def team_group(name: str) -> str:
    for g, ts in REAL_GROUPS.items():
        if name in ts:
            return g
    return ""


def group_tables() -> dict[str, list[dict]]:
    """Actual group standings from played group matches.

    Per team: MP, W, D, L, GF, GA, GD, Pts. Sorted by Pts, then GD, then GF
    (FIFA tie-break order, head-to-head omitted). Teams with no games yet show
    all zeros. Pure function of `schedule()` — recomputes as results land.
    """
    stats = {t: {"team": t, "mp": 0, "w": 0, "d": 0, "l": 0,
                 "gf": 0, "ga": 0, "pts": 0} for t in FIELD}
    for m in schedule():
        if m["stage"] != "group" or not m["played"]:
            continue
        h, a = m["home_team"], m["away_team"]
        hs, as_ = m["home_score"], m["away_score"]
        for t, gf, ga in ((h, hs, as_), (a, as_, hs)):
            s = stats[t]
            s["mp"] += 1
            s["gf"] += gf
            s["ga"] += ga
            if gf > ga:
                s["w"] += 1
                s["pts"] += 3
            elif gf == ga:
                s["d"] += 1
                s["pts"] += 1
            else:
                s["l"] += 1
    out: dict[str, list[dict]] = {}
    for g, ts in REAL_GROUPS.items():
        rows = [{**stats[t], "gd": stats[t]["gf"] - stats[t]["ga"]} for t in ts]
        rows.sort(key=lambda r: (r["pts"], r["gd"], r["gf"]), reverse=True)
        out[g] = rows
    return out


@lru_cache
def teams() -> list[dict]:
    elo = _elo()
    ranked = sorted(FIELD, key=lambda t: elo.get(t, 1500), reverse=True)
    rank = {t: i + 1 for i, t in enumerate(ranked)}
    out = []
    for t in FIELD:
        code = FLAG.get(t, "")
        mgr, mwr = MANAGERS.get(t, ("", 0.0))
        out.append({
            "code": (code.split("-")[-1] if code else t[:3]).upper()[:3],
            "name": t, "group": team_group(t),
            "elo": round(elo.get(t, 1500.0), 1), "fifa_rank": rank[t],
            "flag_url": f"https://flagcdn.com/96x72/{code}.png" if code else "",
            "manager": mgr, "manager_winrate": mwr,
            "strength_index": round(min(100, max(0, (elo.get(t, 1500) - 1300) / 7)), 1),
        })
    return out


@lru_cache
def team_index() -> dict[str, dict]:
    return {t["name"]: t for t in teams()}


_POS_MAP = {"GK": "GK", "DEF": "DF", "MID": "MF", "FWD": "FW",
            "DF": "DF", "MF": "MF", "FW": "FW"}
_POS_BASE = {"FW": 84, "MF": 80, "DF": 76, "GK": 74}


@lru_cache
def _full_squads() -> dict:
    """Real 23-26 man rosters for all 48 teams (web-sourced)."""
    import json
    p = Path(__file__).resolve().parent / "squads.json"
    return json.loads(p.read_text()) if p.exists() else {}


@lru_cache
def _player_images() -> dict:
    """name -> free-licensed Wikipedia/Commons headshot URL.

    Built offline by `gen_player_images.py`. Players with no free image are
    absent; the frontend falls back to an initials avatar.
    """
    import json
    p = Path(__file__).resolve().parent.parent / "data" / "raw" / "player_images.json"
    try:
        return json.loads(p.read_text()) if p.exists() else {}
    except Exception:  # noqa: BLE001
        return {}


def player_photo(name: str) -> str:
    return _player_images().get(name, "")


def squad(name: str) -> list[dict]:
    # 1. curated marquee squad (rich real stats)
    rows = SQUADS.get(name)
    if rows is not None:
        return [{"name": nm, "position": pos, "club": club, "goals": g,
                 "assists": a, "xg": xg, "xa": xa, "impact": imp,
                 "fitness": fit, "photo_url": player_photo(nm)}
                for (nm, pos, club, g, a, xg, xa, imp, fit) in rows]
    # 2. full real roster (name/position/club); ratings derived deterministically
    full = _full_squads().get(name)
    if full:
        out = []
        for i, p in enumerate(full):
            pos = _POS_MAP.get(p.get("position", "MF"), "MF")
            impact = max(40, min(90, round(_POS_BASE[pos] - i * 0.18)))
            out.append({"name": p["name"], "position": pos,
                        "club": p.get("club") or "—", "number": p.get("number"),
                        "goals": 0, "assists": 0, "xg": 0.0, "xa": 0.0,
                        "impact": impact, "fitness": "fit",
                        "photo_url": player_photo(p["name"])})
        return out
    # 3. generic fallback (team with no roster data)
    rows = [(f"{name} Player {i+1}", _POS_CYCLE[i % 6], "—",
             max(0, 5 - i), max(0, 4 - i), 0.0, 0.0, 70 - i * 3, "fit")
            for i in range(6)]
    return [{"name": nm, "position": pos, "club": club, "goals": g, "assists": a,
             "xg": xg, "xa": xa, "impact": imp, "fitness": fit, "photo_url": ""}
            for (nm, pos, club, g, a, xg, xa, imp, fit) in rows]


def key_players(name: str, k: int = 3) -> dict:
    s = sorted(squad(name), key=lambda p: p["impact"], reverse=True)
    attack = [p for p in s if p["position"] in ("FW", "MF")][:k]
    defense = [p for p in s if p["position"] in ("DF", "GK")][:max(2, k - 1)]
    return {"attacking": attack, "defensive": defense}


@lru_cache
def _gen_schedule() -> list[dict]:
    """Real MD1 results + generated MD2/MD3 group fixtures (2026)."""
    out: list[dict] = []
    mid = 1
    # ---- Matchday 1: real results, real ET kickoff times ----
    for (ko_iso, h, a, hs, as_, city) in MD1:
        ko = datetime.fromisoformat(ko_iso)
        out.append(_mk(mid, team_group(h), h, a, city, ko, hs, as_, "MD1"))
        mid += 1
    # ---- Matchday 2 & 3: official schedule, real ET kick-offs, real venues ----
    for (ko_iso, g, md, h, a, hs, as_, city) in MD23:
        ko = datetime.fromisoformat(ko_iso)
        out.append(_mk(mid, g, h, a, city, ko, hs, as_, md))
        mid += 1
    return out


@lru_cache
def schedule() -> list[dict]:
    return _gen_schedule()


@lru_cache
def knockout() -> list[dict]:
    """Knockout bracket (R32 -> Final): real dates/venues, ET kick-offs.
    Team slots are bracket placeholders (e.g. 'Winner Group A') until the group
    stage resolves, so these are NOT run through the predictor. Source data
    derived from the public worldcup2026 dataset; kicks converted to ET."""
    import json
    p = Path(__file__).resolve().parent / "knockout.json"
    rows = json.loads(p.read_text())
    for r in rows:
        r["stage"] = "knockout"
        r["venue"] = CITY_VENUE.get(r["city"], r["city"])
    return rows


@lru_cache
def _match_times() -> dict:
    """Authoritative ET kick-offs keyed 'home|away' (venue-local converted to
    Eastern from the worldcup2026 dataset; matches FIFA). Overrides any earlier
    web-scraped times, which proved inconsistent across aggregators."""
    import json
    p = Path(__file__).resolve().parent / "match_times.json"
    return json.loads(p.read_text()) if p.exists() else {}


def _mk(mid, g, h, a, city, ko, hs, as_, md) -> dict:
    # offset-aware kickoffs (MD1, real ET) keep their offset; naive generated
    # kickoffs are tagged UTC ("Z") and rendered in ET by the frontend.
    kickoff = ko.isoformat() if ko.tzinfo else ko.isoformat() + "Z"
    kickoff = _match_times().get(f"{h}|{a}", kickoff)  # authoritative ET override
    return {
        "id": mid, "stage": "group", "group": g, "matchday": md,
        "home_team": h, "away_team": a,
        "venue": CITY_VENUE.get(city, city), "city": city,
        "kickoff": kickoff,
        "neutral": not (h in HOSTS),
        "weather": "", "home_rest_days": 4, "away_rest_days": 4,
        "home_score": hs, "away_score": as_,
        "played": hs is not None,
    }


@lru_cache
def match_by_id(mid: int) -> dict | None:
    for m in schedule():
        if m["id"] == mid:
            return m
    return None


@lru_cache
def _team_match_cities() -> dict[str, list[tuple[int, str]]]:
    d: dict[str, list[tuple[int, str]]] = {}
    for m in schedule():
        d.setdefault(m["home_team"], []).append((m["id"], m["city"]))
        d.setdefault(m["away_team"], []).append((m["id"], m["city"]))
    return d


def prev_city(team: str, match_id: int) -> str | None:
    prev = [c for (i, c) in _team_match_cities().get(team, []) if i < match_id]
    return prev[-1] if prev else None
