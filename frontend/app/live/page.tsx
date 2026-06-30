"use client";
import useSWR from "swr";
import Link from "next/link";
import { motion } from "framer-motion";
import { api, pct0 } from "@/lib/api";
import { Flag, ProbBar, Countdown, LiveBadge, SectionHeader } from "@/components/ui";

const fetcher = (p: string) => api(p);
const ET = "America/New_York";
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ET });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });

export default function LiveCenter() {
  const { data: knockoutData, error } = useSWR("/api/knockout", fetcher);

  if (error) return (
    <div className="card-broadcast flex items-center gap-3 text-danger">
      <span className="text-2xl">⚡</span> Live center offline.
    </div>
  );
  if (!knockoutData) return <div className="h-80 animate-pulse rounded-3xl bg-ink-2" />;

  const now = Date.now();
  const r32: any[] = ((knockoutData.matches ?? []) as any[])
    .filter((m: any) => m.round === "Round of 32" && m.resolved)
    .sort((a: any, b: any) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());

  // live window: include matches that kicked off up to 2h ago
  const upcoming = r32.filter((m: any) => new Date(m.kickoff).getTime() > now - 2 * 60 * 60 * 1000);
  const [next, ...rest] = upcoming;

  return (
    <div className="space-y-8">
      <SectionHeader title="LIVE CENTER"
        sub="Round of 32 · Jun 28 – Jul 3 · real-time predictions"
        action={<LiveBadge label="LIVE DATA" color="danger" />} />

      {/* ── Up-next hero ── */}
      {next && (
        <motion.section
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl border border-danger/30 bg-gradient-to-br from-ink-2 via-ink-3/80 to-ink p-7 shadow-[0_0_60px_rgba(255,77,77,0.06)] sm:p-10"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-32 left-1/2 h-96 w-px bg-gradient-to-b from-danger/20 to-transparent" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_-10%,rgba(255,77,77,0.04),transparent)]" />
          </div>

          <div className="relative z-10">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted">
              <div className="flex items-center gap-3">
                <LiveBadge label="UP NEXT" color="danger" />
                <span className="chip-gold font-display uppercase tracking-widest">ROUND OF 32</span>
              </div>
              <span className="font-display uppercase tracking-[0.2em]">
                🏟 {next.city} · {fmtDate(next.kickoff)}
              </span>
            </div>

            <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_auto_1fr] sm:gap-6">
              <LiveTeam name={next.home_team} flag={next.home_flag}
                prob={next.prediction?.p_home ?? 0} side="home" color="text-success" />
              <div className="flex flex-col items-center gap-3 sm:gap-4">
                <Countdown to={next.kickoff} />
                <span className="chip text-xs">Draw {pct0(next.prediction?.p_draw ?? 0)}</span>
              </div>
              <LiveTeam name={next.away_team} flag={next.away_flag}
                prob={next.prediction?.p_away ?? 0} side="away" color="text-cyan" />
            </div>

            <div className="mt-8">
              <ProbBar
                home={next.prediction?.p_home ?? 0}
                draw={next.prediction?.p_draw ?? 0}
                away={next.prediction?.p_away ?? 0}
                height={8} />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                {next.predicted_score && (
                  <span className="text-sm text-muted">
                    Pick <b className="font-display text-gold">{next.predicted_score}</b>
                    {next.shootout && <span className="ml-1 text-muted">· pens</span>}
                    {!next.shootout && (() => { const [h,a] = (next.predicted_score ?? "0-0").split("-").map(Number); return h === a && next.predicted_winner; })() && <span className="ml-1 text-muted">· AET</span>}
                    {next.confidence && (
                      <span className="ml-2 chip-gold text-xs">{next.confidence} conf</span>
                    )}
                  </span>
                )}
                <Link href={`/knockout/${next.id}`} className="btn-gold text-xs ml-auto">
                  Open Match Center →
                </Link>
              </div>
            </div>
          </div>
        </motion.section>
      )}

      {/* ── Upcoming R32 grid ── */}
      {rest.length > 0 && (
        <section>
          <SectionHeader title="UPCOMING R32 FIXTURES" sub="Round of 32 · sorted by kickoff" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((m: any, i: number) => (
              <motion.div key={m.id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.04 }}>
                <LiveKnockoutCard m={m} />
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* ── Empty state ── */}
      {r32.length === 0 && (
        <div className="card-broadcast py-12 text-center">
          <p className="text-muted">Knockout fixtures loading — check back shortly.</p>
          <Link href="/matches" className="btn-sm mt-4 inline-block">View all fixtures →</Link>
        </div>
      )}

      {upcoming.length === 0 && r32.length > 0 && (
        <div className="card-broadcast py-8 text-center">
          <p className="text-stadium font-display">All Round of 32 ties completed.</p>
          <p className="mt-1 text-sm text-muted">Round of 16 begins Jul 5.</p>
          <Link href="/matches" className="btn-gold mt-4 inline-block text-xs">
            View knockout bracket →
          </Link>
        </div>
      )}
    </div>
  );
}

