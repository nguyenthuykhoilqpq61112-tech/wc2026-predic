"use client";
import useSWR from "swr";
import { useMemo } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { api, pct, pct0 } from "@/lib/api";
import { Flag, SectionHeader } from "@/components/ui";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";

const fetcher = (p: string) => api(p);

/* ── Derive eliminated teams from completed knockout matches ── */
function useEliminatedTeams() {
  const { data: ko } = useSWR("/api/knockout", fetcher, { revalidateOnFocus: false });
  return useMemo<Set<string>>(() => {
    const out = new Set<string>();
    if (!ko?.matches) return out;
    for (const m of ko.matches as any[]) {
      const hs = m.home_score;
      const aws = m.away_score;
      if (hs == null || aws == null) continue;
      const home = m.home_team;
      const away = m.away_team;
      if (!home || !away) continue;
      const ph: number | null = m.pen_home ?? null;
      const pa: number | null = m.pen_away ?? null;
      if (hs > aws)           { out.add(away); }
      else if (aws > hs)      { out.add(home); }
      else if (ph != null && pa != null) {
        if (ph > pa)          { out.add(away); }
        else                  { out.add(home); }
      }
    }
    return out;
  }, [ko]);
}

export default function SimulatorPage() {
  const { data, error } = useSWR("/api/simulate?top=24", fetcher);
  const { data: groups }  = useSWR("/api/simulate/groups", fetcher);
  const eliminated = useEliminatedTeams();

  if (error) return (
    <div className="card-broadcast flex items-center gap-3 text-danger">
      <span className="text-2xl">⚡</span> Run the pipeline first — no simulation data.
    </div>
  );
  if (!data) return <SimSkeleton />;

  const chart     = data.champion_odds.slice(0, 12);
  const fullTable = data.champion_odds;

  /* Split table into active vs eliminated */
  const activeRows    = fullTable.filter((r: any) => !eliminated.has(r.team));
  const eliminatedRows = fullTable.filter((r: any) =>  eliminated.has(r.team));

  /* Chart: put eliminated teams at the bottom in red */
  const chartRows = [
    ...chart.filter((r: any) => !eliminated.has(r.team)),
    ...chart.filter((r: any) =>  eliminated.has(r.team)),
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        title="TOURNAMENT SIMULATOR"
        sub="50 000 Monte Carlo tournaments · 12 groups · 32-team knockout"
      />

      {/* ════ ELIMINATED BANNER ════ */}
      {eliminated.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-danger/30 bg-danger/8 px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">
              ✕
            </span>
            <span className="font-display text-sm font-bold uppercase tracking-widest text-danger">
              Eliminated · {eliminated.size} team{eliminated.size > 1 ? "s" : ""} out
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            {[...eliminated].sort().map((team) => {
              const row = fullTable.find((r: any) => r.team === team);
              return (
                <Link key={team} href={`/teams/${encodeURIComponent(team)}`}
                  className="flex items-center gap-2 rounded-xl border border-danger/20 bg-danger/10
                             px-3 py-2 transition hover:border-danger/40 hover:bg-danger/15">
                  <Flag url={row?.flag_url} name={team} size={20} />
                  <div>
                    <div className="font-display text-[12px] font-bold text-danger line-through leading-tight">
                      {team}
                    </div>
                    <div className="text-[9px] text-danger/60 uppercase tracking-wider">
                      Was {pct(row?.Champion ?? 0)} title odds
                    </div>
                  </div>
                  <span className="ml-1 rounded border border-danger/30 px-1 py-0.5 text-[9px] font-bold text-danger/70">
                    OUT
                  </span>
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
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-danger/60 mr-1.5 align-middle" />
            Red bars = eliminated · probabilities are pre-elimination model output
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
                      fill={isOut ? "#FF4D4D" : "#C8D3E8"}
                      fontSize={11}
                      textDecoration={isOut ? "line-through" : "none"}
                      opacity={isOut ? 0.7 : 1}
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
                    `${pct(v)}${isOut ? " (ELIMINATED)" : ""}`,
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
                  if (isOut) return <Cell key={i} fill="#FF4D4D" opacity={0.45} />;
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
        <SectionHeader title="STAGE-BY-STAGE ODDS" sub={`${activeRows.length} active · ${eliminatedRows.length} eliminated`} />

        <div className="overflow-x-auto">
          <div className="min-w-[440px]">
            {/* header */}
            <div className={`${STAGE_GRID} border-b border-white/10 px-2 py-3 text-[11px] uppercase tracking-widest text-muted`}>
              <span>#</span>
              <span>Team</span>
              <span className="text-right">R32</span>
              <span className="text-right">QF</span>
              <span className="text-right">SF</span>
              <span className="text-right">Final</span>
              <span className="pr-1 text-right">🏆</span>
            </div>

            {/* Active teams */}
            {activeRows.map((r: any, i: number) => (
              <StageRow key={r.team} r={r} rank={i + 1} eliminated={false} />
            ))}

            {/* Eliminated divider */}
            {eliminatedRows.length > 0 && (
              <div className="flex items-center gap-3 border-t border-danger/20 bg-danger/5 px-3 py-2 mt-1">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">✕</span>
                <span className="font-display text-[10px] uppercase tracking-widest text-danger">
                  Eliminated from WC 2026
                </span>
              </div>
            )}

            {/* Eliminated teams */}
            {eliminatedRows.map((r: any, i: number) => (
              <StageRow key={r.team} r={r} rank={activeRows.length + i + 1} eliminated={true} />
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
function StageRow({ r, rank, eliminated }: { r: any; rank: number; eliminated: boolean }) {
  return (
    <Link href={`/teams/${encodeURIComponent(r.team)}`}
      className={`
        ${STAGE_GRID} border-b px-2 py-2 transition
        ${eliminated
          ? "border-danger/20 bg-danger/5 hover:bg-danger/10"
          : rank === 1
            ? "border-line/30 border-l-2 border-l-gold hover:bg-white/3"
            : rank === 2
              ? "border-line/30 border-l-2 border-l-cyan hover:bg-white/3"
              : "border-line/30 hover:bg-white/3"
        }
      `}>

      {/* rank */}
      <span className={`text-[11px] font-bold tabnum ${
        eliminated ? "text-danger/50" : rank <= 3 ? "text-gold" : "text-muted/50"}`}>
        {rank}
      </span>

      {/* team */}
      <span className="flex min-w-0 items-center gap-1.5">
        <Flag url={r.flag_url} name={r.team} size={16} />
        <span className={`min-w-0 break-words font-display text-sm font-semibold leading-tight
          ${eliminated ? "text-danger/70 line-through" : ""}`}>
          {r.team}
        </span>
        {eliminated && (
          <span className="shrink-0 rounded border border-danger/40 px-1 py-px text-[8px] font-bold text-danger/80">
            OUT
          </span>
        )}
      </span>

      {/* stage probabilities */}
      {(["R32", "QF", "SF", "Final", "Champion"] as const).map((stage, si) => (
        <span key={stage}
          className={`text-right tabnum text-xs
            ${eliminated ? "text-danger/40 line-through" : ""}
            ${!eliminated && stage === "Champion" && rank === 1 ? "font-bold text-gold" : ""}
            ${!eliminated && stage === "Champion" && rank <= 3 && rank > 1 ? "text-cyan" : ""}
            ${!eliminated && stage !== "Champion" ? "text-muted" : ""}
            ${si === 4 ? "pr-1" : ""}
          `}>
          {eliminated ? "—" : pct(r[stage])}
        </span>
      ))}
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
            <div key={t.team}>
              <div className="mb-1 flex items-center justify-between">
                <span className={`flex items-center gap-1.5 text-sm font-semibold
                  ${isOut ? "text-danger/60" : i < 2 ? "text-stadium" : "text-muted"}`}>
                  <span className={`text-xs w-4 ${
                    isOut ? "text-danger/50" : i < 2 ? "text-teal" : "text-muted/50"}`}>
                    {i + 1}.
                  </span>
                  <span className={isOut ? "line-through" : ""}>{t.team}</span>
                  {isOut
                    ? <span className="chip text-[8px] border-danger/30 text-danger/70">OUT</span>
                    : i < 2 && <span className="chip-gold text-[9px]">ADV</span>}
                </span>
                <span className={`tabnum text-xs font-bold ${isOut ? "text-danger/50" : "text-cyan"}`}>
                  {isOut ? "ELIM" : pct(t.advance_prob)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  className={`h-1.5 rounded-full ${
                    isOut ? "bg-danger/40"
                    : i === 0 ? "bg-gold"
                    : i === 1 ? "bg-cyan"
                    : "bg-white/20"}`}
                  initial={{ width: 0 }}
                  animate={{ width: isOut ? "100%" : `${(t.advance_prob / maxProb) * 100}%` }}
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
