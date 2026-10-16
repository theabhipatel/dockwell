import { ArrowLeft, BookOpen } from "lucide-react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"

import { SiteFooter } from "./site-footer"
import { SiteHeader } from "./site-header"

export function SiteNotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center px-4 py-24 text-center">
        <p className="text-brand font-mono text-sm font-semibold tracking-widest">404</p>
        <h1 className="mt-3 text-4xl font-semibold">This page doesn't exist</h1>
        <p className="text-muted-foreground mt-4">It may have moved. Try the docs, or head back home.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/">
              <ArrowLeft /> Home
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/docs">
              <BookOpen /> Documentation
            </Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
