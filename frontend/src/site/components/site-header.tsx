import { useEffect, useRef, useState } from "react"
import { ArrowRight, Menu, Star, X } from "lucide-react"
import { Link, useLocation } from "react-router"

import { Logo } from "@/components/brand"
import { cn } from "@/lib/utils"

import { APP_URL, DEMO_MODE, GITHUB_URL, LOGIN_URL, SIGNUP_URL } from "../config"
import { usePublicModels } from "../live-data"
import { useSignedIn } from "../site-root"
import { GitHubIcon } from "./github-icon"
import { ThemeToggle } from "./theme-toggle"

interface NavItem {
  href: string
  label: string
  /** Section id on the landing page, for the scroll spy. */
  section?: string
  site?: boolean
}

const NAV: NavItem[] = [
  { href: "/#features", label: "Features", section: "features" },
  { href: "/#how-it-works", label: "How it works", section: "how-it-works" },
  { href: "/pricing", label: "Pricing", site: true },
  { href: "/models", label: "Models", site: true },
  { href: "/docs", label: "Docs", site: true },
]

export function GitHubStarButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener"
      aria-label={compact ? "Star DockWell on GitHub" : undefined}
      className={cn(
        "group bg-card hover:border-foreground/25 inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium shadow-xs transition-colors",
        className,
      )}
    >
      <GitHubIcon className="size-4" />
      {compact ? null : <span>Star</span>}
      <Star className="text-warning size-3.5 transition-transform group-hover:scale-125 group-hover:rotate-12" />
    </a>
  )
}

/** The coral call to action: glows and nudges its arrow on hover. */
function CtaButton({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      className={cn(
        "group/cta bg-brand text-brand-foreground relative inline-flex h-9 items-center gap-1.5 overflow-hidden rounded-xl px-4 text-sm font-semibold",
        "shadow-[var(--glow-brand)] transition-[box-shadow,transform] hover:-translate-y-px",
        "hover:shadow-[var(--glow-brand-strong)]",
        className,
      )}
    >
      {/* Sheen that sweeps across on hover */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-white/25 opacity-0 transition-all duration-500 group-hover/cta:left-full group-hover/cta:opacity-100"
      />
      <span className="relative">{children}</span>
      <ArrowRight className="relative size-4 transition-transform group-hover/cta:translate-x-0.5" />
    </a>
  )
}

export function AuthActions({ stacked = false }: { stacked?: boolean }) {
  const signedIn = useSignedIn()
  if (signedIn) {
    return (
      <CtaButton href={APP_URL} className={stacked ? "w-full justify-center" : undefined}>
        Open app
      </CtaButton>
    )
  }
  return (
    <>
      <a
        href={LOGIN_URL}
        className={cn(
          "text-muted-foreground hover:text-foreground inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors",
          stacked && "bg-muted text-foreground flex-1 justify-center",
        )}
      >
        Sign in
      </a>
      <CtaButton href={SIGNUP_URL} className={stacked ? "flex-1 justify-center" : undefined}>
        {DEMO_MODE ? "Try the demo" : "Get started"}
      </CtaButton>
    </>
  )
}

/** How many models are serving right now, from the public catalogue. */
function LiveChip() {
  const { data } = usePublicModels()
  const live = data?.filter((m) => m.status === "ready" && !m.deprecated).length
  return (
    <Link
      to="/models"
      className="text-muted-foreground hover:text-foreground hover:border-brand/40 bg-background/60 inline-flex h-8 items-center gap-2 rounded-full border px-3 font-mono text-[11px] transition-colors"
    >
      <span className="relative flex size-2">
        <span className="bg-chart-5 absolute inline-flex size-full animate-ping rounded-full opacity-60" />
        <span className="bg-chart-5 relative inline-flex size-2 rounded-full" />
      </span>
      <span className="min-w-[6.5rem] tabular-nums">
        {live === undefined ? "models live" : `${live} ${live === 1 ? "model" : "models"} live`}
      </span>
    </Link>
  )
}

function useActiveItem(): string | null {
  const { pathname, hash } = useLocation()
  const [section, setSection] = useState<string | null>(null)

  useEffect(() => {
    if (pathname !== "/") return
    const ids = NAV.flatMap((item) => (item.section ? [item.section] : []))
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null)
    if (els.length === 0) return
    const onScroll = () => {
      // The last section whose top has passed the upper third of the screen.
      const line = window.innerHeight / 3
      let current: string | null = null
      for (const el of els) {
        const rect = el.getBoundingClientRect()
        if (rect.top <= line && rect.bottom > 80) current = el.id
      }
      setSection(current)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [pathname, hash])

  if (pathname === "/") return section ? `/#${section}` : null
  const match = NAV.find((item) => item.site && (pathname === item.href || pathname.startsWith(`${item.href}/`)))
  return match?.href ?? null
}

function NavLink({
  item,
  className,
  onClick,
  ...rest
}: { item: NavItem; className?: string; onClick?: () => void } & React.HTMLAttributes<HTMLElement>) {
  if (item.site) {
    return (
      <Link to={item.href} className={className} onClick={onClick} {...rest}>
        {item.label}
      </Link>
    )
  }
  return (
    <a href={item.href} className={className} onClick={onClick} {...rest}>
      {item.label}
    </a>
  )
}

/** Desktop links with a highlight that glides to the hovered link, and a coral dot under the
 * page or landing section you are on. */
function DesktopNav() {
  const active = useActiveItem()
  const listRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ left: number; width: number } | null>(null)

  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    const list = listRef.current
    if (!list) return
    const a = e.currentTarget.getBoundingClientRect()
    const b = list.getBoundingClientRect()
    setHover({ left: a.left - b.left, width: a.width })
  }

  return (
    <nav aria-label="Main" className="hidden lg:block">
      <div ref={listRef} className="relative flex items-center" onMouseLeave={() => setHover(null)}>
        <span
          aria-hidden="true"
          className="bg-brand/10 dark:bg-brand/15 absolute inset-y-0 rounded-lg transition-all duration-300 ease-out"
          style={{ left: hover?.left ?? 0, width: hover?.width ?? 0, opacity: hover ? 1 : 0 }}
        />
        {NAV.map((item) => {
          const isActive = active === item.href
          return (
            <NavLink
              key={item.href}
              item={item}
              onMouseEnter={onEnter}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            />
          )
        })}
        {NAV.map((item) => (active === item.href ? <ActiveDot key={item.href} listRef={listRef} href={item.href} /> : null))}
      </div>
    </nav>
  )
}

