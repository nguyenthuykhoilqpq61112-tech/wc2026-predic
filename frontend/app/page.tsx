"use client";
import useSWR from "swr";
import Link from "next/link";
import { motion } from "framer-motion";
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

export default function Home() {
  const { data, error } = useSWR("/api/home", fetcher, { revalidateOnFocus: false });
  if (error) return (
    <div className="card-broadcast flex items-center gap-3 text-danger">
      <span className="text-2xl">⚡</span>
      <span>Control center offline — start the API on :8000.</span>
    </div>
  );
  if (!data) return <Skeleton />;

  const hero = data.featured_matches?.[0];
  const winner = hero ? (hero.p_home >= hero.p_away ? hero.home_team : hero.away_team) : "";
  const winP = hero ? Math.max(hero.p_home, hero.p_away) : 0;

  return (
    <div className="space-y-12">

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
                  GROUP {hero.group} · MD{hero.matchday}
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
                <Link href={`/matches/${hero.id}`} className="btn-gold text-xs">
                  Open Match Center →
                </Link>
              </div>
            </div>
          </div>
        </motion.section>
      )}

      {/* ════════════ TOURNAMENT ODDS + DARK HORSES ════════════ */}
      <section className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        {/* winner probability chart */}
        <motion.div variants={FADE_UP} initial="hidden" animate="show" transition={stagger(1)}
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
        <motion.div variants={FADE_UP} initial="hidden" animate="show" transition={stagger(2)}
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
        <motion.section variants={FADE_UP} initial="hidden" animate="show" transition={stagger(3)}>
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
        <motion.section variants={FADE_UP} initial="hidden" animate="show" transition={stagger(4)}>
          <SectionHeader title="CAI INSIGHTS" sub="Model signals & anomalies" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.insights.slice(0, 3).map((ins: any, i: number) => (
              <AIInsightCard key={i} text={ins.text} confidence={ins.confidence} />
            ))}
          </div>
        </motion.section>
      )}

      {/* ════════════ FEATURED MATCHES ════════════ */}
      <motion.section variants={FADE_UP} initial="hidden" animate="show" transition={stagger(5)}>
        <SectionHeader title="FEATURED MATCHES" sub="Model-selected fixtures"
          action={<Link href="/matches" className="btn-sm">All fixtures →</Link>} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(data.featured_matches ?? []).map((m: any, i: number) => (
            <motion.div key={m.id}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}>
              <MatchCard m={m} />
            </motion.div>
          ))}
        </div>
      </motion.section>
    </div>
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
