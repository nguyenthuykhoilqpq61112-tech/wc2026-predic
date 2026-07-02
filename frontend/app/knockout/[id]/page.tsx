"use client";
import useSWR from "swr";
import Link from "next/link";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { Flag, LowConfidenceTag, isLowConfidence } from "@/components/ui";
import { MatchFlowReport } from "@/components/match-flow";
import { CaiScenarios, CaiPainPoints, CaiCompareBar } from "@/components/cai-blocks";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";

const fetcher = (p: string) => api(p);
const ET = "America/New_York";
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: ET,
  });
const pctStr = (x?: number) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

export default function KnockoutMatchPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { data, error } = useSWR("/api/knockout", fetcher);

  if (error) return <Shell><div className="card text-live">Knockout data offline.</div></Shell>;
  if (!data) return <Shell><div className="h-80 animate-pulse rounded-2xl bg-white/5" /></Shell>;

  const m = data.matches?.find((x: any) => String(x.id) === String(id));
  if (!m || !m.resolved)
    return <Shell><div className="card">This tie isn't resolved yet — slots fill once the group stage completes.</div></Shell>;

  const journeys = data.journeys ?? {};
  const homeWin = m.predicted_winner === m.home_team;
  const a = m.analysis ?? {};

  /* ── determine actual winner when played ── */
  let actualWinner: string | null = null;
  let actualLoser: string | null = null;
  if (m.played && m.home_score != null && m.away_score != null) {
    if (m.home_score > m.away_score) { actualWinner = m.home_team; actualLoser = m.away_team; }
    else if (m.away_score > m.home_score) { actualWinner = m.away_team; actualLoser = m.home_team; }
    else if (m.pen_home != null && m.pen_away != null) {
      if (m.pen_home > m.pen_away) { actualWinner = m.home_team; actualLoser = m.away_team; }
      else { actualWinner = m.away_team; actualLoser = m.home_team; }
    }
  }
  const predictionCorrect = actualWinner != null && actualWinner === m.predicted_winner;
  const isPens = m.pen_home != null && m.pen_away != null;

  return (
    <Shell>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

        {/* ══ POST-MATCH ANALYSIS (played matches) ══ */}
        {m.played && actualWinner && (
          <>
            {/* Result hero */}
            <div className="card-broadcast overflow-hidden p-0">
              <div className="flex items-center justify-between bg-white/[0.04] px-4 py-2 text-[11px] text-muted">
                <span className="chip-gold">{m.round} · Post-Match Analysis</span>
                <span>{fmt(m.kickoff)} · 📍 {m.venue}, {m.city}</span>
              </div>

              {/* Scoreboard */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 p-6">
                <div className="flex flex-col items-center gap-2">
                  <div className={actualWinner === m.home_team ? "opacity-100" : "opacity-40 grayscale"}>
                    <Flag url={m.home_flag} name={m.home_team} size={64} />
                  </div>
                  <div className={`font-display text-base font-bold leading-tight text-center
                    ${actualWinner === m.home_team ? "text-gold" : "text-muted"}`}>
                    {m.home_team}
                  </div>
                  {actualWinner === m.home_team && (
                    <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-gold">
                      Advances ›
                    </span>
                  )}
                </div>

                <div className="text-center">
                  <div className="font-display text-5xl font-black tabnum text-white leading-none">
                    {m.home_score}<span className="text-muted/50 mx-2">–</span>{m.away_score}
                  </div>
                  {isPens && (
                    <div className="mt-1 font-display text-lg font-bold text-cyan tabnum">
                      {m.pen_home}–{m.pen_away} <span className="text-xs font-normal text-muted">pens</span>
                    </div>
                  )}
                  <div className="mt-2 text-[10px] uppercase tracking-widest text-muted">
                    {isPens ? "After Extra Time + Penalties" : "Full Time"}
                  </div>
                  <div className={`mt-2 inline-block rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider
                    ${predictionCorrect
                      ? "border border-success/30 bg-success/10 text-success"
                      : "border border-white/15 bg-white/5 text-muted"}`}>
                    {predictionCorrect ? "✓ Prediction correct" : `✗ Model predicted ${m.predicted_winner}`}
                  </div>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <div className={actualWinner === m.away_team ? "opacity-100" : "opacity-40 grayscale"}>
                    <Flag url={m.away_flag} name={m.away_team} size={64} />
                  </div>
                  <div className={`font-display text-base font-bold leading-tight text-center
                    ${actualWinner === m.away_team ? "text-gold" : "text-muted"}`}>
                    {m.away_team}
                  </div>
                  {actualWinner === m.away_team && (
                    <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-gold">
                      Advances ›
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ══ KEY MOMENTS — news channel report ══ */}
            {m.actual_events?.length > 0 && (
              <div className="card-broadcast overflow-hidden p-0">
                <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.03] px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm font-bold uppercase tracking-widest text-stadium">Key Moments</span>
                    <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-success">Live Report</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted">
                    <span className="opacity-60">Source</span>
                    <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-bold text-stadium">ESPN</span>
                    <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-bold text-stadium">FIFA</span>
                  </div>
                </div>
                <div className="relative p-5">
                  <div className="absolute left-[33px] top-5 bottom-5 w-px bg-white/8" />
                  <div className="space-y-3">
                    {m.actual_events.map((e: any, i: number) => {
                      const isGoal = e.type === "goal";
                      const isShootout = e.type === "shootout";
                      const isVar = e.type === "var";
                      const isSub = e.type === "sub";
                      const isPhase = e.type === "phase";
                      const teamColor = e.team === m.home_team ? "text-gold" : e.team === m.away_team ? "text-cyan" : "text-muted";
                      const bubbleCls = isGoal
                        ? "border-gold/50 bg-gold/15 text-gold shadow-[0_0_8px_rgba(255,215,0,0.2)]"
                        : isShootout ? "border-cyan/40 bg-cyan/10 text-cyan"
                        : isVar ? "border-yellow-400/40 bg-yellow-400/10 text-yellow-400"
                        : isPhase ? "border-white/20 bg-white/8 text-white/60"
                        : "border-white/10 bg-white/5 text-muted";
                      const cardCls = isGoal
                        ? "border-gold/25 bg-gradient-to-r from-gold/8 to-transparent"
                        : isShootout ? "border-cyan/20 bg-cyan/5"
                        : isVar ? "border-yellow-400/20 bg-yellow-400/5"
                        : "border-white/5 bg-white/2";
                      const icon = isGoal ? "⚽" : isShootout ? "🎯" : isVar ? "📺" : isSub ? "🔄" : isPhase ? "⏱" : "•";
                      return (
                        <div key={i} className="flex gap-4">
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold tabnum ${bubbleCls}`}>
                            {(isPhase || isShootout) ? icon : `${e.minute}′`}
                          </div>
                          <div className={`flex-1 rounded-xl border px-4 py-3 ${cardCls}`}>
                            {isGoal && (
                              <div className={`mb-1 text-[10px] font-bold uppercase tracking-widest ${teamColor}`}>
                                ⚽ Goal — {e.team}
                              </div>
                            )}
                            {isVar && (
                              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-yellow-400">📺 VAR Review</div>
                            )}
                            <p className={`text-[13px] leading-snug ${isGoal ? "font-semibold text-white" : isVar ? "text-yellow-300/90" : "text-muted"}`}>
                              {e.text}
                            </p>
                            {isGoal && (e.scorer || e.assist) && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {e.scorer && (
                                  <span className="rounded-full border border-gold/25 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold text-gold">
                                    ⚽ {e.scorer}{e.minute ? ` ${e.minute}′` : ""}
                                  </span>
                                )}
                                {e.assist && (
                                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-muted">
                                    🅰 {e.assist}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ══ FULL GAME ANALYSIS ══ */}
            {(() => {
              const goals = (m.actual_events ?? []).filter((e: any) => e.type === "goal");
              const scorerMap: Record<string, { team: string; goals: number }> = {};
              goals.forEach((e: any) => {
                if (e.scorer) {
                  if (!scorerMap[e.scorer]) scorerMap[e.scorer] = { team: e.team, goals: 0 };
                  scorerMap[e.scorer].goals++;
                }
              });
              const topScorers = Object.entries(scorerMap).sort((a, b) => b[1].goals - a[1].goals).slice(0, 4);
              return (
                <div className="card-broadcast overflow-hidden p-0">
                  <div className="flex items-center gap-2 border-b border-white/8 bg-white/[0.03] px-4 py-2.5">
                    <span className="font-display text-sm font-bold uppercase tracking-widest text-stadium">Full Game Analysis</span>
                    <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan">Post-Match</span>
                  </div>
                  <div className="space-y-5 p-5">
                    {/* Narrative verdict */}
                    {m.actual_stats?.result_note && (
                      <div className="rounded-xl border border-white/8 bg-white/3 px-4 py-4">
                        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted">
                          <span className="h-px w-4 bg-cyan/40" />Match Verdict<span className="h-px flex-1 bg-white/8" />
                        </div>
                        <p className="text-[13px] leading-relaxed text-stadium">{m.actual_stats.result_note}</p>
                      </div>
                    )}

                    {/* Model accuracy verdict */}
                    <div className={`flex items-start gap-4 rounded-xl border p-4 ${predictionCorrect ? "border-success/25 bg-success/5" : "border-white/10 bg-white/3"}`}>
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${predictionCorrect ? "bg-success/15 text-success" : "bg-white/8 text-muted"}`}>
                        {predictionCorrect ? "✓" : "✗"}
                      </div>
                      <div>
                        <div className={`font-display text-sm font-bold ${predictionCorrect ? "text-success" : "text-stadium"}`}>
                          {predictionCorrect ? "CAI called it right" : `CAI missed — predicted ${m.predicted_winner}`}
                        </div>
                        <p className="mt-0.5 text-[12px] leading-snug text-muted">
                          {predictionCorrect
                            ? `Model confidence was ${Math.round((m.win_probability ?? 0) * 100)}%. The result validated the pre-match analysis.`
                            : `Model had ${m.predicted_winner} at ${Math.round((m.win_probability ?? 0) * 100)}% confidence. ${actualWinner} defied the odds.`}
                        </p>
                      </div>
                    </div>

                    {/* Top scorers */}
                    {topScorers.length > 0 && (
                      <div>
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">Goal Scorers</div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {topScorers.map(([name, info]) => {
                            const isHome = info.team === m.home_team;
                            return (
                              <div key={name} className={`rounded-xl border p-3 text-center ${isHome ? "border-gold/20 bg-gold/5" : "border-cyan/20 bg-cyan/5"}`}>
                                <div className="text-2xl font-black tabnum text-white">{info.goals}</div>
                                <div className={`mt-0.5 text-[11px] font-semibold leading-tight ${isHome ? "text-gold" : "text-cyan"}`}>{name}</div>
                                <div className="mt-0.5 text-[9px] text-muted">{info.team}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Stats */}
                    <div className="space-y-3">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Match Stats</div>
                      <StatBar label="xG" hVal={m.actual_stats?.home_xg ?? a.expected_goals?.home} aVal={m.actual_stats?.away_xg ?? a.expected_goals?.away}
                        hTeam={m.home_team} aTeam={m.away_team} max={3} format={(v) => v.toFixed(2)} isActual={Boolean(m.actual_stats?.home_xg)} />
                      {m.actual_stats?.home_possession != null && (
                        <StatBar label="Possession" hVal={m.actual_stats.home_possession / 100} aVal={m.actual_stats.away_possession / 100}
                          hTeam={m.home_team} aTeam={m.away_team} max={1} format={(v) => `${Math.round(v * 100)}%`} isActual />
                      )}
                      {m.actual_stats?.home_shots_on_target != null && (
                        <StatBar label="Shots on Target" hVal={m.actual_stats.home_shots_on_target} aVal={m.actual_stats.away_shots_on_target}
                          hTeam={m.home_team} aTeam={m.away_team}
                          max={Math.max(m.actual_stats.home_shots_on_target, m.actual_stats.away_shots_on_target) * 1.5}
                          format={(v) => String(Math.round(v))} isActual />
                      )}
                      <StatBar label="Player Condition" hVal={a.home_condition} aVal={a.away_condition}
                        hTeam={m.home_team} aTeam={m.away_team} max={1} format={(v) => `${(v * 100).toFixed(0)}%`} />
                      <StatBar label="Goalkeeper Quality" hVal={a.home_gk_quality} aVal={a.away_gk_quality}
                        hTeam={m.home_team} aTeam={m.away_team} max={1} format={(v) => `${(v * 100).toFixed(0)}%`} />
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Score probability — pre-match model */}
            {m.flow?.most_likely_scores?.length > 0 && (
              <div className="card-broadcast">
                <div className="mb-4">
                  <div className="font-display text-sm font-bold uppercase tracking-widest text-stadium">Score Probability</div>
                  <div className="text-[11px] text-muted mt-0.5">Pre-match model · actual result highlighted</div>
                </div>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={m.flow.most_likely_scores} margin={{ left: 0, right: 40, top: 4, bottom: 4 }}>
                      <XAxis dataKey="score" tick={{ fill: "#8FA0C8", fontSize: 11 }} stroke="#4A5B80" />
                      <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fill: "#8FA0C8", fontSize: 10 }} stroke="#4A5B80" />
                      <Tooltip formatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                        contentStyle={{ background: "#0F1D3D", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 10, fontSize: 12 }}
                        cursor={{ fill: "rgba(0,212,255,0.04)" }} />
                      <Bar dataKey="prob" radius={[6, 6, 0, 0]}>
                        {m.flow.most_likely_scores.map((s: any, i: number) => {
                          const isActual = s.score === `${m.home_score}-${m.away_score}`;
                          return <Cell key={i} fill={isActual ? "#FFD700" : "#2A3F6B"} opacity={isActual ? 1 : 0.6} />;
                        })}
                        <LabelList dataKey="prob" position="top" formatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                          style={{ fill: "#8FA0C8", fontSize: 9 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[10px] text-muted">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-gold mr-0.5 align-middle" />Actual result
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#2A3F6B] mr-0.5 align-middle opacity-60" />Predicted alternatives
                </div>
              </div>
            )}

            {/* Tournament form */}
            {m.flow?.tournament_form && (
              <div className="card-broadcast">
                <div className="mb-4 font-display text-sm font-bold uppercase tracking-widest text-stadium">Tournament Form</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[m.home_team, m.away_team].map((team) => {
                    const tf = m.flow.tournament_form[team];
                    if (!tf) return null;
                    const isWinner = team === actualWinner;
                    return (
                      <div key={team} className={`rounded-2xl border p-4 ${isWinner ? "border-gold/25 bg-gold/5" : "border-white/8 bg-white/2"}`}>
                        <div className="mb-3 flex items-center gap-2">
                          <Flag url={team === m.home_team ? m.home_flag : m.away_flag} name={team} size={28} />
                          <div>
                            <div className={`font-display text-sm font-bold ${isWinner ? "text-gold" : "text-stadium"}`}>{team}</div>
                            <div className="text-[10px] text-muted">{tf.record}</div>
                          </div>
                          <div className={`ml-auto text-[11px] font-bold ${tf.form_delta > 3 ? "text-success" : "text-muted"}`}>
                            {tf.form_delta > 0 ? "+" : ""}{tf.form_delta} Elo
                          </div>
                        </div>
                        <div className="mb-3 flex gap-1.5">
                          {["W","D","L"].map((r) => {
                            const count = r === "W" ? tf.w : r === "D" ? tf.d : tf.l;
                            return Array.from({ length: count }).map((_, i) => (
                              <span key={`${r}-${i}`} className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold
                                ${r === "W" ? "bg-success/20 text-success" : r === "D" ? "bg-white/15 text-white" : "bg-white/8 text-muted/50"}`}>
                                {r}
                              </span>
                            ));
                          })}
                        </div>
                        <div className="mb-3 flex items-center gap-3 text-[12px]">
                          <div><div className="font-bold tabnum text-stadium">{tf.gf}</div><div className="text-[9px] text-muted">Goals For</div></div>
                          <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full bg-gold/60 rounded-full" style={{ width: `${Math.min(100, (tf.gf / (tf.played * 3)) * 100)}%` }} />
                          </div>
                          <div className="text-right"><div className="font-bold tabnum text-muted">{tf.ga}</div><div className="text-[9px] text-muted">Against</div></div>
                        </div>
                        <div className="space-y-1">
                          {tf.log?.map((l: string, i: number) => {
                            const isWin = l.startsWith("W"); const isDraw = l.startsWith("D");
                            return (
                              <div key={i} className="flex items-center gap-2 text-[10px] text-muted">
                                <span className={`h-3.5 w-3.5 shrink-0 rounded-full flex items-center justify-center text-[7px] font-bold
                                  ${isWin ? "bg-success/25 text-success" : isDraw ? "bg-white/20 text-white" : "bg-white/8 text-muted/50"}`}>
                                  {l[0]}
                                </span>
                                {l}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Pain points */}
            <CaiPainPoints home={m.home_team} away={m.away_team} painPoints={m.flow?.pain_points} />

            {/* Penalty shootout detail */}
            {isPens && (
              <div className="card-broadcast">
                <div className="mb-4 font-display text-sm font-bold uppercase tracking-widest text-stadium">
                  Penalty Shootout
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 mb-5">
                  <div className="text-center">
                    <div className={`font-display text-4xl font-black tabnum ${actualWinner === m.home_team ? "text-gold" : "text-muted"}`}>
                      {m.pen_home}
                    </div>
                    <div className="mt-1 text-[11px] text-muted">{m.home_team}</div>
                  </div>
                  <div className="text-[11px] uppercase tracking-widest text-muted">Pens</div>
                  <div className="text-center">
                    <div className={`font-display text-4xl font-black tabnum ${actualWinner === m.away_team ? "text-gold" : "text-muted"}`}>
                      {m.pen_away}
                    </div>
                    <div className="mt-1 text-[11px] text-muted">{m.away_team}</div>
                  </div>
                </div>

                {/* Actual kick-by-kick breakdown */}
                {m.actual_penalties && (
                  <div className="grid grid-cols-2 gap-4 border-t border-white/8 pt-4">
                    {([
                      [m.home_team, m.actual_penalties.home],
                      [m.away_team, m.actual_penalties.away],
                    ] as [string, any[]][]).map(([team, kicks]) => {
                      const isWinner = team === actualWinner;
                      return (
                        <div key={team}>
                          <div className={`mb-2 text-[10px] font-bold uppercase tracking-wider ${isWinner ? "text-gold" : "text-muted"}`}>
                            {team}
                          </div>
                          <div className="space-y-1.5">
                            {kicks.map((k: any, ki: number) => (
                              <div key={ki} className="flex items-center gap-2 text-[11px]">
                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold
                                  ${k.outcome === "scored" ? "bg-success/20 text-success"
                                    : k.outcome === "saved" ? "bg-danger/15 text-danger/80"
                                    : "bg-white/10 text-muted/60"}`}>
                                  {k.outcome === "scored" ? "✓" : k.outcome === "saved" ? "S" : "✗"}
                                </span>
                                <span className={k.outcome === "scored" ? "text-stadium" : "text-muted/60"}>
                                  {k.player}
                                </span>
                                <span className="ml-auto text-[9px] text-muted/40 capitalize">{k.outcome}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <hr className="border-white/8" />
            <div className="text-center text-[11px] text-muted uppercase tracking-widest">
              Pre-Match CAI Prediction
            </div>
          </>
        )}

        {/* ══ PRE-MATCH PREDICTION (always shown, labelled as prediction for played matches) ══ */}
        <div className="card-broadcast overflow-hidden p-0">
          <div className="flex items-center justify-between bg-white/[0.04] px-4 py-2 text-[11px] text-muted">
            <span className="chip">{m.round} · Match {m.id}</span>
            <span>{fmt(m.kickoff)} · 📍 {m.venue}, {m.city}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-5">
            <TeamHead name={m.home_team} flag={m.home_flag} win={homeWin}
              title={m.home_title_pct} />
            <div className="text-center">
              <div className="font-display text-3xl font-bold text-gold">
                {m.predicted_score}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted">
                {m.played ? "model predicted" : m.shootout ? "after pens" : (() => { const [h,aw] = (m.predicted_score ?? "0-0").split("-").map(Number); return !m.played && h === aw && m.predicted_winner ? "predicted AET" : "predicted"; })()}
              </div>
            </div>
            <TeamHead name={m.away_team} flag={m.away_flag} win={!homeWin}
              title={m.away_title_pct} right />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-white/10 px-4 py-3 text-sm">
            <span><span className="font-bold text-gold">{m.predicted_winner}</span> {m.played ? "was predicted to advance" : "advances"}</span>
            <span className="text-muted">·</span>
            <span>win prob <span className="font-bold text-stadium">{Math.round((m.win_probability ?? 0) * 100)}%</span></span>
            {m.confidence != null && <><span className="text-muted">·</span><span>conf <span className="font-bold">{m.confidence}</span></span></>}
            {isLowConfidence(m) && <LowConfidenceTag confidence={m.confidence} />}
          </div>
          {m.survival?.advance_stage && (
            <div className="flex justify-center gap-6 border-t border-white/10 px-4 py-2 text-[11px] text-muted">
              <span>↗ reach {m.survival.advance_stage}:</span>
              <span>{m.home_team} <b className="text-stadium">{pctStr(m.survival.home?.advance)}</b></span>
              <span>{m.away_team} <b className="text-stadium">{pctStr(m.survival.away?.advance)}</b></span>
            </div>
          )}
        </div>

        {/* road to here — both teams' journeys */}
        <section>
          <h2 className="mb-3 font-display text-lg font-bold">Road to this tie</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <JourneyColumn team={m.home_team} flag={m.home_flag} games={journeys[m.home_team]} />
            <JourneyColumn team={m.away_team} flag={m.away_flag} games={journeys[m.away_team]} />
          </div>
        </section>

        {/* CAI three-way scenario projection */}
        <CaiScenarios scenarios={m.flow?.scenarios} knockout />

        {/* why the projected winner advances */}
        <section className="card-broadcast p-5">
          <h2 className="mb-3 font-display text-lg font-bold">
            {m.played ? `Why CAI predicted ${m.predicted_winner}` : `Why ${m.predicted_winner} advances`}
          </h2>
          <div className="space-y-2">
            <CaiCompareBar label="Player condition" h={a.home_condition} a={a.away_condition} />
            <CaiCompareBar label="Manager track record" h={a.home_manager_wr} a={a.away_manager_wr} />
            {a.home_gk_quality != null &&
              <CaiCompareBar label="Goalkeeper" h={a.home_gk_quality} a={a.away_gk_quality} />}
            {a.expected_goals && (
              <div className="flex justify-between pt-1 text-[12px] text-muted">
                <span>Expected goals</span>
                <span className="font-semibold text-stadium">
                  {a.expected_goals.home?.toFixed(2)} – {a.expected_goals.away?.toFixed(2)}
                </span>
              </div>
            )}
          </div>
          {m.reasons?.length > 0 && (
            <ul className="mt-4 space-y-1.5 text-[13px] leading-snug text-stadium">
              {m.reasons.map((rs: string, k: number) => (
                <li key={k} className="flex gap-2"><span className="text-gold">›</span><span>{rs}</span></li>
              ))}
            </ul>
          )}
        </section>

        {/* projected game flow — always shown; for played matches it's the pre-match CAI projection */}
        {m.flow && (
          <section className="card-broadcast p-5">
            <h2 className="mb-3 font-display text-lg font-bold">
              {m.played ? "CAI Pre-Match Projection" : "How the tie plays out"}
            </h2>
            {m.played && (
              <p className="mb-4 text-[12px] text-muted leading-relaxed">
                This is what CAI projected before kick-off — compare against the actual result above
                to see where the model was right and where the game surprised us.
              </p>
            )}
            <MatchFlowReport flow={m.flow} />
          </section>
        )}
      </motion.div>
    </Shell>
  );
}

/* ── Stat comparison bar (post-match) ── */
function StatBar({ label, hVal, aVal, hTeam, aTeam, max, format, isActual }: {
  label: string; hVal?: number; aVal?: number;
  hTeam: string; aTeam: string;
  max: number; format: (v: number) => string; isActual?: boolean;
}) {
  if (hVal == null || aVal == null) return null;
  const hW = (hVal / max) * 100;
  const aW = (aVal / max) * 100;
  const hWins = hVal >= aVal;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className={`font-medium ${hWins ? "text-gold" : "text-muted"}`}>{hTeam} {format(hVal)}</span>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-muted/50 text-[10px] uppercase tracking-wider">{label}</span>
          {isActual && <span className="text-[8px] text-success/60 uppercase tracking-wider">actual</span>}
        </div>
        <span className={`font-medium ${!hWins ? "text-gold" : "text-muted"}`}>{format(aVal)} {aTeam}</span>
      </div>
      <div className="flex h-3 items-stretch gap-0.5 overflow-hidden rounded-full">
        <div className="flex flex-1 justify-end rounded-l-full overflow-hidden bg-white/5">
          <motion.div className="h-full rounded-l-full bg-gold/70"
            initial={{ width: 0 }} animate={{ width: `${hW}%` }} transition={{ duration: 0.8, delay: 0.1 }} />
        </div>
        <div className="w-px bg-white/20" />
        <div className="flex flex-1 justify-start rounded-r-full overflow-hidden bg-white/5">
          <motion.div className="h-full rounded-r-full bg-cyan/60"
            initial={{ width: 0 }} animate={{ width: `${aW}%` }} transition={{ duration: 0.8, delay: 0.15 }} />
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <Link href="/matches" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-gold">
        ← All fixtures
      </Link>
      {children}
    </div>
  );
}

function TeamHead({ name, flag, win, title, right }:
  { name: string; flag?: string; win: boolean; title?: number; right?: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-2 ${right ? "md:items-center" : ""}`}>
      <Flag url={flag} name={name} size={52} />
      <div className={`text-center font-display leading-tight ${win ? "text-base font-bold text-gold" : "text-sm font-semibold text-stadium"}`}>
        {name}
      </div>
      {title != null && <div className="text-[10px] text-muted">🏆 {pctStr(title)} title</div>}
    </div>
  );
}

function JourneyColumn({ team, flag, games }:
  { team: string; flag?: string; games?: any[] }) {
  return (
    <div className="card-broadcast p-4">
      <div className="mb-3 flex items-center gap-2">
        <Flag url={flag} name={team} size={24} />
        <h3 className="font-display text-sm font-bold">{team}</h3>
        {games && games.length > 0 && (
          <span className="ml-auto flex gap-1">
            {games.map((g, i) => <ResultDot key={i} r={g.result} />)}
          </span>
        )}
      </div>
      {!games || games.length === 0 ? (
        <p className="text-[12px] text-muted">No group-stage games on record.</p>
      ) : (
        <ol className="space-y-3">
          {games.map((g, i) => <JourneyGame key={i} g={g} />)}
        </ol>
      )}
    </div>
  );
}

function JourneyGame({ g }: { g: any }) {
  const scorers = (g.team_scorers ?? []).map((s: any) =>
    `${s.player} ${s.minute}'${s.type && s.type !== "goal" ? " (" + (s.type === "own goal" ? "OG" : "P") + ")" : ""}`);
  return (
    <li className="border-l-2 border-white/10 pl-3">
      <div className="flex items-center gap-2 text-sm">
        <ResultDot r={g.result} />
        <span className="font-display font-bold tabular-nums text-stadium">{g.score}</span>
        <span className="text-muted">vs</span>
        <Flag url={g.opp_flag} name={g.opponent} size={16} />
        <span className="font-medium">{g.opponent}</span>
      </div>
      {scorers.length > 0 && (
        <div className="mt-0.5 text-[11px] text-gold/80">⚽ {scorers.join(" · ")}</div>
      )}
      {(g.turning_point || g.headline) && (
        <div className="mt-0.5 text-[11px] leading-snug text-muted">
          {g.turning_point || g.headline}
        </div>
      )}
    </li>
  );
}

function ResultDot({ r }: { r: string }) {
  const cls = r === "W" ? "bg-stadium text-black" : r === "D" ? "bg-white/30 text-white" : "bg-live text-white";
  return (
    <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${cls}`}>
      {r}
    </span>
  );
}
