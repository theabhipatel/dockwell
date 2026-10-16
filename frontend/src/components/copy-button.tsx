import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copyText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

interface CopyButtonProps {
  value: string
  label?: string
  secret?: boolean
  className?: string
  size?: "icon-xs" | "icon-sm" | "icon"
}

/** Copies a key, id or snippet. Secrets are cleared from the clipboard after 30 seconds. */
export function CopyButton({ value, label = "Copy", secret = false, className, size = "icon-sm" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await copyText(value, { secret })
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.")
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          className={cn("text-muted-foreground hover:text-foreground shrink-0", className)}
          onClick={() => void copy()}
          aria-label={label}
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  )
}

/** A monospace value (id, key prefix, URL) with a copy button next to it. */
export function CopyField({ value, display, secret = false, className }: { value: string; display?: string; secret?: boolean; className?: string }) {
  return (
    <span className={cn("bg-muted/60 inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2", className)}>
      <code className="truncate text-xs">{display ?? value}</code>
      <CopyButton value={value} secret={secret} size="icon-xs" />
    </span>
  )
}
