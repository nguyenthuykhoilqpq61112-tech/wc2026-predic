"use client";
import useSWR from "swr";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { api, pct, pct0 } from "@/lib/api";
import {
  MatchCard, ProbBar, ProbRing, Countdown, Flag, LiveBadge,
  SectionHeader, AIInsightCard, StageProbRow,
} from "@/components/ui";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const fetcher = (p: string) => api(p);

const FADE_UP = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };
const stagger = (i: number) => ({ duration: 0.45, delay: i * 0.07, ease: "easeOut" });

const ET = "America/New_York";
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ET });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
const todayStr = () =>
  new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: ET });

/* ── Who-wins-and-why narrative generator ── */
function buildNarrative(m: any): { headline: string; detail: string; factors: string[] } {
  const p = m.prediction ?? {};
  const ph = p.p_home ?? m.p_home ?? 0;
  const pa = p.p_away ?? m.p_away ?? 0;
  const pd = p.p_draw ?? m.p_draw ?? 0;
  const winner = ph >= pa ? m.home_team : m.away_team;
  const loser  = ph >= pa ? m.away_team : m.home_team;
  const winP   = Math.max(ph, pa);
  const isHome = ph >= pa;

  let headline = "";
  if (winP > 0.65)
    headline = `${winner} are strong favorites`;
  else if (winP > 0.55)
    headline = `${winner} hold a clear edge`;
  else if (winP > 0.50)
    headline = `${winner} edge it — but barely`;
  else
    headline = "Too close to call — genuine toss-up";

  const winPct  = Math.round(winP * 100);
  const drawPct = Math.round(pd * 100);
  const losePct = Math.round(Math.min(ph, pa) * 100);

  let detail = `CAI gives ${winner} a ${winPct}% chance of winning`;
  if (m.predicted_score) detail += `, projecting a ${m.predicted_score} scoreline`;
  detail += ".";
  if (drawPct > 22)
    detail += ` A draw is very much on the cards at ${drawPct}%.`;
  else if (drawPct > 15)
    detail += ` Draw unlikely but possible (${drawPct}%).`;
  detail += ` ${loser} have a ${losePct}% upset chance.`;

  const factors: string[] = [];
  if (isHome) factors.push(`${winner} playing as the nominal home side`);
  if (winP > 0.65) factors.push(`High model consensus across all 4 ensemble members`);
  if (pd > 0.25) factors.push(`High draw probability — tight, defensive game expected`);
  if (m.confidence != null && m.confidence > 60) factors.push(`High prediction confidence (${m.confidence}/100)`);
  if (m.confidence != null && m.confidence < 30) factors.push(`Low confidence — treat as a coin-flip (${m.confidence}/100)`);
  if (m.upset_probability >= 0.32) factors.push(`Elevated upset risk flagged by the model`);
  if (m.market_used) factors.push(`Betting market odds incorporated into ensemble`);
  if (m.shootout) factors.push(`Penalty shootout may be required`);
  if (!factors.length) factors.push(`Ensemble-calibrated output across Dixon-Coles, Elo, XGBoost & Neural Net`);

  return { headline, detail, factors };
}

