"use client";
import useSWR from "swr";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { Flag, SectionHeader } from "@/components/ui";

const fetcher = (p: string) => api(p);

type Row = {
  rank?: number; player: string; team: string;
  flag_url?: string; photo_url?: string; note?: string;
  goals?: number; assists?: number;
  clean_sheets?: number; goals_against?: number; played?: number;
};

export default function AwardsPage() {
  const { data, error } = useSWR("/api/awards", fetcher);

  if (error) return (
    <div className="card-broadcast flex items-center gap-3 text-danger">
      <span className="text-2xl">⚡</span> Backend unreachable.
    </div>
  );
  if (!data) return <AwardsSkeleton />;

  return (
    <div className="space-y-6">
      <SectionHeader title="TOURNAMENT AWARDS" sub="FIFA World Cup 2026 · Golden Boot · Golden Glove · Golden Ball" />

      <AwardSection
        icon="🥇" title="GOLDEN BOOT" sub="Top scorer"
        badge={{ text: "LIVE — real goal data", tone: "gold" }}
        caption={`as of ${data.as_of} · scorers from match events`}
        rows={(data.golden_boot || []).slice(0, 15)}
        stat={(r) => [
          { label: "G", value: r.goals ?? 0, big: true },
          { label: "A", value: r.assists ?? 0 },
        ]} />

      <AwardSection
        icon="🧤" title="GOLDEN GLOVE" sub="Best goalkeeper"
        badge={{ text: "clean sheets + reputation", tone: "cyan" }}
        caption={`as of ${data.as_of} · ranked by clean sheets — no live save-count feed exists`}
        rows={data.golden_glove || []}
        stat={(r) => [
          { label: "CS", value: r.clean_sheets ?? 0, big: true },
          { label: "GA", value: r.goals_against ?? 0 },
        ]} />

      <AwardSection
        icon="⭐" title="GOLDEN BALL" sub="Best player"
        badge={{ text: "media power ranking", tone: "cyan" }}
        caption={`as of ${data.as_of} · curated ranking, enriched with live goals`}
        rows={data.golden_ball || []}
        stat={(r) => [{ label: "G", value: r.goals ?? 0, big: true }]} />

      {Array.isArray(data.sources) && data.sources.length > 0 && (
        <p className="px-1 text-[11px] text-muted">
          Sources:{" "}
          {data.sources.map((s: string, i: number) => (
            <span key={i}>
              {i > 0 && " · "}
              <a href={s} target="_blank" rel="noreferrer"
                className="text-cyan/70 hover:text-cyan underline-offset-2 hover:underline">
                {new URL(s).hostname.replace("www.", "")}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function AwardSection({ icon, title, sub, badge, caption, rows, stat }: {
  icon: string; title: string; sub: string;
  badge: { text: string; tone: "gold" | "cyan" };
  caption: string; rows: Row[];
  stat: (r: Row) => { label: string; value: number | string; big?: boolean }[];
}) {
  return (
    <section className="card-broadcast">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-lg font-bold uppercase tracking-widest text-stadium">{title}</h2>
          <p className="text-[11px] uppercase tracking-wider text-muted">{sub}</p>
        </div>
        <span className={badge.tone === "gold" ? "chip-gold text-[10px]" : "chip-cyan text-[10px]"}>
          {badge.text}
        </span>
      </div>

      <div className="divide-y divide-white/5">
        {rows.map((r, i) => (
          <motion.div key={`${r.player}-${i}`}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            className="flex items-center gap-3 py-2.5">
            <span className={`w-6 shrink-0 text-center font-display text-sm font-bold tabnum
              ${i === 0 ? "text-gold" : i < 3 ? "text-cyan" : "text-muted"}`}>
              {r.rank ?? i + 1}
            </span>
            <Avatar photo={r.photo_url} flag={r.flag_url} name={r.player} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-display font-semibold text-stadium">{r.player}</span>
                {r.flag_url && <Flag url={r.flag_url} name={r.team} size={14} />}
              </div>
              <div className="truncate text-[11px] text-muted">
                {r.team}{r.note ? ` · ${r.note}` : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {stat(r).map((s, j) => (
                <div key={j} className="text-right">
                  <div className={`font-display font-bold tabnum ${s.big ? "text-xl text-gold" : "text-sm text-stadium"}`}>
                    {s.value}
                  </div>
                  <div className="text-[9px] uppercase tracking-wider text-muted">{s.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
        {rows.length === 0 && <p className="py-6 text-center text-muted">No data yet.</p>}
      </div>

      <p className="mt-3 border-t border-white/5 pt-2 text-[10px] text-muted">{caption}</p>
    </section>
  );
}

function Avatar({ photo, flag, name }: { photo?: string; flag?: string; name: string }) {
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt={name} width={36} height={36}
      className="h-9 w-9 shrink-0 rounded-full border border-white/10 object-cover" />;
  }
  if (flag) return <div className="shrink-0"><Flag url={flag} name={name} size={26} /></div>;
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-ink-3 text-[10px] font-bold text-muted">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function AwardsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-12 w-72 animate-pulse rounded-lg bg-ink-2" />
      {[...Array(3)].map((_, i) => (
        <div key={i} className="card-broadcast space-y-3">
          <div className="h-6 w-40 animate-pulse rounded bg-ink-2" />
          {[...Array(5)].map((_, j) => (
            <div key={j} className="h-12 animate-pulse rounded-xl bg-ink-2" />
          ))}
        </div>
      ))}
    </div>
  );
}
