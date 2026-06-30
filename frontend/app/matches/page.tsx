"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { motion, AnimatePresence } from "framer-motion";
import { api, pct0 } from "@/lib/api";
import { Flag, ProbBar, LiveBadge, SectionHeader, LowConfidenceTag, isLowConfidence, PredictionBadge, predictionHit, predictionGoldHit } from "@/components/ui";

const fetcher = (p: string) => api(p);
const GROUPS = "ABCDEFGHIJKL".split("");
const MDS = ["MD1", "MD2", "MD3"];

function buildEliminated(koData: any): Set<string> {
  const out = new Set<string>();
  if (!koData?.matches) return out;
  for (const m of koData.matches as any[]) {
    const hs = m.home_score;
    const aws = m.away_score;
    if (hs == null || aws == null) continue;
    const home = m.home_team;
    const away = m.away_team;
    if (!home || !away) continue;
    const ph: number | null = m.pen_home ?? null;
    const pa: number | null = m.pen_away ?? null;
    if (hs > aws)                              out.add(away);
    else if (aws > hs)                         out.add(home);
    else if (ph != null && pa != null)         ph > pa ? out.add(away) : out.add(home);
  }
  return out;
}

const ROUND_LABEL: Record<string, string> = {
  "Round of 32": "R32",
  "Round of 16": "R16",
  "Quarter Final": "QF",
  "Semi Final": "SF",
  "Third Place": "3P",
  "Final": "Final",
};

const ROUND_DATE: Record<string, string> = {
  "Round of 32": "Jun 28 – Jul 3",
  "Round of 16": "Jul 5 – Jul 7",
  "Quarter Final": "Jul 10 – Jul 11",
  "Semi Final": "Jul 14 – Jul 15",
  "Final": "Jul 19",
};

const ET = "America/New_York";
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: ET,
  });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: ET,
  });
const fmtShort = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ET });

