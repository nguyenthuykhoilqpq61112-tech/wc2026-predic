"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const MODEL_MEMBERS = [
  { name: "Dixon-Coles", desc: "Bivariate Poisson with score correlation", color: "#00D4FF", acc: "54.2%" },
  { name: "Elo Rating", desc: "Dynamic team strength from 49k+ matches", color: "#00E676", acc: "55.2%" },
  { name: "XGBoost", desc: "Gradient boosted tree on 80+ features", color: "#FFD700", acc: "58.1%" },
  { name: "Neural Net", desc: "Deep net with form & fitness embeddings", color: "#FF6B6B", acc: "57.4%" },
];

const KEY_STATS = [
  { label: "Training matches", value: "49,445" },
  { label: "Simulations / update", value: "50,000" },
  { label: "Group stage accuracy", value: "~76%" },
  { label: "Model members", value: "4 ensemble" },
];

export function Mascot() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating mascot button */}
      <div className="fixed bottom-6 right-5 z-40">
        <motion.button
          onClick={() => setOpen(v => !v)}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          animate={{ y: [0, -4, 0] }}
          transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
          className="relative flex h-14 w-14 flex-col items-center justify-center rounded-full
                     border-2 border-cyan/60 bg-gradient-to-br from-ink-3 to-ink shadow-[0_0_20px_rgba(0,212,255,0.3)]
                     hover:border-cyan hover:shadow-[0_0_30px_rgba(0,212,255,0.5)]
                     transition-all duration-200"
          aria-label="CAI Model Info"
        >
          {/* pulsing ring */}
          <span className="absolute inset-0 rounded-full border border-cyan/30 animate-ping opacity-40" />
          <span className="text-2xl leading-none">🤖</span>
          <span className="mt-0.5 font-display text-[8px] font-bold uppercase tracking-widest text-cyan leading-none">
            CAI
          </span>
          {/* unread dot */}
          {!open && (
            <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border border-ink bg-gold animate-pulse" />
          )}
        </motion.button>
      </div>

      {/* Info panel */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/40"
            />
            <motion.aside
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="fixed bottom-24 right-5 z-50 w-80 max-h-[80vh] overflow-y-auto
                         rounded-2xl border border-cyan/25 bg-ink-2/95 backdrop-blur-xl
                         shadow-[0_0_40px_rgba(0,212,255,0.12)] p-5"
            >
              {/* header */}
              <div className="mb-4 flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl
                                bg-gradient-to-br from-cyan/20 to-teal/10 text-xl border border-cyan/20">
                  🤖
                </div>
                <div>
                  <div className="font-display text-sm font-bold uppercase tracking-wider text-stadium">
                    CAI · ChrisAI
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-cyan/70">
                    Prediction Model
                  </div>
                </div>
                <button onClick={() => setOpen(false)}
                  className="ml-auto text-muted hover:text-stadium transition text-lg leading-none">
                  ✕
                </button>
              </div>

              <p className="mb-4 text-[12px] leading-relaxed text-stadium/80">
                CAI is a{" "}
                <span className="text-gold font-semibold">4-member ensemble</span>{" "}
                that prioritises current form and momentum over historical averages.
                Each member votes on outcome probabilities; the calibrated blend
                powers all predictions on this platform.
              </p>

              {/* ensemble members */}
              <div className="mb-4">
                <div className="mb-2 text-[10px] uppercase tracking-widest text-muted">Ensemble members</div>
                <div className="space-y-2">
                  {MODEL_MEMBERS.map((m) => (
                    <div key={m.name}
                      className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/3 p-2.5">
                      <div className="h-7 w-1.5 shrink-0 rounded-full" style={{ background: m.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-[11px] font-semibold text-stadium">{m.name}</div>
                        <div className="text-[10px] text-muted leading-tight">{m.desc}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-display text-xs font-bold tabnum" style={{ color: m.color }}>
                          {m.acc}
                        </div>
                        <div className="text-[9px] text-muted">WDL acc</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* key stats */}
              <div className="mb-4 grid grid-cols-2 gap-2">
                {KEY_STATS.map((s) => (
                  <div key={s.label}
                    className="rounded-xl border border-white/5 bg-white/3 p-2.5 text-center">
                    <div className="font-display text-sm font-bold text-gold tabnum">{s.value}</div>
                    <div className="text-[9px] uppercase tracking-wide text-muted leading-tight mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* how it works blurb */}
              <div className="rounded-xl border border-cyan/15 bg-cyan/5 p-3 text-[11px] leading-relaxed text-stadium/80">
                <span className="text-cyan font-semibold">How it works: </span>
                Historical base (Elo + Dixon-Coles) sets the prior.
                XGBoost + Neural Net inject current form, squad fitness, and
                tactical context. A calibrated ensemble blend of all four models
                drives the final probability output, which feeds 50,000 Monte Carlo
                simulations for tournament-wide odds.
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
