"use client";
import useSWR from "swr";
import Link from "next/link";
import { motion } from "framer-motion";
import { api, pct, pct0 } from "@/lib/api";
import { Flag, StatRow, Meter, ProbBar, PredictionBadge, predictionHit } from "@/components/ui";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, LabelList,
} from "recharts";

const fetcher = (p: string) => api(p);
const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

const ET = "America/New_York";
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ET });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });

/* ─── Static WC history for all 48 teams ─── */
const WC_HISTORY: Record<string, {
  appearances: number; titles: number; best: string;
  title_years: number[]; note: string;
}> = {
  Argentina:     { appearances: 18, titles: 3, best: "Champions", title_years: [1978,1986,2022], note: "Two-time defending champions. Messi-led dynasty." },
  Brazil:        { appearances: 22, titles: 5, best: "Champions", title_years: [1958,1962,1970,1994,2002], note: "Most WC titles in history. 5 stars on the shirt." },
  Germany:       { appearances: 20, titles: 4, best: "Champions", title_years: [1954,1974,1990,2014], note: "Most consistent WC nation — never missed the QF until 2018." },
  France:        { appearances: 16, titles: 2, best: "Champions", title_years: [1998,2018], note: "Won on home soil in '98, dominant again in 2018. Finalists in 2022." },
  Italy:         { appearances: 18, titles: 4, best: "Champions", title_years: [1934,1938,1982,2006], note: "4 titles, but failed to qualify in 2018 and 2022." },
  England:       { appearances: 16, titles: 1, best: "Champions", title_years: [1966], note: "Only title on home soil in 1966. Infamous for 'It's coming home'." },
  Spain:         { appearances: 16, titles: 1, best: "Champions", title_years: [2010], note: "Won in South Africa with tiki-taka. Golden generation." },
  Uruguay:       { appearances: 14, titles: 2, best: "Champions", title_years: [1930,1950], note: "Founding giants of the World Cup. Two early titles." },
  Netherlands:   { appearances: 11, titles: 0, best: "Runner-up ×3", title_years: [], note: "3 finals, 0 titles. Eliminated R32 2026 by Morocco." },
  Portugal:      { appearances: 9,  titles: 0, best: "3rd place (1966)", title_years: [], note: "Eusébio reached the SF in 1966. Ronaldo era: SF in 2006, QF in 2022." },
  Mexico:        { appearances: 17, titles: 0, best: "QF ×2", title_years: [], note: "8 consecutive R16 exits (1994–2018). Host nation in 2026." },
  Colombia:      { appearances: 6,  titles: 0, best: "QF (2014)", title_years: [], note: "James Rodríguez's Golden Boot tournament in Brazil 2014." },
  Morocco:       { appearances: 7,  titles: 0, best: "SF (2022)", title_years: [], note: "First African nation to reach a WC semi-final. Beat Netherlands R32 in 2026." },
  Japan:         { appearances: 8,  titles: 0, best: "R16", title_years: [], note: "Consistently competitive. Blue Samurai reached R16 in 2002, 2010, 2018, 2022." },
  South_Korea:   { appearances: 11, titles: 0, best: "4th (2002)", title_years: [], note: "Co-hosts in 2002, reached the semi-finals — best run for an Asian nation." },
  "South Korea": { appearances: 11, titles: 0, best: "4th (2002)", title_years: [], note: "Co-hosts in 2002, reached the semi-finals — best run for an Asian nation." },
  USA:           { appearances: 11, titles: 0, best: "3rd (1930)", title_years: [], note: "Founding member. Shock run in 1950. Host nation in 2026 (co-host)." },
  "United States": { appearances: 11, titles: 0, best: "3rd (1930)", title_years: [], note: "Founding member. Shock run in 1950. Host nation in 2026 (co-host)." },
  Norway:        { appearances: 3,  titles: 0, best: "QF (1938)", title_years: [], note: "Rare WC participant. Haaland is their biggest WC chance yet." },
  Belgium:       { appearances: 14, titles: 0, best: "3rd (2018)", title_years: [], note: "Golden generation peaked at 3rd in Russia 2018. Courtois era." },
  Switzerland:   { appearances: 12, titles: 0, best: "QF ×3", title_years: [], note: "Reliable overachievers. Consistent R16 appearances." },
  Canada:        { appearances: 3,  titles: 0, best: "Group (1986)", title_years: [], note: "Back after 40 years. Beat South Africa in R32 2026." },
  Ecuador:       { appearances: 4,  titles: 0, best: "QF (2006)", title_years: [], note: "Reached QF in Germany. Consistent CONMEBOL qualifier." },
  "Ivory Coast": { appearances: 4,  titles: 0, best: "R16", title_years: [], note: "Drogba generation reached R16 in 2014. Competitive African side." },
  "DR Congo":    { appearances: 2,  titles: 0, best: "QF (1974)", title_years: [], note: "Then Zaire. Drew 1-1 with Portugal in WC2026." },
  Austria:       { appearances: 7,  titles: 0, best: "3rd (1954)", title_years: [], note: "Cold-war era powerhouse. Long absence, back in 2026." },
  Croatia:       { appearances: 7,  titles: 0, best: "Runner-up (2018)", title_years: [], note: "Modric's golden generation: 3rd in 1998, runner-up 2018." },
  Senegal:       { appearances: 4,  titles: 0, best: "QF (2002)", title_years: [], note: "Surprised France in 2002. Mané era finally qualified again." },
  Australia:     { appearances: 6,  titles: 0, best: "R16", title_years: [], note: "Socceroos reached R16 in 2006, 2022. Consistent AFC side." },
  "Bosnia and Herzegovina": { appearances: 2, titles: 0, best: "Group", title_years: [], note: "Debut in 2014. Competitive Balkan side." },
  Paraguay:      { appearances: 9,  titles: 0, best: "QF ×2", title_years: [], note: "Punching above their weight. Beat Germany on pens in R32 2026!" },
  Algeria:       { appearances: 4,  titles: 0, best: "R16 (2014)", title_years: [], note: "Thriller vs Germany in 2014. Strong African side." },
  Ghana:         { appearances: 4,  titles: 0, best: "QF (2010)", title_years: [], note: "Came agonisingly close to SF in South Africa 2010." },
  Egypt:         { appearances: 4,  titles: 0, best: "Group", title_years: [], note: "3 Africa Cup of Nations titles. Salah era WC debut in 2018." },
  "South Africa":{ appearances: 3,  titles: 0, best: "Group", title_years: [], note: "2010 hosts. Lost to Canada R32 in 2026." },
  Iran:          { appearances: 6,  titles: 0, best: "Group", title_years: [], note: "Most WC appearances of any Asian team after Japan/Korea." },
  Sweden:        { appearances: 12, titles: 0, best: "Runner-up (1958)", title_years: [], note: "Ibrahimović era peaked at R16. Playing France today (R32)." },
  Scotland:      { appearances: 8,  titles: 0, best: "Group", title_years: [], note: "Famously never advanced past the group stage in 8 attempts." },
  Turkey:        { appearances: 2,  titles: 0, best: "3rd (2002)", title_years: [], note: "Incredible run to 3rd place in 2002, co-hosted by Korea/Japan." },
  "Cape Verde":  { appearances: 1,  titles: 0, best: "R32 (2026)", title_years: [], note: "First ever WC appearance. Face Argentina in R32." },
  "Saudi Arabia":{ appearances: 6,  titles: 0, best: "R16 (1994)", title_years: [], note: "Upset Argentina in 2022 group stage — biggest shock in decades." },
  Uzbekistan:    { appearances: 1,  titles: 0, best: "Group (2026)", title_years: [], note: "First WC debut in 2026. Lost 5-0 to Portugal." },
  Jordan:        { appearances: 1,  titles: 0, best: "Group (2026)", title_years: [], note: "First WC debut in 2026." },
  Qatar:         { appearances: 1,  titles: 0, best: "Group (2022)", title_years: [], note: "2022 hosts — worst hosting performance as first round exit." },
  Panama:        { appearances: 2,  titles: 0, best: "Group", title_years: [], note: "Debut in 2018. Competitive CONCACAF side." },
  Tunisia:       { appearances: 6,  titles: 0, best: "Group", title_years: [], note: "Most WC appearances of any North African team." },
  "New Zealand": { appearances: 3,  titles: 0, best: "Group", title_years: [], note: "Oceania representatives. Drew vs Italy in 2010." },
  Haiti:         { appearances: 2,  titles: 0, best: "Group", title_years: [], note: "Debut in 1974. Back in 2026." },
  Curaçao:       { appearances: 1,  titles: 0, best: "Group (2026)", title_years: [], note: "First ever WC debut in 2026." },
  "Czech Republic": { appearances: 9, titles: 0, best: "Runner-up (1962)", title_years: [], note: "As Czechoslovakia, reached the final twice (1934, 1962)." },
};

