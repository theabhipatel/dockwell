import { useState } from "react"
import { Link } from "react-router"
import { ArrowUp, ArrowUpRight, Check, Cloud, Copy, Cpu, Server } from "lucide-react"

import { LogoMark } from "@/components/brand"
import { copyText } from "@/lib/clipboard"

import { AUTHOR, GITHUB_URL, SITE_URL } from "../config"
import { usePublicConfig } from "../live-data"
import { DevelopedBy } from "./developed-by"
import { GitHubIcon } from "./github-icon"

const YEAR = new Date().getFullYear()

interface FooterLink {
  label: string
  href: string
  site?: boolean
}

const BERTHS: { code: string; title: string; links: FooterLink[] }[] = [
  {
    code: "B-01",
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Pricing", href: "/pricing", site: true },
      { label: "Models", href: "/models", site: true },
      { label: "Self-host", href: "/#self-host" },
    ],
  },
  {
    code: "B-02",
    title: "Docs",
    links: [
      { label: "Quick start", href: "/docs/quick-start", site: true },
      { label: "OpenAI SDKs", href: "/docs/openai-sdks", site: true },
      { label: "Self-host on a GPU", href: "/docs/self-hosting", site: true },
      {
        label: "Run locally on CPU",
        href: "/docs/running-locally",
        site: true,
      },
    ],
  },
  {
    code: "B-03",
    title: "Open source",
    links: [
      { label: "GitHub repository", href: GITHUB_URL },
      { label: "Report an issue", href: `${GITHUB_URL}/issues` },
      { label: "Privacy policy", href: "/privacy", site: true },
      { label: "Terms of service", href: "/terms", site: true },
    ],
  },
]

/** The three ways to run DockWell, each with its own guide. */
const ROUTES = [
  {
    icon: Cpu,
    title: "Local CPU",
    engine: "llama.cpp",
    href: "/docs/running-locally",
  },
  {
    icon: Server,
    title: "GPU server",
    engine: "vLLM",
    href: "/docs/self-hosting",
  },
  {
    icon: Cloud,
    title: "Serverless demo",
    engine: "Groq",
    href: "/docs/vercel-demo",
  },
]

/** Containers on the dock: popular open models, sized like 20 ft and 40 ft boxes. */
const CARGO: { name: string; tag: string; tone: number; long?: boolean }[] = [
  { name: "llama-3.1-8b", tag: "128k ctx", tone: 1, long: true },
  { name: "qwen2.5-7b", tag: "32k ctx", tone: 2 },
  { name: "mistral-7b", tag: "32k ctx", tone: 3 },
  { name: "gemma-2-9b", tag: "8k ctx", tone: 4, long: true },
  { name: "phi-3.5-mini", tag: "128k ctx", tone: 5 },
  { name: "deepseek-r1-distill", tag: "reasoning", tone: 1, long: true },
  { name: "qwen2.5-coder", tag: "code", tone: 3 },
  { name: "llama-3.3-70b", tag: "vLLM", tone: 2, long: true },
  { name: "qwen2.5-0.5b", tag: "CPU", tone: 4 },
]

function Container({ name, tag, tone, long }: (typeof CARGO)[number]) {
  return (
    <div className={long ? "cargo w-60" : "cargo w-40"} style={{ "--tone": `var(--chart-${tone})` } as React.CSSProperties}>
      <span className="bg-background/90 text-foreground absolute top-1/2 left-3 -translate-y-1/2 rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] leading-tight shadow-sm">
        <span className="block font-semibold">{name}</span>
        <span className="text-muted-foreground block">{tag}</span>
      </span>
    </div>
  )
}

