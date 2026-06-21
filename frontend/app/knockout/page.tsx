"use client";
import { useState } from "react";
import useSWR from "swr";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { Flag } from "@/components/ui";

const fetcher = (p: string) => api(p);
const ET = "America/New_York";
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: ET,
  });
const pctStr = (x?: number) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

export default function KnockoutPage() {
  const { data, error } = useSWR("/api/knockout", fetcher);
  const [active, setActive] = useState<any>(null);

  if (error) return <div className="card text-live">Knockout schedule offline.</div>;
  if (!data) return <div className="h-80 animate-pulse rounded-2xl bg-white/5" />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Knockout Bracket · World Cup 2026</h1>
        <span className="text-xs text-muted">Jun 28 – Jul 19 · times ET</span>
      </div>

      {data.projected && data.podium?.champion && <Podium podium={data.podium} />}

      <p className="text-sm text-muted">
        {data.projected
          ? "Projected bracket — group slots filled from final standings (real results + predicted remaining games). The 🏆 % next to a team is its chance to win the WHOLE tournament (Monte-Carlo) — not this match. A team can have higher title odds yet be the underdog in one specific tie: the side that advances is the higher match win-probability (shown inside each match). Click a match for the full analysis."
          : "Official knockout schedule (Round of 32 → Final). Team slots resolve once the group stage completes."}
      </p>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {data.rounds.map((r: any, ri: number) => (
          <div key={r.round} className="w-[320px] shrink-0">
            <h2 className="h2 sticky top-0 mb-3">{r.round}</h2>
            <div className="space-y-3">
              {r.matches.map((m: any, i: number) => (
                <Tie key={m.id} m={m} delay={ri * 0.05 + i * 0.02}
                  onClick={() => m.resolved && setActive(m)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {active && <AnalysisModal m={active} onClose={() => setActive(null)} />}
      </AnimatePresence>
    </div>
  );
}

/* ── Podium: champion centre/top, runner-up left, third right ─────────────── */
function Podium({ podium }: { podium: any }) {
  const { champion, runner_up, third } = podium;
  return (
    <div className="card bg-gradient-to-b from-gold/10 to-transparent p-5">
      <div className="mb-4 text-center text-[11px] uppercase tracking-widest text-gold/80">
        Projected Final Standing
      </div>
      <div className="flex items-end justify-center gap-3 sm:gap-6">
        <Step place={2} block="h-16 sm:h-20" data={runner_up} medal="🥈" />
        <Step place={1} block="h-24 sm:h-32" data={champion} medal="🏆" big />
        <Step place={3} block="h-10 sm:h-14" data={third} medal="🥉" />
      </div>
    </div>
  );
}

function Step({ place, block, data, medal, big }:
  { place: number; block: string; data: any; medal: string; big?: boolean }) {
  if (!data) return <div className="w-24" />;
  return (
    <div className="flex w-24 flex-col items-center sm:w-32">
      <div className="text-2xl">{medal}</div>
      <Flag url={data.flag} name={data.team} size={big ? 56 : 40} />
      <div className={`mt-1 text-center font-display font-bold leading-tight ${
        big ? "text-base text-gold" : "text-sm text-stadium"}`}>{data.team}</div>
      <div className="text-[10px] text-muted">title {pctStr(data.title_pct)}</div>
      <div className={`mt-2 w-full rounded-t-lg ${block} ${
        place === 1 ? "bg-gold/40" : "bg-white/10"}`} />
    </div>
  );
}

/* ── Bracket tile ────────────────────────────────────────────────────────── */
function Tie({ m, delay, onClick }: { m: any; delay: number; onClick: () => void }) {
  const resolved = m.resolved;
  const homeWin = resolved && m.predicted_winner === m.home_team;
  const awayWin = resolved && m.predicted_winner === m.away_team;
  const wp = m.win_probability ? Math.round(m.win_probability * 100) : null;
  const scoreStr = m.predicted_score
    ? (m.shootout ? `${m.predicted_score} · pens` : m.predicted_score)
    : "vs";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      onClick={onClick}
      className={`card p-3 ${resolved ? "cursor-pointer hover:border-gold/40" : ""} ${
        m.round === "Final" ? "border-gold/50 bg-gold/10 shadow-glow" : ""}`}>
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
        <span className="chip">Match {m.id}</span>
        <span>{fmt(m.kickoff)}</span>
      </div>

      {resolved ? (
        <div className="space-y-1.5">
          <TeamRow name={m.home_team} flag={m.home_flag}
            win={homeWin} title={m.home_title_pct} />
          <div className="text-center text-[10px] uppercase tracking-widest text-gold/70">
            {scoreStr}
          </div>
          <TeamRow name={m.away_team} flag={m.away_flag}
            win={awayWin} title={m.away_title_pct} />

          <div className="flex items-center justify-between pt-1 text-[11px]">
            <span className="text-muted">
              Win prob <span className="font-bold text-stadium">{wp}%</span>
            </span>
            {m.confidence != null &&
              <span className="text-gold font-bold">{m.confidence} conf</span>}
          </div>
          {wp != null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gold/80" style={{ width: `${wp}%` }} />
            </div>
          )}
          <div className="pt-0.5 text-center text-[10px] text-gold/70">
            tap for analysis →
          </div>
        </div>
      ) : (
        <div className="space-y-1 font-display text-sm font-semibold">
          <div className="break-words leading-tight">{m.home_label}</div>
          <div className="text-[10px] uppercase tracking-widest text-gold/70">vs</div>
          <div className="break-words leading-tight">{m.away_label}</div>
        </div>
      )}

      <div className="mt-2 text-[11px] text-muted">📍 {m.venue} · {m.city}</div>
    </motion.div>
  );
}

function TeamRow({ name, flag, win, title }:
  { name: string; flag?: string; win: boolean; title?: number }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${
      win ? "bg-gold/15" : ""}`}>
      <span className="shrink-0"><Flag url={flag} name={name} size={20} /></span>
      <span className={`min-w-0 flex-1 break-words font-display text-sm leading-tight ${
        win ? "font-bold text-stadium" : "font-medium"}`}>{name}</span>
      {title != null && (
        <span className="shrink-0 text-[10px] text-muted" title="Monte-Carlo chance to win the whole tournament">
          🏆 {pctStr(title)}
        </span>
      )}
      {win && <span className="shrink-0 text-[10px] text-gold">▶</span>}
    </div>
  );
}

/* ── Analysis modal ──────────────────────────────────────────────────────── */
function AnalysisModal({ m, onClose }: { m: any; onClose: () => void }) {
  const a = m.analysis ?? {};
  const winnerHome = m.predicted_winner === m.home_team;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <motion.div
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="card max-h-[88vh] w-full max-w-lg overflow-y-auto p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="chip">Match {m.id} · {m.round}</span>
          <button onClick={onClose} className="text-muted hover:text-stadium">✕</button>
        </div>

        {/* teams + result */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <SideHead name={m.home_team} flag={m.home_flag} win={winnerHome} />
          <div className="text-center">
            <div className="font-display text-lg font-bold text-gold">
              {m.predicted_score ?? ""}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted">predicted</div>
          </div>
          <SideHead name={m.away_team} flag={m.away_flag} win={!winnerHome} right />
        </div>

        <div className="mb-4 rounded-xl bg-gold/10 p-3 text-center text-sm">
          <span className="font-bold text-gold">{m.predicted_winner}</span> advances ·
          win prob <span className="font-bold">{Math.round((m.win_probability ?? 0) * 100)}%</span>
          {m.confidence != null && <> · conf <span className="font-bold">{m.confidence}</span></>}
        </div>

        {/* player condition + manager strategy comparison */}
        <h3 className="mb-2 text-[11px] uppercase tracking-widest text-gold/80">
          Why {m.predicted_winner} wins
        </h3>
        <div className="space-y-2">
          <CompareBar label="Player condition" hi={m.home_team} ai={m.away_team}
            h={a.home_condition} a={a.away_condition} fmt={(v) => pctStr(v)} />
          <CompareBar label="Manager track record" hi={m.home_team} ai={m.away_team}
            h={a.home_manager_wr} a={a.away_manager_wr} fmt={(v) => pctStr(v)} />
          {a.home_gk_quality != null && (
            <CompareBar label="Goalkeeper" hi={m.home_team} ai={m.away_team}
              h={a.home_gk_quality} a={a.away_gk_quality} fmt={(v) => pctStr(v)} />
          )}
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
          <>
            <h3 className="mb-2 mt-4 text-[11px] uppercase tracking-widest text-gold/80">
              Key factors
            </h3>
            <ul className="space-y-1.5 text-[13px] leading-snug text-stadium">
              {m.reasons.map((rs: string, k: number) => (
                <li key={k} className="flex gap-2">
                  <span className="text-gold">›</span><span>{rs}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function SideHead({ name, flag, win, right }:
  { name: string; flag?: string; win: boolean; right?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col items-center gap-1`}>
      <Flag url={flag} name={name} size={40} />
      <div className={`text-center font-display text-sm leading-tight ${
        win ? "font-bold text-gold" : "font-medium text-stadium"}`}>{name}</div>
    </div>
  );
}

function CompareBar({ label, hi, ai, h, a, max = 1, fmt }:
  { label: string; hi: string; ai: string; h?: number; a?: number;
    max?: number; fmt: (v?: number) => string }) {
  const hv = h ?? 0, av = a ?? 0;
  const total = hv + av || 1;
  const hPct = max ? Math.min(100, (hv / max) * 100) : (hv / total) * 100;
  const aPct = max ? Math.min(100, (av / max) * 100) : (av / total) * 100;
  const hLead = hv >= av;
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[11px]">
        <span className={hLead ? "font-bold text-gold" : "text-muted"}>{fmt(h)}</span>
        <span className="text-muted">{label}</span>
        <span className={!hLead ? "font-bold text-gold" : "text-muted"}>{fmt(a)}</span>
      </div>
      <div className="flex h-2 gap-1">
        <div className="flex flex-1 justify-end">
          <div className={`h-full rounded-l-full ${hLead ? "bg-gold/80" : "bg-white/20"}`}
            style={{ width: `${hPct}%` }} />
        </div>
        <div className="flex flex-1 justify-start">
          <div className={`h-full rounded-r-full ${!hLead ? "bg-gold/80" : "bg-white/20"}`}
            style={{ width: `${aPct}%` }} />
        </div>
      </div>
    </div>
  );
}