function getHistory(name: string) {
  return WC_HISTORY[name] ?? {
    appearances: 1, titles: 0, best: "Group stage", title_years: [], note: "Making history at WC 2026."
  };
}

/* ─── Stage colours for chart ─── */
const STAGE_COLORS: Record<string, string> = {
  "R32": "#00D4FF",
  "QF":  "#00FFB2",
  "SF":  "#FFD700",
  "Final": "#FF9500",
  "Champion": "#FF4D4D",
};

/* ─── Custom tooltip for funnel chart ─── */
function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0].payload;
  return (
    <div className="rounded-xl border border-cyan/25 bg-ink-2/95 px-3 py-2 text-xs backdrop-blur">
      <div className="font-display font-bold text-stadium">{name}</div>
      <div className="tabnum text-gold">{(value * 100).toFixed(1)}%</div>
    </div>
  );
}

/* ─── Fitness badge ─── */
function FitBadge({ status }: { status: string }) {
  const cls = status === "fit"
    ? "text-success border-success/30 bg-success/10"
    : status === "doubt"
      ? "text-gold border-gold/30 bg-gold/10"
      : "text-danger border-danger/30 bg-danger/10";
  const label = status === "fit" ? "✓ FIT" : status === "doubt" ? "? DOUBT" : "✗ OUT";
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${cls}`}>
      {label}
    </span>
  );
}

export default function TeamPage({ params }: { params: { name: string } }) {
  const name = decodeURIComponent(params.name);
  const { data, error } = useSWR(`/api/teams/${encodeURIComponent(name)}`, fetcher);
  const { data: allMatches } = useSWR("/api/matches?", fetcher);

  if (error) return (
    <div className="card-broadcast flex items-center gap-3 text-danger">
      <span className="text-2xl">⚡</span> Team not found or API offline.
    </div>
  );
  if (!data) return <TeamSkeleton />;

  const prog = data.progression ?? {};
  const sq: any[] = data.squad ?? [];
  const history = getHistory(name);

  /* squad grouped */
  const byPos = {
    GK:  sq.filter(p => p.position === "GK"),
    DEF: sq.filter(p => p.position === "DF" || p.position === "DEF"),
    MID: sq.filter(p => p.position === "MF" || p.position === "MID"),
    FWD: sq.filter(p => p.position === "FW" || p.position === "FWD"),
  };

  /* team attributes */
  const attackAvg  = avg(byPos.FWD.map(p => p.impact)) || avg(sq.map(p => p.impact));
  const midfieldAvg = avg(byPos.MID.map(p => p.impact)) || avg(sq.map(p => p.impact));
  const defAvg     = avg([...byPos.DEF, ...byPos.GK].map(p => p.impact)) || avg(sq.map(p => p.impact));
  const fit        = sq.filter(p => p.fitness === "fit").length;
  const fitPct     = sq.length ? (fit / sq.length) * 100 : 100;

  /* group stage matches */
  const teamMatches: any[] = (allMatches ?? []).filter(
    (m: any) => m.home_team === name || m.away_team === name
  ).sort((a: any, b: any) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());

  const played = teamMatches.filter((m: any) => m.played);
  const upcoming = teamMatches.filter((m: any) => !m.played);
  const wins   = played.filter((m: any) => {
    const isHome = m.home_team === name;
    return isHome ? m.home_score > m.away_score : m.away_score > m.home_score;
  }).length;
  const draws  = played.filter((m: any) => m.home_score === m.away_score).length;
  const losses = played.length - wins - draws;
  const goalsFor = played.reduce((acc: number, m: any) =>
    acc + (m.home_team === name ? m.home_score : m.away_score), 0);
  const goalsAgainst = played.reduce((acc: number, m: any) =>
    acc + (m.home_team === name ? m.away_score : m.home_score), 0);

  /* funnel chart data */
  const funnelData = [
    { name: "R32",      value: prog.advance_R32  ?? 0 },
    { name: "QF",       value: prog.reach_QF     ?? 0 },
    { name: "SF",       value: prog.reach_SF     ?? 0 },
    { name: "Final",    value: prog.reach_Final  ?? 0 },
    { name: "Champion", value: prog.win_title    ?? 0 },
  ];

  const tier = data.elo >= 2000 ? { label: "Elite",     color: "#FFD700" }
             : data.elo >= 1850 ? { label: "Contender", color: "#00D4FF" }
             : data.elo >= 1700 ? { label: "Solid",     color: "#00FFB2" }
             :                    { label: "Underdog",  color: "#8FA0C8" };

  const injuries: any[] = data.injury_report ?? [];
  const kpAtk: any[] = data.key_players?.attacking ?? [];
  const kpDef: any[] = data.key_players?.defensive ?? [];

  return (
    <div className="space-y-7">

      {/* ═══ HERO HEADER ═══ */}
      <motion.section
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-cyan/20
                   bg-gradient-to-br from-ink-2 via-ink-3/80 to-ink p-6 sm:p-8
                   shadow-[0_0_50px_rgba(0,212,255,0.06)]">
        {/* beam */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 left-1/3 h-80 w-px bg-gradient-to-b from-cyan/20 to-transparent" />
        </div>

        <div className="relative z-10 flex flex-wrap items-center gap-6">
          <Flag url={data.flag_url} name={name} size={80} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="chip-cyan text-[10px]">GRP {data.group}</span>
              <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
                style={{ color: tier.color, borderColor: tier.color + "50" }}>
                {tier.label}
              </span>
              {history.titles > 0 && (
                <span className="chip-gold text-[10px]">
                  {"🏆".repeat(Math.min(history.titles, 3))} {history.titles}× World Champions
                </span>
              )}
            </div>
            <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight text-stadium sm:text-4xl">
              {name}
            </h1>
            <div className="mt-1 flex flex-wrap gap-4 text-[12px] text-muted">
              <span>👤 {data.manager} <span className="text-gold">({Math.round((data.manager_winrate ?? 0) * 100)}% win rate)</span></span>
              <span>🌍 FIFA #{data.fifa_rank}</span>
              <span>📊 Elo {Math.round(data.elo)}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-display text-4xl font-extrabold tabnum text-cyan">{data.strength_index}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted">Strength Index</div>
          </div>
        </div>
      </motion.section>

      {/* ═══ WORLD CUP HISTORY ═══ */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="card-broadcast">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-gold text-lg">📖</span>
          <h2 className="font-display text-base font-bold uppercase tracking-widest text-stadium">
            World Cup History
          </h2>
        </div>

        {/* stats row */}
        <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {[
            { label: "Appearances", value: history.appearances, color: "#00D4FF" },
            { label: "Titles",      value: history.titles,      color: "#FFD700" },
            { label: "Best Finish", value: history.best,        color: "#00FFB2", wide: true },
          ].map((s) => (
            <div key={s.label}
              className={`rounded-xl border border-white/5 bg-white/3 p-3 text-center ${s.wide ? "col-span-2 sm:col-span-1" : ""}`}>
              <div className="font-display text-xl font-bold tabnum" style={{ color: s.color }}>
                {s.value}
              </div>
              <div className="mt-0.5 text-[9px] uppercase tracking-wider text-muted">{s.label}</div>
            </div>
          ))}
          {history.title_years.length > 0 && (
            <div className="col-span-3 sm:col-span-2 rounded-xl border border-gold/15 bg-gold/5 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-gold/70 mb-1">Title Years</div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {history.title_years.map(y => (
                  <span key={y} className="chip-gold text-[10px]">🏆 {y}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="rounded-xl border border-white/5 bg-white/3 px-4 py-3 text-[13px] leading-relaxed text-stadium/80">
          {history.note}
        </p>
      </motion.section>

      {/* ═══ THIS WORLD CUP — GROUP STAGE ═══ */}
      {(played.length > 0 || upcoming.length > 0) && (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="card-broadcast">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚽</span>
              <h2 className="font-display text-base font-bold uppercase tracking-widest text-stadium">
                WC 2026 · Group Stage
              </h2>
            </div>
            {played.length > 0 && (
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-success font-bold">{wins}W</span>
                <span className="text-muted">{draws}D</span>
                <span className="text-danger">{losses}L</span>
                <span className="text-muted">·</span>
                <span className="text-stadium font-bold">{goalsFor}–{goalsAgainst}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            {played.map((m: any) => {
              const isHome = m.home_team === name;
              const opp = isHome ? m.away_team : m.home_team;
              const oppFlag = isHome ? m.away_flag : m.home_flag;
              const scored  = isHome ? m.home_score : m.away_score;
              const conceded = isHome ? m.away_score : m.home_score;
              const result = scored > conceded ? "W" : scored === conceded ? "D" : "L";
              const resultColor = result === "W" ? "text-success" : result === "D" ? "text-gold" : "text-danger";
              const resultBg = result === "W" ? "bg-success/10 border-success/25" : result === "D" ? "bg-gold/10 border-gold/25" : "bg-danger/10 border-danger/25";
              const hit = predictionHit(m);
              return (
                <Link key={m.id} href={`/matches/${m.id}`}
                  className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/3
                             px-3 py-2.5 transition hover:border-cyan/25 hover:bg-cyan/5">
                  <span className={`w-5 shrink-0 rounded text-center text-xs font-bold ${resultColor}`}>{result}</span>
                  <span className="chip text-[10px] shrink-0">GRP {m.group} · {m.matchday}</span>
                  <Flag url={oppFlag} name={opp} size={18} />
                  <span className="flex-1 font-display text-sm font-semibold text-stadium min-w-0 truncate">
                    vs {opp}
                  </span>
                  <span className={`font-display text-lg font-bold tabnum shrink-0 ${resultColor}`}>
                    {scored}–{conceded}
                  </span>
                  {hit !== null && (
                    <span className={`text-[10px] shrink-0 ${hit ? "text-success" : "text-muted"}`}>
                      {hit ? "✓ CAI" : "✗ CAI"}
                    </span>
                  )}
                  <span className="text-[10px] text-muted shrink-0 hidden sm:block">
                    {fmtDate(m.kickoff)} · {m.city}
                  </span>
                </Link>
              );
            })}

            {upcoming.map((m: any) => {
              const isHome = m.home_team === name;
              const opp = isHome ? m.away_team : m.home_team;
              const oppFlag = isHome ? m.away_flag : m.home_flag;
              const winP = isHome ? m.p_home : m.p_away;
              return (
                <Link key={m.id} href={`/matches/${m.id}`}
                  className="flex items-center gap-3 rounded-xl border border-cyan/15 bg-cyan/5
                             px-3 py-2.5 transition hover:border-cyan/30">
                  <span className="w-5 shrink-0 rounded text-center text-[10px] font-bold text-cyan">UP</span>
                  <span className="chip-cyan text-[10px] shrink-0">GRP {m.group} · {m.matchday}</span>
                  <Flag url={oppFlag} name={opp} size={18} />
                  <span className="flex-1 font-display text-sm font-semibold text-stadium min-w-0 truncate">
                    vs {opp}
                  </span>
                  <span className="font-display text-xs font-bold tabnum text-cyan shrink-0">
                    {pct0(winP)} win
                  </span>
                  <span className="text-[10px] text-muted shrink-0 hidden sm:block">
                    {fmtDate(m.kickoff)} · {fmtTime(m.kickoff)}
                  </span>
                </Link>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* ═══ ANALYSIS + FUNNEL ═══ */}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">

        {/* Left — Team Analysis */}
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="card-broadcast space-y-5">
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <h2 className="font-display text-base font-bold uppercase tracking-widest text-stadium">
              Team Analysis · WC 2026
            </h2>
          </div>

          {/* attribute bars */}
          <div className="grid gap-x-8 sm:grid-cols-2">
            <Meter label="Attack" value={attackAvg} color="#00E676" />
            <Meter label="Midfield" value={midfieldAvg} color="#FFD700" />
            <Meter label="Defence" value={defAvg} color="#00D4FF" />
            <Meter label="Squad Fitness" value={fitPct} color="#00FFB2" />
          </div>

          {/* key players */}
          {(kpAtk.length > 0 || kpDef.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { label: "Attacking threats", players: kpAtk, color: "#00E676" },
                { label: "Defensive pillars", players: kpDef, color: "#00D4FF" },
              ].map(({ label, players, color }) => players.length > 0 && (
                <div key={label}>
                  <div className="mb-2 text-[10px] uppercase tracking-widest text-muted">{label}</div>
                  <div className="space-y-2">
                    {players.slice(0, 3).map((p: any) => (
                      <div key={p.name}
                        className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/3 p-2.5">
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10
                                        bg-ink-3 text-sm overflow-hidden">
                          {p.photo_url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={p.photo_url} alt={p.name} className="h-full w-full object-cover rounded-full" />
                            : "👤"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-display text-[12px] font-semibold text-stadium truncate">{p.name}</div>
                          <div className="text-[10px] text-muted">{p.club}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-display text-sm font-bold tabnum" style={{ color }}>{p.impact}</div>
                          <div className="text-[9px] text-muted">impact</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* injury report */}
          {injuries.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-widest text-muted">Injury / Suspension Report</div>
              <div className="space-y-2">
                {injuries.map((inj: any) => (
                  <div key={inj.player}
                    className="flex items-start gap-3 rounded-xl border border-danger/15 bg-danger/5 px-3 py-2">
                    <FitBadge status={inj.status} />
                    <div className="min-w-0 flex-1">
                      <span className="font-display text-[12px] font-semibold text-stadium">{inj.player}</span>
                      <span className="ml-2 text-[11px] text-muted">{inj.detail}</span>
                    </div>
                    {inj.return_date && (
                      <span className="text-[10px] text-gold shrink-0">
                        Ret: {fmtDate(inj.return_date)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {injuries.length === 0 && (
            <div className="rounded-xl border border-success/20 bg-success/5 px-4 py-2.5 text-[12px] text-success">
              ✓ No injury concerns — squad fully available
            </div>
          )}

          {/* manager */}
          <div className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/3 px-4 py-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink-3 text-xl border border-white/10">
              👔
            </div>
            <div>
              <div className="font-display text-sm font-bold text-stadium">{data.manager}</div>
              <div className="text-[11px] text-muted">Head Coach · {Math.round((data.manager_winrate ?? 0) * 100)}% win rate with this squad</div>
            </div>
          </div>
        </motion.section>

        {/* Right — Funnel Chart */}
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="card-broadcast flex flex-col">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-lg">🎯</span>
            <h2 className="font-display text-base font-bold uppercase tracking-widest text-stadium">
              Chances to Finals
            </h2>
          </div>
          <div className="mb-2 text-[10px] text-muted">50,000 Monte Carlo simulations</div>

          {/* champion highlight */}
          <div className="mb-5 rounded-xl border border-gold/25 bg-gold/8 p-4 text-center">
            <div className="font-display text-4xl font-extrabold tabnum text-gold">
              {pct0(prog.win_title ?? 0)}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-gold/70 mt-0.5">
              Champion probability
            </div>
          </div>

          {/* bar chart */}
          <div className="flex-1 min-h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical"
                margin={{ left: 12, right: 48, top: 4, bottom: 4 }}>
                <XAxis type="number" domain={[0, 1]}
                  tickFormatter={v => `${Math.round(v * 100)}%`}
                  stroke="#4A5B80" fontSize={10} tick={{ fill: "#8FA0C8" }} />
                <YAxis type="category" dataKey="name" width={60}
                  fontSize={11} tick={{ fill: "#C8D3E8" }} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="value" radius={[0, 8, 8, 0]} maxBarSize={28}>
                  {funnelData.map((entry) => (
                    <Cell key={entry.name} fill={STAGE_COLORS[entry.name] ?? "#00D4FF"} />
                  ))}
                  <LabelList dataKey="value" position="right"
                    formatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                    style={{ fill: "#C8D3E8", fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* stage breakdown rows */}
          <div className="mt-4 space-y-1.5">
            {funnelData.map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: STAGE_COLORS[s.name] }} />
                <span className="flex-1 text-[11px] text-muted">{s.name}</span>
                <div className="h-1.5 w-24 rounded-full bg-white/5 overflow-hidden">
                  <motion.div className="h-full rounded-full"
                    style={{ background: STAGE_COLORS[s.name] }}
                    initial={{ width: 0 }}
                    animate={{ width: `${s.value * 100}%` }}
                    transition={{ duration: 0.8, delay: 0.3 }} />
                </div>
                <span className="w-10 text-right text-[11px] font-bold tabnum text-stadium">
                  {pct0(s.value)}
                </span>
              </div>
            ))}
          </div>
        </motion.section>
      </div>

      {/* ═══ FULL SQUAD ═══ */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="card-broadcast">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-lg">👥</span>
          <h2 className="font-display text-base font-bold uppercase tracking-widest text-stadium">
            Current Squad
          </h2>
          <span className="chip text-[10px]">{sq.length} players</span>
          <span className="ml-auto text-[10px] text-muted">
            {fit} fit · {sq.filter(p => p.fitness === "doubt").length} doubt · {sq.filter(p => p.fitness === "out").length} out
          </span>
        </div>

        {(["GK", "DEF", "MID", "FWD"] as const).map((pos) => {
          const players = byPos[pos];
          if (!players.length) return null;
          const posLabel: Record<string, string> = { GK: "Goalkeepers", DEF: "Defenders", MID: "Midfielders", FWD: "Forwards" };
          const posColor: Record<string, string> = { GK: "#FF9500", DEF: "#00D4FF", MID: "#00FFB2", FWD: "#00E676" };
          return (
            <div key={pos} className="mb-5 last:mb-0">
              <div className="mb-2 flex items-center gap-2">
                <div className="h-3 w-1 rounded-full" style={{ background: posColor[pos] }} />
                <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: posColor[pos] }}>
                  {posLabel[pos]}
                </span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-white/5">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-[10px] uppercase tracking-wider text-muted">
                      <th className="px-3 py-2 text-left">Player</th>
                      <th className="px-3 py-2 text-left">Club</th>
                      <th className="px-3 py-2 text-right">G</th>
                      <th className="px-3 py-2 text-right">A</th>
                      <th className="px-3 py-2 text-right">xG</th>
                      <th className="px-3 py-2 text-right">Impact</th>
                      <th className="px-3 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {players
                      .sort((a: any, b: any) => b.impact - a.impact)
                      .map((p: any, i: number) => (
                        <motion.tr key={p.name}
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                          transition={{ delay: 0.3 + i * 0.03 }}
                          className="border-t border-white/5 hover:bg-white/3 transition">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10
                                              bg-ink-3 text-xs overflow-hidden">
                                {p.photo_url
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={p.photo_url} alt={p.name} className="h-full w-full rounded-full object-cover" />
                                  : "👤"}
                              </div>
                              <div>
                                <div className="font-display text-[12px] font-semibold text-stadium leading-tight">
                                  {p.name}
                                  {p.number && <span className="ml-1.5 text-[10px] text-muted">#{p.number}</span>}
                                </div>
                                {p.news && (
                                  <div className="text-[9px] text-danger/80 leading-tight">{p.news}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-muted">{p.club}</td>
                          <td className="px-3 py-2.5 text-right tabnum text-[12px] font-bold text-stadium">
                            {p.goals ?? 0}
                          </td>
                          <td className="px-3 py-2.5 text-right tabnum text-[12px] text-muted">
                            {p.assists ?? 0}
                          </td>
                          <td className="px-3 py-2.5 text-right tabnum text-[11px] text-muted">
                            {(p.xg ?? 0).toFixed(1)}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="inline-flex items-center gap-1">
                              <div className="h-1.5 w-12 rounded-full bg-white/5 overflow-hidden">
                                <div className="h-full rounded-full"
                                  style={{ width: `${p.impact}%`, background: posColor[pos] }} />
                              </div>
                              <span className="tabnum text-[11px] font-bold" style={{ color: posColor[pos] }}>
                                {p.impact}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <FitBadge status={p.fitness ?? "fit"} />
                          </td>
                        </motion.tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </motion.section>

    </div>
  );
}

function TeamSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-36 animate-pulse rounded-3xl bg-ink-2" />
      <div className="h-32 animate-pulse rounded-2xl bg-ink-2" />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="h-72 animate-pulse rounded-2xl bg-ink-2" />
        <div className="h-72 animate-pulse rounded-2xl bg-ink-2" />
      </div>
      <div className="h-96 animate-pulse rounded-2xl bg-ink-2" />
    </div>
  );
}
