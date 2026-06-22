"""Generate static API snapshots for the Vercel frontend (backend-free demo).

Calls every read-only GET endpoint via FastAPI TestClient (no server needed) and
writes the JSON responses into frontend/public/snapshot/, plus a manifest mapping
each request path (with query) to its snapshot file. lib/api.ts uses the manifest
as a fallback when the live backend is unreachable.

Run:  cd backend && python gen_snapshots.py
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

OUT = Path(__file__).resolve().parents[1] / "frontend" / "public" / "snapshot"
client = TestClient(app)


def slug(path: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", path).strip("_")
    if len(s) > 80:  # keep filenames sane; disambiguate with a hash
        s = s[:80] + "_" + hashlib.sha1(path.encode()).hexdigest()[:8]
    return s or "root"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, str] = {}

    def grab(path: str) -> object | None:
        r = client.get(path)
        if r.status_code != 200:
            print(f"  skip {path} ({r.status_code})")
            return None
        data = r.json()
        fn = f"{slug(path)}.json"
        (OUT / fn).write_text(json.dumps(data))
        manifest[path] = fn
        return data

    # ── static / list endpoints ──────────────────────────────────────────
    grab("/api/home")
    grab("/api/insights")
    grab("/api/knockout")
    grab("/api/awards")
    grab("/api/teams")
    grab("/api/simulate/groups")
    grab("/api/simulate?top=16")
    grab("/api/simulate?top=24")
    grab("/api/matches?upcoming=true&limit=18")
    matches = grab("/api/matches?")  # empty query = all matches
    teams = grab("/api/teams")

    # ── per-entity: match detail + analytics ─────────────────────────────
    for m in matches or []:
        mid = m.get("id")
        if mid is None:
            continue
        grab(f"/api/matches/{mid}")
        grab(f"/api/matches/{mid}/analytics")

    # ── per-entity: team detail ──────────────────────────────────────────
    for t in teams or []:
        name = t.get("name")
        if not name:
            continue
        from urllib.parse import quote
        grab(f"/api/teams/{quote(name)}")

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"\nwrote {len(manifest)} snapshots + manifest -> {OUT}")


if __name__ == "__main__":
    main()
