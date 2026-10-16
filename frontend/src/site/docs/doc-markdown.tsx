import { Children, isValidElement, useState } from "react"
import type { ReactElement, ReactNode } from "react"
import { Check, CircleAlert, Copy, Info, Lightbulb, Link2, OctagonAlert, TriangleAlert } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import Markdown from "react-markdown"
import { Link } from "react-router"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

import type { Heading } from "./catalog"

/* ---- GitHub-style callouts: "> [!NOTE]" ------------------------------------------------------- */

type CalloutKind = "note" | "tip" | "important" | "warning" | "caution"

const CALLOUTS: Record<CalloutKind, { label: string; icon: LucideIcon; className: string }> = {
  note: { label: "Note", icon: Info, className: "border-info/30 bg-info-soft/45 [--callout:var(--info)]" },
  tip: { label: "Tip", icon: Lightbulb, className: "border-success/30 bg-success-soft/45 [--callout:var(--success)]" },
  important: { label: "Important", icon: CircleAlert, className: "border-brand/30 bg-brand-soft/45 [--callout:var(--brand)]" },
  warning: { label: "Warning", icon: TriangleAlert, className: "border-warning/35 bg-warning-soft/45 [--callout:var(--warning)]" },
  caution: { label: "Caution", icon: OctagonAlert, className: "border-destructive/30 bg-destructive/8 [--callout:var(--destructive)]" },
}

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: { hName?: string; hProperties?: Record<string, string> }
}

/** Turns a blockquote that starts with [!KIND] into an <aside data-callout="kind">. */
function remarkCallouts() {
  const walk = (node: MdNode) => {
    if (node.type === "blockquote") {
      const paragraph = node.children?.[0]
      const text = paragraph?.type === "paragraph" ? paragraph.children?.[0] : undefined
      const match = text?.type === "text" ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i.exec(text.value ?? "") : null
      if (match && text && paragraph) {
        text.value = (text.value ?? "").slice(match[0].length)
        if (!text.value && paragraph.children?.length === 1) node.children?.shift()
        node.data = { hName: "aside", hProperties: { "data-callout": match[1].toLowerCase() } }
      }
    }
    node.children?.forEach(walk)
  }
  return (tree: MdNode) => walk(tree)
}

/* ---- Code blocks with a copy button --------------------------------------------------------- */

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ""
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const child = Children.toArray(children)[0] as ReactElement<{ className?: string; children?: ReactNode }> | undefined
  const language = /language-([\w-]+)/.exec(child?.props.className ?? "")?.[1]
  const code = textOf(child?.props.children).replace(/\n$/, "")
  return (
    <div className="group bg-surface my-6 overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between border-b px-4 py-1.5">
        <span className="text-muted-foreground font-mono text-[11px] font-medium tracking-wide uppercase">{language ?? "text"}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            })
          }}
          className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-sans text-xs transition-colors"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[0.84rem] leading-[1.75]">
        <code>{code.split("\n").map((line, i) => <CodeLine key={i} line={line} language={language} />)}</code>
      </pre>
    </div>
  )
}

/** Light highlighting that's safe for every language: comments and shell prompts. */
function CodeLine({ line, language }: { line: string; language?: string }) {
  const commentStart = ["bash", "sh", "shell", "env", "yaml", "yml", "powershell", "ini", "toml", "dotenv", "conf", "nginx", "caddy", "dockerfile"].includes(language ?? "")
    ? line.search(/(^|\s)#/)
    : -1
  if (commentStart >= 0) {
    return (
      <span className="block">
        {line.slice(0, commentStart)}
        <span className="text-muted-foreground italic">{line.slice(commentStart)}</span>
        {"\n"}
      </span>
    )
  }
  if (language === "env" || language === "dotenv") {
    const eq = line.indexOf("=")
    if (eq > 0) {
      return (
        <span className="block">
          <span className="text-foreground font-semibold">{line.slice(0, eq)}</span>
          <span className="text-muted-foreground">=</span>
          <span className="text-brand">{line.slice(eq + 1)}</span>
          {"\n"}
        </span>
      )
    }
  }
  return (
    <span className="block">
      {line}
      {"\n"}
    </span>
  )
}

/* ---- The renderer ---------------------------------------------------------------------------- */

export function DocMarkdown({ source, headings }: { source: string; headings: Heading[] }) {
  // Headings render in document order, so the i-th heading gets the i-th precomputed id.
  let next = 0
  const heading = (Tag: "h2" | "h3") =>
    function DocHeading({ children }: { children?: ReactNode }) {
      const id = headings[next++]?.id ?? undefined
      return (
        <Tag id={id}>
          {children}
          {id ? (
            <a href={`#${id}`} className="heading-anchor inline-flex align-middle" aria-label="Link to this section">
              <Link2 className="size-4" />
            </a>
          ) : null}
        </Tag>
      )
    }

  return (
    <div className="docs-prose">
      <Markdown
        remarkPlugins={[remarkGfm, remarkCallouts]}
        components={{
          h1: heading("h2"),
          h2: heading("h2"),
          h3: heading("h3"),
          a: ({ href = "", children }) => {
            if (href.startsWith("/") && !href.startsWith("//")) return <Link to={href}>{children}</Link>
            if (href.startsWith("#")) return <a href={href}>{children}</a>
            return (
              <a href={href} target="_blank" rel="noopener">
                {children}
              </a>
            )
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ children }) => (
            <div className="my-6 overflow-x-auto rounded-xl border">
              <table>{children}</table>
            </div>
          ),
          aside: ({ children, ...props }) => {
            const kind = ((props as Record<string, unknown>)["data-callout"] as CalloutKind | undefined) ?? "note"
            const callout = CALLOUTS[kind] ?? CALLOUTS.note
            const Icon = callout.icon
            return (
              <aside className={cn("my-6 rounded-xl border px-4 py-3.5 text-[0.95em] [&>p]:my-1.5", callout.className)}>
                <p className="mb-1 flex items-center gap-2 font-sans text-sm font-semibold text-[var(--callout)]">
                  <Icon className="size-4" /> {callout.label}
                </p>
                {children}
              </aside>
            )
          },
        }}
      >
        {source}
      </Markdown>
    </div>
  )
}
