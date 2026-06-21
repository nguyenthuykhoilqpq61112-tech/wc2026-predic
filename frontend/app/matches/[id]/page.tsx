"use client";
import useSWR from "swr";
import { motion } from "framer-motion";
import { api, pct, pct0 } from "@/lib/api";
import {
  Flag, ProbBar, ProbRing, Countdown, MomentumBar, Meter, PlayerCard,
  LiveBadge, AIInsightCard, SectionHeader, StatRow,
} from "@/components/ui";
import { MatchAnalytics } from "@/components/match-analytics";

const fetcher = (p: string) => api(p);

export default function MatchCenter({ params }: { params: { id: string } }) {
  const { data, error } = useSWR(`/api/matches/${params.id}`, fetcher);
  if (error) return (
    <div className="card-broadcast flex items-center gap-3 text-danger">
      <span className="text-2xl">⚡</span> Match feed unavailable.
    </div>
  );
  if (!data) return <MatchSkeleton />;

  const { match: m, prediction: p, key_players, tactical, injuries,
    availability, conditions, team_comparison } = data;
  const home = m.home_team, away = m.away_team;
  const tc = team_comparison || {};
  const wx = conditions?.weather;
  const xg = p.expected_goals;

  return (
    <div className="space-y-8">

      {/* ════════════ SCOREBOARD HERO ════════════ */}
      <motion.section
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-3xl border border-cyan/20 bg-gradient-to-br from-ink-2 via-ink-3/90 to-ink p-7 shadow-[0_0_80px_rgba(0,212,255,0.07)] sm:p-10"
      >
        {/* beam decorations */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/3 h-[500px] w-px bg-gradient-to-b from-cyan/15 to-transparent" />
          <div className="absolute -top-40 right-1/3 h-[500px] w-px bg-gradient-to-b from-gold/10 to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_-10%,rgba(0,212,255,0.06),transparent)]" />
        </div>

        <div className="relative z-10">
          {/* meta row */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted">
            <div className="flex items-center gap-3">
              {m.played ? <LiveBadge label="FULL TIME" color="cyan" /> : <LiveBadge label="MATCH CENTER" color="cyan" />}
              <span className="chip-cyan font-display uppercase tracking-widest">
                GROUP {m.group} · {m.matchday}
              </span>
            </div>
            <span className="font-display uppercase tracking-[0.2em]">
              🏟 {m.venue} · {new Date(m.kickoff).toLocaleString(undefined,
                { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>

          {/* teams */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-6">
            <ScoreTeam name={home} flag={tc[home]?.flag_url} prob={p.p_home}
              side="home" isLeading={p.p_home >= p.p_away} />

            <div className="flex flex-col items-center gap-3 sm:gap-4">
              <div className={`font-display text-3xl sm:text-5xl font-extrabold tracking-widest tabnum ${m.played ? "text-stadium" : "text-white/20"}`}>
                {m.played ? `${m.home_score} – ${m.away_score}` : "VS"}
              </div>
              {m.played
                ? <span className="chip-gold text-xs">FULL TIME</span>
                : <Countdown to={m.kickoff} />}
              <span className="chip text-xs">Draw {pct0(p.p_draw)}</span>
            </div>

            <ScoreTeam name={away} flag={tc[away]?.flag_url} prob={p.p_away}
              side="away" isLeading={p.p_away > p.p_home} />
          </div>

          {/* prob bar */}
          <div className="mt-8">
            <ProbBar home={p.p_home} draw={p.p_draw} away={p.p_away} height={10} />
            <div className="mt-2 grid grid-cols-3 items-start gap-2 text-xs tabnum sm:text-sm">
              <div className="min-w-0 text-success font-bold">
                <span className="block break-words leading-tight">{home}</span>
                <span className="block">{pct0(p.p_home)}</span>
              </div>
              <div className="text-center text-muted">
                <span className="block leading-tight">DRAW</span>
                <span className="block">{pct0(p.p_draw)}</span>
              </div>
              <div className="min-w-0 text-right text-cyan font-bold">
                <span className="block break-words leading-tight">{away}</span>
                <span className="block">{pct0(p.p_away)}</span>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ════════════ POST-MATCH ANALYTICS (played only) ════════════ */}
      {m.played && <MatchAnalytics matchId={m.id} />}

      {/* ════════════ PREDICTION ENGINE + AI ANALYSIS ════════════ */}
      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        {/* prediction */}
        <motion.section
          initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}
          className="card-broadcast">
          <SectionHeader title="PREDICTION ENGINE" sub="5-model ensemble" />
          <div className="flex items-center justify-around py-2">
            <ProbRing value={p.confidence / 100} label="CONFIDENCE" color="#FFD700" size={108} />
            <div className="space-y-2">
              <ProbRow color="text-success" label={home} value={pct(p.p_home)} />
              <ProbRow color="text-muted" label="Draw" value={pct(p.p_draw)} />
              <ProbRow color="text-cyan" label={away} value={pct(p.p_away)} />
              <div className="pt-1 text-[11px] text-muted">
                xG {xg.home} – {xg.away}
                {p.market_used && <span className="chip ml-2 text-[10px]">📈 Market</span>}
              </div>
            </div>
          </div>

          {/* top scores */}
          <div className="mt-5">
            <div className="mb-3 text-[11px] uppercase tracking-widest text-muted">Most likely scorelines</div>
            {p.top_scores.map((s: any, i: number) => (
              <div key={s.score} className="flex items-center gap-3 py-1.5">
                <span className="w-14 font-display font-bold text-stadium">{s.score}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                  <motion.div className="h-2 rounded-full bg-gradient-to-r from-gold to-gold/40"
                    initial={{ width: 0 }}
                    animate={{ width: `${(s.prob / p.top_scores[0].prob) * 100}%` }}
                    transition={{ duration: 0.7, delay: i * 0.1 }} />
                </div>
                <span className="w-12 text-right text-xs tabnum text-muted">{pct(s.prob)}</span>
              </div>
            ))}
          </div>
        </motion.section>

        {/* AI analysis */}
        <motion.section
          initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
          className="card-broadcast">
          <SectionHeader title="AI PRE-MATCH ANALYSIS" sub="Ensemble narrative" />
          <div className="rounded-xl border border-cyan/10 bg-cyan/[0.03] p-4">
            <p className="text-[15px] leading-relaxed text-stadium/90">{p.explanation}</p>
          </div>

          <div className="mt-5">
            <div className="mb-2 text-[11px] uppercase tracking-widest text-muted">xG Momentum</div>
            <MomentumBar home={home} away={away} homeVal={xg.home} awayVal={xg.away} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-x-8">
            <Meter label={`${home} attack`} value={(xg.home / ((xg.home + xg.away) || 1)) * 100} color="#00E676" />
            <Meter label={`${away} attack`} value={(xg.away / ((xg.home + xg.away) || 1)) * 100} color="#00D4FF" />
            <Meter label={`${home} strength`} value={tc[home]?.strength_index ?? 50} color="#FFD700" />
            <Meter label={`${away} strength`} value={tc[away]?.strength_index ?? 50} color="#FFD700" />
          </div>
        </motion.section>
      </div>

      {/* ════════════ KEY PLAYERS ════════════ */}
      <section>
        <SectionHeader title="KEY PLAYERS TO WATCH" sub="Top impact ratings" />
        <div className="grid gap-8 md:grid-cols-2">
          {[home, away].map((t) => (
            <div key={t}>
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 font-display font-semibold text-stadium">
                  <Flag url={tc[t]?.flag_url} name={t} size={24} /> {t}
                </span>
                {availability?.[t] != null && (
                  <span className="text-xs text-muted">
                    Squad avail{" "}
                    <b className={
                      availability[t] >= 0.95 ? "text-success"
                        : availability[t] >= 0.85 ? "text-gold" : "text-danger"
                    }>
                      {Math.round(availability[t] * 100)}%
                    </b>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(key_players[t]?.attacking || []).slice(0, 3).map((pl: any) => (
                  <PlayerCard key={pl.name} p={pl} flag={tc[t]?.flag_url} />
                ))}
              </div>
              {injuries[t]?.length > 0 && (
                <div className="mt-3 rounded-xl border border-gold/20 bg-gold/[0.03] p-3 text-xs">
                  <div className="mb-2 font-display text-[11px] uppercase tracking-widest text-gold">
                    ⚠ Injury / Suspension Report
                  </div>
                  {injuries[t].map((inj: any) => (
                    <div key={inj.name} className="flex justify-between gap-2 py-0.5 border-b border-white/5 last:border-0">
                      <span className="font-semibold">{inj.name}{" "}
                        <span className={inj.fitness === "out" ? "text-danger" : "text-gold"}>
                          ({inj.fitness})
                        </span>
                      </span>
                      <span className="text-muted">{inj.news}{inj.return_date ? ` · ~${inj.return_date}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ════════════ CONDITIONS + MODEL ENSEMBLE ════════════ */}
      <div className="grid gap-6 md:grid-cols-2">
        {conditions && (
          <section className="card-broadcast">
            <SectionHeader title="MATCH CONDITIONS" sub="Environmental & logistical factors" />
            <div className="space-y-1">
              <StatRow label={`Weather${wx?.source === "live" ? " 🔴" : ""}`}
                value={<span className="text-stadium">{wx?.summary}</span>} />
              <StatRow label="Temperature" value={`${wx?.temp_c}°C · ${wx?.humidity}% RH`} />
              {(wx?.altitude_m ?? 0) >= 1000 && (
                <StatRow label="Altitude" value={`${wx?.altitude_m} m`} />
              )}
              <StatRow label="Weather severity"
                value={
                  <span className={wx?.severity >= 0.6 ? "text-danger" : wx?.severity >= 0.3 ? "text-gold" : "text-success"}>
                    {Math.round((wx?.severity ?? 0) * 100)}%
                  </span>
                } />
              <StatRow label="Rest days"
                value={`${home} ${conditions.rest_days?.[home]}d · ${away} ${conditions.rest_days?.[away]}d`} />
              <StatRow label="Travel to venue"
                value={`${home} ${Math.round(conditions.travel_km?.[home] ?? 0)} km · ${away} ${Math.round(conditions.travel_km?.[away] ?? 0)} km`} />
            </div>
          </section>
        )}

        <section className="card-broadcast">
          <SectionHeader title="MODEL ENSEMBLE" sub="Individual member outputs" />
          <div className="mb-3 flex justify-end gap-4 text-[10px] uppercase tracking-widest text-muted">
            <span className="text-success">Home</span>
            <span>Draw</span>
            <span className="text-cyan">Away</span>
          </div>
          <div className="space-y-2">
            {Object.entries(p.members).map(([name, v]: any) => (
              <div key={name} className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-3 py-2 text-xs">
                <span className="w-20 font-display uppercase tracking-wide text-muted">{name}</span>
                <div className="flex-1">
                  <ProbBar home={v[0]} draw={v[1]} away={v[2]} height={4} />
                </div>
                <span className="w-10 text-right tabnum text-success">{pct0(v[0])}</span>
                <span className="w-10 text-right tabnum text-muted">{pct0(v[1])}</span>
                <span className="w-10 text-right tabnum text-cyan">{pct0(v[2])}</span>
              </div>
            ))}
          </div>
          {tactical?.summary && (
            <p className="mt-4 text-[12px] text-muted leading-relaxed">{tactical.summary}</p>
          )}
        </section>
      </div>

      {/* ════════════ LIVE WIDGETS PLACEHOLDER (pre-match only) ════════════ */}
      {/* Completed matches show the news-sourced post-match analysis inside
          <MatchAnalytics> above instead of these "activate at kickoff" stubs. */}
      {!m.played && (
        <section className="card-broadcast border-dashed border-white/10">
          <SectionHeader title="BROADCAST WIDGETS" sub="Activate at kickoff" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { icon: "🎯", label: "Shot Map" },
              { icon: "🔗", label: "Passing Network" },
              { icon: "🔥", label: "Heat Map" },
              { icon: "📈", label: "Live Momentum" },
            ].map((w) => (
              <div key={w.label}
                className="grid h-24 place-items-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] text-center text-xs text-muted">
                <span>
                  <div className="text-2xl mb-1">{w.icon}</div>
                  {w.label}<br />
                  <span className="text-gold/60 text-[10px]">at kickoff</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── Score team column ── */
function ScoreTeam({ name, flag, prob, isLeading }:
  { name: string; flag?: string; prob: number; side: "home" | "away"; isLeading: boolean }) {
  return (
    <div className={`flex w-full min-w-0 flex-col items-center gap-3 text-center`}>
      <div className="relative">
        <Flag url={flag} name={name} size={64} />
        {isLeading && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-[10px] font-bold text-ink">★</span>
        )}
      </div>
      <div className="w-full break-words font-display text-base font-bold text-stadium leading-tight sm:text-xl">{name}</div>
      <div className={`font-display text-3xl font-extrabold tabnum ${isLeading ? "text-gold" : "text-cyan"}`}>
        {pct0(prob)}
      </div>
    </div>
  );
}

/* ── Probability row ── */
function ProbRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className={`${color} font-display text-sm`}>{label}</span>
      <span className="font-bold tabnum text-stadium">{value}</span>
    </div>
  );
}

/* ── Skeleton ── */
function MatchSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-80 animate-pulse rounded-3xl bg-ink-2" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-2xl bg-ink-2" />
        <div className="h-72 animate-pulse rounded-2xl bg-ink-2" />
      </div>
    </div>
  );
}

