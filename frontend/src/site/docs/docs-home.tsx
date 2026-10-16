import { useState } from "react"
import { ArrowRight, Code2, Cpu, Rocket, Server } from "lucide-react"
import { Link } from "react-router"

import { StarCard } from "./doc-page"
import { DOC_SECTIONS } from "./catalog"
import { DocsSearch, SearchTrigger } from "./docs-search"

const START_HERE = [
  { to: "/docs/quick-start", icon: Rocket, title: "Quick start", body: "From sign-up to your first API request in a few minutes." },
  { to: "/docs/openai-sdks", icon: Code2, title: "OpenAI SDKs", body: "Use the official SDKs by changing only the base URL." },
  { to: "/docs/self-hosting", icon: Server, title: "Self-host on a GPU", body: "vLLM, monitoring and billing on your own server." },
  { to: "/docs/running-locally", icon: Cpu, title: "Run locally on CPU", body: "One command, a tiny model, no GPU needed." },
]

export function DocsHome() {
  const [searchOpen, setSearchOpen] = useState(false)
  return (
    <div className="pb-24">
      <section className="bg-card relative overflow-hidden rounded-3xl border px-6 py-12 sm:px-10 sm:py-16">
        <div className="site-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" aria-hidden="true" />
        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_22%,transparent),transparent)]" aria-hidden="true" />
        <div className="relative max-w-2xl">
          <p className="text-brand font-mono text-xs font-semibold tracking-[0.18em] uppercase">Documentation</p>
          <h1 className="mt-3 text-4xl leading-tight font-semibold sm:text-5xl">Everything about DockWell</h1>
          <p className="text-muted-foreground font-reading mt-4 text-lg leading-relaxed">
            Serve open source models behind an OpenAI-compatible API, meter every token, and run it all on your own
            hardware. Guides for developers calling the API and for the people running the platform.
          </p>
          <SearchTrigger large onOpen={() => setSearchOpen(true)} className="mt-8 max-w-lg" />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold">Start here</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {START_HERE.map((item) => (
            <Link key={item.to} to={item.to} className="group bg-card hover:border-brand/40 rounded-2xl border p-5 transition-[border-color,box-shadow] hover:shadow-md">
              <span className="bg-brand-soft text-brand flex size-10 items-center justify-center rounded-xl">
                <item.icon className="size-5" />
              </span>
              <p className="mt-4 flex items-center gap-1.5 font-semibold">
                {item.title} <ArrowRight className="size-4 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
              </p>
              <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{item.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-14 grid gap-6 lg:grid-cols-2">
        {DOC_SECTIONS.map((section) => (
          <div key={section.title} className="bg-card rounded-2xl border p-6">
            <div className="flex items-center gap-3">
              <span className="bg-muted flex size-9 items-center justify-center rounded-lg">
                <section.icon className="text-brand size-[18px]" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">{section.title}</h2>
                <p className="text-muted-foreground text-sm">{section.blurb}</p>
              </div>
            </div>
            <ul className="mt-5 divide-y">
              {section.pages.map((page) => (
                <li key={page.slug}>
                  <Link to={`/docs/${page.slug}`} className="group flex items-start justify-between gap-4 py-3">
                    <span>
                      <span className="group-hover:text-brand block text-sm font-medium transition-colors">{page.title}</span>
                      <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">{page.description}</span>
                    </span>
                    <ArrowRight className="text-muted-foreground group-hover:text-brand mt-0.5 size-4 shrink-0 transition-colors" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <StarCard className="self-start lg:col-span-2 lg:max-w-md" />
      </section>
      <DocsSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}
