import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Sora, Inter } from "next/font/google";
import { Nav } from "@/components/nav";
import { RouteTransition } from "@/components/route-transition";
import { CaiInfo } from "@/components/cai-info";
import { Mascot } from "@/components/mascot";

const display = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WC26 CAI · FIFA World Cup 2026 Prediction Platform",
  description:
    "CAI (ChrisAI) — broadcast-grade FIFA World Cup 2026 prediction platform. " +
    "Live match command center, CAI pre-match analysis, ensemble forecasts, " +
    "Monte Carlo tournament simulation and player impact insights.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#071226",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        {/* Global stadium atmosphere particles */}
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="particle"
              style={{
                left: `${(i * 37 + 13) % 100}%`,
                top: `${(i * 53 + 7) % 100}%`,
                animationDelay: `${(i * 0.7) % 3}s`,
                animationDuration: `${2.5 + (i % 4) * 0.8}s`,
                opacity: 0.3 + (i % 5) * 0.1,
                width: i % 3 === 0 ? "3px" : "2px",
                height: i % 3 === 0 ? "3px" : "2px",
                background: i % 4 === 0 ? "#00FFB2" : i % 3 === 0 ? "#FFD700" : "#00D4FF",
              }}
            />
          ))}
        </div>

        <RouteTransition />
        <Mascot />
        <Nav />
        <main className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-6">
          {children}
        </main>

        <footer className="relative z-10 border-t border-line">
          <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
              <div>
                <div className="font-display text-sm font-bold uppercase tracking-[0.25em]">
                  <span className="cyan-text">WC26</span>
                  <span className="text-muted"> · CAI Prediction Platform</span>
                </div>
                <CaiInfo />
              </div>
              <div className="text-[11px] text-muted/50">
                Not affiliated with FIFA. Not betting advice. Tournament predictions for entertainment.
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