/** Positions the coral dot under the active link once it has been laid out. */
function ActiveDot({ listRef, href }: { listRef: React.RefObject<HTMLDivElement | null>; href: string }) {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    const place = () => {
      const list = listRef.current
      const link = list?.querySelector<HTMLElement>(`[href="${href}"]`)
      if (!list || !link) return
      const a = link.getBoundingClientRect()
      setLeft(a.left - list.getBoundingClientRect().left + a.width / 2)
    }
    place()
    window.addEventListener("resize", place)
    return () => window.removeEventListener("resize", place)
  }, [listRef, href])
  if (left === null) return null
  return (
    <span
      aria-hidden="true"
      className="bg-brand absolute -bottom-1 size-1 -translate-x-1/2 rounded-full shadow-[0_0_8px_var(--brand)] transition-[left] duration-300"
      style={{ left }}
    />
  )
}

export function SiteHeader({ docs = false }: { docs?: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const progressRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8)
      const max = document.documentElement.scrollHeight - window.innerHeight
      progressRef.current?.style.setProperty("--progress", String(max > 0 ? Math.min(window.scrollY / max, 1) : 0))
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const compact = scrolled && !docs

  return (
    // Always 4rem tall: the docs sidebars stick right below it.
    <header className="sticky top-0 z-50 h-16 px-3 pt-2.5 sm:px-4">
      <div
        className={cn(
          "relative mx-auto flex h-12 items-center gap-3 rounded-2xl border pr-2 pl-3 transition-all duration-500 ease-out",
          "bg-background/70 supports-[backdrop-filter]:bg-background/55 backdrop-blur-xl backdrop-saturate-150",
          docs ? "max-w-[90rem]" : compact ? "max-w-5xl" : "max-w-7xl",
          scrolled || docs || open
            ? "border-border shadow-[0_10px_30px_-12px_rgb(0_0_0/0.25)] dark:shadow-[0_10px_30px_-12px_rgb(0_0_0/0.7)]"
            : "border-border/60 shadow-none",
        )}
      >
        <Link to="/" className="rounded-lg" aria-label="DockWell home" onClick={() => setOpen(false)}>
          <Logo />
        </Link>
        {docs ? <span className="bg-brand-soft text-brand rounded-md px-2 py-0.5 text-xs font-semibold">Docs</span> : null}

        <span aria-hidden="true" className="bg-border mx-1 hidden h-5 w-px lg:block" />
        <DesktopNav />

        <div className="ml-auto hidden items-center gap-1.5 md:flex">
          <span className={cn("hidden transition-opacity xl:block", compact && "xl:hidden")}>
            <LiveChip />
          </span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener"
            aria-label="DockWell on GitHub"
            className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-9 items-center justify-center rounded-lg transition-colors"
          >
            <GitHubIcon className="size-[18px]" />
          </a>
          <ThemeToggle />
          <span aria-hidden="true" className="bg-border mx-1 h-5 w-px" />
          <AuthActions />
        </div>

        <div className="ml-auto flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            className="hover:bg-muted inline-flex size-9 items-center justify-center rounded-lg"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {/* Reading progress along the bottom edge */}
        <span
          ref={progressRef}
          aria-hidden="true"
          className="header-progress pointer-events-none absolute inset-x-5 -bottom-px h-[2px] origin-left rounded-full"
        />
      </div>

      {open ? (
        <div className="bg-background/95 mx-auto mt-2 max-w-7xl rounded-2xl border p-2 shadow-lg backdrop-blur-xl md:hidden">
          <nav className="grid grid-cols-2 gap-1" aria-label="Mobile">
            {NAV.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                onClick={() => setOpen(false)}
                className="hover:bg-muted rounded-xl px-3 py-3 text-sm font-medium"
              />
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener"
              className="hover:bg-muted inline-flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-medium"
            >
              <GitHubIcon className="size-4" /> GitHub
            </a>
          </nav>
          <div className="mt-2 flex items-center gap-2 border-t p-2 pt-3">
            <AuthActions stacked />
          </div>
        </div>
      ) : null}
    </header>
  )
}
