"use client";
import { useState, useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { Flag, SectionHeader } from "@/components/ui";

const fetcher = (p: string) => api(p);

const GROUPS = "ABCDEFGHIJKL".split("");

function useKnockoutSets() {
  const { data: ko } = useSWR("/api/knockout", fetcher, { revalidateOnFocus: false });
  return useMemo<{ r32Teams: Set<string>; eliminated: Set<string> }>(() => {
    const r32Teams = new Set<string>();
    const eliminated = new Set<string>();
    if (!ko?.matches) return { r32Teams, eliminated };
    for (const m of ko.matches as any[]) {
      // Collect all teams that made the R32
      if (m.round === "Round of 32") {
        if (m.home_team) r32Teams.add(m.home_team);
        if (m.away_team) r32Teams.add(m.away_team);
      }
      // Collect teams knocked out in R32 or later
      const hs = m.home_score;
      const aws = m.away_score;
      if (hs == null || aws == null) continue;
      const home = m.home_team;
      const away = m.away_team;
      if (!home || !away) continue;
      const ph: number | null = m.pen_home ?? null;
      const pa: number | null = m.pen_away ?? null;
      if (hs > aws)                               eliminated.add(away);
      else if (aws > hs)                          eliminated.add(home);
      else if (ph != null && pa != null) {
        if (ph > pa)                              eliminated.add(away);
        else                                      eliminated.add(home);
      }
    }
    return { r32Teams, eliminated };
  }, [ko]);
}

export default function TeamsPage() {
  const { data, error } = useSWR("/api/teams", fetcher);
  const { r32Teams, eliminated } = useKnockoutSets();
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [showElim, setShowElim] = useState(true);

  if (error) return (
    <div className="card-broadcast flex items-center gap-3 text-danger">
      <span className="text-2xl">⚡</span> Backend unreachable.
    </div>
  );
  if (!data) return <TeamsSkeleton />;

  // Only show teams that made it to the knockout stage (R32+)
  // If r32Teams hasn't loaded yet, show all teams as fallback
  const inKnockout = (t: any) => r32Teams.size === 0 || r32Teams.has(t.name);

  const sorted = [...data]
    .filter(inKnockout)
    .sort((a: any, b: any) => {
      const aOut = eliminated.has(a.name) ? 1 : 0;
      const bOut = eliminated.has(b.name) ? 1 : 0;
      if (aOut !== bOut) return aOut - bOut;
      return a.fifa_rank - b.fifa_rank;
    });

  const filtered = sorted.filter((t: any) =>
    (!group || t.group === group) &&
    (!search || t.name.toLowerCase().includes(search.toLowerCase())) &&
    (showElim || !eliminated.has(t.name))
  );

  const activeFiltered = filtered.filter((t: any) => !eliminated.has(t.name));
  const elimFiltered   = filtered.filter((t: any) =>  eliminated.has(t.name));
  const groupStageOut  = r32Teams.size > 0 ? (data.length - r32Teams.size) : 0;

  const getTier = (elo: number) =>
    elo >= 2000 ? { label: "Elite",      color: "text-gold" } :
    elo >= 1850 ? { label: "Contender",  color: "text-cyan" } :
    elo >= 1700 ? { label: "Solid",      color: "text-teal" } :
                  { label: "Underdog",   color: "text-muted" };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="NATIONS"
        sub={`${activeFiltered.length} still competing · ${eliminated.size} knocked out · ${groupStageOut} eliminated in group stage · FIFA World Cup 2026`}
      />

      {/* knocked-out notice */}
      {eliminated.size > 0 && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/8 bg-white/3 px-4 py-3">
          <span className="font-display text-sm font-semibold text-muted">
            {eliminated.size} team{eliminated.size > 1 ? "s" : ""} knocked out · shown below
          </span>
          <button onClick={() => setShowElim(v => !v)}
            className="ml-auto text-[11px] text-muted/60 hover:text-muted transition">
            {showElim ? "Hide" : "Show"}
          </button>
        </motion.div>
      )}

      {/* filter bar */}
      <div className="card-broadcast flex flex-wrap items-center gap-3 py-4">
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
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search team…"
          className="min-w-[160px] flex-1 rounded-lg border border-white/10 bg-ink-3 px-3 py-1.5 text-sm placeholder:text-muted focus:border-cyan/40 focus:outline-none focus:ring-1 focus:ring-cyan/20" />
      </div>

      {/* active teams */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {activeFiltered.map((t: any, i: number) => (
          <TeamCard key={t.name} t={t} i={i} eliminated={false} getTier={getTier} />
        ))}
      </div>

      {/* knocked-out section */}
      {showElim && elimFiltered.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/8" />
            <span className="rounded-full border border-white/10 bg-white/3 px-3 py-1 text-[11px] uppercase tracking-widest text-muted">
              Knocked out
            </span>
            <div className="h-px flex-1 bg-white/8" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {elimFiltered.map((t: any, i: number) => (
              <TeamCard key={t.name} t={t} i={i} eliminated={true} getTier={getTier} />
            ))}
          </div>
        </>
      )}

      {filtered.length === 0 && (
        <p className="text-center text-muted py-8">No teams match the filter.</p>
      )}
    </div>
  );
}

function TeamCard({ t, i, eliminated, getTier }: {
  t: any; i: number; eliminated: boolean;
  getTier: (elo: number) => { label: string; color: string };
}) {
  const tier = getTier(t.elo);
  const strengthW = Math.min(100, Math.max(0, ((t.strength_index - 30) / 70) * 100));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.025 }}>
      <Link href={`/teams/${encodeURIComponent(t.name)}`}
        className={`group flex items-center gap-4 rounded-2xl border p-4 transition
          ${eliminated
            ? "border-white/5 bg-white/2 opacity-45 hover:opacity-70 hover:border-white/10"
            : "card-broadcast match-card-hover"
          }`}>

        {/* flag */}
        <div className="relative shrink-0">
          <div className={eliminated ? "grayscale" : ""}>
            <Flag url={t.flag_url} name={t.name} size={44} />
          </div>
          <span className="absolute -bottom-1 -right-1 rounded-full bg-ink-3 px-1 text-[9px] font-bold text-muted border border-white/10">
            #{t.fifa_rank}
          </span>
        </div>

        {/* info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 leading-tight">
            <span className="min-w-0 break-words font-display font-semibold leading-tight text-muted">
              {t.name}
            </span>
            {!eliminated && (
              <span className={`shrink-0 text-[10px] font-bold ${tier.color}`}>{tier.label}</span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted/60">
            <span className="chip text-[9px]">GRP {t.group}</span>
            <span>Elo {t.elo}</span>
          </div>
          {/* strength bar */}
          <div className="mt-2 h-1.5 w-full rounded-full bg-white/5">
            <motion.div
              className="h-1.5 rounded-full bg-white/20"
              initial={{ width: 0 }}
              animate={{ width: `${strengthW}%` }}
              transition={{ duration: 0.6, delay: i * 0.025 }} />
          </div>
        </div>

        {/* strength index */}
        <div className="text-right shrink-0">
          <div className="font-display text-xl font-bold tabnum text-muted/50">
            {t.strength_index}
          </div>
          <div className="text-[10px] text-muted/40">Strength</div>
        </div>
      </Link>
    </motion.div>
  );
}

function TeamsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-12 w-64 animate-pulse rounded-lg bg-ink-2" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink-2" />
        ))}
      </div>
    </div>
  );
}