/** A quay with containers gliding past and water below. Decorative only. */
function Dock() {
  return (
    <div className="dock relative overflow-hidden pt-10" aria-hidden="true">
      <div className="dock-track flex w-max items-end gap-3 pr-3">
        {[...CARGO, ...CARGO].map((item, i) => (
          <Container key={i} {...item} />
        ))}
      </div>
      <div className="quay relative h-3" />
      <svg className="dock-water text-brand block h-6 w-[200%]" viewBox="0 0 1200 24" preserveAspectRatio="none">
        <path
          d="M0 8 Q 37.5 2 75 8 T 150 8 T 225 8 T 300 8 T 375 8 T 450 8 T 525 8 T 600 8 T 675 8 T 750 8 T 825 8 T 900 8 T 975 8 T 1050 8 T 1125 8 T 1200 8"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M0 18 Q 37.5 13 75 18 T 150 18 T 225 18 T 300 18 T 375 18 T 450 18 T 525 18 T 600 18 T 675 18 T 750 18 T 825 18 T 900 18 T 975 18 T 1050 18 T 1125 18 T 1200 18"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}

/** Deterministic bar widths, so the server render and the browser match. */
const BARCODE = Array.from("DOCKWELL/V1/MIT", (ch, i) => [((ch.charCodeAt(0) + i) % 3) + 1, ((ch.charCodeAt(0) * 7 + i) % 3) + 1])

function Barcode() {
  return (
    <div className="flex h-9 items-stretch gap-[2px]" aria-hidden="true">
      {BARCODE.map(([bar, gap], i) => (
        <span key={i} className="bg-foreground/80" style={{ width: bar * 1.5, marginRight: gap - 1 }} />
      ))}
    </div>
  )
}

function ManifestRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 py-2">
      <dt className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

/** A cargo manifest that carries the real API address of this deployment. */
function Manifest() {
  const config = usePublicConfig()
  const baseUrl = config.data?.api_base_url ?? `${SITE_URL}/v1`
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await copyText(baseUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked: the address stays selectable.
    }
  }

  return (
    <div className="manifest bg-card text-card-foreground relative rounded-2xl border shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <span className="font-mono text-[11px] font-semibold tracking-[0.2em] uppercase">Cargo manifest</span>
        <span className="text-muted-foreground font-mono text-[11px]">No. DW-{YEAR}</span>
      </div>
      <div className="manifest-perforation relative mx-5 border-t border-dashed" />
      <dl className="divide-border/60 divide-y px-5 py-2">
        <ManifestRow label="Port of call">
          <span className="flex items-center gap-2">
            <code className="truncate font-mono text-[13px]">{baseUrl}</code>
            <button
              type="button"
              onClick={() => void copy()}
              className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
              aria-label="Copy the API base URL"
            >
              {copied ? <Check className="text-brand size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </span>
        </ManifestRow>
        <ManifestRow label="Protocol">OpenAI-compatible, streaming included</ManifestRow>
        <ManifestRow label="Cargo">Open source models on vLLM or llama.cpp</ManifestRow>
        <ManifestRow label="Licence">MIT, free to self-host</ManifestRow>
      </dl>
      <div className="flex items-end justify-between gap-4 border-t border-dashed px-5 py-4">
        <span className="inline-flex items-center gap-2 text-xs font-medium">
          <span className="relative flex size-2">
            <span className="bg-chart-5 absolute inline-flex size-full animate-ping rounded-full opacity-60" />
            <span className="bg-chart-5 relative inline-flex size-2 rounded-full" />
          </span>
          Docked and serving
        </span>
        <Barcode />
      </div>
    </div>
  )
}

function BerthLink({ link }: { link: FooterLink }) {
  const className = "group/link text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
  const arrow = (
    <ArrowUpRight className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover/link:translate-x-0 group-hover/link:opacity-100" />
  )
  if (link.site) {
    return (
      <Link to={link.href} className={className}>
        {link.label}
        {arrow}
      </Link>
    )
  }
  const external = link.href.startsWith("http")
  return (
    <a href={link.href} {...(external ? { target: "_blank", rel: "noopener" } : {})} className={className}>
      {link.label}
      {arrow}
    </a>
  )
}

export function SiteFooter() {
  return (
    <footer className="bg-background text-foreground relative border-t">
      <Dock />

      <div className="bg-muted/30 relative">
        <div
          className="site-dots pointer-events-none absolute inset-0 opacity-50 mask-[linear-gradient(to_bottom,black,transparent_70%)]"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <div className="space-y-8">
              <div className="space-y-4">
                <Link to="/" className="inline-flex items-center gap-3">
                  <LogoMark className="size-9" />
                  <span className="font-heading text-xl font-semibold tracking-tight">DockWell</span>
                </Link>
                <p className="font-heading text-2xl leading-snug font-semibold tracking-tight text-balance sm:text-[1.7rem]">
                  Your models, <span className="text-gradient-brand">docked and served.</span>
                </p>
                <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
                  Self-hosted serving for open source AI models behind an OpenAI-compatible API, with accounts, keys, usage, billing and
                  monitoring built in.
                </p>
              </div>
              <Manifest />
            </div>

            <div className="flex flex-col justify-between gap-12">
              <div className="space-y-12">
                <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3">
                  {BERTHS.map((berth) => (
                    <div key={berth.code} className="border-l pl-4">
                      <p className="text-brand font-mono text-[10.5px] font-semibold tracking-[0.18em]">{berth.code}</p>
                      <h3 className="mt-1 font-sans text-sm font-semibold">{berth.title}</h3>
                      <ul className="mt-4 space-y-2.5">
                        {berth.links.map((link) => (
                          <li key={link.label}>
                            <BerthLink link={link} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </nav>

                <div>
                  <p className="text-muted-foreground font-mono text-[10.5px] font-semibold tracking-[0.18em] uppercase">Shipping routes</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {ROUTES.map((route) => (
                      <Link
                        key={route.href}
                        to={route.href}
                        className="group bg-card hover:border-brand/50 flex items-center gap-3 rounded-xl border p-3 transition-colors"
                      >
                        <span className="bg-brand-soft text-brand flex size-9 shrink-0 items-center justify-center rounded-lg">
                          <route.icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{route.title}</span>
                          <span className="text-muted-foreground block font-mono text-[11px]">{route.engine}</span>
                        </span>
                        <ArrowUpRight className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors" />
                      </Link>
                    ))}
                  </div>
                </div>
              </div>

              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener"
                className="group bg-card hover:border-brand/50 flex items-center gap-4 rounded-2xl border p-5 transition-colors"
              >
                <span className="bg-foreground text-background flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <GitHubIcon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Built in the open</span>
                  <span className="text-muted-foreground block text-sm">
                    Read the code, open an issue or send a pull request. A star helps others find it.
                  </span>
                </span>
                <ArrowUpRight className="text-muted-foreground group-hover:text-foreground size-5 shrink-0 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-dashed">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row md:items-center md:justify-between">
          <p className="text-muted-foreground text-xs leading-relaxed">
            © {YEAR} DockWell by{" "}
            <a href={AUTHOR.url} target="_blank" rel="noopener author" className="hover:text-foreground underline-offset-4 hover:underline">
              {AUTHOR.name} ({AUTHOR.fullName})
            </a>
            . Open source under the MIT licence.
          </p>
          <div className="flex items-center justify-between gap-6 md:justify-end">
            <a
              href="#top"
              onClick={(e) => {
                e.preventDefault()
                window.scrollTo({ top: 0, behavior: "smooth" })
              }}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors"
            >
              <ArrowUp className="size-3.5" /> Back to top
            </a>
            <DevelopedBy />
          </div>
        </div>
      </div>
    </footer>
  )
}
