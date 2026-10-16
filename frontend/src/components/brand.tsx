import { useId } from "react"

import { cn } from "@/lib/utils"

/** The DockWell mark: a white "D" with a docking port in its stem around a glowing core (the
 * model being served) on a charcoal tile. The core is the theme's coral (--brand-bright), so the
 * mark looks the same in light and dark mode. public/logo.svg is the static copy. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7 shrink-0", className)} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1f1f25" />
          <stop offset="1" stopColor="#0c0c10" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-2" y="-2" width="5" height="5">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}-tile)`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill={`url(#${id}-sheen)`} stroke="#fff" strokeOpacity="0.16" />
      <path
        d="M10.5 13V8.5H16a7.5 7.5 0 0 1 0 15h-5.5V19"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16.6" cy="16" r="3.2" className="fill-brand-bright" opacity="0.75" filter={`url(#${id}-glow)`} />
      <circle cx="16.6" cy="16" r="2.5" className="fill-brand-bright" />
    </svg>
  )
}

export function Logo({ className, name = "DockWell" }: { className?: string; name?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="font-heading text-[1.05rem] font-semibold tracking-tight">{name}</span>
    </span>
  )
}
