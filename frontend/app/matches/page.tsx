"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { motion, AnimatePresence } from "framer-motion";
import { api, pct0 } from "@/lib/api";
import { Flag, ProbBar, LiveBadge, SectionHeader } from "@/components/ui";

const fetcher = (p: string) => api(p);
const GROUPS = "ABCDEFGHIJKL".split("");
const MDS = ["MD1", "MD2", "MD3"];

const ET = "America/New_York";
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: ET,
  });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: ET,
  });

export default function MatchesPage() {
  const router = useRouter();
  const [group, setGroup] = useState("");
  const [matchday, setMatchday] = useState("");
  const [team, setTeam] = useState("");
  const [upcoming, setUpcoming] = useState(false);
  const [view, setView] = useState<"cards" | "table">("cards");

  // Fetch the full fixture list once, then filter CLIENT-SIDE. (Server-side
  // query params can't be pre-rendered into the static snapshot demo, so the
  // search/filters must run on the client to work with or without a live API.)
  const { data: allData, error } = useSWR(`/api/matches?`, fetcher);

  const data = useMemo(() => {
    if (!allData) return allData;
    const t = team.trim().toLowerCase();
    return allData.filter((m: any) => {
      if (group && m.group !== group) return false;
      if (matchday && m.matchday !== matchday) return false;
      if (upcoming && m.played) return false;
      if (t && !m.home_team.toLowerCase().includes(t) &&
              !m.away_team.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [allData, group, matchday, team, upcoming]);

  const played = (data ?? []).filter((m: any) => m.played).length;
  const total = (data ?? []).length;

  return (
    <div className="space-y-6">

      {/* ── Page header ── */}
      <SectionHeader title="FIXTURES" sub={`FIFA World Cup 2026 · Canada · Mexico · USA`}
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setView("cards")}
              className={`btn-sm ${view === "cards" ? "btn-gold" : ""}`}>⊞ Cards</button>
            <button onClick={() => setView("table")}
              className={`btn-sm ${view === "table" ? "btn-gold" : ""}`}>☰ Table</button>
          </div>
        } />

      {/* ── Filter bar ── */}
      <div className="card-broadcast flex flex-wrap items-center gap-3 py-4">
        <div className="flex flex-wrap gap-2">
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
        </div>
        <div className="h-6 w-px bg-white/10 hidden sm:block" />
        <div className="flex gap-2">
          {MDS.map((d) => (
            <button key={d} onClick={() => setMatchday(matchday === d ? "" : d)}
              className={`chip cursor-pointer text-xs transition hover:border-gold/50 ${matchday === d ? "chip-gold" : ""}`}>
              {d}
            </button>
          ))}
        </div>
        <input value={team} onChange={(e) => setTeam(e.target.value)}
          placeholder="Search team…"
          className="min-w-[140px] flex-1 rounded-lg border border-white/10 bg-ink-3 px-3 py-1.5 text-sm placeholder:text-muted focus:border-cyan/40 focus:outline-none focus:ring-1 focus:ring-cyan/20" />
        <button onClick={() => setUpcoming((v) => !v)}
          className={`btn-sm ${upcoming ? "btn-gold" : ""}`}>
          {upcoming ? "⏭ Upcoming" : "All dates"}
        </button>
        {data && (
          <span className="ml-auto text-xs text-muted hidden md:block">
            <b className="text-success">{played}</b> played · <b className="text-stadium">{total - played}</b> upcoming
          </span>
        )}
      </div>

      {error && (
        <div className="card-broadcast flex items-center gap-3 text-danger">
          <span className="text-xl">⚡</span> Backend unreachable — start the API on :8000.
        </div>
      )}
      {!data && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-ink-2" />
          ))}
        </div>
      )}

      {/* ── CARDS VIEW ── */}
      {data && view === "cards" && <CardsView data={data} router={router} />}

      {/* ── TABLE VIEW ── */}
      {data && view === "table" && <TableView data={data} router={router} />}
    </div>
  );
}

