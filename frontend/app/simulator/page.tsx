"use client";
import useSWR from "swr";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { api, pct, pct0 } from "@/lib/api";
import { Flag, SectionHeader } from "@/components/ui";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";

const fetcher = (p: string) => api(p);

/* ── Derive eliminated teams and confirmed R16 qualifiers from knockout results ── */
function useKnockoutStatus() {
  const { data: ko } = useSWR("/api/knockout", fetcher, { revalidateOnFocus: false });
  return useMemo<{ eliminated: Set<string>; r16Teams: Set<string> }>(() => {
    const eliminated = new Set<string>();
    const r16Teams   = new Set<string>();
    if (!ko?.matches) return { eliminated, r16Teams };
    for (const m of ko.matches as any[]) {
      const hs = m.home_score;
      const aws = m.away_score;
      if (hs == null || aws == null) continue;
      const home = m.home_team;
      const away = m.away_team;
      if (!home || !away) continue;
      const ph: number | null = m.pen_home ?? null;
      const pa: number | null = m.pen_away ?? null;
      let winner: string, loser: string;
      if (hs > aws)           { winner = home; loser = away; }
      else if (aws > hs)      { winner = away; loser = home; }
      else if (ph != null && pa != null) {
        winner = ph > pa ? home : away;
        loser  = ph > pa ? away : home;
      } else { continue; }
      eliminated.add(loser);
      if (m.type === "r32") r16Teams.add(winner);
    }
    return { eliminated, r16Teams };
  }, [ko]);
}

/* ── Scale raw sim odds to conditional on being in R16 ── */
function applyConditional(r: any, r16Teams: Set<string>): any {
  if (!r16Teams.has(r.team)) return r;
  const pR16 = r.R16 ?? 0;
  if (pR16 < 0.01) return r;
  return {
    ...r,
    R32: 1.0,
    QF:       r.QF       / pR16,
    SF:       r.SF       / pR16,
    Final:    r.Final    / pR16,
    Champion: r.Champion / pR16,
    _conditional: true,
  };
}

type SortStage = "R32" | "QF" | "SF" | "Final" | "Champion";
const SORT_STAGES: SortStage[] = ["R32", "QF", "SF", "Final", "Champion"];

