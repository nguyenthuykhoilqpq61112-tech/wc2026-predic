"use client";
/* Match-flow simulation report — the same engine that drives the knockout
   bracket, rendered as a pre-game analysis block. Works for both knockout ties
   (90' -> ET -> shootout) and group fixtures (a draw is a valid result). */

const pctStr = (x?: number) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

export function MatchFlowReport({ flow }: { flow: any }) {
  if (!flow) return null;
  const f = flow;
  const pr = f.probabilities;
  const reg = pr.regulation;
  const home = f.home_team, away = f.away_team;
  const ko = f.mode === "knockout";

  return (
    <div className="space-y-6">
      {/* headline result */}
      <div className="rounded-xl border border-gold/20 bg-gold/[0.04] p-4 text-center">
        <div className="text-[11px] uppercase tracking-widest text-muted">
          {ko ? "Projected to advance" : "Projected result"}
        </div>
        <div className="mt-1 font-display text-xl font-bold text-gold">
          {f.predicted_winner === "Draw" ? "Draw" : f.predicted_winner}
          <span className="ml-2 text-stadium">{f.predicted_score}</span>
          {f.shootout && <span className="ml-1 text-sm text-muted">· pens</span>}
        </div>
        <div className="mt-1 text-xs text-muted">
          probability <b className="text-stadium">{pctStr(f.win_probability)}</b>
          {f.confidence != null && <> · confidence <b className="text-stadium">{f.confidence}</b></>}
        </div>
      </div>

      {/* outcome ladder */}
      <div>
        <SubHead>Regulation (90′)</SubHead>
        <SplitBar a={reg.home} d={reg.draw} b={reg.away} aLabel={home} bLabel={away} />
        {ko && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat label="Goes to extra time" v={pctStr(pr.extra_time)} />
            <Stat label="Goes to shootout" v={pctStr(pr.shootout)} />
          </div>
        )}
      </div>

      {/* shootout winner (knockout only) */}
      {ko && pr.shootout > 0.05 && (
        <div className="rounded-xl bg-white/5 p-3">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-muted">If it goes to penalties</span>
            <span className="font-bold text-gold">{pr.shootout_winner.predicted} favoured</span>
          </div>
          <SplitBar a={pr.shootout_winner.home} b={pr.shootout_winner.away}
            aLabel={home} bLabel={away} />
        </div>
      )}

      {/* in-tournament form (MD1/MD2) */}
      {f.tournament_form && (() => {
        const tf = f.tournament_form;
        const fh = tf[home], fa = tf[away];
        if (!fh?.played && !fa?.played) return null;
        return (
          <div>
            <SubHead>Current form · group stage</SubHead>
            <div className="grid grid-cols-2 gap-3">
              {[[home, fh], [away, fa]].map(([t, fr]: any) => (
                <div key={t} className="rounded-xl bg-white/5 p-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="truncate font-display text-[12px] font-bold text-stadium">{t}</span>
                    <span className={`text-[11px] font-bold ${
                      fr.form_delta > 3 ? "text-success" : fr.form_delta < -3 ? "text-danger" : "text-muted"}`}>
                      {fr.form_delta > 0 ? "+" : ""}{fr.form_delta} Elo
                    </span>
                  </div>
                  <div className="text-[11px] text-muted">{fr.record} · {fr.gf}-{fr.ga} GF/GA</div>
                  {fr.log?.map((l: string, i: number) => (
                    <div key={i} className="text-[10px] text-muted/80">{l}</div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* most likely scores */}
      {f.most_likely_scores?.length > 0 && (
        <div>
          <SubHead>Most likely scorelines</SubHead>
          <div className="flex flex-wrap gap-2">
            {f.most_likely_scores.map((s: any, i: number) => (
              <span key={i} className="chip text-[11px]">
                {s.score} <span className="text-gold">{pctStr(s.prob)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* key players */}
      {f.key_players && (
        <div>
          <SubHead>Players to decide it</SubHead>
          <div className="grid grid-cols-2 gap-3">
            {[home, away].map((t) => {
              const kp = f.key_players[t];
              if (!kp) return null;
              return (
                <div key={t} className="rounded-xl bg-white/5 p-2.5">
                  <div className="mb-1 truncate font-display text-[12px] font-bold text-stadium">{t}</div>
                  {kp.likely_scorer && <div className="text-[11px] text-muted">⚽ {kp.likely_scorer}</div>}
                  {kp.penalty_decider && <div className="text-[11px] text-muted">🎯 {kp.penalty_decider}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* projected flow timeline */}
      {f.match_flow?.length > 0 && (
        <div>
          <SubHead>Projected flow</SubHead>
          <ul className="space-y-1.5">
            {f.match_flow.map((e: any, i: number) => (
              <li key={i} className="flex gap-2 text-[12px] leading-snug">
                <span className="w-9 shrink-0 text-right font-bold tabular-nums text-gold/80">{e.minute}′</span>
                <span className={e.type === "goal" || e.type === "shootout"
                  ? "font-medium text-stadium" : "text-muted"}>
                  {e.type === "goal" ? "⚽ " : e.type === "shootout" ? "🎯 " : ""}{e.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* risk factors */}
      {f.risk_factors?.length > 0 && (
        <div>
          <SubHead>Risk factors</SubHead>
          <ul className="space-y-1.5 text-[12px] leading-snug text-stadium">
            {f.risk_factors.map((r: string, i: number) => (
              <li key={i} className="flex gap-2"><span className="text-danger">⚠</span><span>{r}</span></li>
            ))}
          </ul>
        </div>
      )}

      {/* explainability */}
      {f.explainability && (
        <div className="rounded-xl bg-gold/5 p-3">
          <SubHead>How the model weighs it</SubHead>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {Object.entries(f.explainability.model_weights || {}).map(([k, v]: any) => (
              <span key={k} className="chip text-[10px]">
                {k.replace(/_/g, " ")} <span className="text-gold">{Math.round(v * 100)}%</span>
              </span>
            ))}
          </div>
          {f.explainability.reasons?.length > 0 && (
            <ul className="mb-2 space-y-1 text-[12px] leading-snug text-stadium">
              {f.explainability.reasons.map((r: string, i: number) => (
                <li key={i} className="flex gap-2"><span className="text-gold">›</span><span>{r}</span></li>
              ))}
            </ul>
          )}
          {f.explainability.why_penalties && (
            <p className="text-[12px] leading-snug text-muted">{f.explainability.why_penalties}</p>
          )}
          {f.explainability.what_could_change && (
            <p className="mt-1.5 text-[12px] leading-snug text-muted">
              <span className="text-gold/80">What could change it: </span>
              {f.explainability.what_could_change}
            </p>
          )}
        </div>
      )}

      <div className="text-right text-[10px] text-muted">
        {f.n_sims?.toLocaleString()} Monte-Carlo runs · {ko ? "90′ → ET → pens" : "90′ regulation"}
      </div>
    </div>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[11px] uppercase tracking-widest text-gold/80">{children}</div>;
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2.5 py-1.5">
      <div className="text-[10px] text-muted">{label}</div>
      <div className="font-display text-base font-bold text-stadium">{v}</div>
    </div>
  );
}

function SplitBar({ a, d, b, aLabel, bLabel }:
  { a: number; d?: number; b: number; aLabel: string; bLabel: string }) {
  const av = Math.round(a * 100), dv = Math.round((d ?? 0) * 100), bv = Math.round(b * 100);
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[10px]">
        <span className="truncate font-medium text-stadium">{aLabel} {av}%</span>
        {d != null && <span className="text-muted">draw {dv}%</span>}
        <span className="truncate font-medium text-stadium">{bv}% {bLabel}</span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-gold/80" style={{ width: `${av}%` }} />
        {d != null && <div className="h-full bg-white/25" style={{ width: `${dv}%` }} />}
        <div className="h-full bg-stadium/50" style={{ width: `${bv}%` }} />
      </div>
    </div>
  );
}
