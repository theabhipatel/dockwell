import { useRef, useState } from "react"
import type { ReactNode } from "react"
import { Check, Copy } from "lucide-react"
import Markdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"

import { copyText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const SAFE_PROTOCOL = /^(https?:|mailto:|#|\/)/i

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await copyText(ref.current?.innerText ?? "")
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="group/code relative">
      <pre ref={ref}>{children}</pre>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => void copy()}
        aria-label="Copy code"
        className="bg-background/80 text-muted-foreground hover:text-foreground absolute top-2 right-2 size-7 rounded-md opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  )
}

/**
 * Renders untrusted markdown safely: raw HTML is never rendered (react-markdown default),
 * links are restricted to safe protocols and code blocks get highlighting and a copy button.
 */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn("prose-dw", className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        urlTransform={(url) => (SAFE_PROTOCOL.test(url.trim()) ? url : "")}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
          // External images would leak views to third parties and break the CSP; show links instead.
          img: ({ src, alt }) => (
            <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noopener noreferrer nofollow">
              {alt || "image"}
            </a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {source}
      </Markdown>
    </div>
  )
}
