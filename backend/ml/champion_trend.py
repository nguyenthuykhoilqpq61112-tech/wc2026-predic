"""Champion-probability trend over time.

Each Monte Carlo re-sim archives the previous `sim_results.json` into
`data/processed/sim_archive/sim_results_<UTC-timestamp>.json`. This reads that
archive plus the current `sim_results.json` and builds a per-day time series of
title-winner probability for the current top teams — so the site can show how
the model's champion call has moved as results come in.

Pure/presentation-agnostic (no flags); the router decorates with flag URLs.
"""
from __future__ import annotations

import glob
import json
import re
from datetime import datetime, timezone
from pathlib import Path

PROC = Path(__file__).resolve().parent.parent / "data" / "processed"
ARCH = PROC / "sim_archive"
CUR = PROC / "sim_results.json"


def _champ_map(path: str | Path) -> dict[str, float]:
    try:
        data = json.loads(Path(path).read_text())
    except Exception:  # noqa: BLE001
        return {}
    return {x["team"]: float(x.get("Champion", 0.0)) for x in data if "team" in x}


def build(top: int = 6) -> dict:
    """One point per calendar day (the day's latest sim), for the top `top`
    teams by current champion %."""
    points: list[tuple[datetime, dict]] = []
    for f in glob.glob(str(ARCH / "sim_results_*.json")):
        m = re.search(r"(\d{8}T\d{6})", f)
        if not m:
            continue
        try:
            ts = datetime.strptime(m.group(1), "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        points.append((ts, _champ_map(f)))
    if CUR.exists():
        points.append((datetime.now(timezone.utc), _champ_map(CUR)))

    points = [p for p in points if p[1]]
    if not points:
        return {"series": [], "teams": []}
    points.sort(key=lambda p: p[0])

    # keep the latest sim per calendar day
    by_day: dict[object, tuple[datetime, dict]] = {}
    for ts, cm in points:
        by_day[ts.date()] = (ts, cm)
    days = sorted(by_day.keys())

    latest = by_day[days[-1]][1]
    teams = [t for t, _ in sorted(latest.items(), key=lambda kv: -kv[1])[:top]]

    series = []
    for d in days:
        _, cm = by_day[d]
        row = {"date": d.strftime("%b %d")}
        for t in teams:
            row[t] = round(cm.get(t, 0.0) * 100, 1)
        series.append(row)

    return {"series": series, "teams": teams,
            "n_points": len(series), "as_of": days[-1].isoformat()}
