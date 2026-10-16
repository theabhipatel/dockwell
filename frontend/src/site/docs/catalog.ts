/** The docs table of contents: metadata only (page content is loaded per page). */
import { BookOpen, Code2, CreditCard, Server, Users } from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface DocMeta {
  slug: string
  title: string
  description: string
  section: string
}

export interface DocSection {
  title: string
  icon: LucideIcon
  blurb: string
  pages: DocMeta[]
}

const section = (title: string, icon: LucideIcon, blurb: string, pages: Omit<DocMeta, "section">[]): DocSection => ({
  title,
  icon,
  blurb,
  pages: pages.map((p) => ({ ...p, section: title })),
})

export const DOC_SECTIONS: DocSection[] = [
  section("Getting started", BookOpen, "What DockWell is and how to make your first request.", [
    { slug: "introduction", title: "Introduction", description: "What DockWell is, who it is for, and the three ways to run it." },
    { slug: "quick-start", title: "Quick start", description: "Sign up, create an API key and send your first chat completion in minutes." },
    { slug: "core-concepts", title: "Core concepts", description: "Workspaces, projects, API keys, models, providers, credits and the gateway." },
  ]),
  section("Using the API", Code2, "The OpenAI-compatible API, streaming, limits and errors.", [
    { slug: "authentication", title: "Authentication and API keys", description: "Bearer authentication, key options, expiry, allowed models and limits." },
    { slug: "chat-completions", title: "Chat completions", description: "Chat completions, tools, completions, embeddings and listing models." },
    { slug: "streaming", title: "Streaming", description: "Server-sent events with usage in every stream, and how cancellation is charged." },
    { slug: "openai-sdks", title: "Using the OpenAI SDKs", description: "Python, JavaScript and curl: change only the base URL and key." },
    { slug: "models", title: "Models", description: "The model catalogue, capabilities, context length, deprecation and pricing." },
    { slug: "rate-limits", title: "Rate limits", description: "Requests and tokens per minute per key, project, workspace and platform, and spend limits." },
    { slug: "errors", title: "Errors", description: "OpenAI-format errors, every status and code DockWell returns, and how to retry." },
  ]),
  section("Accounts and billing", CreditCard, "Credits, payments, workspaces, roles and security.", [
    { slug: "billing-and-credits", title: "Billing and credits", description: "Pay-as-you-go credits, Stripe Checkout, auto recharge, limits, invoices and the ledger." },
    { slug: "workspaces-and-roles", title: "Workspaces and roles", description: "Workspaces, projects, members, invitations, roles, permissions, logs and account security." },
  ]),
  section("Self-hosting", Server, "Run DockWell on a GPU server, locally or as a demo.", [
    { slug: "self-hosting", title: "Self-hosting on a GPU server", description: "Docker Compose with vLLM, Postgres, nginx, Prometheus and Grafana on one server." },
    { slug: "running-locally", title: "Running locally on CPU", description: "One command with llama.cpp and a tiny model. No GPU needed." },
    { slug: "vercel-demo", title: "Deploying the demo on Vercel", description: "A public demo on Vercel and Neon with Groq as the provider." },
    { slug: "configuration", title: "Configuration reference", description: "Every environment variable and admin platform setting, with defaults." },
    { slug: "upgrading", title: "Upgrading", description: "Update a self-hosted install, a local checkout or the Vercel demo." },
  ]),
  section("Operating DockWell", Users, "The admin area and answers to common questions.", [
    { slug: "admin-guide", title: "Admin guide", description: "Users, workspaces, models, deployments, pricing, settings, billing and health." },
    { slug: "faq", title: "FAQ and troubleshooting", description: "Answers to common questions and fixes for common problems." },
  ]),
]

export const ALL_DOCS: DocMeta[] = DOC_SECTIONS.flatMap((s) => s.pages)

export function findDoc(slug: string | undefined): DocMeta | undefined {
  return ALL_DOCS.find((d) => d.slug === slug)
}

export function neighbours(slug: string): { prev?: DocMeta; next?: DocMeta } {
  const i = ALL_DOCS.findIndex((d) => d.slug === slug)
  return { prev: i > 0 ? ALL_DOCS[i - 1] : undefined, next: i >= 0 ? ALL_DOCS[i + 1] : undefined }
}

/** Markdown sources, one lazily loaded chunk per page. */
const sources = import.meta.glob<string>("./content/*.md", { query: "?raw", import: "default" })

export async function loadDocSource(slug: string): Promise<string | null> {
  const load = sources[`./content/${slug}.md`]
  return load ? load() : null
}

export interface Heading {
  depth: 2 | 3
  text: string
  id: string
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

/** Plain text of a markdown heading line (links and emphasis stripped). */
export function headingText(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim()
}

/** `##` and `###` headings, skipping fenced code blocks. Ids match the rendered heading ids. */
export function extractHeadings(source: string): Heading[] {
  const out: Heading[] = []
  const seen = new Map<string, number>()
  let fenced = false
  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced) continue
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!m) continue
    const text = headingText(m[2])
    out.push({ depth: m[1].length as 2 | 3, text, id: uniqueId(slugify(text), seen) })
  }
  return out
}

export function uniqueId(base: string, seen: Map<string, number>): string {
  const n = seen.get(base) ?? 0
  seen.set(base, n + 1)
  return n === 0 ? base : `${base}-${n}`
}
