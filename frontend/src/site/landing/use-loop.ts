import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"

/** True while `ref` is on screen and the visitor allows motion. Animations only run then. */
export function useActive(ref: RefObject<HTMLElement | null>, threshold = 0.2): boolean {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const io = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, threshold])
  return active
}

/** Calls `fn` every `ms` while `enabled` and the tab is visible. */
export function useInterval(fn: () => void, ms: number, enabled: boolean) {
  const saved = useRef(fn)
  useEffect(() => {
    saved.current = fn
  })
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => {
      if (!document.hidden) saved.current()
    }, ms)
    return () => window.clearInterval(id)
  }, [ms, enabled])
}

/** Deterministic noise in [0, 1): the same on the server and in the browser. */
export function noise(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}