export default function MatchesPage() {
  const router = useRouter();
  const [group, setGroup] = useState("");
  const [matchday, setMatchday] = useState("");
  const [team, setTeam] = useState("");
  const [upcoming, setUpcoming] = useState(false);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [openRounds, setOpenRounds] = useState<Record<string, boolean>>({ "Round of 32": true });
  const toggleRound = (r: string) => setOpenRounds(p => ({ ...p, [r]: !p[r] }));

  const { data: allData, error } = useSWR(`/api/matches?`, fetcher);
  const { data: knockoutData } = useSWR(`/api/knockout`, fetcher);

  const data = useMemo(() => {
    if (!allData) return allData;
    const t = team.trim().toLowerCase();
    return allData.filter((m: any) => {
      if (group && m.group !== group) return false;
      if (matchday && m.matchday !== matchday) return false;
      if (upcoming && m.played) return false;
      if (t && !m.home_team.toLowerCase().includes(t) &&
              !m.away_team.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [allData, group, matchday, team, upcoming]);

  const played = (data ?? []).filter((m: any) => m.played).length;
  const total = (data ?? []).length;

  const accuracy = useMemo(() => {
    const pl = (allData ?? []).filter((m: any) => m.played);
    const n = pl.length;
    if (!n) return null;
    const wdl = pl.filter((m: any) => predictionHit(m) === true).length;
    const exact = pl.filter((m: any) =>
      m.top_score && m.top_score.score === `${m.home_score}-${m.away_score}`).length;
    return { n, wdl, wdlPct: Math.round((wdl / n) * 100),
             exact, exactPct: Math.round((exact / n) * 100) };
  }, [allData]);

  /* KO accuracy: use model_predicted_winner (pre-match model pick) vs actual winner.
   * predicted_winner is overridden with actual result in knockout_engine; we store
   * the original model pick in model_predicted_winner before that override. */
  const koAccuracy = useMemo(() => {
    const matches: any[] = knockoutData?.matches ?? [];
    // Only played matches with a stored model prediction
    const playedWithPred = matches.filter(
      (m: any) => m.home_score != null && (m.model_predicted_winner || m.predicted_winner)
    );
    if (!playedWithPred.length) return null;

    const byRound: Record<string, { n: number; correct: number }> = {};
    let totalN = 0, totalCorrect = 0;

    for (const m of playedWithPred) {
      const hs = m.home_score as number;
      const aws = m.away_score as number;
      const ph: number | null = m.pen_home ?? null;
      const pa: number | null = m.pen_away ?? null;
      let actual: string | null = null;
      if (hs > aws)                          actual = m.home_team;
      else if (aws > hs)                     actual = m.away_team;
      else if (ph != null && pa != null)     actual = ph > pa ? m.home_team : m.away_team;
      if (!actual) continue;

      // Use model_predicted_winner if available (original pre-match pick)
      const modelPick = m.model_predicted_winner ?? m.predicted_winner;
      const hit = modelPick === actual;
      const round: string = m.round ?? "Knockout";
      if (!byRound[round]) byRound[round] = { n: 0, correct: 0 };
      byRound[round].n++;
      if (hit) byRound[round].correct++;
      totalN++;
      if (hit) totalCorrect++;
    }

    if (!totalN) return null;
    return { byRound, totalN, totalCorrect,
             totalPct: Math.round((totalCorrect / totalN) * 100) };
  }, [knockoutData]);

  const knockoutRounds: any[] = useMemo(() => {
    if (!knockoutData?.rounds) return [];
    return knockoutData.rounds as any[];
  }, [knockoutData]);

  const eliminated = useMemo(() => buildEliminated(knockoutData), [knockoutData]);

  return (
    <div className="space-y-6">

      {/* ── Page header ── */}
      <SectionHeader title="FIXTURES" sub="FIFA World Cup 2026 · Canada · Mexico · USA" />

      {/* ── Knockout rounds ── */}
      {knockoutRounds.map((r: any) => {
        const label = ROUND_LABEL[r.round] ?? r.round;
        const dateRange = ROUND_DATE[r.round];
        const isOpen = openRounds[r.round] ?? false;
        const resolvedCount = (r.matches as any[]).filter((m: any) => m.resolved).length;
        const sortedMatches = [...r.matches].sort((a: any, b: any) => {
          if (a.kickoff && b.kickoff)
            return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
          return (a.id ?? 0) - (b.id ?? 0);
        });

        return (
          <section key={r.round}>
            <button
              onClick={() => toggleRound(r.round)}
              className="card-broadcast w-full flex items-center justify-between py-3 px-5 hover:border-white/20 transition cursor-pointer">
              <div className="flex flex-wrap items-center gap-3">
                <span className="chip-gold text-[10px] uppercase tracking-wider">{label}</span>
                <span className="font-display text-sm font-bold uppercase tracking-wider text-stadium">
                  {r.round}
                </span>
                {dateRange && (
                  <span className="hidden sm:inline text-[11px] text-muted">{dateRange}</span>
                )}
                <span className="text-[11px] text-muted">
                  {resolvedCount}/{r.matches.length} resolved
                </span>
              </div>
              <span className="shrink-0 text-muted text-xs font-semibold uppercase tracking-wider">
                {isOpen ? "▲ Hide" : "▼ Show"}
              </span>
            </button>

            {isOpen && (
              <div className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  <AnimatePresence>
                    {sortedMatches.map((m: any, i: number) => (
                      <motion.div key={m.id}
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}>
                        <KnockoutMatchCard m={m} roundLabel={label} eliminated={eliminated} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                {/* Model accuracy for this round (shown once results are in) */}
                {koAccuracy?.byRound[r.round] && (() => {
                  const rs = koAccuracy.byRound[r.round];
                  const pct = Math.round((rs.correct / rs.n) * 100);
                  const grpHits = accuracy?.wdl ?? 0;
                  const grpN = accuracy?.n ?? 0;
                  const totalHits = grpHits + koAccuracy.totalCorrect;
                  const totalN = grpN + koAccuracy.totalN;
                  const overallPct = totalN ? Math.round((totalHits / totalN) * 100) : null;
                  return (
                    <div className="card-broadcast space-y-4 py-4">
                      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🎯</span>
                          <span className="font-display text-xs uppercase tracking-widest text-muted">Model accuracy</span>
                        </div>

                        {/* Overall combined */}
                        {overallPct !== null && (
                          <div className="flex items-center gap-3 rounded-xl border border-cyan/20 bg-cyan/5 px-4 py-2">
                            <div>
                              <div className="font-display text-2xl font-bold tabnum text-cyan">{overallPct}%</div>
                              <div className="text-[10px] uppercase tracking-wider text-muted">
                                Overall · <span className="text-stadium">{totalHits}/{totalN}</span> correct
                              </div>
                            </div>
                          </div>
                        )}

                        {/* This round */}
                        <div>
                          <div className={`font-display text-2xl font-bold tabnum ${pct >= 70 ? "text-success" : pct >= 50 ? "text-gold" : "text-danger"}`}>
                            {pct}%
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-muted">
                            {label} · <span className="text-stadium">{rs.correct}/{rs.n}</span> correct
                          </div>
                        </div>

                        {/* Group stage */}
                        {accuracy && (
                          <div>
                            <div className="font-display text-2xl font-bold tabnum text-success">{accuracy.wdlPct}%</div>
                            <div className="text-[10px] uppercase tracking-wider text-muted">
                              Group stage · <span className="text-stadium">{accuracy.wdl}/{accuracy.n}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Dot chart for this round */}
                      <div className="flex items-center gap-3 border-t border-white/5 pt-3">
                        <span className="chip-gold text-[9px] shrink-0">{label}</span>
                        <span className="text-[11px] text-muted">{rs.correct}/{rs.n} predicted correctly</span>
                        <div className="ml-auto flex gap-1.5">
                          {Array.from({ length: rs.n }).map((_, i) => (
                            <span key={i} className={`h-3 w-3 rounded-full border ${
                              i < rs.correct
                                ? "bg-success/30 border-success/60"
                                : "bg-white/8 border-white/15"}`} />
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </section>
        );
      })}

      {/* ── Group Stage (collapsible) ── */}
      <section>
        <button
          onClick={() => setGroupsOpen(v => !v)}
          className="card-broadcast w-full flex items-center justify-between py-3 px-5 hover:border-white/20 transition cursor-pointer">
          <div className="flex items-center gap-3">
            <span className="font-display text-sm font-bold uppercase tracking-wider text-stadium">
              Group Stage Results
            </span>
            {accuracy && (
              <span className="text-[11px] text-muted">
                {accuracy.wdl}/{accuracy.n} correct · {accuracy.wdlPct}% accuracy
              </span>
            )}
          </div>
          <span className="text-muted text-xs font-semibold uppercase tracking-wider">
            {groupsOpen ? "▲ Hide" : "▼ Show"}
          </span>
        </button>

        {groupsOpen && (
          <div className="mt-4 space-y-4">
            {/* Overall model accuracy */}
            {accuracy && (
              <div className="card-broadcast space-y-4 py-4">
                {/* Header row */}
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🎯</span>
                    <span className="font-display text-xs uppercase tracking-widest text-muted">Model accuracy</span>
                  </div>

                  {/* Overall total */}
                  {koAccuracy && (
                    <div className="flex items-center gap-3 rounded-xl border border-cyan/20 bg-cyan/5 px-4 py-2">
                      <div>
                        <div className="font-display text-2xl font-bold tabnum text-cyan">
                          {Math.round(((accuracy.wdl + koAccuracy.totalCorrect) / (accuracy.n + koAccuracy.totalN)) * 100)}%
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-muted">
                          Overall · <span className="text-stadium">{accuracy.wdl + koAccuracy.totalCorrect}/{accuracy.n + koAccuracy.totalN}</span> correct
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Group stage WDL */}
                  <div>
                    <div className="font-display text-2xl font-bold tabnum text-success">{accuracy.wdlPct}%</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted">
                      Outcome · <span className="text-stadium">{accuracy.wdl}/{accuracy.n}</span> correct
                    </div>
                  </div>

                  {/* Exact score */}
                  <div>
                    <div className="font-display text-2xl font-bold tabnum text-gold">{accuracy.exactPct}%</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted">
                      Exact score · <span className="text-stadium">{accuracy.exact}/{accuracy.n}</span>
                    </div>
                  </div>
                </div>

                {/* Per-round KO breakdown */}
                {koAccuracy && Object.entries(koAccuracy.byRound).map(([round, stats]) => (
                  <div key={round} className="flex items-center gap-3 border-t border-white/5 pt-3">
                    <span className="chip-gold text-[9px] shrink-0">
                      {round === "Round of 32" ? "R32" :
                       round === "Round of 16" ? "R16" :
                       round === "Quarter-finals" ? "QF" :
                       round === "Semi-finals" ? "SF" :
                       round === "Final" ? "Final" : round}
                    </span>
                    <span className="font-display text-sm font-bold tabnum text-stadium">
                      {Math.round((stats.correct / stats.n) * 100)}%
                    </span>
                    <span className="text-[11px] text-muted">
                      {stats.correct}/{stats.n} predicted correctly
                    </span>
                    <div className="ml-auto flex gap-1">
                      {Array.from({ length: stats.n }).map((_, i) => (
                        <span key={i} className={`h-2 w-2 rounded-full ${
                          i < stats.correct ? "bg-success" : "bg-white/15"}`} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Filter bar + view toggle */}
            <div className="card-broadcast flex flex-wrap items-center gap-3 py-4">
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setGroup("")}
                  className={`chip cursor-pointer text-xs transition hover:border-cyan/50 ${!group ? "chip-cyan" : ""}`}>
                  All Groups
                </button>
                {GROUPS.map((g) => (
                  <button key={g} onClick={() => setGroup(group === g ? "" : g)}
                    className={`chip cursor-pointer text-xs transition hover:border-cyan/50 ${group === g ? "chip-cyan" : ""}`}>
                    Grp {g}
                  </button>
                ))}
              </div>
              <div className="h-6 w-px bg-white/10 hidden sm:block" />
              <div className="flex gap-2">
                {MDS.map((d) => (
                  <button key={d} onClick={() => setMatchday(matchday === d ? "" : d)}
                    className={`chip cursor-pointer text-xs transition hover:border-gold/50 ${matchday === d ? "chip-gold" : ""}`}>
                    {d}
                  </button>
                ))}
              </div>
              <input value={team} onChange={(e) => setTeam(e.target.value)}
                placeholder="Search team…"
                className="min-w-[140px] flex-1 rounded-lg border border-white/10 bg-ink-3 px-3 py-1.5 text-sm placeholder:text-muted focus:border-cyan/40 focus:outline-none focus:ring-1 focus:ring-cyan/20" />
              <button onClick={() => setUpcoming((v) => !v)}
                className={`btn-sm ${upcoming ? "btn-gold" : ""}`}>
                {upcoming ? "⏭ Upcoming" : "All dates"}
              </button>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setView("cards")}
                  className={`btn-sm ${view === "cards" ? "btn-gold" : ""}`}>⊞</button>
                <button onClick={() => setView("table")}
                  className={`btn-sm ${view === "table" ? "btn-gold" : ""}`}>☰</button>
              </div>
              {data && (
                <span className="ml-auto text-xs text-muted hidden md:block">
                  <b className="text-success">{played}</b> played · <b className="text-stadium">{total - played}</b> upcoming
                </span>
              )}
            </div>

            {error && (
              <div className="card-broadcast flex items-center gap-3 text-danger">
                <span className="text-xl">⚡</span> Backend unreachable — start the API on :8000.
              </div>
            )}
            {!data && !error && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-44 animate-pulse rounded-2xl bg-ink-2" />
                ))}
              </div>
            )}

            {data && view === "cards" && <CardsView data={data} router={router} eliminated={eliminated} />}
            {data && view === "table" && <TableView data={data} router={router} eliminated={eliminated} />}
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Knockout match card (all rounds) ── */
function KnockoutMatchCard({ m, roundLabel, eliminated }: {
  m: any; roundLabel: string; eliminated: Set<string>;
}) {
  const p = m.prediction ?? {};
  const played = m.home_score != null && m.away_score != null;
  const homeWin = played && m.home_score > m.away_score;
  const awayWin = played && m.away_score > m.home_score;
  const homeDraw = played && m.home_score === m.away_score;
  /* pen winner */
  const homeAdv = homeWin || (homeDraw && (m.pen_home ?? 0) > (m.pen_away ?? 0));
  const awayAdv = awayWin || (homeDraw && (m.pen_away ?? 0) > (m.pen_home ?? 0));
  const homeElim = played && eliminated.has(m.home_team);
  const awayElim = played && eliminated.has(m.away_team);
  const dateStr = m.kickoff ? fmtShort(m.kickoff) : "TBD";
  const timeStr = m.kickoff ? fmtTime(m.kickoff) : "";

  /* prediction outcome outline */
  let outlineCls = "";
  if (played && m.predicted_winner) {
    const actualScore = `${m.home_score}-${m.away_score}`;
    const scoreHit = m.predicted_score === actualScore;
    const actualWinner = homeAdv ? m.home_team : awayAdv ? m.away_team : null;
    const winnerHit = actualWinner != null && actualWinner === m.predicted_winner;
    if (scoreHit) {
      outlineCls = "!border-gold/60 shadow-[0_0_18px_rgba(255,215,0,0.18)]";
    } else if (winnerHit) {
      outlineCls = "!border-success/50 shadow-[0_0_14px_rgba(0,230,118,0.10)]";
    }
  }

  const inner = (
    <div className={`card-broadcast h-full text-left ${m.resolved ? "match-card-hover" : "opacity-60"} ${outlineCls}`}>
      {/* header */}
      <div className="mb-3 flex items-center justify-between text-[11px]">
        <span className="chip-gold text-[10px] uppercase tracking-wider">{roundLabel}</span>
        <span className="text-muted">{dateStr}{timeStr ? ` · ${timeStr}` : ""}</span>
      </div>

      {m.resolved ? (
        <>
          {/* teams */}
          <div className="mb-3 flex items-center justify-between gap-2">
            {/* home */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className={homeElim ? "grayscale opacity-40 shrink-0" : "shrink-0"}>
                <Flag url={m.home_flag} name={m.home_team} size={28} />
              </div>
              <span className={`min-w-0 break-words font-display font-semibold leading-tight text-sm
                ${homeElim ? "text-muted/40" : homeAdv ? "text-gold" : "text-stadium"}`}>
                {m.home_team}
              </span>
            </div>
            {/* score */}
            {played ? (
              <div className="shrink-0 px-1 text-center">
                <span className="font-display text-xl font-bold tabnum text-stadium">
                  {m.home_score} – {m.away_score}
                </span>
                {m.pen_home != null && (
                  <div className="text-[9px] text-muted tabnum">
                    ({m.pen_home} – {m.pen_away} pens)
                  </div>
                )}
              </div>
            ) : (
              <span className="font-display text-xs font-bold text-muted/50 shrink-0 px-2">VS</span>
            )}
            {/* away */}
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <span className={`min-w-0 break-words text-right font-display font-semibold leading-tight text-sm
                ${awayElim ? "text-muted/40" : awayAdv ? "text-gold" : "text-stadium"}`}>
                {m.away_team}
              </span>
              <div className={awayElim ? "grayscale opacity-40 shrink-0" : "shrink-0"}>
                <Flag url={m.away_flag} name={m.away_team} size={28} />
              </div>
            </div>
          </div>

          {/* prob bar for upcoming */}
          {!played && p.p_home != null && (
            <>
              <ProbBar home={p.p_home} draw={p.p_draw ?? 0} away={p.p_away ?? 0} height={6} />
              <div className="mt-2 flex justify-between text-[11px] tabnum">
                <span className="text-success">{pct0(p.p_home)}</span>
                <span className="text-muted">D {pct0(p.p_draw)}</span>
                <span className="text-cyan">{pct0(p.p_away)}</span>
              </div>
            </>
          )}

          {/* predicted score */}
          {m.predicted_score && !played && (
            <div className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-white/5 py-1 text-[11px]">
              <span className="uppercase tracking-wider text-muted">Predicted</span>
              <span className="font-display font-bold text-gold">{m.predicted_score}</span>
              {m.shootout && <span className="text-muted">· pens</span>}
              {!m.shootout && !m.played && m.predicted_score && (() => { const [h,a] = m.predicted_score.split("-").map(Number); return h === a && m.predicted_winner; })() && <span className="text-muted">· AET</span>}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-muted">
            <span>📍 {m.city}</span>
            <div className="flex items-center gap-2">
              {played && m.predicted_winner && (() => {
                const actualScore = `${m.home_score}-${m.away_score}`;
                const scoreHit = m.predicted_score === actualScore;
                const actualWinner = homeAdv ? m.home_team : awayAdv ? m.away_team : null;
                const winnerHit = actualWinner != null && actualWinner === m.predicted_winner;
                if (scoreHit) return (
                  <span className="rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold text-gold uppercase tracking-wider">
                    Score ✓
                  </span>
                );
                if (winnerHit) return (
                  <span className="rounded border border-success/35 bg-success/8 px-1.5 py-0.5 text-[9px] font-bold text-success uppercase tracking-wider">
                    Winner ✓
                  </span>
                );
                return (
                  <span className="rounded border border-white/10 bg-white/3 px-1.5 py-0.5 text-[9px] font-bold text-muted/50 uppercase tracking-wider">
                    Miss
                  </span>
                );
              })()}
              {m.confidence && <span className="font-bold text-gold">{m.confidence} conf</span>}
            </div>
          </div>
        </>
      ) : (
        /* unresolved / TBD */
        <div className="space-y-2 py-1">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 shrink-0 rounded-full bg-white/10" />
            <span className="font-display text-sm text-muted">{m.home_label ?? "TBD"}</span>
          </div>
          <div className="pl-9 text-[10px] uppercase tracking-widest text-gold/50">vs</div>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 shrink-0 rounded-full bg-white/10" />
            <span className="font-display text-sm text-muted">{m.away_label ?? "TBD"}</span>
          </div>
          {m.city && (
            <div className="mt-2 border-t border-white/5 pt-2 text-[10px] text-muted">
              📍 {m.city} · {dateStr}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (!m.resolved) return <div className="h-full">{inner}</div>;
  return <Link href={`/knockout/${m.id}`} className="block h-full">{inner}</Link>;
}

/* ── Cards grid ── */
function CardsView({ data, router, eliminated }: { data: any[]; router: any; eliminated: Set<string> }) {
  const byDate: Record<string, any[]> = {};
  for (const m of data) {
    const d = fmtDate(m.kickoff);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(m);
  }
  if (data.length === 0) return <p className="text-muted py-4">No matches match the filter.</p>;
  return (
    <div className="space-y-8">
      {Object.entries(byDate).map(([date, matches]) => (
        <section key={date}>
          <div className="mb-3 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/5" />
            <span className="font-display text-xs uppercase tracking-widest text-muted">{date}</span>
            <div className="h-px flex-1 bg-white/5" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence>
              {matches.map((m: any, i: number) => (
                <motion.div key={m.id}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}>
                  <BroadcastMatchCard m={m} onClick={() => router.push(`/matches/${m.id}`)} eliminated={eliminated} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      ))}
    </div>
  );
}

/* ── Broadcast match card (group stage) ── */
function BroadcastMatchCard({ m, onClick, eliminated }: {
  m: any; onClick: () => void; eliminated: Set<string>;
}) {
  const goldHit = m.played && predictionGoldHit(m);
  const hit = m.played ? predictionHit(m) : null;
  const homeElim = eliminated.has(m.home_team);
  const awayElim = eliminated.has(m.away_team);
  const borderCls = goldHit
    ? "border-[#FFD700]/60 shadow-[0_0_14px_rgba(255,215,0,0.12)]"
    : hit === true
      ? "border-success/50 shadow-[0_0_14px_rgba(0,230,118,0.10)]"
      : "";
  return (
    <button onClick={onClick} className={`card-broadcast match-card-hover w-full text-left group ${borderCls}`}>
      <div className="mb-3 flex items-center justify-between text-[11px] text-muted">
        <span className="chip-cyan">GRP {m.group} · {m.matchday}</span>
        {m.played
          ? <LiveBadge label="FULL TIME" color="cyan" />
          : <span className="chip">{fmtTime(m.kickoff)}</span>}
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className={homeElim ? "grayscale opacity-40 shrink-0" : "shrink-0"}>
            <Flag url={m.home_flag} name={m.home_team} size={28} />
          </div>
          <span className={`min-w-0 break-words leading-tight font-display font-semibold
            ${homeElim ? "text-muted/40" : "text-stadium"}`}>
            {m.home_team}
          </span>
        </div>
        {m.played ? (
          <span className="font-display text-xl font-bold tabnum text-stadium shrink-0 px-2">
            {m.home_score} – {m.away_score}
          </span>
        ) : (
          <span className="font-display text-xs font-bold text-muted/50 shrink-0 px-2">VS</span>
        )}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <span className={`min-w-0 break-words text-right leading-tight font-display font-semibold
            ${awayElim ? "text-muted/40" : "text-stadium"}`}>
            {m.away_team}
          </span>
          <div className={awayElim ? "grayscale opacity-40 shrink-0" : "shrink-0"}>
            <Flag url={m.away_flag} name={m.away_team} size={28} />
          </div>
        </div>
      </div>

      {m.played && (
        <div className="mb-2 flex justify-center">
          <PredictionBadge m={m} />
        </div>
      )}

      {!m.played && (
        <>
          <ProbBar home={m.p_home} draw={m.p_draw} away={m.p_away} height={6} />
          <div className="mt-2 flex justify-between text-[11px] tabnum">
            <span className="text-success">{pct0(m.p_home)}</span>
            <span className="text-muted">D {pct0(m.p_draw)}</span>
            <span className="text-cyan">{pct0(m.p_away)}</span>
          </div>
        </>
      )}

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted border-t border-white/5 pt-2">
        <span>📍 {m.city}</span>
        <div className="flex gap-1">
          {m.market_used && <span className="chip">📈</span>}
          {m.upset_probability >= 0.32 && <span className="chip-gold text-[10px]">⚠ UPSET</span>}
          {!m.played && isLowConfidence(m) && <LowConfidenceTag confidence={m.confidence} />}
          {m.confidence && <span className="text-gold font-bold">{m.confidence}</span>}
        </div>
      </div>
    </button>
  );
}

/* ── Table view ── */
function TableView({ data, router, eliminated }: { data: any[]; router: any; eliminated: Set<string> }) {
  let lastDate = "";
  if (data.length === 0) return <p className="text-muted py-4">No matches match the filter.</p>;
  return (
    <div className="card-broadcast overflow-x-auto p-0">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-2 py-3 font-medium">Time ET</th>
            <th className="px-2 py-3 font-medium">Grp/MD</th>
            <th className="px-4 py-3 font-medium">Match</th>
            <th className="px-4 py-3 text-center font-medium">Result / Odds</th>
            <th className="px-3 py-3 text-right font-medium">Conf</th>
          </tr>
        </thead>
        <tbody>
          {data.map((m: any) => {
            const d = fmtDate(m.kickoff);
            const newDay = d !== lastDate;
            lastDate = d;
            const homeElim = eliminated.has(m.home_team);
            const awayElim = eliminated.has(m.away_team);
            return (
              <tr key={m.id}
                onClick={() => router.push(`/matches/${m.id}`)}
                className={`cursor-pointer border-b border-white/5 transition hover:bg-cyan/5
                  ${newDay ? "border-t border-t-white/10" : ""}`}>
                <td className="whitespace-nowrap px-4 py-3 text-muted">
                  {newDay && <span className="font-display text-xs text-stadium">{d}</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-3 tabnum text-muted text-xs">{fmtTime(m.kickoff)}</td>
                <td className="px-2 py-3">
                  <span className="chip-cyan text-[10px]">G{m.group}</span>
                  <span className="ml-1 text-muted text-[10px]">{m.matchday}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 font-display font-semibold">
                    <div className={homeElim ? "grayscale opacity-40" : ""}>
                      <Flag url={m.home_flag} name={m.home_team} size={18} />
                    </div>
                    <span className={homeElim ? "text-muted/40" : "text-stadium"}>{m.home_team}</span>
                    <span className="text-muted text-xs">v</span>
                    <span className={awayElim ? "text-muted/40" : "text-stadium"}>{m.away_team}</span>
                    <div className={awayElim ? "grayscale opacity-40" : ""}>
                      <Flag url={m.away_flag} name={m.away_team} size={18} />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  {m.played ? (
                    <span className="font-bold tabnum text-stadium">
                      {m.home_score}–{m.away_score}
                      <span className="ml-1.5 text-[10px] text-success">FT</span>
                      {predictionHit(m) === true &&
                        <span className="ml-1 text-[11px] text-success" title={`Model predicted ${m.predicted_winner} — correct`}>✓</span>}
                      {predictionHit(m) === false &&
                        <span className="ml-1 text-[11px] text-muted" title={`Model predicted ${m.predicted_winner}`}>✗</span>}
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2 text-xs tabnum">
                      <span className="text-success">{pct0(m.p_home)}</span>
                      <span className="text-muted">D {pct0(m.p_draw)}</span>
                      <span className="text-cyan">{pct0(m.p_away)}</span>
                      {m.market_used && <span className="chip text-[9px]">📈</span>}
                      {m.upset_probability >= 0.32 && <span className="chip-gold text-[9px]">⚠</span>}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  <span className="inline-flex items-center justify-end gap-1.5">
                    {!m.played && isLowConfidence(m) &&
                      <span title={`Low confidence (${m.confidence}/100) — near coin-flip`} className="text-muted">⚠</span>}
                    <b className={isLowConfidence(m) ? "text-muted" : "text-gold"}>{m.confidence}</b>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
