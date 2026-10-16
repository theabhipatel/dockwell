import { useMemo } from "react"
import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import javascript from "highlight.js/lib/languages/javascript"
import python from "highlight.js/lib/languages/python"

import { CopyButton } from "@/components/copy-button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { curlSnippet, javascriptSnippet, pythonSnippet } from "@/lib/snippets"
import type { SnippetOptions } from "@/lib/snippets"
import { cn } from "@/lib/utils"

hljs.registerLanguage("bash", bash)
hljs.registerLanguage("python", python)
hljs.registerLanguage("javascript", javascript)

export function HighlightedCode({ code, language, className }: { code: string; language: string; className?: string }) {
  const html = useMemo(() => hljs.highlight(code, { language }).value, [code, language])
  return (
    <div className={cn("group/code bg-code text-code-foreground relative rounded-lg border", className)}>
      <pre className="overflow-x-auto p-4 pr-12 text-[0.8rem] leading-6">
        {/* highlight.js escapes the code; the markup contains only its own span tags. */}
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      <CopyButton value={code} label="Copy code" className="bg-background/70 absolute top-2 right-2 border" />
    </div>
  )
}

/** The same request as curl, Python and JavaScript (OpenAI SDKs with only the base URL changed). */
export function CodeSnippets({ options, className }: { options: SnippetOptions; className?: string }) {
  const tabs = [
    { value: "curl", label: "curl", language: "bash", code: curlSnippet(options) },
    { value: "python", label: "Python", language: "python", code: pythonSnippet(options) },
    { value: "javascript", label: "JavaScript", language: "javascript", code: javascriptSnippet(options) },
  ]
  return (
    <Tabs defaultValue="curl" className={className}>
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          <HighlightedCode code={t.code} language={t.language} />
        </TabsContent>
      ))}
    </Tabs>
  )
}