/* ── Cards grid ── */
function CardsView({ data, router }: { data: any[]; router: any }) {
  // Group by date
  const byDate: Record<string, any[]> = {};
  for (const m of data) {
    const d = fmtDate(m.kickoff);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(m);
  }
  if (data.length === 0) return <p className="text-muted py-4">No matches match the filter.</p>;
  return (
    <div className="space-y-8">
      {Object.entries(byDate).map(([date, matches]) => (
        <section key={date}>
          <div className="mb-3 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/5" />
            <span className="font-display text-xs uppercase tracking-widest text-muted">{date}</span>
            <div className="h-px flex-1 bg-white/5" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence>
              {matches.map((m: any, i: number) => (
                <motion.div key={m.id}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}>
                  <BroadcastMatchCard m={m} onClick={() => router.push(`/matches/${m.id}`)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      ))}
    </div>
  );
}

/* ── Broadcast match card (inline, not using MatchCard to keep self-contained) ── */
function BroadcastMatchCard({ m, onClick }: { m: any; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card-broadcast match-card-hover w-full text-left group">
      {/* top meta */}
      <div className="mb-3 flex items-center justify-between text-[11px] text-muted">
        <span className="chip-cyan">GRP {m.group} · {m.matchday}</span>
        {m.played
          ? <LiveBadge label="FULL TIME" color="cyan" />
          : <span className="chip">{fmtTime(m.kickoff)}</span>}
      </div>

      {/* teams + score */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Flag url={m.home_flag} name={m.home_team} size={28} />
          <span className="min-w-0 break-words leading-tight font-display font-semibold text-stadium">{m.home_team}</span>
        </div>
        {m.played ? (
          <span className="font-display text-xl font-bold tabnum text-stadium shrink-0 px-2">
            {m.home_score} – {m.away_score}
          </span>
        ) : (
          <span className="font-display text-xs font-bold text-muted/50 shrink-0 px-2">VS</span>
        )}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <span className="min-w-0 break-words text-right leading-tight font-display font-semibold text-stadium">{m.away_team}</span>
          <Flag url={m.away_flag} name={m.away_team} size={28} />
        </div>
      </div>

      {/* prob bar */}
      {!m.played && (
        <>
          <ProbBar home={m.p_home} draw={m.p_draw} away={m.p_away} height={6} />
          <div className="mt-2 flex justify-between text-[11px] tabnum">
            <span className="text-success">{pct0(m.p_home)}</span>
            <span className="text-muted">D {pct0(m.p_draw)}</span>
            <span className="text-cyan">{pct0(m.p_away)}</span>
          </div>
        </>
      )}

      {/* bottom meta */}
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted border-t border-white/5 pt-2">
        <span>📍 {m.city}</span>
        <div className="flex gap-1">
          {m.market_used && <span className="chip">📈</span>}
          {m.upset_probability >= 0.32 && <span className="chip-gold text-[10px]">⚠ UPSET</span>}
          {m.confidence && <span className="text-gold font-bold">{m.confidence}</span>}
        </div>
      </div>
    </button>
  );
}

/* ── Table view ── */
function TableView({ data, router }: { data: any[]; router: any }) {
  let lastDate = "";
  if (data.length === 0) return <p className="text-muted py-4">No matches match the filter.</p>;
  return (
    <div className="card-broadcast overflow-x-auto p-0">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-2 py-3 font-medium">Time ET</th>
            <th className="px-2 py-3 font-medium">Grp/MD</th>
            <th className="px-4 py-3 font-medium">Match</th>
            <th className="px-4 py-3 text-center font-medium">Result / Odds</th>
            <th className="px-3 py-3 text-right font-medium">Conf</th>
          </tr>
        </thead>
        <tbody>
          {data.map((m: any) => {
            const d = fmtDate(m.kickoff);
            const newDay = d !== lastDate;
            lastDate = d;
            return (
              <tr key={m.id}
                onClick={() => router.push(`/matches/${m.id}`)}
                className={`cursor-pointer border-b border-white/5 transition hover:bg-cyan/5
                  ${newDay ? "border-t border-t-white/10" : ""}`}>
                <td className="whitespace-nowrap px-4 py-3 text-muted">
                  {newDay && <span className="font-display text-xs text-stadium">{d}</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-3 tabnum text-muted text-xs">{fmtTime(m.kickoff)}</td>
                <td className="px-2 py-3">
                  <span className="chip-cyan text-[10px]">G{m.group}</span>
                  <span className="ml-1 text-muted text-[10px]">{m.matchday}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 font-display font-semibold text-stadium">
                    <Flag url={m.home_flag} name={m.home_team} size={18} />
                    {m.home_team}
                    <span className="text-muted text-xs">v</span>
                    {m.away_team}
                    <Flag url={m.away_flag} name={m.away_team} size={18} />
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  {m.played ? (
                    <span className="font-bold tabnum text-stadium">
                      {m.home_score}–{m.away_score}
                      <span className="ml-1.5 text-[10px] text-success">FT</span>
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2 text-xs tabnum">
                      <span className="text-success">{pct0(m.p_home)}</span>
                      <span className="text-muted">D {pct0(m.p_draw)}</span>
                      <span className="text-cyan">{pct0(m.p_away)}</span>
                      {m.market_used && <span className="chip text-[9px]">📈</span>}
                      {m.upset_probability >= 0.32 && <span className="chip-gold text-[9px]">⚠</span>}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  <b className="text-gold">{m.confidence}</b>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

