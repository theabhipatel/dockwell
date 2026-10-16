import { useRef } from "react"
import type { ReactNode } from "react"

import { useReveal } from "../landing/use-reveal"
import { DemoBanner } from "./demo-banner"
import { SiteFooter } from "./site-footer"
import { SiteHeader } from "./site-header"

export function SitePage({ eyebrow, title, intro, children }: { eyebrow: string; title: ReactNode; intro: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useReveal(ref)
  return (
    <div ref={ref} className="flex min-h-dvh flex-col overflow-x-clip">
      <DemoBanner />
      <SiteHeader />
      <main className="flex-1">
        <section className="relative border-b">
          <div className="bg-glow pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
            <p data-reveal className="text-brand font-mono text-xs font-semibold tracking-[0.18em] uppercase">{eyebrow}</p>
            <h1 data-reveal className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
            <p data-reveal className="text-muted-foreground font-reading mt-5 max-w-2xl text-lg leading-relaxed">{intro}</p>
          </div>
        </section>
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">{children}</div>
      </main>
      <SiteFooter />
    </div>
  )
}
