"use client";
import useSWR from "swr";
import { motion } from "framer-motion";
import { api, pct } from "@/lib/api";
import { AIInsightCard, SectionHeader } from "@/components/ui";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const fetcher = (p: string) => api(p);

export default function AnalyticsPage() {
  const { data: ins } = useSWR("/api/insights", fetcher);
  const { data: sim } = useSWR("/api/simulate?top=16", fetcher);

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

