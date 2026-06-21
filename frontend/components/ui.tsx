"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { pct0, pct } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════════════════
   FLAGS
══════════════════════════════════════════════════════════════════════════════ */
export function Flag({ url, name, size = 26 }: { url?: string; name: string; size?: number }) {
  if (!url) return (
    <span className="inline-flex items-center justify-center rounded-sm bg-ink-3 border border-line text-[10px] font-bold text-muted"
      style={{ width: size * 1.4, height: size, fontSize: size * 0.35 }}>
      {name.slice(0, 3).toUpperCase()}
    </span>
  );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={name} width={Math.round(size * 1.4)} height={size}
    className="inline-block rounded-sm border border-white/10 shadow object-cover" />;
}

/* ══════════════════════════════════════════════════════════════════════════════
   LIVE BADGE
══════════════════════════════════════════════════════════════════════════════ */
export function LiveBadge({ label = "LIVE", color = "danger" }: { label?: string; color?: string }) {
  const cls = color === "cyan"
    ? "border-cyan/30 bg-cyan/10 text-cyan"
    : "border-danger/30 bg-danger/10 text-danger";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-display text-[10px] uppercase tracking-[0.2em] ${cls}`}>
      <span className="live-dot" /> {label}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   PROBABILITY BAR (tri-segment broadcast style)
══════════════════════════════════════════════════════════════════════════════ */
export function ProbBar({ home, draw, away, animate = true, height = 10 }:
  { home: number; draw: number; away: number; animate?: boolean; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-white/5"
      style={{ height }}>
      <div className="flex h-full">
        <motion.div className="h-full bg-gradient-to-r from-success to-teal"
          initial={animate ? { width: 0 } : false}
          animate={{ width: `${home * 100}%` }}
          transition={{ duration: 0.9, ease: "easeOut" }} />
        <motion.div className="h-full bg-muted/40"
          initial={animate ? { width: 0 } : false}
          animate={{ width: `${draw * 100}%` }}
          transition={{ duration: 0.9, delay: 0.1, ease: "easeOut" }} />
        <motion.div className="h-full bg-gradient-to-r from-cyan to-sky-400"
          initial={animate ? { width: 0 } : false}
          animate={{ width: `${away * 100}%` }}
          transition={{ duration: 0.9, delay: 0.2, ease: "easeOut" }} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   PROBABILITY RING (SVG arc animated)
══════════════════════════════════════════════════════════════════════════════ */
export function ProbRing({ value, label, color = "#00D4FF", size = 96, track = "rgba(255,255,255,0.06)" }:
  { value: number; label?: string; color?: string; size?: number; track?: string }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={6} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, value))) }}
          transition={{ duration: 1.2, ease: "easeOut" }} />
      </svg>
      <div className="absolute text-center pointer-events-none">
        <div className="stat-num text-xl font-bold leading-none" style={{ color }}>
          {pct0(value)}
        </div>
        {label && <div className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-muted leading-none">{label}</div>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   COUNTDOWN TIMER
══════════════════════════════════════════════════════════════════════════════ */
export function Countdown({ to }: { to: string }) {
  const [left, setLeft] = useState<number>(0);
  useEffect(() => {
    const tick = () => setLeft(new Date(to).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [to]);

  if (left <= 0) return <LiveBadge label="Kickoff" color="danger" />;

  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1_000);

  const Unit = ({ v, u }: { v: number; u: string }) => (
    <div className="flex flex-col items-center">
      <span className="stat-num text-2xl font-bold text-stadium tabnum leading-none">
        {String(v).padStart(2, "0")}
      </span>
      <span className="text-[9px] uppercase tracking-wider text-muted">{u}</span>
    </div>
  );

  return (
    <div className="flex items-center gap-2">
      <Unit v={d} u="d" />
      <span className="text-cyan/40 text-lg">:</span>
      <Unit v={h} u="h" />
      <span className="text-cyan/40 text-lg">:</span>
      <Unit v={m} u="m" />
      <span className="text-cyan/40 text-lg">:</span>
      <Unit v={s} u="s" />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   MOMENTUM BAR (diverging xG)
══════════════════════════════════════════════════════════════════════════════ */
export function MomentumBar({ home, away, homeVal, awayVal }:
  { home: string; away: string; homeVal: number; awayVal: number }) {
  const total = homeVal + awayVal || 1;
  const h = homeVal / total;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs text-muted">
        <span className="text-success">{home} <b>{(h * 100).toFixed(0)}%</b></span>
        <span className="text-cyan">{((1 - h) * 100).toFixed(0)}% <b>{away}</b></span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-white/5">
        <motion.div className="h-full bg-gradient-to-r from-success to-teal"
          initial={{ width: 0 }}
          animate={{ width: `${h * 100}%` }}
          transition={{ duration: 0.9 }} />
        <motion.div className="h-full bg-gradient-to-r from-cyan to-sky-400"
          initial={{ width: 0 }}
          animate={{ width: `${(1 - h) * 100}%` }}
          transition={{ duration: 0.9, delay: 0.05 }} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   METER / ATTRIBUTE BAR (0-100 scale)
══════════════════════════════════════════════════════════════════════════════ */
export function Meter({ label, value, color = "#00D4FF", max = 100 }:
  { label: string; value: number; color?: string; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="stat-num font-semibold tabnum" style={{ color }}>{Math.round(value)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5">
        <motion.div className="h-1.5 rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8 }} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   PLAYER CARD (FIFA Ultimate-Team style)
══════════════════════════════════════════════════════════════════════════════ */
export function PlayerCard({ p, flag, compact = false }: { p: any; flag?: string; compact?: boolean }) {
  const fitnessColor = p.fitness === "fit" ? "#00E676" : p.fitness === "doubt" ? "#FFD700" : "#FF4D4D";
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-ink-3 to-ink p-3 shadow-ring
                    transition hover:border-cyan/30 hover:shadow-glow group">
      {/* Shine overlay */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300
                      bg-gradient-to-br from-cyan/5 via-transparent to-transparent pointer-events-none rounded-xl" />

      <div className="flex items-start justify-between">
        <div className="text-center">
          <div className="stat-num text-3xl font-bold leading-none" style={{ color: "#00D4FF" }}>
            {Math.round(p.impact)}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-muted mt-0.5">{p.position}</div>
          {flag && <div className="mt-1"><Flag url={flag} name="" size={18} /></div>}
        </div>
        <div className="grid h-14 w-14 place-items-center rounded-full border border-line bg-white/5 text-2xl overflow-hidden">
          {p.photo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={p.photo_url} alt={p.name} className="h-full w-full rounded-full object-cover" />
            : "👤"}
        </div>
      </div>

      <div className="mt-2 font-display text-sm font-semibold leading-tight">{p.name}</div>
      {!compact && <div className="text-[11px] text-muted leading-tight mt-0.5">{p.club}</div>}

      <div className="mt-2 flex flex-wrap gap-2 text-[10px] tabnum">
        <span className="text-muted"><b className="text-stadium">{p.goals}</b>G</span>
        <span className="text-muted"><b className="text-stadium">{p.assists}</b>A</span>
        <span className="text-muted">xG <b className="text-stadium">{p.xg}</b></span>
        <span className="font-bold" style={{ color: fitnessColor }}>
          {p.fitness === "fit" ? "✓ FIT" : p.fitness === "doubt" ? "? DOUBT" : "✗ OUT"}
        </span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   BROADCAST MATCH CARD (premium TV-style)
══════════════════════════════════════════════════════════════════════════════ */
export function MatchCard({ m }: { m: any }) {
  const played = m.played;
  const cardRef = useRef<HTMLAnchorElement>(null);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 100;
    const my = ((e.clientY - rect.top) / rect.height) * 100;
    cardRef.current.style.setProperty("--mx", `${mx}%`);
    cardRef.current.style.setProperty("--my", `${my}%`);
  };

  return (
    <Link ref={cardRef} href={`/matches/${m.id}`}
      onMouseMove={handleMouseMove}
      className="match-card-hover block rounded-2xl border border-line bg-ink-2/80 backdrop-blur p-4 shadow-card">

      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <span className="chip-cyan">Group {m.group} · {m.matchday}</span>
        <span className="text-[11px] text-muted">
          {played
            ? <span className="status-ft">FT</span>
            : new Date(m.kickoff).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      </div>

      {/* Teams */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 font-display font-semibold text-sm">
          <Flag url={m.home_flag} name={m.home_team} size={22} />
          <span className="min-w-0 break-words leading-tight">{m.home_team}</span>
        </div>

        {played ? (
          <span className="stat-num text-xl font-bold tabnum text-stadium shrink-0">
            {m.home_score}
            <span className="text-muted mx-1">–</span>
            {m.away_score}
          </span>
        ) : (
          <span className="font-display text-xs font-bold text-gold/70 shrink-0">VS</span>
        )}

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 font-display font-semibold text-sm">
          <span className="min-w-0 break-words text-right leading-tight">{m.away_team}</span>
          <Flag url={m.away_flag} name={m.away_team} size={22} />
        </div>
      </div>

      {/* Probability bar */}
      {!played && (
        <>
          <ProbBar home={m.p_home} draw={m.p_draw} away={m.p_away} height={6} />
          <div className="mt-1.5 flex justify-between text-[11px] tabnum">
            <span className="text-success font-semibold">{pct0(m.p_home)}</span>
            <span className="text-muted">D {pct0(m.p_draw)}</span>
            <span className="text-cyan font-semibold">{pct0(m.p_away)}</span>
          </div>
          {m.top_score && (
            <div className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-white/5 py-1 text-[11px]">
              <span className="uppercase tracking-wider text-muted">Predicted</span>
              <span className="font-display font-bold text-gold">{m.top_score.score}</span>
              {m.expected_goals && (
                <span className="text-muted">
                  · xG {m.expected_goals.home?.toFixed(1)}–{m.expected_goals.away?.toFixed(1)}
                </span>
              )}
            </div>
          )}
        </>
      )}

      {/* Played: predicted scoreline vs actual (accuracy) */}
      {played && m.top_score && (
        <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px]">
          <span className="uppercase tracking-wider text-muted">Predicted</span>
          <span className={`font-display font-bold ${
            m.top_score.score === `${m.home_score}-${m.away_score}`
              ? "text-success" : "text-muted"}`}>{m.top_score.score}</span>
          {m.top_score.score === `${m.home_score}-${m.away_score}` && <span>✓</span>}
        </div>
      )}

      {/* Footer meta */}
      <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted">
        <span>{m.city}</span>
        <div className="flex items-center gap-1.5">
          {m.market_used && <span className="chip-cyan">📈 mkt</span>}
          {m.upset_probability >= 0.32 && <span className="chip-gold">⚡ upset</span>}
          {!played && <span className="font-bold text-gold">{m.confidence}</span>}
        </div>
      </div>
    </Link>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   STAT ROW
══════════════════════════════════════════════════════════════════════════════ */
export function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat-row">
      <span className="text-muted">{label}</span>
      <span className="stat-num tabnum">{value}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   AI INSIGHT PANEL
══════════════════════════════════════════════════════════════════════════════ */
export function AIInsightCard({ text, confidence }: { text: string; confidence?: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan/20 bg-ink-2/80 p-5">
      {/* Glow accent */}
      <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-cyan/10 blur-3xl" />
      <div className="relative z-10">
        <div className="mb-3 flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-cyan/15 text-cyan text-sm">✦</div>
          <span className="font-display text-[11px] uppercase tracking-[0.2em] text-cyan/80">
            AI Pre-Match Analysis
          </span>
          {confidence != null && (
            <span className="ml-auto chip-cyan">Conf {confidence}/100</span>
          )}
        </div>
        <p className="text-[15px] leading-relaxed text-stadium/90 font-light">{text}</p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   TEAM COMPARISON BARS (EA Sports style)
══════════════════════════════════════════════════════════════════════════════ */
export function TeamComparisonCard({
  home, away, homeTeam, awayTeam, homeColor = "#00E676", awayColor = "#00D4FF"
}: {
  home: Record<string, number>;
  away: Record<string, number>;
  homeTeam: string; awayTeam: string;
  homeColor?: string; awayColor?: string;
}) {
  const attrs = Object.keys(home);
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-[11px] font-display uppercase tracking-wider mb-4">
        <span style={{ color: homeColor }}>{homeTeam}</span>
        <span className="text-muted">Comparison</span>
        <span style={{ color: awayColor }}>{awayTeam}</span>
      </div>
      {attrs.map((attr) => {
        const hv = home[attr] ?? 50;
        const av = away[attr] ?? 50;
        const total = hv + av || 1;
        const hp = (hv / total) * 100;
        return (
          <div key={attr}>
            <div className="mb-1 flex justify-between text-[11px]">
              <span className="tabnum font-semibold" style={{ color: homeColor }}>{hv}</span>
              <span className="text-muted text-[10px] uppercase tracking-wide">{attr}</span>
              <span className="tabnum font-semibold" style={{ color: awayColor }}>{av}</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
              <motion.div className="h-full rounded-l-full"
                style={{ background: homeColor }}
                initial={{ width: 0 }}
                animate={{ width: `${hp}%` }}
                transition={{ duration: 0.8 }} />
              <motion.div className="h-full rounded-r-full"
                style={{ background: awayColor }}
                initial={{ width: 0 }}
                animate={{ width: `${100 - hp}%` }}
                transition={{ duration: 0.8, delay: 0.05 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   STAGE PROBABILITY TABLE ROW
══════════════════════════════════════════════════════════════════════════════ */
export function StageProbRow({ team, flag, R32, QF, SF, Final, Champion, rank = 0 }:
  { team: string; flag?: string; R32?: number; QF?: number; SF?: number; Final?: number; Champion?: number; rank?: number }) {
  return (
    <div className={`flex items-center gap-3 py-2.5 border-b border-line/40 transition hover:bg-white/3
                     ${rank <= 2 ? "border-l-2 border-l-gold pl-2" : rank <= 5 ? "border-l-2 border-l-cyan pl-2" : ""}`}>
      <span className="w-6 text-center text-xs font-bold text-muted">{rank}</span>
      <Flag url={flag} name={team} size={20} />
      <span className="min-w-0 flex-1 break-words font-display text-sm font-semibold leading-tight">{team}</span>
      {SF != null    && <span className="w-14 text-right tabnum text-xs text-muted">{pct(SF)}</span>}
      {Final != null && <span className="w-14 text-right tabnum text-xs">{pct(Final)}</span>}
      {Champion != null && (
        <span className={`w-16 text-right tabnum text-sm font-bold ${rank === 1 ? "text-gold" : rank <= 3 ? "text-cyan" : ""}`}>
          {pct(Champion)}
        </span>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   SECTION HEADER
══════════════════════════════════════════════════════════════════════════════ */
export function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div>
        <div className="font-display text-[10px] uppercase tracking-[0.3em] text-cyan/70 mb-1">{sub}</div>
        <h2 className="font-display text-xl font-bold uppercase tracking-tight text-stadium">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export { pct, pct0 };

