"""Fetch free-licensed player headshots from Wikipedia/Wikimedia.

For every player shown on the site (curated squads + real goalscorers), look up
the player's Wikipedia page lead image (a Wikimedia Commons thumbnail, which is
free-licensed and hotlinkable). Cache name -> image URL in
`data/raw/player_images.json`. Players with no free image are simply omitted; the
frontend falls back to a generated initials avatar.

Run:  cd backend && python gen_player_images.py
"""
from __future__ import annotations

import json
import time
import urllib.parse
from pathlib import Path

import requests

from app import events, fixtures

OUT = Path(__file__).resolve().parent / "data" / "raw" / "player_images.json"
UA = {"User-Agent": "wc2026-cai-demo/1.0 (educational project)"}
REST = "https://en.wikipedia.org/api/rest_v1/page/summary/"


def _thumb(title: str) -> str | None:
    enc = urllib.parse.quote(title.replace(" ", "_"))
    try:
        r = requests.get(REST + enc, headers=UA, timeout=15)
        if r.status_code != 200:
            return None
        d = r.json()
        if d.get("type") == "disambiguation":
            return None
        return (d.get("thumbnail") or {}).get("source")
    except Exception:  # noqa: BLE001
        return None


def lookup(name: str) -> str | None:
    # Try the plain name, then the "(footballer)" / "(soccer)" disambiguations.
    for title in (name, f"{name} (footballer)", f"{name} (soccer)"):
        url = _thumb(title)
        if url:
            return url
    return None


def collect_names() -> set[str]:
    names: set[str] = set()
    # 1. curated marquee squads (name is the first tuple field)
    for squad in fixtures.SQUADS.values():
        for p in squad:
            names.add(p[0])
    # 2. full real 23-26 man rosters for all 48 teams (squads.json)
    for roster in fixtures._full_squads().values():
        for p in roster:
            nm = p.get("name")
            if nm:
                names.add(nm)
    # 3. real goalscorers scraped from the web
    for rec in events.load().values():
        for side in ("home", "away"):
            for s in rec.get("scorers", {}).get(side, []):
                if s.get("player") and s["player"] != "Unknown":
                    names.add(s["player"])
    return names


def main() -> None:
    existing = {}
    if OUT.exists():
        try:
            existing = json.loads(OUT.read_text())
        except Exception:  # noqa: BLE001
            existing = {}

    names = sorted(collect_names())
    images = dict(existing)
    hit = miss = 0
    for n in names:
        if n in images and images[n]:
            continue
        url = lookup(n)
        if url:
            images[n] = url
            hit += 1
            print(f"  ✓ {n}")
        else:
            miss += 1
            print(f"  · {n} (no free image)")
        time.sleep(0.1)  # be polite to the API

    OUT.write_text(json.dumps(images, ensure_ascii=False, indent=1))
    print(f"\n{hit} new images, {miss} missing, {len(images)} total -> {OUT}")


if __name__ == "__main__":
    main()
