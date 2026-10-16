import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUpRight, FlaskConical, X } from "lucide-react"

import { DEMO_MODE } from "../config"

const DISMISSED_KEY = "dockwell-demo-notice-dismissed"
const AUTO_HIDE_MS = 30_000
const ENTER_DELAY_MS = 700
const EXIT_MS = 350

// Remembered for the browser session: once closed (or auto-hidden) it stays away while the
// visitor moves between pages, and comes back on their next visit.
function wasDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "1"
  } catch {
    return false
  }
}

function rememberDismissed() {
  try {
    sessionStorage.setItem(DISMISSED_KEY, "1")
  } catch {
    // Storage blocked (private mode etc.): it just shows again on the next page.
  }
}

/**
 * Floating "this is the public demo" notice, shown only when built with VITE_DEMO_MODE=true.
 * It closes with the button or Escape, and hides itself after 30 seconds; the countdown
 * (and its progress line) pauses while the pointer or keyboard focus is on it.
 */
export function DemoBanner() {
  const [phase, setPhase] = useState<"hidden" | "shown" | "leaving">("hidden")
  const [paused, setPaused] = useState(false)
  const remaining = useRef(AUTO_HIDE_MS)

  // Appear only after hydration: the pre-rendered HTML never contains the notice, so there is no
  // hydration mismatch and no flash for visitors who already dismissed it.
  useEffect(() => {
    if (!DEMO_MODE || wasDismissed()) return
    const timer = window.setTimeout(() => setPhase("shown"), ENTER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const close = useCallback(() => {
    rememberDismissed()
    setPhase("leaving")
  }, [])

  // Auto-hide countdown that keeps the time left across pauses.
  useEffect(() => {
    if (phase !== "shown" || paused) return
    const started = performance.now()
    const timer = window.setTimeout(close, remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current -= performance.now() - started
    }
  }, [phase, paused, close])

  // Unmount once the exit animation has played.
  useEffect(() => {
    if (phase !== "leaving") return
    const timer = window.setTimeout(() => setPhase("hidden"), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== "shown") return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [phase, close])

  if (!DEMO_MODE || phase === "hidden") return null

  return (
    <div
      role="region"
      aria-label="Demo notice"
      className="fixed inset-x-3 bottom-3 z-70 sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:w-[35rem] sm:-translate-x-1/2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setPaused(false)}
    >
      {/* Always dark (the `dark` class switches the theme tokens), on the teal gradient of the logo
          tile, with a deep black shadow so it lifts clearly off the page in both themes. */}
      <div
        className={
          "site-toast dark relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#2a2550_0%,#17152e_45%,#0b0b14_100%)] text-white shadow-[0_22px_50px_-10px_rgb(0_0_0/0.75),0_8px_18px_-6px_rgb(0_0_0/0.5)] ring-1 ring-white/10" +
          (phase === "leaving" ? " site-toast-out" : "")
        }
      >
        <div className="relative flex items-start gap-3.5 p-4 pr-12 sm:items-center">
          <span className="bg-brand text-brand-foreground relative grid size-10 shrink-0 place-items-center rounded-xl">
            <FlaskConical className="size-5" />
            <span aria-hidden className="absolute -top-1 -right-1 flex size-3">
              <span className="bg-brand absolute inline-flex size-full animate-ping rounded-full opacity-70" />
              <span className="bg-brand relative inline-flex size-3 rounded-full ring-2 ring-[#17152e]" />
            </span>
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-tight">You're exploring the live demo</p>
            <p className="mt-0.5 text-xs leading-relaxed text-white/70">
              Payments are Stripe test mode and data may be reset. Run it on your own GPU server for real traffic.
            </p>
            <a href="/docs/self-hosting" className="text-brand mt-2 inline-flex items-center gap-1 text-xs font-semibold sm:hidden">
              Self-host it <ArrowUpRight className="size-3.5" />
            </a>
          </div>

          <a
            href="/docs/self-hosting"
            className="bg-brand text-brand-foreground hidden h-8 shrink-0 items-center gap-1 rounded-lg px-3 text-xs font-semibold shadow-sm transition-opacity hover:opacity-90 sm:inline-flex"
          >
            Self-host <ArrowUpRight className="size-3.5" />
          </a>
        </div>

        <button
          type="button"
          onClick={close}
          aria-label="Dismiss demo notice"
          className="absolute top-2.5 right-2.5 grid size-7 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none sm:top-1/2 sm:-translate-y-1/2"
        >
          <X className="size-4" />
        </button>

        {/* Countdown to auto-hide; pauses together with the timer. Hidden for reduced motion. */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10 motion-reduce:hidden">
          <div
            className="site-toast-progress bg-brand h-full origin-left"
            style={{ animationPlayState: paused || phase === "leaving" ? "paused" : "running" }}
          />
        </div>
      </div>
    </div>
  )
}
