"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { submitFeedback } from "@/lib/supabase";

const STARS = [1, 2, 3, 4, 5];

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Floating trigger */}
      <button
        onClick={() => setOpen(true)}
        title="Send feedback"
        className="fixed bottom-6 right-20 z-50 flex h-12 w-12 items-center justify-center rounded-full
                   border border-cyan/30 bg-ink-2 shadow-lg shadow-black/40 text-xl
                   hover:border-cyan/60 hover:bg-ink-3 transition-all hover:scale-110 active:scale-95">
        💬
      </button>

      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return;
    setState("loading");
    try {
      await submitFeedback({ name: name.trim() || undefined, rating, message: message.trim(), page: pathname });
      setState("success");
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Something went wrong. Please try again.");
      setState("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-6 sm:items-center sm:justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-ink-2 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-stadium">Share your feedback</h2>
            <p className="text-[11px] text-muted mt-0.5">Help us improve the WC2026 predictor</p>
          </div>
          <button onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-stadium hover:bg-white/5 transition text-lg">
            ✕
          </button>
        </div>

        {state === "success" ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <span className="text-5xl">🎉</span>
            <p className="font-display text-lg font-bold text-success">Thanks for the feedback!</p>
            <p className="text-sm text-muted">It helps us keep the predictions sharp.</p>
            <button onClick={onClose}
              className="mt-2 rounded-xl border border-cyan/30 bg-cyan/10 px-6 py-2 text-sm font-semibold text-cyan hover:bg-cyan/20 transition">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Star rating */}
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted mb-2">
                Rating <span className="text-danger">*</span>
              </label>
              <div className="flex gap-2">
                {STARS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setRating(s)}
                    onMouseEnter={() => setHovered(s)}
                    onMouseLeave={() => setHovered(0)}
                    className="text-3xl transition-transform hover:scale-125 active:scale-110">
                    {s <= (hovered || rating) ? "⭐" : "☆"}
                  </button>
                ))}
              </div>
              {!rating && state === "error" && (
                <p className="mt-1 text-[11px] text-danger">Please select a rating.</p>
              )}
            </div>

            {/* Name (optional) */}
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted mb-1.5">
                Name <span className="text-muted/50">(optional)</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={80}
                className="w-full rounded-xl border border-white/10 bg-ink-3 px-4 py-2.5 text-sm
                           placeholder:text-muted focus:border-cyan/40 focus:outline-none focus:ring-1 focus:ring-cyan/20" />
            </div>

            {/* Message */}
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted mb-1.5">
                Message <span className="text-danger">*</span>
              </label>
              <textarea
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What do you think? Any predictions we got wrong? Features you'd love?"
                rows={4}
                maxLength={1000}
                className="w-full resize-none rounded-xl border border-white/10 bg-ink-3 px-4 py-2.5 text-sm
                           placeholder:text-muted focus:border-cyan/40 focus:outline-none focus:ring-1 focus:ring-cyan/20" />
              <div className="mt-1 text-right text-[10px] text-muted">{message.length}/1000</div>
            </div>

            {state === "error" && errorMsg && (
              <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {errorMsg}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={state === "loading" || !rating || !message.trim()}
              className="w-full rounded-xl border border-cyan/30 bg-cyan/10 py-3 text-sm font-bold
                         text-cyan uppercase tracking-wider transition hover:bg-cyan/20
                         disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]">
              {state === "loading" ? "Sending…" : "Send Feedback"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
