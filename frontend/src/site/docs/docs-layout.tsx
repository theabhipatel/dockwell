import { useState } from "react"
import { Menu, Search } from "lucide-react"
import { NavLink, Outlet, useLocation } from "react-router"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import { SiteFooter } from "../components/site-footer"
import { DemoBanner } from "../components/demo-banner"
import { GitHubStarButton, SiteHeader } from "../components/site-header"
import { DOC_SECTIONS, findDoc } from "./catalog"
import { DocsSearch, SearchTrigger, useDocsSearchShortcut } from "./docs-search"

function DocsNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentation" className="space-y-7">
      {DOC_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="flex items-center gap-2 px-2 text-[13px] font-semibold">
            <section.icon className="text-brand size-4" /> {section.title}
          </p>
          <ul className="mt-2 space-y-0.5 border-l pl-0 ml-[1.05rem]">
            {section.pages.map((page) => (
              <li key={page.slug}>
                <NavLink
                  to={`/docs/${page.slug}`}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "-ml-px block border-l py-1.5 pr-2 pl-3.5 text-[13.5px] transition-colors",
                      isActive ? "border-brand text-brand font-medium" : "text-muted-foreground hover:text-foreground hover:border-foreground/30 border-transparent",
                    )
                  }
                >
                  {page.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function DocsLayout() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useDocsSearchShortcut(setSearchOpen)
  const current = findDoc(location.pathname.split("/")[2])

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <SiteHeader docs />
      {/* Mobile and tablet: section menu + search */}
      <div className="bg-background/95 sticky top-16 z-40 flex items-center gap-2 border-b px-4 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="hover:bg-muted flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium"
        >
          <Menu className="size-4 shrink-0" />
          <span className="truncate">{current ? current.title : "Documentation"}</span>
        </button>
        <button type="button" onClick={() => setSearchOpen(true)} className="hover:bg-muted rounded-lg p-2" aria-label="Search the docs">
          <Search className="size-4" />
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-[90rem] flex-1 gap-10 px-4 sm:px-6 lg:px-8">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-16 -mx-2 max-h-[calc(100dvh-4rem)] overflow-y-auto px-2 pt-8 pb-10">
            <SearchTrigger onOpen={() => setSearchOpen(true)} className="mb-7" />
            <DocsNav />
            <GitHubStarButton className="mt-8 w-full justify-center" />
          </div>
        </aside>
        <main className="min-w-0 flex-1 pt-8 lg:pt-10">
          <Outlet />
        </main>
      </div>
      <SiteFooter />

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-[85%] max-w-xs gap-0 overflow-y-auto p-0">
          <SheetHeader className="border-b">
            <SheetTitle>Documentation</SheetTitle>
          </SheetHeader>
          <div className="p-4">
            <DocsNav onNavigate={() => setMenuOpen(false)} />
            <GitHubStarButton className="mt-8 w-full justify-center" />
          </div>
        </SheetContent>
      </Sheet>
      <DocsSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}
