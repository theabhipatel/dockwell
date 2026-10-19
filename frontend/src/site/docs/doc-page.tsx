import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Clock, PencilLine, Star } from "lucide-react"
import { Link, useLoaderData } from "react-router"
import type { LoaderFunctionArgs } from "react-router"

import { cn } from "@/lib/utils"

import { GITHUB_DOCS_EDIT_URL, GITHUB_URL } from "../config"
import { GitHubIcon } from "../components/github-icon"
import { extractHeadings, findDoc, loadDocSource, neighbours } from "./catalog"
import type { Heading } from "./catalog"
import { DocMarkdown } from "./doc-markdown"
import { Button } from "@/components/ui/button"

export async function docLoader({ params }: LoaderFunctionArgs) {
  const meta = findDoc(params.slug)
  const source = meta ? await loadDocSource(meta.slug) : null
  return { slug: params.slug ?? "", source }
}

/** Highlights the section currently being read. */
function useActiveHeading(headings: Heading[]): string | null {
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null)
  useEffect(() => {
    const elements = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0) return
    const onScroll = () => {
      const offset = 120
      let current = elements[0].id
      for (const el of elements) {
        if (el.getBoundingClientRect().top - offset <= 0) current = el.id
        else break
      }
      setActive(current)
    }
    let raf = 0
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0
        onScroll()
      })
    }
    onScroll()
    window.addEventListener("scroll", schedule, { passive: true })
    return () => {
      window.removeEventListener("scroll", schedule)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [headings])
  return active
}

export function StarCard({ className }: { className?: string }) {
  return (
    <div className={cn("bg-card relative overflow-hidden rounded-xl border p-4", className)}>
      <div className="pointer-events-none absolute -top-10 -right-10 size-28 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand-2)_25%,transparent),transparent)]" aria-hidden="true" />
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Star className="fill-warning text-warning size-4" /> Enjoying DockWell?
      </p>
      <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">A star on GitHub helps other teams find it, and keeps the project going.</p>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener"
        className="bg-foreground text-background mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
      >
        <GitHubIcon className="size-3.5" /> Star on GitHub
      </a>
    </div>
  )
}

function Toc({ headings, active }: { headings: Heading[]; active: string | null }) {
  if (headings.length === 0) return null
  return (
    <nav aria-label="On this page">
      <p className="mb-3 text-xs font-semibold tracking-wide uppercase">On this page</p>
      <ul className="border-l text-[13px]">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={cn(
                "-ml-px block border-l py-1 leading-snug transition-colors",
                h.depth === 3 ? "pl-6" : "pl-3",
                active === h.id ? "border-brand text-brand font-medium" : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function DocPage() {
  const { slug, source } = useLoaderData<typeof docLoader>()
  const meta = findDoc(slug)
  const headings = useMemo(() => (source ? extractHeadings(source) : []), [source])
  const active = useActiveHeading(headings)

  if (!meta || source === null) {
    return (
      <div className="py-24 text-center">
        <p className="text-brand font-mono text-sm font-semibold tracking-widest">404</p>
        <h1 className="mt-3 text-3xl font-semibold">No docs page here</h1>
        <p className="text-muted-foreground mt-3">It may have been renamed. Try the search, or start from the overview.</p>
        <Link to="/docs" className="text-brand mt-6 inline-flex items-center gap-1.5 font-medium hover:underline">
          <ArrowLeft className="size-4" /> Documentation home
        </Link>
      </div>
    )
  }

  const { prev, next } = neighbours(meta.slug)
  const minutes = Math.max(1, Math.round(source.split(/\s+/).length / 220))

  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1 pb-20">
        <nav aria-label="Breadcrumb" className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
          <Link to="/docs" className="hover:text-foreground">
            Docs
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-brand">{meta.section}</span>
        </nav>
        <h1 className="mt-3 text-3xl leading-tight font-semibold sm:text-[2.6rem]">{meta.title}</h1>
        <p className="text-muted-foreground font-reading mt-4 text-lg leading-relaxed">{meta.description}</p>
        <div className="text-muted-foreground mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-b pb-6 text-xs">
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" /> {minutes} min read
          </span>
          <a href={`${GITHUB_DOCS_EDIT_URL}/${meta.slug}.md`} target="_blank" rel="noopener" className="hover:text-foreground flex items-center gap-1.5">
            <PencilLine className="size-3.5" /> Edit this page
          </a>
        </div>

        <div className="mt-8">
          <DocMarkdown source={source} headings={headings} />
        </div>

        <div className="mt-16 grid gap-3 sm:grid-cols-2">
          {prev ? (
            <Link to={`/docs/${prev.slug}`} className="group hover:border-brand/40 rounded-xl border p-4 transition-colors">
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" /> Previous
              </span>
              <span className="mt-1 block font-semibold">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link to={`/docs/${next.slug}`} className="group hover:border-brand/40 rounded-xl border p-4 text-right transition-colors">
              <span className="text-muted-foreground flex items-center justify-end gap-1 text-xs">
                Next <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="mt-1 block font-semibold">{next.title}</span>
            </Link>
          ) : null}
        </div>
        <StarCard className="mt-10 xl:hidden" />
      </article>

      <aside className="hidden w-60 shrink-0 xl:block">
        <div className="sticky top-24 max-h-[calc(100dvh-7rem)] space-y-6 overflow-y-auto pb-6">
          <Toc headings={headings} active={active} />
          <StarCard />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="text-muted-foreground hover:text-foreground h-auto gap-1.5 px-0 text-xs font-medium hover:bg-transparent dark:hover:bg-transparent"
          >
            <ArrowUp className="size-3.5" /> Back to top
          </Button>
        </div>
      </aside>
    </div>
  )
}
