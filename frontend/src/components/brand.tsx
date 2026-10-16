import { cn } from "@/lib/utils"

/** The DockWell mark: three stacked engine slots docked on a rounded tile. Colours come from the
 * theme tokens, so the mark follows light and dark mode (public/logo.svg is the static copy). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7 shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <rect x="7" y="8" width="18" height="4" rx="1.5" className="fill-primary-foreground" opacity="0.55" />
      <rect x="7" y="14" width="18" height="4" rx="1.5" className="fill-primary-foreground" opacity="0.8" />
      <rect x="7" y="20" width="12" height="4" rx="1.5" className="fill-primary-foreground" />
      <circle cx="23" cy="22" r="2.4" className="fill-brand" />
    </svg>
  )
}

export function Logo({ className, name = "DockWell" }: { className?: string; name?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-heading text-[1.05rem] font-semibold tracking-tight">{name}</span>
    </span>
  )
}
