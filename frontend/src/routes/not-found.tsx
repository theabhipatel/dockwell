import { ArrowLeft, Compass } from "lucide-react"
import { Link } from "react-router"

import { Logo } from "@/components/brand"
import { Button } from "@/components/ui/button"

export function NotFoundContent({
  title = "Page not found",
  description = "The page you're looking for doesn't exist, or you don't have access to it.",
}: {
  title?: string
  description?: string
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="relative mb-8">
        <div className="bg-grid absolute -inset-10 rounded-full [mask-image:radial-gradient(circle,black,transparent_70%)]" aria-hidden="true" />
        <span className="relative flex size-16 items-center justify-center rounded-2xl bg-card text-brand shadow-md ring-1 ring-border">
          <Compass className="size-7" />
        </span>
      </div>
      <p className="font-mono text-sm font-semibold tracking-widest text-brand">404</p>
      <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
      <p className="text-muted-foreground mt-3 max-w-md text-sm leading-relaxed">{description}</p>
      <Button className="mt-8" asChild>
        <Link to="/app">
          <ArrowLeft /> Back to your workspace
        </Link>
      </Button>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <div className="bg-glow flex min-h-dvh flex-col">
      <header className="px-4 py-5 sm:px-8">
        <a href="/" className="inline-flex rounded-lg">
          <Logo />
        </a>
      </header>
      <NotFoundContent />
    </div>
  )
}
