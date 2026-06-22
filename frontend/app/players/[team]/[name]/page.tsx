"use client";
import useSWR from "swr";
import { api } from "@/lib/api";

const fetcher = (p: string) => api(p);

export default function PlayerPage({ params }: { params: { team: string; name: string } }) {
  const team = decodeURIComponent(params.team);
  const name = decodeURIComponent(params.name);
  const { data, error } = useSWR(
    `/api/players/${encodeURIComponent(team)}/${encodeURIComponent(name)}`, fetcher);
  if (error) return <div className="card text-danger">Player not found.</div>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const stats: [string, any][] = [
    ["Position", data.position], ["Club", data.club],
    ["Goals", data.goals], ["Assists", data.assists],
    ["xG", data.xg], ["xA", data.xa],
    ["Minutes", data.minutes], ["Fitness", data.fitness],
  ];
  return (
    <div className="space-y-6">
      <section className="card flex items-start gap-4">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-white/5 text-3xl">
          {data.photo_url
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={data.photo_url} alt={data.name} className="h-full w-full object-cover" />
            : "👤"}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{data.name}</h1>
          <p className="text-muted">{team} · {data.position} · {data.club}</p>
          <div className="mt-4 inline-flex items-center gap-3 rounded-xl border border-line px-4 py-3">
            <span className="text-xs text-muted">Impact rating</span>
            <span className="text-3xl font-extrabold text-acc tabnum">{data.impact}</span>
          </div>
        </div>
      </section>
      <section className="card grid grid-cols-2 gap-x-8 sm:grid-cols-4">
        {stats.map(([k, v]) => (
          <div key={k} className="py-2">
            <div className="text-xs text-muted">{k}</div>
            <div className="text-lg font-semibold tabnum">{String(v)}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
