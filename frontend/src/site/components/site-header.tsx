import { useEffect, useState } from "react"
import { ArrowRight, Menu, Star, X } from "lucide-react"
import { Link } from "react-router"

import { Logo } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { APP_URL, DEMO_MODE, GITHUB_URL, LOGIN_URL, SIGNUP_URL } from "../config"
import { useSignedIn } from "../site-root"
import { GitHubIcon } from "./github-icon"
import { ThemeToggle } from "./theme-toggle"

const NAV = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/models", label: "Models" },
]

export function GitHubStarButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener"
      className={cn(
        "group bg-card hover:border-foreground/25 inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium shadow-xs transition-colors",
        className,
      )}
    >
      <GitHubIcon className="size-4" />
      {compact ? null : <span>Star</span>}
      <Star className="size-3.5 text-warning transition-transform group-hover:scale-125 group-hover:rotate-12" />
    </a>
  )
}

export function AuthActions({ size = "sm" }: { size?: "sm" | "default" }) {
  const signedIn = useSignedIn()
  if (signedIn) {
    return (
      <Button size={size} asChild>
        <a href={APP_URL}>
          Open app <ArrowRight />
        </a>
      </Button>
    )
  }
  return (
    <>
      <Button size={size} variant="ghost" asChild>
        <a href={LOGIN_URL}>Sign in</a>
      </Button>
      <Button size={size} asChild>
        <a href={SIGNUP_URL}>
          {DEMO_MODE ? "Try the demo" : "Get started"} <ArrowRight />
        </a>
      </Button>
    </>
  )
}

export function SiteHeader({ docs = false }: { docs?: boolean }) {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-[background-color,border-color,box-shadow] duration-300",
        scrolled || docs || open ? "border-border bg-background/92 shadow-xs" : "border-transparent bg-transparent",
      )}
    >
      <div className={cn("mx-auto flex h-16 items-center gap-4 px-4 sm:px-6", docs ? "max-w-[90rem] lg:px-8" : "max-w-7xl")}>
        <Link to="/" className="rounded-lg" aria-label="DockWell home" onClick={() => setOpen(false)}>
          <Logo />
        </Link>
        {docs ? (
          <span className="bg-brand-soft text-brand -ml-1 rounded-md px-2 py-0.5 text-xs font-semibold">Docs</span>
        ) : null}
        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-2 text-sm font-medium transition-colors"
            >
              {item.label}
            </a>
          ))}
          <Link
            to="/docs"
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              docs ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Docs
          </Link>
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <GitHubStarButton />
          <ThemeToggle />
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
      </div>
      {open ? (
        <div className="border-t md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3" aria-label="Mobile">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setOpen(false)} className="hover:bg-muted rounded-lg px-3 py-2.5 text-sm font-medium">
                {item.label}
              </a>
            ))}
            <Link to="/docs" onClick={() => setOpen(false)} className="hover:bg-muted rounded-lg px-3 py-2.5 text-sm font-medium">
              Docs
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-3">
              <GitHubStarButton />
              <AuthActions />
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  )
}
