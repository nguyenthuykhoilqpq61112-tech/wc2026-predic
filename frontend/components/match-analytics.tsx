"use client";
import { useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { SectionHeader } from "@/components/ui";

const fetcher = (p: string) => api(p);

// pitch viewBox — x:0..100 length, y:0..64 width
const PW = 100, PH = 64;

function Pitch({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${PW} ${PH}`} className="w-full" role="img">
      {/* turf */}
      <rect x="0" y="0" width={PW} height={PH} rx="2" fill="#0c2a1c" />
      <g stroke="rgba(255,255,255,0.18)" strokeWidth="0.3" fill="none">
        <rect x="1.5" y="1.5" width={PW - 3} height={PH - 3} />
        <line x1={PW / 2} y1="1.5" x2={PW / 2} y2={PH - 1.5} />
        <circle cx={PW / 2} cy={PH / 2} r="8" />
        {/* boxes */}
        <rect x="1.5" y={PH / 2 - 11} width="11" height="22" />
        <rect x={PW - 12.5} y={PH / 2 - 11} width="11" height="22" />
        <rect x="1.5" y={PH / 2 - 5} width="4.5" height="10" />
        <rect x={PW - 6} y={PH / 2 - 5} width="4.5" height="10" />
      </g>
      {children}
    </svg>
  );
}

const HOME = "#00D4FF", AWAY = "#FFD700";

/* ── Shot map ── */
function ShotMap({ shots }: { shots: { home: any[]; away: any[] } }) {
  const dot = (s: any, color: string, i: number) => {
    const r = 0.8 + s.xg * 3.2;
    const goal = s.outcome === "goal";
    return (
      <g key={color + i}>
        <circle cx={s.x} cy={s.y} r={r}
          fill={goal ? color : "none"} stroke={color}
          strokeWidth={goal ? 0 : 0.5} opacity={goal ? 0.95 : 0.55} />
        {goal && <circle cx={s.x} cy={s.y} r={r + 1.2} fill="none" stroke={color} strokeWidth="0.4" />}
      </g>
    );
  };
  return (
    <Pitch>
      {shots.home.map((s, i) => dot(s, HOME, i))}
      {shots.away.map((s, i) => dot(s, AWAY, i))}
    </Pitch>
  );
}

/* ── Heat map (one team) ── */
function HeatGrid({ grid, color }: { grid: number[][]; color: string }) {
  const rows = grid.length, cols = grid[0].length;
  const cw = PW / cols, ch = PH / rows;
  return (
    <Pitch>
      {grid.map((row, r) =>
        row.map((v, c) => (
          <rect key={`${r}-${c}`} x={c * cw} y={r * ch} width={cw} height={ch}
            fill={color} opacity={0.08 + v * 0.6} />
        )))}
    </Pitch>
  );
}

/* ── Passing network (one team) ── */
function Network({ net, color }: { net: { nodes: any[]; edges: any[] }; color: string }) {
  const maxW = Math.max(...net.edges.map((e) => e.weight), 1);
  const maxP = Math.max(...net.nodes.map((n) => n.passes), 1);
  return (
    <Pitch>
      {net.edges.map((e, i) => {
        const a = net.nodes[e.from], b = net.nodes[e.to];
        return (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={color} strokeWidth={0.2 + (e.weight / maxW) * 0.9}
            opacity={0.15 + (e.weight / maxW) * 0.4} />
        );
      })}
      {net.nodes.map((n, i) => {
        const r = 1.6 + (n.passes / maxP) * 2.6;
        return (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={r} fill={color} opacity={0.85} />
            <text x={n.x} y={n.y - r - 0.8} textAnchor="middle"
              fontSize="2.1" fill="#C8D3E8">
              {n.player.split(" ").slice(-1)[0]}
            </text>
          </g>
        );
      })}
    </Pitch>
  );
}

/* ── Box-score comparison bar ── */
function StatBar({ label, h, a, pct: isPct }: { label: string; h: number; a: number; pct?: boolean }) {
  const total = h + a || 1;
  const hp = isPct ? h : (h / total) * 100;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs tabnum">
        <span className="font-semibold" style={{ color: HOME }}>{h}{isPct ? "%" : ""}</span>
        <span className="text-muted uppercase tracking-wider text-[10px]">{label}</span>
        <span className="font-semibold" style={{ color: AWAY }}>{a}{isPct ? "%" : ""}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-white/5">
        <div style={{ width: `${hp}%`, background: HOME }} />
        <div style={{ width: `${100 - hp}%`, background: AWAY }} />
      </div>
    </div>
  );
}

function Legend({ home, away }: { home: string; away: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: HOME }} /> {home}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: AWAY }} /> {away}
      </span>
    </div>
  );
}

export function MatchAnalytics({ matchId }: { matchId: number | string }) {
  const { data, error } = useSWR(`/api/matches/${matchId}/analytics`, fetcher);
  const [netSide, setNetSide] = useState<"home" | "away">("home");
  if (error) return null;            // not played yet → hide section
  if (!data) return <div className="h-64 animate-pulse rounded-2xl bg-ink-2" />;

  const { home, away, score, box_score: bx, scorers, shot_map, heat_map,
    passing_network, post_match: pm } = data;
  const net = passing_network[netSide];
  const netColor = netSide === "home" ? HOME : AWAY;
  const scorersLive = (data.scorers_source || "").startsWith("ESPN");

  return (
    <section className="space-y-5">
      <SectionHeader title="MATCH ANALYTICS" sub="Post-match breakdown" />

      {/* Post-match analysis from news (ESPN + others) */}
      {pm && (
        <div className="card-broadcast border-gold/30">
          <div className="mb-2 flex items-center justify-between">
            <span className="chip-gold inline-flex items-center gap-1.5 text-[10px]">
              📰 Post-match analysis
            </span>
            {pm.auto
              ? <span className="text-[10px] text-muted/70">auto-summary</span>
              : pm.sources?.length > 0 &&
                <span className="text-[10px] text-muted/70">source: {pm.sources.join(" · ")}</span>}
          </div>
          {pm.headline && (
            <h3 className="font-display text-base font-bold text-stadium">{pm.headline}</h3>
          )}
          {pm.summary && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{pm.summary}</p>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {pm.star_player && (
              <div className="rounded-lg bg-gold/10 p-2.5">
                <div className="text-[10px] uppercase tracking-widest text-gold/80">⭐ Star man</div>
                <div className="font-display text-sm font-bold text-stadium">{pm.star_player}</div>
                {pm.star_reason && <div className="text-[11px] text-muted">{pm.star_reason}</div>}
              </div>
            )}
            {pm.turning_point && (
              <div className="rounded-lg bg-white/[0.03] p-2.5">
                <div className="text-[10px] uppercase tracking-widest text-muted">🔑 Turning point</div>
                <div className="text-[11px] text-muted">{pm.turning_point}</div>
              </div>
            )}
            {pm.what_lacked && (
              <div className="rounded-lg bg-white/[0.03] p-2.5 sm:col-span-2">
                <div className="text-[10px] uppercase tracking-widest text-muted">📉 What was missing</div>
                <div className="text-[11px] text-muted">{pm.what_lacked}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {scorersLive
          ? <span className="chip inline-flex items-center gap-1.5 text-[10px] text-success">
              <span className="live-dot" /> Scorers · live from web (ESPN)
            </span>
          : <span className="chip-gold inline-flex text-[10px]">🤖 Scorers · model-generated</span>}
        <span className="chip-gold inline-flex text-[10px]">🤖 Maps · model-generated</span>
      </div>
      <p className="-mt-2 text-[11px] text-muted/70">{data.disclaimer}</p>

      {/* Scorers + final */}
      <div className="card-broadcast">
        <div className="mb-3 flex items-center justify-center gap-4 font-display">
          <span className="text-stadium">{home}</span>
          <span className="text-2xl font-extrabold tabnum text-gold">{score[0]} – {score[1]}</span>
          <span className="text-stadium">{away}</span>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <ul className="space-y-1">
            {scorers.home.length === 0 && <li className="text-muted/50 text-xs">No goals</li>}
            {scorers.home.map((s: any, i: number) => (
              <li key={i} className="flex items-center gap-2">
                <span style={{ color: HOME }}>⚽</span>
                <span className="break-words">{s.player}</span>
                <span className="text-muted text-xs">{s.minute}'{s.type === "penalty" ? " (P)" : ""}</span>
              </li>
            ))}
          </ul>
          <ul className="space-y-1 text-right">
            {scorers.away.length === 0 && <li className="text-muted/50 text-xs">No goals</li>}
            {scorers.away.map((s: any, i: number) => (
              <li key={i} className="flex items-center justify-end gap-2">
                <span className="text-muted text-xs">{s.minute}'{s.type === "penalty" ? " (P)" : ""}</span>
                <span className="break-words">{s.player}</span>
                <span style={{ color: AWAY }}>⚽</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Box score */}
      <div className="card-broadcast space-y-3">
        <div className="h2">Match Stats</div>
        <StatBar label="Possession" h={bx.possession[0]} a={bx.possession[1]} pct />
        <StatBar label="Shots" h={bx.shots[0]} a={bx.shots[1]} />
        <StatBar label="On target" h={bx.shots_on_target[0]} a={bx.shots_on_target[1]} />
        <StatBar label="xG" h={bx.xg[0]} a={bx.xg[1]} />
        <StatBar label="Corners" h={bx.corners[0]} a={bx.corners[1]} />
        <StatBar label="Fouls" h={bx.fouls[0]} a={bx.fouls[1]} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Shot map */}
        <div className="card-broadcast space-y-3">
          <div className="flex items-center justify-between">
            <div className="h2 mb-0">Shot Map</div>
            <Legend home={home} away={away} />
          </div>
          <ShotMap shots={shot_map} />
          <p className="text-[11px] text-muted/60">
            Dot size ∝ shot xG · filled = goal. {home} attacks right, {away} left.
          </p>
        </div>

        {/* Passing network */}
        <div className="card-broadcast space-y-3">
          <div className="flex items-center justify-between">
            <div className="h2 mb-0">Passing Network</div>
            <div className="flex gap-1">
              <button onClick={() => setNetSide("home")}
                className={`btn-sm ${netSide === "home" ? "" : "opacity-50"}`}>{home}</button>
              <button onClick={() => setNetSide("away")}
                className={`btn-sm ${netSide === "away" ? "" : "opacity-50"}`}>{away}</button>
            </div>
          </div>
          <Network net={net} color={netColor} />
          <p className="text-[11px] text-muted/60">
            Node size ∝ involvement · line thickness ∝ passes between players.
          </p>
        </div>

        {/* Heat maps */}
        <div className="card-broadcast space-y-2">
          <div className="h2">Heat Map · {home}</div>
          <HeatGrid grid={heat_map.home} color={HOME} />
        </div>
        <div className="card-broadcast space-y-2">
          <div className="h2">Heat Map · {away}</div>
          <HeatGrid grid={heat_map.away} color={AWAY} />
        </div>
      </div>
    </section>
  );
}
