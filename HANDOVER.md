# WC2026 — CAI (ChrisAI) Prediction Platform — Session Handover

Date: 2026-06-21
Branch: `main` · all work committed + pushed to
`github.com/Christy-Varghese/wc2026-prediction-platform`.

🌐 Live: https://chris-fifaworldcup26-prediction.vercel.app

---

## 1. ML ensemble + calibration — DONE
- Priority reweight: squad form/condition up, location (travel/weather) down.
- Reliability-aware confidence + temperature/vector calibration (identity
  fallback), dynamic inverse-log-loss member weights, synthetic-market de-trust.
  Artifacts in `backend/data/processed/`: `calibrator.json`, `member_metrics.json`,
  `reliability.json`, `feature_coverage.json`.
- **Draw-aware pick:** `predicted_winner` now returns `"Draw"` when draw prob is
  competitive and sides are level (`DRAW_PROB_MIN`/`DRAW_BALANCE` in `ensemble.py`);
  the leaning side is kept as `favored_team`.
- Tests: `backend/tests/` + `backend/ml/tests/` — all pass.

## 2. Manager + goalkeeper signals — DONE
- `MANAGER_WINRATE` (in `ml/player_condition.py`) + `fixtures.MANAGERS` expanded
  to **all 48 web-verified head coaches** (Brazil = Ancelotti, Morocco = Ouahbi).
  Applied as a 0.20 logit term.
- `GK_QUALITY` table (curated keeper-strength tiers, fitness-adjusted) applied as
  a dedicated `GK_COEF = 0.25 × gk_delta` logit term. Surfaced in the knockout
  analysis modal. Weight order: player form 0.55 > GK 0.25 > manager 0.20.
  Direction verified empirically (strong keeper → side harder to beat).

## 3. Knockout projection — DONE (`app/knockout_engine.py`)
- Projects final group standings (real results + predicted remaining games),
  best-8 third-place teams via backtracking slot assignment, resolves R32→Final
  through the predictor (higher win-prob advances). Memoized; `invalidate()` after
  ingest. `/api/knockout` returns resolved teams, per-tie prediction, sim title-%,
  player/manager/GK analysis, and a podium (champion / runner-up / 3rd).
- **Scoreline-consistency fix:** `predicted_score` never shows a loser-win; level
  ties resolve to a draw + `shootout` flag (pens). Frontend: fixed-width columns
  (no name cutoff), title-% chips, podium, click-a-tie analysis modal.

## 4. Post-match analysis (news) — DONE
- `app/match_analytics.py` `post_match_report()` serves curated, news-sourced
  write-ups (`data/raw/post_match.json`: headline, summary, star man, turning
  point, what was missing; sourced ESPN + others) with an auto-generated factual
  fallback for any not-yet-curated completed match.
- Frontend: completed matches show a 📰 Post-Match Analysis card; the old
  "BROADCAST WIDGETS / Activate at kickoff" stubs render only for unplayed games.

## 5. Results ingested (MD1 + MD2 through Jun 21)
- Jun 19: Scotland 0-1 Morocco, Brazil 3-0 Haiti, Paraguay 1-0 Turkey.
- Jun 20: Netherlands 5-1 Sweden, Germany 2-1 Ivory Coast, Ecuador 0-0 Curaçao,
  Tunisia 0-4 Japan.
- Jun 21: Spain 4-0 Saudi Arabia, Belgium 0-0 Iran (Belgium red card 2H),
  Uruguay 2-2 Cape Verde (Araújo 44', Canobbio 45+6' / Pina 21', Varela 61').
  All with web-verified scorers in `match_events.json` + curated `post_match.json`.
  **NZ vs Egypt left unplayed** (`None`) — was still live (NZ 1-0) at ingest time;
  ingest it once final.
- Updated via `fixtures.py` schedule + `data/raw/results.csv` (Python, not sed) +
  `ml/tournament_form.py` `WC2026_PLAYED` (kept in lock-step with fixtures).
- Monte Carlo re-run (`python ml/simulate.py`, N=50000, ~25s). **Projected
  champion unchanged: Argentina ≈31.0%** (Spain 11.0%, England 8.0%, France 7.6%).
  The two Jun 21 draws shift Group G/H standings, not the title favorite.
  Tests pass (calibration 7/7, ensemble 14/14); knockout/services engines verified.

## 6. Branding — DONE
- Rebranded all user-facing "AI" → **CAI (ChrisAI)** (nav, titles, "CAI picks",
  "CAI INSIGHTS", "CAI Pre-Match Analysis", layout metadata). Admin page + nav
  button removed (public showcase site).

## 7. Deployment — DONE
- **Frontend → Vercel**, git-integrated (auto-deploys from `main`, root `frontend`),
  custom alias `chris-fifaworldcup26-prediction.vercel.app`, SSO protection off.
- **Backend → Render** ready via `render.yaml` (not yet provisioned — needs the
  owner's dashboard login; see `DEPLOY.md`).
- **Backend-free demo:** `backend/gen_snapshots.py` → static JSON in
  `frontend/public/snapshot/`; `lib/api.ts` falls back to snapshots when the live
  backend is unreachable (uses `no-cache` so new deploys aren't served stale).

---

## Known issues / watch-outs
- **`retrain.py` full run can hang at the sim step** in this macOS/Python 3.14
  environment (BLAS/multiprocessing + the subprocess stdout pipe). `_sim` now runs
  `simulate.py` in a subprocess writing to a log file (not the inherited pipe) with
  a 900s timeout. If a full `retrain.run()` still stalls, run the steps' models
  then `python ml/simulate.py` standalone (reliable ~1 min), which is what the
  current artifacts were built with.
- `torch` not installed → NN member off (intentional). XGBoost member active.
- `results.csv` is git-ignored (large); the prebuilt artifacts in
  `data/processed/` are committed so the API/snapshots work without a retrain.

## Refresh after new matches
```bash
cd backend && source ../.venv/bin/activate
# 1. add results to fixtures.py + data/raw/results.csv + match_events.json
#    + a post_match.json entry (news analysis)
# 2. rebuild models (or just re-sim if Elo/DC are current):
python ml/simulate.py                 # reliable standalone sim
# 3. regenerate static snapshots + push (Vercel auto-deploys):
python gen_snapshots.py
cd .. && git add -A && git commit -m "data: <date> results" && git push
```

## Environment / repro
```bash
cd /Users/christyvarghese/Documents/ObsidianVault/SecondBrain/wc2026-prediction-platform
source .venv/bin/activate
cd backend && uvicorn app.main:app --reload --port 8000   # API → :8000/docs
cd ../frontend && npm run dev                              # UI → :3000
# tests:
python backend/tests/test_calibration_engine.py
python backend/ml/tests/test_ensemble_confidence.py
```
