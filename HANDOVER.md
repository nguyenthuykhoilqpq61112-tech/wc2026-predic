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

## 8. Scoreline calibration — DONE
Scorelines ran ~13% low on goals (modeled 2.60 vs actual 3.00 g/match over 39
played games) and clustered too low for blowouts. Fixed:
- **`config.GOAL_SCALE = 1.15`** — multiplicative calibration on Dixon-Coles
  lambdas (`model.py._lambdas`). Implied scale now **1.005** (modeled total/match
  2.98 vs actual 3.00). Re-tune from `backtest.scoreline_calibration()`'s
  `implied_scale` if a future slice drifts.
- **Poisson member de-flattened** (`poisson.py`): supremacy + total now scale with
  the Elo gap (`POISSON_SUP_K`, `POISSON_TOT_GAMMA`) — even 3.10, mismatch 5.45,
  huge 6.09. Was locked at 2.70 total / per-team ≤1.89 (couldn't blow out).
- **rho bounded** (`DC_RHO_BOUNDS`) so an odd training slice can't over-damp high
  scores; DC refit (rho=−0.080, in range).
- Predictions now carry **`total_goals` + `over_2_5`**; list cards expose
  `top_scores` (detail page already rendered the top-3). `backtest.py` gains
  `scoreline_calibration()` (modeled vs actual totals, goal MAE, O/U-2.5 acc).
- Re-sim: champion stable (Argentina 32.3%). O/U-2.5 acc 0.72, goal MAE 0.86.
- **⚠️ Refit DC only via module import** (`import model; model.fit(...)`), never
  `python ml/model.py` directly — the latter pickles the class as
  `__main__.DCModel`, which `ensemble.py` (`from model import DCModel`) can't load.
  `retrain.py` already does it the right way.
- **Bigger accuracy levers still need new data** (not done): real shot-level xG
  feed, confirmed kickoff lineups, real over/under + handicap odds, match-event
  (red cards/pens) data. See the chat analysis for the ranked list.

## Known issues / watch-outs
- **Custom alias is not on the Vercel project, so deploys don't update it.**
  Root cause (diagnosed Jun 21): `chris-fifaworldcup26-prediction.vercel.app` is
  **not in the project's Domains list**. Prod deploys only auto-alias the domains
  the project owns — here `frontend-five-iota-33.vercel.app`. The custom alias was
  set manually once and stays pinned; pushes to `main` build fine but never move
  it, so the live URL serves stale data while the repo + build are correct.
  **⚠️ STILL OUTSTANDING — permanent fix not yet applied.** Recurred again
  Jun 22 (had to re-run the manual alias after the recalibrated-model push).
  It will keep recurring on every prod deploy until done. **Permanent fix
  (do this once):** add `chris-fifaworldcup26-prediction.vercel.app` under
  Vercel → project → Settings → Domains → Add — then it follows every deploy
  and the manual step below is no longer needed.
  **Manual fix (used Jun 21 + Jun 22):** from the repo ROOT (not `frontend/`,
  or Vercel looks for `frontend/frontend`): `npx vercel --prod --yes` then
  `npx vercel alias set <printed-hash-url> chris-fifaworldcup26-prediction.vercel.app`.
  Verify by comparing a prediction value (e.g. match 40 `p_home`) in the live
  `…/snapshot/api_home.json` against the local file — they must match. NOTE: the
  response `last-modified`/`age` headers are NOT a reliable stale tell here —
  Vercel returns `last-modified ≈ now, age 0` even when the alias serves an old
  deployment. Compare content, not headers.
  Vercel MCP is 403 for this team scope, so the agent can't do it — needs the CLI.
- **`retrain.py` OpenMP deadlock — FIXED Jun 22 (commit 7df34f4).** Full
  `retrain.run()` used to hang ~12h: running several OpenMP/BLAS steps (Dixon-Coles
  scipy refit, XGBoost, sim, walk-forward backtest) back-to-back in one process
  deadlocked in libomp's join barrier (`__kmpc_fork_call → __kmp_join_call →
  _pthread_cond_wait`, 0% CPU) on this macOS/Python 3.14 box, so the `calibrate`
  step never ran. Fix: cap math-lib threads to 1 for the whole process
  (`OMP/OPENBLAS/MKL/VECLIB/NUMEXPR_NUM_THREADS`, set via `os.environ.setdefault`
  at the TOP of `retrain.py` BEFORE numpy/pandas/xgboost import); `_sim` and
  `_calibrate` also run their heavy scripts in fresh subprocesses (own thread caps,
  stdout→logfile, timeouts). Full run now completes ~14 min, every step ok incl
  calibrate (~476s). If a new heavy step ever re-hangs at 0% CPU, `sample <pid>`
  for `__kmp_join_call` and isolate it in a subprocess.
- `torch` now installed → NN member trains in retrain (was off when absent).
  XGBoost member active.
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
