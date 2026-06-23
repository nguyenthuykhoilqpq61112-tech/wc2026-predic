"use client";
import { useState, useEffect } from "react";
import useSWR from "swr";
import { motion } from "framer-motion";
import { api, pct } from "@/lib/api";
import { AIInsightCard, SectionHeader } from "@/components/ui";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";

const fetcher = (p: string) => api(p);

// Distinct line colours for the champion-trend chart (by team rank).
const TREND_COLORS = ["#FFD700", "#00D4FF", "#00FFB2", "#FF6B9D", "#B388FF",
  "#FFA94D", "#4DD0E1", "#F06292", "#AED581", "#9575CD"];

export default function AnalyticsPage() {
  const { data: ins } = useSWR("/api/insights", fetcher);
  const { data: sim } = useSWR("/api/simulate?top=16", fetcher);
  const { data: trend } = useSWR("/api/simulate/champion-trend", fetcher);

  // Which teams to plot on the trend chart. All teams are selectable; default
  // to the current top 6 so the chart isn't 48-line spaghetti.
  const [picked, setPicked] = useState<string[] | null>(null);
  useEffect(() => {
    if (trend?.teams && picked === null) setPicked(trend.teams.slice(0, 6));
  }, [trend, picked]);
  const sel = picked ?? [];
  const colorFor = (team: string) =>
    TREND_COLORS[(trend?.teams?.indexOf(team) ?? 0) % TREND_COLORS.length];
  const toggle = (team: string) =>
    setPicked((p) => {
      const cur = p ?? [];
      return cur.includes(team) ? cur.filter((t) => t !== team) : [...cur, team];
    });

  return (
    <div className="space-y-8">
      <SectionHeader title="ANALYTICS" sub="Model signals, upset alerts & dark horses" />

      {/* champion odds chart */}
      <section className="card-broadcast">
        <SectionHeader title="TITLE-WINNER PROBABILITY" sub="Top 16 · 50 000 simulations" />
        <div className="h-80">
          {sim ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sim.champion_odds} layout="vertical"
                margin={{ left: 8, right: 36, top: 4, bottom: 4 }}>
                <XAxis type="number" tickFormatter={(v) => `${Math.round(v * 100)}%`}
                  stroke="#4A5B80" fontSize={11} tick={{ fill: "#8FA0C8" }} />
                <YAxis type="category" dataKey="team" width={96}
                  fontSize={12} tick={{ fill: "#C8D3E8" }} />
                <Tooltip
                  formatter={(v: number) => [`${pct(v)}`, "Champion"]}
                  cursor={{ fill: "rgba(0,212,255,0.04)" }}
                  contentStyle={{
                    background: "#0F1D3D",
                    border: "1px solid rgba(0,212,255,0.2)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="Champion" radius={[0, 8, 8, 0]}>
                  {sim.champion_odds.map((_: any, i: number) => (
                    <Cell key={i}
                      fill={i === 0 ? "#FFD700" : i === 1 ? "#00D4FF" : i <= 3 ? "#00FFB2" : "#2A3F6B"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="h-full animate-pulse rounded-xl bg-ink-2" />}
        </div>
      </section>

      {/* champion % trend over time */}
      <section className="card-broadcast">
        <SectionHeader title="CHAMPION % TREND"
          sub="How title-winner probability has moved as results come in"
          action={trend?.teams?.length > 0 ? (
            <div className="flex gap-1.5">
              <button onClick={() => setPicked(trend.teams)}
                className="btn-sm text-[11px]">All</button>
              <button onClick={() => setPicked(trend.teams.slice(0, 6))}
                className="btn-sm text-[11px]">Top 6</button>
              <button onClick={() => setPicked([])}
                className="btn-sm text-[11px]">Clear</button>
            </div>
          ) : undefined} />

        {/* team selector — every team is toggleable */}
        {trend?.teams?.length > 0 && (
          <div className="mb-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
            {trend.teams.map((t: string) => {
              const on = sel.includes(t);
              return (
                <button key={t} onClick={() => toggle(t)}
                  className={`chip cursor-pointer text-[10px] transition ${on ? "" : "opacity-50"}`}
                  style={on ? { borderColor: colorFor(t), color: colorFor(t) } : undefined}>
                  {t} {trend.current?.[t] != null && <span className="opacity-70">{trend.current[t]}%</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="h-80">
          {trend && trend.series?.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend.series}
                margin={{ left: 4, right: 20, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" stroke="#4A5B80" fontSize={11} tick={{ fill: "#8FA0C8" }} />
                <YAxis tickFormatter={(v) => `${v}%`} stroke="#4A5B80" fontSize={11}
                  tick={{ fill: "#8FA0C8" }} width={40} domain={[0, "auto"]} />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v}%`, name]}
                  contentStyle={{
                    background: "#0F1D3D",
                    border: "1px solid rgba(0,212,255,0.2)",
                    borderRadius: 12,
                    fontSize: 12,
                  }} />
                {sel.length <= 8 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {sel.map((t: string) => (
                  <Line key={t} type="monotone" dataKey={t}
                    stroke={colorFor(t)} strokeWidth={1.8}
                    dot={{ r: 2 }} activeDot={{ r: 4 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="h-full animate-pulse rounded-xl bg-ink-2" />}
        </div>
        <p className="mt-2 text-[11px] text-muted/70">
          {sel.length} of {trend?.teams?.length ?? 0} teams shown · tap a team to toggle. One point
          per matchday · in-tournament results nudge each team's Elo, which feeds the 50 000-run
          knockout simulation. Moves are small by design (group-stage K-factor is damped).
        </p>
      </section>

      {/* upset alerts + dark horses */}
      <div className="grid gap-6 md:grid-cols-2">
        <section className="card-broadcast">
          <SectionHeader title="⚠ UPSET ALERTS" sub="High-variance fixtures" />
          {ins?.upset_alerts?.length
            ? ins.upset_alerts.map((a: any, i: number) => (
              <motion.div key={a.match}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border-b border-white/5 py-3">
                <div className="flex justify-between text-sm">
                  <span className="font-display font-semibold text-stadium">{a.match}</span>
                  <span className="font-bold tabnum text-gold">{pct(a.underdog_win_prob)}</span>
                </div>
                <p className="mt-1 text-[11px] text-muted">{a.note}</p>
              </motion.div>
            ))
            : <p className="text-sm text-muted py-4">No high-variance fixtures flagged.</p>}
        </section>

        <section className="card-broadcast">
          <SectionHeader title="🐎 DARK HORSES" sub="Value picks from the model" />
          {ins?.dark_horses?.length
            ? ins.dark_horses.map((d: any, i: number) => (
              <motion.div key={d.team}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border-b border-white/5 py-3">
                <div className="flex justify-between text-sm">
                  <span className="font-display font-semibold text-stadium">
                    {d.team} <span className="chip text-[10px]">#{d.elo_rank}</span>
                  </span>
                  <span className="font-bold tabnum text-teal">{pct(d.semi_prob)} SF</span>
                </div>
                <p className="mt-1 text-[11px] text-muted">{d.note}</p>
              </motion.div>
            ))
            : <p className="text-sm text-muted py-4">Run the simulator to surface dark horses.</p>}
        </section>
      </div>

      {/* AI insights */}
      {ins?.insights?.length > 0 && (
        <section>
          <SectionHeader title="CAI INSIGHTS" sub="Model anomaly signals" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ins.insights.slice(0, 6).map((ins: any, i: number) => (
              <AIInsightCard key={i} text={ins.text} confidence={ins.confidence} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