/* ── Live knockout card (upcoming grid) ── */
function LiveKnockoutCard({ m }: { m: any }) {
  const p = m.prediction ?? {};
  return (
    <Link href={`/knockout/${m.id}`} className="card-broadcast match-card-hover block">
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="chip-gold text-[10px]">R32</span>
        <span className="text-muted">{fmtDate(m.kickoff)} · {fmtTime(m.kickoff)}</span>
      </div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Flag url={m.home_flag} name={m.home_team} size={26} />
          <span className="min-w-0 break-words font-display text-sm font-semibold text-stadium leading-tight">
            {m.home_team}
          </span>
        </div>
        <span className="font-display text-xs font-bold text-muted/50 shrink-0 px-2">VS</span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <span className="min-w-0 break-words text-right font-display text-sm font-semibold text-stadium leading-tight">
            {m.away_team}
          </span>
          <Flag url={m.away_flag} name={m.away_team} size={26} />
        </div>
      </div>
      <ProbBar home={p.p_home ?? 0} draw={p.p_draw ?? 0} away={p.p_away ?? 0} height={5} />
      <div className="mt-1.5 flex justify-between text-[10px] tabnum">
        <span className="text-success">{pct0(p.p_home)}</span>
        <span className="text-muted">D {pct0(p.p_draw)}</span>
        <span className="text-cyan">{pct0(p.p_away)}</span>
      </div>
      {m.predicted_score && (
        <div className="mt-2 text-center text-[10px] text-muted">
          Pick <span className="font-bold text-gold">{m.predicted_score}</span>
          {m.shootout && <span> · pens</span>}
          {!m.shootout && (() => { const [h,a] = (m.predicted_score ?? "0-0").split("-").map(Number); return h === a && m.predicted_winner; })() && <span> · AET</span>}
        </div>
      )}
      <div className="mt-2 border-t border-white/5 pt-2 text-[10px] text-muted">
        📍 {m.city}
        {m.confidence && (
          <span className="float-right font-bold text-gold">{m.confidence} conf</span>
        )}
      </div>
    </Link>
  );
}

/* ── Hero team column ── */
function LiveTeam({ name, flag, prob, side, color }:
  { name: string; flag?: string; prob: number; side: "home" | "away"; color: string }) {
  const rev = side === "away";
  return (
    <div className={`flex min-w-0 items-center gap-3 sm:gap-4 ${rev ? "flex-row-reverse text-right" : ""}`}>
      <Flag url={flag} name={name} size={56} />
      <div className="min-w-0">
        <div className="break-words font-display text-lg font-bold leading-tight text-stadium sm:text-xl">{name}</div>
        <div className={`font-display text-3xl font-extrabold tabnum ${color}`}>{pct0(prob)}</div>
      </div>
    </div>
  );
}
