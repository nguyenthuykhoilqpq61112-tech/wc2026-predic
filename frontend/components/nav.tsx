"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";

const LINKS: [string, string, string][] = [
  ["/",          "Home",       "⌂"],
  ["/live",      "Live",       "◉"],
  ["/matches",   "Matches",    "⚽"],
  ["/groups",    "Groups",     "▦"],
  ["/bracket",   "Bracket",    "⬡"],
  ["/simulator", "Simulator",  "◎"],
  ["/teams",     "Teams",      "🛡"],
  ["/awards",    "Awards",     "🏆"],
  ["/analytics", "Analytics",  "◈"],
];

// Static fallback for the news ticker if /api/news is unavailable.
const NEWS_FALLBACK: string[] = [
  "🏆 FIFA World Cup 2026 · Round of 32 underway",
  "🇵🇾 Paraguay 1-1 Germany (4-3 pens) — Germany ELIMINATED 🚨",
  "🇲🇦 Morocco 1-1 Netherlands (3-2 pens) — Netherlands OUT 🚨",
  "🇧🇷 Brazil 2-1 Japan · 🇨🇦 Canada · 🇳🇴 Norway through",
  "🇦🇷 Argentina projected champions (26.7%) · Final: ARG vs FRA",
  "👟 Golden Boot: Lionel Messi (6 goals)",
  "📊 CAI projects 🇦🇷 Argentina champions (26.7%)",
  "🎯 CAI outcome accuracy: 51/77 overall (66%) · R32: 4/5 (80%)",
  "🤖 CAI: current form + momentum led · 3-scenario knockout xG",
];

export function Nav() {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Data-driven ticker: rebuilt from live state on every ingest. Falls back to
  // the static list if /api/news (or its snapshot) is unavailable.
  const { data: news } = useSWR("/api/news", (p: string) => api(p));
  const ticker: string[] = news?.items?.length ? news.items : NEWS_FALLBACK;

  return (
    <header className="sticky top-0 z-50">
      {/* Live ticker bar */}
      <div className="border-b border-line/50 bg-ink/95 px-4 py-1.5">
        <div className="ticker-wrap mx-auto max-w-7xl overflow-hidden">
          <div className="ticker-track flex gap-12 text-[11px] text-muted">
            {[...ticker, ...ticker].map((item, i) => (
              <span key={i} className="shrink-0 flex items-center gap-2">
                {item}
                <span className="text-line">·</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="border-b border-line bg-ink/90 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          {/* Logo */}
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <div className="relative">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan to-teal text-lg font-bold text-ink shadow-glow animate-glow-pulse">
                ⚽
              </div>
            </div>
            <div className="hidden sm:block">
              <div className="font-display text-base font-bold leading-none uppercase tracking-widest">
                <span className="cyan-text">WC</span>
                <span className="text-gold">26</span>
              </div>
              <div className="text-[9px] uppercase tracking-[0.3em] text-muted/60 leading-none">
                CAI Predictor
              </div>
            </div>
          </Link>

          {/* Desktop links */}
          <div className="no-scrollbar hidden flex-1 items-center gap-0.5 overflow-x-auto md:flex">
            {LINKS.map(([href, label]) => {
              const active = href === "/" ? path === "/" : path.startsWith(href);
              return (
                <Link key={href} href={href}
                  className={`relative whitespace-nowrap rounded-lg px-3 py-2 font-display text-xs
                              uppercase tracking-widest transition-all duration-200
                              ${active
                                ? "text-cyan bg-cyan/10"
                                : "text-muted hover:bg-white/5 hover:text-stadium"}`}>
                  {label}
                  {active && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute bottom-0 left-2 right-2 h-px bg-cyan rounded-full"
                    />
                  )}
                  {label === "Live" && (
                    <span className="ml-1.5 inline-flex h-1.5 w-1.5 rounded-full bg-danger animate-live" />
                  )}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Live status pill */}
            <div className="hidden items-center gap-1.5 rounded-full border border-danger/30 bg-danger/10 px-3 py-1 sm:flex">
              <span className="live-dot" />
              <span className="font-display text-[10px] uppercase tracking-widest text-danger">Live</span>
            </div>

            {/* Mobile hamburger */}
            <button
              className="ml-1 rounded-lg border border-line p-2 text-muted hover:text-cyan md:hidden"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Menu">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                {menuOpen
                  ? <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  : <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-line md:hidden">
              <div className="grid grid-cols-2 gap-1 p-3">
                {LINKS.map(([href, label, icon]) => {
                  const active = href === "/" ? path === "/" : path.startsWith(href);
                  return (
                    <Link key={href} href={href}
                      onClick={() => setMenuOpen(false)}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 font-display text-sm uppercase tracking-wide
                        ${active ? "bg-cyan/10 text-cyan" : "text-muted hover:bg-white/5"}`}>
                      <span>{icon}</span>{label}
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </header>
  );
}

