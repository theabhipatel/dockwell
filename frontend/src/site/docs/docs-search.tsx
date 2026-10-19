import { useEffect, useState } from "react"
import { FileText, Hash, Search } from "lucide-react"
import { useNavigate } from "react-router"

import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"

import type { SearchEntry } from "./search-index"
import { Button } from "@/components/ui/button"

/** Opens the docs search with Ctrl/Cmd + K or "/". */
export function useDocsSearchShortcut(setOpen: (open: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setOpen])
}

export function SearchTrigger({ onOpen, className, large = false }: { onOpen: () => void; className?: string; large?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onOpen}
      className={cn(
        "bg-card dark:bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground hover:bg-card dark:hover:bg-card w-full justify-start gap-2 rounded-lg border text-left font-normal shadow-xs",
        large ? "h-12 px-4 text-base" : "h-9 px-3 text-sm",
        className,
      )}
    >
      <Search className={large ? "size-5" : "size-4"} />
      <span className="flex-1">Search the docs...</span>
      <kbd className="bg-muted hidden rounded px-1.5 py-0.5 font-mono text-[10px] font-medium sm:inline">Ctrl K</kbd>
    </Button>
  )
}

export function DocsSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<SearchEntry[] | null>(null)

  useEffect(() => {
    if (!open || entries) return
    void import("./search-index").then((m) => setEntries(m.SEARCH_INDEX))
  }, [open, entries])

  const groups = new Map<string, SearchEntry[]>()
  for (const entry of entries ?? []) {
    const list = groups.get(entry.section) ?? []
    list.push(entry)
    groups.set(entry.section, list)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search the docs" description="Find a page or a section" className="sm:max-w-xl">
      <Command>
        <CommandInput placeholder="Search pages and sections..." />
        <CommandList className="max-h-[min(60vh,28rem)]">
          <CommandEmpty>{entries ? "No results." : "Loading..."}</CommandEmpty>
          {[...groups.entries()].map(([section, items]) => (
            <CommandGroup key={section} heading={section}>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.title} ${item.page} ${item.keywords} ${item.id}`}
                  onSelect={() => {
                    onOpenChange(false)
                    navigate(item.href)
                  }}
                >
                  {item.kind === "page" ? <FileText className="text-brand" /> : <Hash className="text-muted-foreground" />}
                  <span className="truncate">{item.title}</span>
                  {item.kind === "heading" ? <span className="text-muted-foreground ml-auto truncate text-xs">{item.page}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