export default function SimulatorPage() {
  const { data, error } = useSWR("/api/simulate?top=24", fetcher);
  const { data: groups }  = useSWR("/api/simulate/groups", fetcher);
  const { eliminated, r16Teams } = useKnockoutStatus();
  const [sortBy, setSortBy] = useState<SortStage>("Champion");

  if (error) return (
    <div className="card-broadcast flex items-center gap-3 text-danger">
      <span className="text-2xl">⚡</span> Run the pipeline first — no simulation data.
    </div>
  );
  if (!data) return <SimSkeleton />;

  const fullTable = (data.champion_odds as any[]).map((r: any) => applyConditional(r, r16Teams));

  /* Split table into active vs eliminated, then sort by selected stage */
  const sortFn = (a: any, b: any) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0);
  const activeRows    = fullTable.filter((r: any) => !eliminated.has(r.team)).sort(sortFn);
  const eliminatedRows = fullTable.filter((r: any) =>  eliminated.has(r.team));

  /* Chart top-12 by adjusted champion odds, eliminated at bottom */
  const chartAll = [...fullTable].sort((a: any, b: any) => b.Champion - a.Champion).slice(0, 12);
  const chartRows = [
    ...chartAll.filter((r: any) => !eliminated.has(r.team)),
    ...chartAll.filter((r: any) =>  eliminated.has(r.team)),
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        title="TOURNAMENT SIMULATOR"
        sub="50 000 Monte Carlo tournaments · 12 groups · 32-team knockout"
      />

      {/* ════ KNOCKED-OUT NOTICE ════ */}
      {eliminated.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-white/8 bg-white/3 px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="font-display text-sm font-semibold text-muted">
              {eliminated.size} team{eliminated.size > 1 ? "s" : ""} knocked out · shown below
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            {[...eliminated].sort().map((team) => {
              const row = fullTable.find((r: any) => r.team === team);
              return (
                <Link key={team} href={`/teams/${encodeURIComponent(team)}`}
                  className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/3
                             px-3 py-2 opacity-50 transition hover:opacity-80">
                  <div className="grayscale">
                    <Flag url={row?.flag_url} name={team} size={20} />
                  </div>
                  <div>
                    <div className="font-display text-[12px] font-bold text-muted/60 leading-tight">
                      {team}
                    </div>
                    <div className="text-[9px] text-muted/40 uppercase tracking-wider">
                      Was {pct(row?.Champion ?? 0)} title odds
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ════ CHAMPION ODDS CHART ════ */}
      <motion.section
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="card-broadcast">
        <div className="mb-1 flex items-center justify-between">
          <SectionHeader title="CHAMPION PROBABILITY" sub="Top 12 contenders" />
        </div>
        {eliminated.size > 0 && (
          <p className="mb-3 text-[11px] text-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-white/20 mr-1.5 align-middle" />
            Faded bars = knocked out · probabilities are pre-tournament model output
          </p>
        )}
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }}>
              <XAxis type="number" tickFormatter={(v) => `${Math.round(v * 100)}%`}
                stroke="#4A5B80" fontSize={11} tick={{ fill: "#8FA0C8" }} />
              <YAxis type="category" dataKey="team" width={100} fontSize={11}
                tick={(props: any) => {
                  const isOut = eliminated.has(props.payload.value);
                  return (
                    <text
                      x={props.x} y={props.y} dy={4}
                      textAnchor="end"
                      fill={isOut ? "#4A5B80" : "#C8D3E8"}
                      fontSize={11}
                      opacity={isOut ? 0.45 : 1}
                    >
                      {props.payload.value}
                    </text>
                  );
                }}
              />
              <Tooltip
                formatter={(v: number, _: any, props: any) => {
                  const isOut = eliminated.has(props.payload.team);
                  return [
                    `${pct(v)}${isOut ? " (knocked out)" : ""}`,
                    "Champion",
                  ];
                }}
                cursor={{ fill: "rgba(0,212,255,0.04)" }}
                contentStyle={{
                  background: "#0F1D3D",
                  border: "1px solid rgba(0,212,255,0.2)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="Champion" radius={[0, 8, 8, 0]}>
                {chartRows.map((r: any, i: number) => {
                  const isOut = eliminated.has(r.team);
                  if (isOut) return <Cell key={i} fill="#2A3F6B" opacity={0.35} />;
                  const rank = chartRows.filter((x: any) => !eliminated.has(x.team)).indexOf(r);
                  return (
                    <Cell key={i}
                      fill={rank === 0 ? "#FFD700" : rank === 1 ? "#00D4FF" : rank <= 3 ? "#00FFB2" : "#2A3F6B"} />
                  );
                })}
                <LabelList dataKey="Champion"
                  position="right"
                  formatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                  style={{ fill: "#8FA0C8", fontSize: 10 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.section>

      {/* ════ STAGE-BY-STAGE TABLE ════ */}
      <motion.section
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="card-broadcast overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <SectionHeader
            title="STAGE-BY-STAGE ODDS"
            sub={`${activeRows.length} active · ${eliminatedRows.length} eliminated${r16Teams.size > 0 ? " · R16 odds conditional on current bracket" : ""}`}
          />
          {/* Sort filter pills */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-muted/50 uppercase tracking-widest mr-1">Sort by</span>
            {SORT_STAGES.map((stage) => (
              <button
                key={stage}
                onClick={() => setSortBy(stage)}
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition
                  ${sortBy === stage
                    ? stage === "Champion"
                      ? "bg-gold/20 text-gold border border-gold/40"
                      : stage === "SF" || stage === "Final"
                        ? "bg-cyan/15 text-cyan border border-cyan/30"
                        : "bg-white/10 text-white border border-white/20"
                    : "text-muted/50 border border-white/8 hover:text-muted hover:border-white/20"
                  }`}
              >
                {stage === "Champion" ? "🏆" : stage}
                {sortBy === stage && <span className="ml-0.5 opacity-70">↓</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[440px]">
            {/* header */}
            <div className={`${STAGE_GRID} border-b border-white/10 px-2 py-3 text-[11px] uppercase tracking-widest text-muted`}>
              <span>#</span>
              <span>Team</span>
              {SORT_STAGES.map((stage) => (
                <button
                  key={stage}
                  onClick={() => setSortBy(stage)}
                  className={`text-right transition w-full
                    ${sortBy === stage
                      ? stage === "Champion" ? "text-gold font-bold" : "text-cyan font-bold"
                      : "text-muted/60 hover:text-muted"
                    }`}
                >
                  {stage === "Champion" ? "🏆" : stage}
                </button>
              ))}
            </div>

            {/* Active teams */}
            {activeRows.map((r: any, i: number) => (
              <StageRow key={r.team} r={r} rank={i + 1} eliminated={false} sortBy={sortBy} />
            ))}

            {/* Knocked-out divider */}
            {eliminatedRows.length > 0 && (
              <div className="flex items-center gap-3 border-t border-white/8 bg-white/2 px-3 py-2 mt-1">
                <span className="font-display text-[10px] uppercase tracking-widest text-muted/50">
                  Knocked out
                </span>
              </div>
            )}

            {/* Eliminated teams */}
            {eliminatedRows.map((r: any, i: number) => (
              <StageRow key={r.team} r={r} rank={activeRows.length + i + 1} eliminated={true} sortBy={sortBy} />
            ))}
          </div>
        </div>
      </motion.section>

      {/* ════ DARK HORSES ════ */}
      {data.dark_horses?.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="card-broadcast">
          <SectionHeader title="DARK HORSES" sub="Value picks — outperforming their seed" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.dark_horses
              .filter((d: any) => !eliminated.has(d.team))
              .map((d: any) => {
                const row = fullTable.find((r: any) => r.team === d.team);
                return (
                  <Link key={d.team} href={`/teams/${encodeURIComponent(d.team)}`}
                    className="rounded-xl border border-cyan/15 bg-cyan/5 p-4 transition
                               hover:border-cyan/30 hover:bg-cyan/10 block">
                    <div className="mb-2 flex items-center gap-2">
                      <Flag url={row?.flag_url} name={d.team} size={22} />
                      <span className="font-display text-sm font-bold text-stadium">{d.team}</span>
                      <span className="chip text-[9px]">#{d.elo_rank} seed</span>
                    </div>
                    <p className="text-[11px] leading-snug text-muted mb-2">{d.note}</p>
                    <div className="flex gap-4 text-[11px]">
                      <div>
                        <div className="font-bold tabnum text-teal">{pct(d.semi_prob)}</div>
                        <div className="text-[9px] text-muted">SF prob</div>
                      </div>
                      <div>
                        <div className="font-bold tabnum text-gold">{pct(d.title_prob)}</div>
                        <div className="text-[9px] text-muted">Title prob</div>
                      </div>
                    </div>
                  </Link>
                );
              })}
          </div>
        </motion.section>
      )}

      {/* ════ GROUP PROJECTIONS ════ */}
      {groups && (
        <motion.section
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <SectionHeader title="GROUP PROJECTIONS" sub="Simulated advancement probabilities" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Object.entries(groups).map(([g, teams]: any) => (
              <GroupCard key={g} group={g} teams={teams} eliminated={eliminated} />
            ))}
          </div>
        </motion.section>
      )}
    </div>
  );
}

/* ── Shared grid template ── */
const STAGE_GRID =
  "grid grid-cols-[26px_minmax(0,1fr)_repeat(5,46px)] items-center gap-1";

/* ── Stage row ── */
function StageRow({ r, rank, eliminated, sortBy }: {
  r: any; rank: number; eliminated: boolean; sortBy: SortStage;
}) {
  return (
    <Link href={`/teams/${encodeURIComponent(r.team)}`}
      className={`
        ${STAGE_GRID} border-b px-2 py-2 transition
        ${eliminated
          ? "border-white/5 opacity-40 hover:opacity-70"
          : rank === 1
            ? "border-line/30 border-l-2 border-l-gold hover:bg-white/3"
            : rank === 2
              ? "border-line/30 border-l-2 border-l-cyan hover:bg-white/3"
              : "border-line/30 hover:bg-white/3"
        }
      `}>

      {/* rank */}
      <span className={`text-[11px] font-bold tabnum ${
        eliminated ? "text-muted/30" : rank <= 3 ? "text-gold" : "text-muted/50"}`}>
        {rank}
      </span>

      {/* team */}
      <span className="flex min-w-0 items-center gap-1.5">
        <div className={eliminated ? "grayscale" : ""}>
          <Flag url={r.flag_url} name={r.team} size={16} />
        </div>
        <span className={`min-w-0 break-words font-display text-sm font-semibold leading-tight
          ${eliminated ? "text-muted/50" : ""}`}>
          {r.team}
        </span>
      </span>

      {/* stage probabilities */}
      {(["R32", "QF", "SF", "Final", "Champion"] as const).map((stage, si) => {
        const isSort = stage === sortBy;
        const isWonR32 = !eliminated && r._conditional && stage === "R32";
        return (
          <span key={stage}
            className={`text-right tabnum text-xs
              ${eliminated ? "text-muted/25" : ""}
              ${!eliminated && isSort && stage === "Champion" ? "font-bold text-gold" : ""}
              ${!eliminated && isSort && stage !== "Champion" ? "font-bold text-cyan" : ""}
              ${!eliminated && !isSort ? "text-muted/60" : ""}
              ${si === 4 ? "pr-1" : ""}
            `}>
            {eliminated ? "—" : isWonR32 ? <span className="text-teal">✓</span> : pct(r[stage])}
          </span>
        );
      })}
    </Link>
  );
}

/* ── Group wall-chart card ── */
function GroupCard({ group, teams, eliminated }: {
  group: string; teams: any[]; eliminated: Set<string>;
}) {
  const maxProb = Math.max(...teams.map((t: any) => t.advance_prob ?? 0), 0.01);
  return (
    <div className="card-broadcast">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-display text-xs font-bold uppercase tracking-widest text-stadium">
          Group {group}
        </span>
        <span className="chip-cyan text-[9px]">Advancement</span>
      </div>
      <div className="space-y-3">
        {teams.map((t: any, i: number) => {
          const isOut = eliminated.has(t.team);
          return (
            <div key={t.team} className={isOut ? "opacity-35" : ""}>
              <div className="mb-1 flex items-center justify-between">
                <span className={`flex items-center gap-1.5 text-sm font-semibold
                  ${isOut ? "text-muted/50" : i < 2 ? "text-stadium" : "text-muted"}`}>
                  <span className={`text-xs w-4 ${
                    isOut ? "text-muted/30" : i < 2 ? "text-teal" : "text-muted/50"}`}>
                    {i + 1}.
                  </span>
                  {t.team}
                  {!isOut && i < 2 && <span className="chip-gold text-[9px]">ADV</span>}
                </span>
                <span className={`tabnum text-xs font-bold ${isOut ? "text-muted/30" : "text-cyan"}`}>
                  {isOut ? "—" : pct(t.advance_prob)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  className={`h-1.5 rounded-full ${
                    isOut ? "bg-white/10"
                    : i === 0 ? "bg-gold"
                    : i === 1 ? "bg-cyan"
                    : "bg-white/20"}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${(t.advance_prob / maxProb) * 100}%` }}
                  transition={{ duration: 0.7, delay: 0.3 + i * 0.05 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Skeleton ── */
function SimSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-12 w-80 animate-pulse rounded-lg bg-ink-2" />
      <div className="h-16 animate-pulse rounded-2xl bg-ink-2" />
      <div className="h-80 animate-pulse rounded-2xl bg-ink-2" />
      <div className="h-96 animate-pulse rounded-2xl bg-ink-2" />
    </div>
  );
}
