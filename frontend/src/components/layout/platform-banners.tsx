import { useState } from "react"
import { AlertTriangle, FlaskConical, Info, Megaphone, Wrench, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useConfig } from "@/hooks/api"
import { cn } from "@/lib/utils"

const DISMISS_KEY = "dockwell-announcement-dismissed"

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

/** Site-wide notices: maintenance mode, the admin announcement and the demo notice. */
export function PlatformBanners() {
  const { data: config } = useConfig()
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)
  if (!config) return null
  const announcement = config.announcement
  const key = announcement ? `${announcement.level}:${announcement.message}` : null
  const dismiss = () => {
    if (!key) return
    setDismissed(key)
    try {
      sessionStorage.setItem(DISMISS_KEY, key)
    } catch {
      // Without storage it simply shows again next time.
    }
  }
  return (
    <>
      {config.maintenance_mode ? (
        <div className="bg-warning-soft text-warning flex items-center gap-2 border-b px-4 py-2 text-sm">
          <Wrench className="size-4 shrink-0" />
          <span className="text-foreground">{config.maintenance_message}</span>
        </div>
      ) : null}
      {announcement && dismissed !== key ? (
        <div
          className={cn(
            "flex items-center gap-2 border-b px-4 py-2 text-sm",
            announcement.level === "info" && "bg-info-soft",
            announcement.level === "warning" && "bg-warning-soft",
            announcement.level === "critical" && "bg-danger-soft",
          )}
        >
          {announcement.level === "info" ? (
            <Megaphone className="text-info size-4 shrink-0" />
          ) : announcement.level === "warning" ? (
            <Info className="text-warning size-4 shrink-0" />
          ) : (
            <AlertTriangle className="text-destructive size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            {announcement.message}
            {announcement.link ? (
              <a href={announcement.link} className="ml-2 font-medium underline underline-offset-2" target="_blank" rel="noopener noreferrer">
                Learn more
              </a>
            ) : null}
          </span>
          <Button variant="ghost" size="icon-xs" onClick={dismiss} aria-label="Dismiss announcement">
            <X />
          </Button>
        </div>
      ) : null}
      {config.demo_mode ? <DemoStrip /> : null}
    </>
  )
}

function DemoStrip() {
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem("dockwell-demo-strip") === "1"
    } catch {
      return false
    }
  })
  if (hidden) return null
  return (
    <div className="bg-brand-soft flex items-center gap-2 border-b px-4 py-2 text-sm">
      <FlaskConical className="text-brand size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        This is the public demo. Payments use Stripe test mode (card 4242 4242 4242 4242) and data may be reset.{" "}
        <a href="/docs/self-hosting" className="font-medium underline underline-offset-2">
          Self-host DockWell
        </a>
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss demo notice"
        onClick={() => {
          setHidden(true)
          try {
            sessionStorage.setItem("dockwell-demo-strip", "1")
          } catch {
            // Shows again next time.
          }
        }}
      >
        <X />
      </Button>
    </div>
  )
}
