import { useEffect, useState } from "react"
import { Check, Monitor, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/** Same key and values as the app (lib/theme.tsx) and public/theme-init.js. */
const STORAGE_KEY = "dockwell-theme"
const DARK_QUERY = "(prefers-color-scheme: dark)"

type Preference = "light" | "dark" | "system"

const OPTIONS: { value: Preference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

function readStored(): Preference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === "light" || value === "dark") return value
  } catch {
    // Storage unavailable (privacy mode): follow the system.
  }
  return "system"
}

function apply(pref: Preference) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia(DARK_QUERY).matches)
  const root = document.documentElement
  root.classList.toggle("dark", dark)
  root.style.colorScheme = dark ? "dark" : "light"
}

/** Light, dark or system theme. The icon swaps with CSS, so the pre-rendered HTML always matches. */
export function ThemeToggle({ className }: { className?: string }) {
  // Starts as "system" on the server and before mount; the real choice is read on open.
  const [pref, setPref] = useState<Preference>("system")

  // While following the system, react when the OS switches between light and dark.
  useEffect(() => {
    if (readStored() !== "system") return
    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      if (readStored() === "system") apply("system")
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [pref])

  const choose = (next: Preference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Preference only.
    }
    apply(next)
    setPref(next)
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && setPref(readStored())}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Change theme"
          className={cn("text-muted-foreground hover:text-foreground hover:bg-muted size-9 rounded-lg", className)}
        >
          <Sun className="size-[18px] dark:hidden" />
          <Moon className="hidden size-[18px] dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {OPTIONS.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => choose(o.value)}>
            <o.icon />
            {o.label}
            {pref === o.value ? <Check className="ml-auto" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
