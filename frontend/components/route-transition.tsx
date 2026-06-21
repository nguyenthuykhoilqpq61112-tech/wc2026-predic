"use client";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

// Top-level section of a path: "/matches/12" -> "/matches", "/" -> "/".
const section = (p: string) => "/" + (p.split("/")[1] || "");

/**
 * Broadcast-style gold sweep transition (Sky-Sports bumper).
 * A gold bar wipes across the screen carrying the CAI logo, briefly hiding the
 * page swap, then exits to reveal the new page. Plays on first load and whenever
 * the TOP-LEVEL section changes — not on minor nav (e.g. /matches -> /matches/[id]).
 */
export function RouteTransition() {
  const pathname = usePathname();
  const seg = section(pathname);
  const prev = useRef<string | null>(null);
  const [play, setPlay] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (prev.current === null) {
      prev.current = seg;            // first mount → play once
      setToken((t) => t + 1);
      setPlay(true);
      return;
    }
    if (prev.current !== seg) {      // top-level section changed
      prev.current = seg;
      setToken((t) => t + 1);
      setPlay(true);
    }
  }, [seg]);

  return (
    <AnimatePresence>
      {play && (
        <motion.div
          key={token}
          className="pointer-events-none fixed inset-0 z-[200] overflow-hidden"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Gold sweep panel: in from left, hold, out to right. Drives dismissal. */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-amber-500 via-gold to-amber-400"
            initial={{ x: "-105%", skewX: "-8deg" }}
            animate={{ x: ["-105%", "0%", "0%", "105%"] }}
            transition={{ duration: 1.5, times: [0, 0.34, 0.5, 1], ease: [0.7, 0, 0.3, 1] }}
            style={{ boxShadow: "0 0 80px rgba(0,0,0,0.5)" }}
            onAnimationComplete={() => setPlay(false)}
          />
          {/* Thin trailing edge highlight */}
          <motion.div
            className="absolute inset-y-0 w-24 bg-white/30 blur-xl"
            initial={{ x: "-130%" }}
            animate={{ x: ["-130%", "120%"] }}
            transition={{ duration: 1.5, ease: [0.7, 0, 0.3, 1] }}
          />
          {/* CAI logo riding the bar */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center gap-3"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.9, 1, 1, 1.04] }}
            transition={{ duration: 1.5, times: [0.18, 0.36, 0.5, 0.7], ease: "easeOut" }}
          >
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-ink text-2xl shadow-xl">
              ⚽
            </div>
            <div className="font-display leading-none text-ink">
              <div className="text-2xl font-extrabold uppercase tracking-[0.2em]">
                WC<span className="text-ink/70">26</span>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.45em] text-ink/80">
                CAI · ChrisAI
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
