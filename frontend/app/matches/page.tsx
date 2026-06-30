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
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
              <div className="card-broadcast flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🎯</span>
                  <span className="font-display text-xs uppercase tracking-widest text-muted">Model accuracy</span>
                </div>
                <div>
                  <div className="font-display text-2xl font-bold tabnum text-success">{accuracy.wdlPct}%</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted">
                    Outcome · <span className="text-stadium">{accuracy.wdl}/{accuracy.n}</span> correct
                  </div>
                </div>
                <div>
                  <div className="font-display text-2xl font-bold tabnum text-gold">{accuracy.exactPct}%</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted">
                    Exact score · <span className="text-stadium">{accuracy.exact}/{accuracy.n}</span>
                  </div>
                </div>
                <span className="ml-auto text-[11px] text-muted">across {accuracy.n} played matches</span>
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
  /* pen winner: home advances if awayWin by pens is false */
  const homeAdv = homeWin || (homeDraw && (m.pen_home ?? 0) > (m.pen_away ?? 0));
  const awayAdv = awayWin || (homeDraw && (m.pen_away ?? 0) > (m.pen_home ?? 0));
  const homeElim = played && eliminated.has(m.home_team);
  const awayElim = played && eliminated.has(m.away_team);
  const dateStr = m.kickoff ? fmtShort(m.kickoff) : "TBD";
  const timeStr = m.kickoff ? fmtTime(m.kickoff) : "";

  const inner = (
    <div className={`card-broadcast h-full text-left ${m.resolved ? "match-card-hover" : "opacity-60"}`}>
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
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <div className={homeElim ? "opacity-50 grayscale" : ""}>
                  <Flag url={m.home_flag} name={m.home_team} size={28} />
                </div>
                <span className={`min-w-0 break-words font-display font-semibold leading-tight text-sm
                  ${homeElim ? "text-danger/70 line-through" : homeAdv ? "text-gold" : "text-stadium"}`}>
                  {m.home_team}
                </span>
              </div>
              {homeElim && (
                <span className="ml-9 inline-flex w-fit items-center rounded border border-danger/40 px-1.5 py-px text-[8px] font-bold text-danger">
                  OUT
                </span>
              )}
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
            <div className="flex min-w-0 flex-1 flex-col items-end gap-0.5">
              <div className="flex items-center gap-2">
                <span className={`min-w-0 break-words text-right font-display font-semibold leading-tight text-sm
                  ${awayElim ? "text-danger/70 line-through" : awayAdv ? "text-gold" : "text-stadium"}`}>
                  {m.away_team}
                </span>
                <div className={awayElim ? "opacity-50 grayscale" : ""}>
                  <Flag url={m.away_flag} name={m.away_team} size={28} />
                </div>
              </div>
              {awayElim && (
                <span className="mr-9 inline-flex w-fit items-center rounded border border-danger/40 px-1.5 py-px text-[8px] font-bold text-danger">
                  OUT
                </span>
              )}
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
            {m.confidence && <span className="font-bold text-gold">{m.confidence} conf</span>}
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

/* ── Small OUT badge for eliminated teams ── */
function OutBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded border border-danger/40 px-1 py-px text-[8px] font-bold text-danger leading-none">
      OUT
    </span>
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
          <div className={homeElim ? "opacity-50 grayscale shrink-0" : "shrink-0"}>
            <Flag url={m.home_flag} name={m.home_team} size={28} />
          </div>
          <span className={`min-w-0 break-words leading-tight font-display font-semibold
            ${homeElim ? "text-danger/70 line-through" : "text-stadium"}`}>
            {m.home_team}
          </span>
          {homeElim && <OutBadge />}
        </div>
        {m.played ? (
          <span className="font-display text-xl font-bold tabnum text-stadium shrink-0 px-2">
            {m.home_score} – {m.away_score}
          </span>
        ) : (
          <span className="font-display text-xs font-bold text-muted/50 shrink-0 px-2">VS</span>
        )}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          {awayElim && <OutBadge />}
          <span className={`min-w-0 break-words text-right leading-tight font-display font-semibold
            ${awayElim ? "text-danger/70 line-through" : "text-stadium"}`}>
            {m.away_team}
          </span>
          <div className={awayElim ? "opacity-50 grayscale shrink-0" : "shrink-0"}>
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
                  ${newDay ? "border-t border-t-white/10" : ""}
                  ${(homeElim || awayElim) ? "bg-danger/3" : ""}`}>
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
                    <div className={homeElim ? "opacity-50 grayscale" : ""}>
                      <Flag url={m.home_flag} name={m.home_team} size={18} />
                    </div>
                    <span className={homeElim ? "text-danger/70 line-through" : "text-stadium"}>{m.home_team}</span>
                    {homeElim && <span className="text-[8px] font-bold text-danger border border-danger/30 rounded px-0.5">OUT</span>}
                    <span className="text-muted text-xs">v</span>
                    {awayElim && <span className="text-[8px] font-bold text-danger border border-danger/30 rounded px-0.5">OUT</span>}
                    <span className={awayElim ? "text-danger/70 line-through" : "text-stadium"}>{m.away_team}</span>
                    <div className={awayElim ? "opacity-50 grayscale" : ""}>
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
