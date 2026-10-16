import { useEffect } from "react"
import type { RefObject } from "react"

/**
 * Fades elements marked `data-reveal` in as they scroll into view. Content is visible in the
 * static HTML; this only arms the effect after marking what is already on screen, so nothing
 * above the fold ever blinks.
 */
export function useReveal(container: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = container.current
    if (!root) return
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"))
    const height = window.innerHeight
    const pending: HTMLElement[] = []
    for (const el of items) {
      const rect = el.getBoundingClientRect()
      if (rect.top < height && rect.bottom > 0) el.setAttribute("data-inview", "")
      else pending.push(el)
    }
    root.classList.add("reveal-armed")
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.setAttribute("data-inview", "")
          io.unobserve(entry.target)
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    )
    for (const el of pending) io.observe(el)
    return () => io.disconnect()
  }, [container])
}