/* ── Match Prediction Modal ── */
function MatchPredictionModal({ m, onClose }: { m: any; onClose: () => void }) {
  const p     = m.prediction ?? {};
  const ph    = p.p_home ?? m.p_home ?? 0;
  const pa    = p.p_away ?? m.p_away ?? 0;
  const pd    = p.p_draw ?? m.p_draw ?? 0;
  const played = m.home_score != null && m.away_score != null;
  const { headline, detail, factors } = buildNarrative(m);
  const winner = ph >= pa ? m.home_team : m.away_team;
  const matchRoute = m.round ? `/knockout/${m.id}` : `/matches/${m.id}`;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <motion.div
        initial={{ scale: 0.94, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-cyan/25
                   bg-ink-2/95 backdrop-blur-xl shadow-[0_0_60px_rgba(0,212,255,0.12)] p-6">

        {/* close */}
        <button onClick={onClose}
          className="absolute right-4 top-4 text-muted hover:text-stadium transition text-lg">
          ✕
        </button>

        {/* round badge */}
        {m.round && (
          <div className="mb-3">
            <span className="chip-gold text-[10px] uppercase tracking-wider">{m.round}</span>
          </div>
        )}

        {/* teams */}
        <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <Flag url={m.home_flag} name={m.home_team} size={44} />
            <span className="font-display text-sm font-bold leading-tight text-stadium">{m.home_team}</span>
            <span className="font-display text-2xl font-extrabold tabnum text-success">{pct0(ph)}</span>
            <span className="text-[9px] uppercase tracking-widest text-muted">Win %</span>
          </div>

          <div className="flex flex-col items-center gap-2">
            {played ? (
              <span className="font-display text-3xl font-extrabold tabnum text-stadium">
                {m.home_score} – {m.away_score}
              </span>
            ) : (
              <>
                <span className="font-display text-xs font-bold text-muted/60 uppercase tracking-widest">vs</span>
                {m.kickoff && (
                  <span className="text-[10px] text-muted text-center">
                    {fmtDate(m.kickoff)}<br />{fmtTime(m.kickoff)}
                  </span>
                )}
              </>
            )}
            <div className="text-center">
              <div className="font-display text-sm font-bold tabnum text-muted">{pct0(pd)}</div>
              <div className="text-[9px] uppercase tracking-wider text-muted">Draw</div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-1.5 text-center">
            <Flag url={m.away_flag} name={m.away_team} size={44} />
            <span className="font-display text-sm font-bold leading-tight text-stadium">{m.away_team}</span>
            <span className="font-display text-2xl font-extrabold tabnum text-cyan">{pct0(pa)}</span>
            <span className="text-[9px] uppercase tracking-widest text-muted">Win %</span>
          </div>
        </div>

        <ProbBar home={ph} draw={pd} away={pa} height={8} />

        {/* CAI verdict */}
        <div className="mt-4 rounded-xl border border-cyan/20 bg-cyan/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-base">🤖</span>
            <span className="font-display text-[10px] uppercase tracking-[0.2em] text-cyan/80">
              CAI Verdict
            </span>
          </div>
          <div className="mb-1 font-display text-base font-bold text-gold">{headline}</div>
          <p className="text-[12px] leading-relaxed text-stadium/85">{detail}</p>
        </div>

        {/* predicted score */}
        {m.predicted_score && !played && (
          <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-white/5 py-2.5">
            <span className="text-[11px] uppercase tracking-widest text-muted">Predicted score</span>
            <span className="font-display text-lg font-bold text-gold">{m.predicted_score}</span>
            {m.shootout && <span className="chip text-[10px]">pens</span>}
          </div>
        )}

        {/* key factors */}
        <div className="mt-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-muted">Key factors</div>
          <ul className="space-y-1">
            {factors.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-stadium/80">
                <span className="mt-0.5 shrink-0 text-gold">›</span>{f}
              </li>
            ))}
          </ul>
        </div>

        {/* venue + CTA */}
        <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
          <span className="text-[11px] text-muted">📍 {m.city}</span>
          <Link href={matchRoute} onClick={onClose}
            className="btn-gold text-xs">
            Full Match Center →
          </Link>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Home() {
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const { data, error } = useSWR("/api/home", fetcher, { revalidateOnFocus: false });
  const { data: knockoutData } = useSWR("/api/knockout", fetcher, { revalidateOnFocus: false });

  if (error) return (
    <div className="card-broadcast flex items-center gap-3 text-danger">
      <span className="text-2xl">⚡</span>
      <span>Control center offline — start the API on :8000.</span>
    </div>
  );
  if (!data) return <Skeleton />;

  const r32Matches: any[] = knockoutData?.matches
    ? (knockoutData.matches as any[])
        .filter((m: any) => m.round === "Round of 32" && m.resolved)
        .sort((a: any, b: any) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())
    : [];

  // Today's matches (ET timezone, any round)
  const todayDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: ET });
  const todayMatches: any[] = knockoutData?.matches
    ? (knockoutData.matches as any[])
        .filter((m: any) => {
          if (!m.kickoff || !m.resolved) return false;
          const mDate = new Date(m.kickoff).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: ET });
          return mDate === todayDate;
        })
        .sort((a: any, b: any) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())
    : [];

  // First upcoming or most recent R32 match drives the hero
  const now = Date.now();
  const nextR32 = r32Matches.find((m: any) => new Date(m.kickoff).getTime() > now - 2 * 60 * 60 * 1000)
    ?? r32Matches[0];

  const hero = nextR32
    ? { ...nextR32, p_home: nextR32.prediction?.p_home ?? 0,
        p_draw: nextR32.prediction?.p_draw ?? 0,
        p_away: nextR32.prediction?.p_away ?? 0, isKnockout: true }
    : data.featured_matches?.[0];

  const winner = hero ? (hero.p_home >= hero.p_away ? hero.home_team : hero.away_team) : "";
  const winP = hero ? Math.max(hero.p_home, hero.p_away) : 0;

  return (
    <div className="space-y-12">

      {/* ════════════ MATCH PREDICTION MODAL ════════════ */}
      <AnimatePresence>
        {selectedMatch && (
          <MatchPredictionModal m={selectedMatch} onClose={() => setSelectedMatch(null)} />
        )}
      </AnimatePresence>

      {/* ════════════ BROADCAST HERO ════════════ */}
      {hero && (
        <motion.section
          variants={FADE_UP} initial="hidden" animate="show"
          transition={stagger(0)}
          className="relative overflow-hidden rounded-3xl border border-cyan/20 bg-gradient-to-br from-ink-2 via-ink-3/80 to-ink p-7 shadow-[0_0_60px_rgba(0,212,255,0.06)] sm:p-10"
        >
          {/* floodlight beams */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-32 left-1/4 h-96 w-px bg-gradient-to-b from-cyan/20 to-transparent" />
            <div className="absolute -top-32 right-1/4 h-96 w-px bg-gradient-to-b from-gold/15 to-transparent" />
          </div>

          <div className="relative z-10">
            {/* header row */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <LiveBadge label="NEXT MATCH" color="cyan" />
                <span className="chip-cyan font-display text-xs uppercase tracking-widest">
                  {hero.isKnockout ? "ROUND OF 32" : `GROUP ${hero.group} · MD${hero.matchday}`}
                </span>
              </div>
              <span className="font-display text-xs uppercase tracking-[0.2em] text-muted">
                🏟 {hero.venue} · {hero.city}
              </span>
            </div>

            {/* teams grid */}
            <div className="grid items-center gap-8 md:grid-cols-[1fr_auto_1fr]">
              <HeroTeam name={hero.home_team} flag={hero.home_flag} prob={hero.p_home}
                side="home" isLeading={hero.p_home >= hero.p_away} />

              <div className="flex flex-col items-center gap-4">
                <Countdown to={hero.kickoff} />
                <ProbRing value={winP} label="WIN %" color="#00D4FF" size={112} />
                <div className="flex items-center gap-2">
                  <span className="chip text-muted text-xs">DRAW</span>
                  <span className="font-display font-bold text-stadium tabnum">{pct0(hero.p_draw)}</span>
                </div>
              </div>

              <HeroTeam name={hero.away_team} flag={hero.away_flag} prob={hero.p_away}
                side="away" isLeading={hero.p_away > hero.p_home} />
            </div>

            {/* prob bar */}
            <div className="mt-8">
              <ProbBar home={hero.p_home} draw={hero.p_draw} away={hero.p_away} height={10} />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted">
                  CAI picks{" "}
                  <b className="font-display text-gold">{winner}</b>
                  {hero.confidence && (
                    <span className="ml-2 chip-gold text-xs">{hero.confidence} confidence</span>
                  )}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedMatch(hero)}
                    className="btn-sm text-xs border-cyan/40 text-cyan hover:border-cyan hover:bg-cyan/10 transition">
                    🤖 CAI Prediction
                  </button>
                  <Link href={hero.isKnockout ? `/knockout/${hero.id}` : `/matches/${hero.id}`}
                    className="btn-gold text-xs">
                    Open Match Center →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </motion.section>
      )}

      {/* ════════════ TODAY'S MATCHES ════════════ */}
      {todayMatches.length > 0 && (
        <motion.section variants={FADE_UP} initial="hidden" animate="show" transition={stagger(1)}>
          <SectionHeader
            title="TODAY'S MATCHES"
            sub={`${todayStr()} · Click any match for CAI prediction`}
            action={<Link href="/matches" className="btn-sm">All fixtures →</Link>}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {todayMatches.map((m: any, i: number) => (
              <TodayMatchCard key={m.id} m={m} index={i} onClick={() => setSelectedMatch(m)} />
            ))}
          </div>
        </motion.section>
      )}

      {/* ════════════ TOURNAMENT ODDS + DARK HORSES ════════════ */}
      <section className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        {/* winner probability chart */}
        <motion.div variants={FADE_UP} initial="hidden" animate="show" transition={stagger(2)}
          className="card-broadcast">
          <SectionHeader title="TOURNAMENT WINNER" sub="Ensemble probability · 50 000 simulations" />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.title_chart} layout="vertical"
                margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
                <XAxis type="number" tickFormatter={(v) => `${Math.round(v * 100)}%`}
                  stroke="#4A5B80" fontSize={11} tick={{ fill: "#8FA0C8" }} />
                <YAxis type="category" dataKey="team" width={96}
                  fontSize={12} tick={{ fill: "#C8D3E8" }} />
                <Tooltip
                  formatter={(v: number) => [`${pct(v)}`, "Champion %"]}
                  cursor={{ fill: "rgba(0,212,255,0.04)" }}
                  contentStyle={{
                    background: "#0F1D3D",
                    border: "1px solid rgba(0,212,255,0.2)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="Champion" radius={[0, 8, 8, 0]}>
                  {(data.title_chart ?? []).map((_: any, i: number) => (
                    <Cell key={i}
                      fill={i === 0 ? "#FFD700" : i === 1 ? "#00D4FF" : i <= 3 ? "#00FFB2" : "#2A3F6B"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* dark horses */}
        <motion.div variants={FADE_UP} initial="hidden" animate="show" transition={stagger(3)}
          className="card-broadcast flex flex-col">
          <SectionHeader title="DARK HORSES" sub="Value picks from the model" />
          <div className="flex-1 space-y-1">
            {data.dark_horses?.length
              ? data.dark_horses.map((d: any, i: number) => (
                <motion.div key={d.team}
                  initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.07 }}
                  className="flex items-start justify-between border-b border-white/5 py-3">
                  <div>
                    <span className="font-display font-semibold text-stadium">{d.team}</span>
                    <span className="ml-2 chip text-xs">#{d.elo_rank} seed</span>
                    <p className="mt-0.5 text-[11px] text-muted">{d.note}</p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <div className="font-display font-bold text-teal tabnum">{pct(d.semi_prob)}</div>
                    <div className="text-[10px] text-muted">SF prob</div>
                  </div>
                </motion.div>
              ))
              : <p className="text-sm text-muted py-4">Run the simulator to surface dark horses.</p>}
          </div>
          <Link href="/simulator" className="mt-4 btn-sm block text-center">
            Full Tournament Simulator →
          </Link>
        </motion.div>
      </section>

      {/* ════════════ STAGE PROBABILITIES ════════════ */}
      {data.stage_probs?.length > 0 && (
        <motion.section variants={FADE_UP} initial="hidden" animate="show" transition={stagger(4)}>
          <SectionHeader title="ADVANCEMENT ODDS" sub="Top contenders · all stages"
            action={<Link href="/simulator" className="btn-sm">Full table</Link>} />
          <div className="card-broadcast overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] uppercase tracking-widest text-muted">
                    <th className="pb-3 text-left pl-2">Team</th>
                    <th className="pb-3 text-right pr-2">R32</th>
                    <th className="pb-3 text-right pr-2">QF</th>
                    <th className="pb-3 text-right pr-2">SF</th>
                    <th className="pb-3 text-right pr-2">Final</th>
                    <th className="pb-3 text-right pr-4">🏆</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stage_probs.slice(0, 8).map((r: any, i: number) => (
                    <StageProbRow key={r.team} {...r} rank={i + 1} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.section>
      )}

      {/* ════════════ AI INSIGHTS ════════════ */}
      {data.insights?.length > 0 && (
        <motion.section variants={FADE_UP} initial="hidden" animate="show" transition={stagger(5)}>
          <SectionHeader title="CAI INSIGHTS" sub="Model signals & anomalies" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.insights.slice(0, 3).map((ins: any, i: number) => (
              <AIInsightCard key={i} text={ins.text} confidence={ins.confidence} />
            ))}
          </div>
        </motion.section>
      )}

      {/* ════════════ ROUND OF 32 ════════════ */}
      {r32Matches.length > 0 && (
        <motion.section variants={FADE_UP} initial="hidden" animate="show" transition={stagger(6)}>
          <SectionHeader title="ROUND OF 32" sub="Knockout stage · Jun 28 – Jul 3 · Click for prediction"
            action={<Link href="/matches" className="btn-sm">All fixtures →</Link>} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {r32Matches.map((m: any, i: number) => (
              <KnockoutCard key={m.id} m={m} index={i} onPredict={() => setSelectedMatch(m)} />
            ))}
          </div>
        </motion.section>
      )}
    </div>
  );
}

/* ── Today's match card ── */
function TodayMatchCard({ m, index, onClick }: { m: any; index: number; onClick: () => void }) {
  const p = m.prediction ?? {};
  const played = m.home_score != null && m.away_score != null;
  const homeWin = played && m.home_score > m.away_score;
  const awayWin = played && m.away_score > m.home_score;
  const now = Date.now();
  const kickoff = new Date(m.kickoff).getTime();
  const isLive = kickoff <= now && now < kickoff + 110 * 60 * 1000;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 + index * 0.07 }}>
      <button
        onClick={onClick}
        className="card-broadcast match-card-hover block w-full text-left h-full
                   border-gold/20 hover:border-gold/50 transition-all duration-200
                   relative overflow-hidden group">

        {/* gold shimmer on hover */}
        <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100
                        transition-opacity duration-300 bg-gradient-to-br from-gold/5 to-transparent" />

        {/* header */}
        <div className="mb-3 flex items-center justify-between relative z-10">
          <span className="chip-gold text-[10px] uppercase tracking-wider">
            {m.round ?? "Today"}
          </span>
          {isLive
            ? <LiveBadge label="LIVE" color="danger" />
            : played
              ? <span className="status-ft text-[10px]">FT</span>
              : <span className="text-[11px] text-muted">{fmtTime(m.kickoff)}</span>}
        </div>

        {/* teams */}
        <div className="mb-3 space-y-2 relative z-10">
          <div className="flex items-center gap-2">
            <Flag url={m.home_flag} name={m.home_team} size={22} />
            <span className={`min-w-0 flex-1 break-words font-display text-sm font-semibold leading-tight
              ${homeWin ? "text-gold" : "text-stadium"}`}>{m.home_team}</span>
            {played && (
              <span className={`shrink-0 font-bold tabnum text-lg ${homeWin ? "text-gold" : "text-muted"}`}>
                {m.home_score}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Flag url={m.away_flag} name={m.away_team} size={22} />
            <span className={`min-w-0 flex-1 break-words font-display text-sm font-semibold leading-tight
              ${awayWin ? "text-gold" : "text-stadium"}`}>{m.away_team}</span>
            {played && (
              <span className={`shrink-0 font-bold tabnum text-lg ${awayWin ? "text-gold" : "text-muted"}`}>
                {m.away_score}
              </span>
            )}
          </div>
        </div>

        {!played && (
          <>
            <ProbBar home={p.p_home ?? 0} draw={p.p_draw ?? 0} away={p.p_away ?? 0} height={5} animate={false} />
            <div className="mt-1.5 flex justify-between text-[10px] tabnum relative z-10">
              <span className="text-success">{pct0(p.p_home ?? 0)}</span>
              <span className="text-muted">D {pct0(p.p_draw ?? 0)}</span>
              <span className="text-cyan">{pct0(p.p_away ?? 0)}</span>
            </div>
            {m.predicted_score && (
              <div className="mt-2 text-center text-[10px] text-muted relative z-10">
                Pick <span className="font-bold text-gold">{m.predicted_score}</span>
                {m.predicted_winner && (
                  <span className="ml-1 chip-gold text-[9px]">→ {m.predicted_winner}</span>
                )}
              </div>
            )}
          </>
        )}

        {/* footer */}
        <div className="mt-2.5 border-t border-white/5 pt-2 flex items-center justify-between relative z-10">
          <span className="text-[10px] text-muted">📍 {m.city}</span>
          <span className="text-[10px] text-cyan/60 group-hover:text-cyan transition">
            🤖 tap for prediction
          </span>
        </div>
      </button>
    </motion.div>
  );
}

/* ── R32 knockout card ── */
function KnockoutCard({ m, index, onPredict }: { m: any; index: number; onPredict: () => void }) {
  const p = m.prediction ?? {};
  const played = m.home_score != null && m.away_score != null;
  const homeWin = played && m.home_score > m.away_score;
  const awayWin = played && m.away_score > m.home_score;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 + index * 0.04 }}
      className="relative group">

      {/* Predict button overlay (top-right) */}
      {!played && (
        <button
          onClick={onPredict}
          className="absolute right-2 top-2 z-20 rounded-lg border border-cyan/30 bg-ink/80
                     px-2 py-0.5 text-[9px] font-display uppercase tracking-wider text-cyan
                     opacity-0 group-hover:opacity-100 transition-opacity duration-150
                     hover:border-cyan hover:bg-cyan/10 backdrop-blur">
          🤖 predict
        </button>
      )}

      <Link href={`/knockout/${m.id}`}
        className="card-broadcast match-card-hover block h-full">

        {/* header */}
        <div className="mb-3 flex items-center justify-between">
          <span className="chip-gold text-[10px] uppercase tracking-wider">R32</span>
          {played
            ? <span className="status-ft text-[10px]">FT</span>
            : <span className="text-[11px] text-muted">{fmtDate(m.kickoff)}</span>}
        </div>

        {/* teams stacked */}
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-2">
            <Flag url={m.home_flag} name={m.home_team} size={20} />
            <span className={`min-w-0 flex-1 break-words font-display text-sm font-semibold leading-tight
              ${homeWin ? "text-gold" : "text-stadium"}`}>{m.home_team}</span>
            {played && (
              <span className={`shrink-0 font-bold tabnum ${homeWin ? "text-gold" : "text-muted"}`}>
                {m.home_score}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Flag url={m.away_flag} name={m.away_team} size={20} />
            <span className={`min-w-0 flex-1 break-words font-display text-sm font-semibold leading-tight
              ${awayWin ? "text-gold" : "text-stadium"}`}>{m.away_team}</span>
            {played && (
              <span className={`shrink-0 font-bold tabnum ${awayWin ? "text-gold" : "text-muted"}`}>
                {m.away_score}
              </span>
            )}
          </div>
        </div>

        {/* countdown + prob bar for upcoming */}
        {!played && (
          <>
            <div className="mb-2.5 flex justify-center">
              <Countdown to={m.kickoff} compact />
            </div>
            <ProbBar home={p.p_home ?? 0} draw={p.p_draw ?? 0} away={p.p_away ?? 0} height={5} animate={false} />
            <div className="mt-1.5 flex justify-between text-[10px] tabnum">
              <span className="text-success">{pct0(p.p_home)}</span>
              <span className="text-muted">D {pct0(p.p_draw)}</span>
              <span className="text-cyan">{pct0(p.p_away)}</span>
            </div>
            {m.predicted_score && (
              <div className="mt-2 text-center text-[10px] text-muted">
                Pick <span className="font-bold text-gold">{m.predicted_score}</span>
                {m.shootout && <span> · pens</span>}
                {!m.shootout && (() => { const [h,a] = (m.predicted_score ?? "0-0").split("-").map(Number); return h === a && m.predicted_winner; })() && <span> · AET</span>}
              </div>
            )}
          </>
        )}

        {/* footer */}
        <div className="mt-2.5 border-t border-white/5 pt-2 text-[10px] text-muted">
          📍 {m.city} · {fmtTime(m.kickoff)}
        </div>
      </Link>
    </motion.div>
  );
}

/* ── Hero team column ── */
function HeroTeam({ name, flag, prob, side, isLeading }:
  { name: string; flag?: string; prob: number; side: "home" | "away"; isLeading: boolean }) {
  const reversed = side === "away";
  return (
    <div className={`flex items-center gap-5 ${reversed ? "md:flex-row-reverse md:text-right" : ""}`}>
      <div className="relative">
        <Flag url={flag} name={name} size={72} />
        {isLeading && (
          <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-[10px] font-bold text-ink">
            ★
          </span>
        )}
      </div>
      <div>
        <div className="font-display text-xl font-bold leading-tight text-stadium sm:text-2xl">{name}</div>
        <div className={`font-display text-4xl font-extrabold tabnum leading-none mt-1 ${isLeading ? "text-gold" : "text-cyan"}`}>
          {pct0(prob)}
        </div>
        <div className="text-[11px] uppercase tracking-widest text-muted mt-0.5">Win probability</div>
      </div>
    </div>
  );
}

/* ── Skeleton loader ── */
function Skeleton() {
  return (
    <div className="space-y-8">
      <div className="h-72 animate-pulse rounded-3xl bg-ink-2" />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="h-72 animate-pulse rounded-2xl bg-ink-2" />
        <div className="h-72 animate-pulse rounded-2xl bg-ink-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map(i => <div key={i} className="h-44 animate-pulse rounded-2xl bg-ink-2" />)}
      </div>
    </div>
  );
}
