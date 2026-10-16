import { useRef } from "react"
import type { ReactNode } from "react"

import { useReveal } from "../landing/use-reveal"
import { DemoBanner } from "./demo-banner"
import { SiteFooter } from "./site-footer"
import { SiteHeader } from "./site-header"

export interface LegalSection {
  title: string
  body: ReactNode
}

export function LegalLayout({ eyebrow, title, intro, updated, sections }: { eyebrow: string; title: string; intro: string; updated: string; sections: LegalSection[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useReveal(ref)
  return (
    <div ref={ref} className="flex min-h-dvh flex-col">
      <DemoBanner />
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-14 pb-24 sm:px-6 sm:pt-20">
        <p data-reveal className="text-brand font-mono text-xs font-semibold tracking-[0.18em] uppercase">{eyebrow}</p>
        <h1 data-reveal className="mt-3 text-4xl font-semibold sm:text-5xl">{title}</h1>
        <p data-reveal className="text-muted-foreground font-reading mt-5 text-lg leading-relaxed">{intro}</p>
        <p className="text-muted-foreground mt-3 text-sm">Last updated {updated}</p>
        <div className="docs-prose mt-12">
          {sections.map((s) => (
            <section key={s.title}>
              <h2>{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
