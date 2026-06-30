"use client";
import { useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import { motion } from "framer-motion";
import { api, pct } from "@/lib/api";
import { SectionHeader, Flag } from "@/components/ui";

const fetcher = (p: string) => api(p);

function useKnockoutSets() {
  const { data: ko } = useSWR("/api/knockout", fetcher, { revalidateOnFocus: false });
  return useMemo<{ r32Teams: Set<string>; r32Eliminated: Set<string> }>(() => {
    const r32Teams = new Set<string>();
    const r32Eliminated = new Set<string>();
    if (!ko?.matches) return { r32Teams, r32Eliminated };
    for (const m of ko.matches as any[]) {
      if (m.round === "Round of 32") {
        if (m.home_team) r32Teams.add(m.home_team);
        if (m.away_team) r32Teams.add(m.away_team);
      }
      // Teams knocked out in any round
      const hs = m.home_score;
      const aws = m.away_score;
      if (hs == null || aws == null) continue;
      const home = m.home_team;
      const away = m.away_team;
      if (!home || !away) continue;
      const ph: number | null = m.pen_home ?? null;
      const pa: number | null = m.pen_away ?? null;
      if (hs > aws)                    r32Eliminated.add(away);
      else if (aws > hs)               r32Eliminated.add(home);
      else if (ph != null && pa != null) ph > pa ? r32Eliminated.add(away) : r32Eliminated.add(home);
    }
    return { r32Teams, r32Eliminated };
  }, [ko]);
}

export default function GroupsPage() {
  const { data, error } = useSWR("/api/simulate/groups", fetcher);
  const { r32Teams, r32Eliminated } = useKnockoutSets();

  if (error) return (
    <div className="card-broadcast flex items-center gap-3 text-danger">
      <span className="text-2xl">⚡</span> Run the simulator first.
    </div>
  );
  if (!data) return <div className="h-80 animate-pulse rounded-2xl bg-ink-2" />;

  const groupsComplete = Object.values(data).every(
    (teams: any) => teams.every((t: any) => t.mp === 3)
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        title="GROUP STANDINGS"
        sub={groupsComplete
          ? "All group matches complete · final standings"
          : "Played results · advancement % from 50 000 Monte Carlo simulations"}
      />

      {groupsComplete && r32Teams.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/8 bg-white/3 px-4 py-3 text-[12px] text-muted">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[8px] font-bold text-ink">✓</span>
          <span>Group stage complete.</span>
          <span className="text-teal font-semibold">ADV</span><span>= confirmed R32 qualifier ·</span>
          <span className="text-muted/50 font-semibold">OUT</span><span>= knocked out ·</span>
          <span className="text-stadium">Pts</span><span>= final points ·</span>
          <span className="text-gold">Proj</span><span>= projected (sim) ·</span>
          <span className="text-cyan">Adv%</span><span>= pre-tournament sim %</span>
        </div>
      )}

      {!groupsComplete && (
        <p className="text-sm text-muted">
          Top two from each group advance automatically. Eight best third-placed
          teams also qualify. <span className="text-teal">Q</span> = projected to advance.
          <span className="text-stadium"> Pts</span> = earned so far ·
          <span className="text-gold"> Proj</span> = projected final points ·
          <span className="text-cyan"> Adv%</span> = simulated chance to advance.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(data).map(([g, teams]: any, gi: number) => {
          const allPlayed = teams.every((t: any) => t.mp === 3);
          return (
            <motion.div key={g} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.04 }} className="card-broadcast overflow-hidden">

              {/* Group header */}
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display text-sm font-bold uppercase tracking-widest text-stadium">
                  Group {g}
                </span>
                <div className="flex items-center gap-2">
                  {allPlayed && (
                    <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-success">
                      Complete
                    </span>
                  )}
                  <span className="chip-cyan text-[9px]">{teams[0]?.mp ?? 0} MP</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[340px] text-sm">
                  <thead>
                    <tr className="border-b border-line/60 text-[10px] uppercase tracking-wider text-muted">
                      <th className="py-1.5 pr-1 text-left font-medium">#</th>
                      <th className="py-1.5 pl-1 text-left font-medium">Team</th>
                      <th className="px-1.5 py-1.5 text-center font-medium" title="Matches played">MP</th>
                      <th className="px-1 py-1.5 text-center font-medium" title="Won">W</th>
                      <th className="px-1 py-1.5 text-center font-medium" title="Drawn">D</th>
                      <th className="px-1 py-1.5 text-center font-medium" title="Lost">L</th>
                      <th className="px-1.5 py-1.5 text-center font-medium" title="Goal difference">GD</th>
                      <th className="px-1.5 py-1.5 text-center font-semibold text-stadium" title="Points">Pts</th>
                      <th className="px-1.5 py-1.5 text-center font-medium text-gold/80" title="Projected final points">Proj</th>
                      <th className="py-1.5 pl-1.5 text-right font-medium" title="Advance probability">Adv%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((t: any, i: number) => {
                      // Determine actual qualification status
                      const confirmed = r32Teams.size > 0
                        ? r32Teams.has(t.team)
                        : i < 2;                   // fallback while loading
                      const groupOut = r32Teams.size > 0 && !r32Teams.has(t.team);
                      const knockedOut = r32Eliminated.has(t.team); // lost in R32+

                      const borderLeft =
                        i === 0 ? "border-l-2 border-l-gold" :
                        i === 1 ? "border-l-2 border-l-cyan" : "";

                      return (
                        <tr key={t.team}
                          className={`border-b border-line/30 transition
                            ${groupOut ? "opacity-35" : confirmed ? "" : "text-muted"}
                            ${borderLeft}`}>

                          {/* Rank */}
                          <td className={`py-2 pr-1 text-left text-[11px] font-bold
                            ${groupOut ? "text-muted/30" : confirmed ? "text-teal" : "text-muted/40"}`}>
                            {i + 1}
                          </td>

                          {/* Team name + flag */}
                          <td className="py-2 pl-1">
                            <Link href={`/teams/${encodeURIComponent(t.team)}`}
                              className="flex items-center gap-1.5 hover:opacity-80 transition">
                              <div className={groupOut ? "grayscale" : ""}>
                                <Flag url={t.flag_url} name={t.team} size={16} />
                              </div>
                              <span className={`min-w-0 break-words leading-tight text-[12px]
                                ${groupOut
                                  ? "text-muted/50 font-medium"
                                  : confirmed ? "font-semibold text-stadium" : "text-muted"}`}>
                                {t.team}
                              </span>
                              {confirmed && !groupOut && (
                                <span className={`shrink-0 text-[8px] font-bold rounded px-1 py-px leading-none
                                  ${knockedOut ? "chip text-muted" : "chip-gold"}`}>
                                  {knockedOut ? "OUT" : "ADV"}
                                </span>
                              )}
                            </Link>
                          </td>

                          {/* Stats */}
                          <td className="px-1.5 py-2 text-center tabnum">{t.mp}</td>
                          <td className="px-1 py-2 text-center tabnum">{t.w}</td>
                          <td className="px-1 py-2 text-center tabnum">{t.d}</td>
                          <td className="px-1 py-2 text-center tabnum">{t.l}</td>
                          <td className="px-1.5 py-2 text-center tabnum">
                            {t.gd > 0 ? `+${t.gd}` : t.gd}
                          </td>
                          <td className={`px-1.5 py-2 text-center font-display font-bold tabnum
                            ${groupOut ? "text-muted/40" : "text-stadium"}`}>
                            {t.pts}
                          </td>
                          <td className="px-1.5 py-2 text-center font-display tabnum text-gold/90 text-xs"
                            title="Projected final points (incl. remaining games)">
                            {t.proj_pts != null ? t.proj_pts.toFixed(1) : "—"}
                          </td>
                          <td className={`py-2 pl-1.5 text-right font-bold tabnum text-xs
                            ${groupOut ? "text-muted/30" : "text-cyan"}`}>
                            {groupOut ? "—" : pct(t.advance_prob)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
