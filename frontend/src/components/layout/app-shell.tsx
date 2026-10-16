import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import { Navigate, Outlet, useLocation, useMatch } from "react-router"

import { InvitationsDialog } from "@/components/invitations"
import { PlatformBanners } from "@/components/layout/platform-banners"
import { FullPageSpinner } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { useMe, useMyInvitations, useWorkspaces } from "@/hooks/api"
import { getLastWorkspace } from "@/lib/last-workspace"
import { NotFoundContent } from "@/routes/not-found"
import { useTheme } from "@/lib/theme"

import { AdminSidebar } from "./admin-sidebar"
import { AppSidebar } from "./app-sidebar"
import { BreadcrumbProvider, TopbarBreadcrumbs } from "./breadcrumbs"
import { CommandPaletteProvider, useCommandPalette } from "./command-palette"
import { NotificationsMenu } from "./notifications-menu"
import { UserMenu } from "./user-menu"

const PROMPTED_KEY = "dockwell-invitations-prompted"

function SearchButton() {
  const palette = useCommandPalette()
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <>
      <Button
        variant="outline"
        className="text-muted-foreground hidden h-9 w-64 justify-start gap-2 bg-surface-raised font-normal shadow-xs md:flex lg:w-80"
        onClick={palette.open}
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search...</span>
        <Kbd>{isMac ? "⌘" : "Ctrl"} K</Kbd>
      </Button>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={palette.open} aria-label="Search">
        <Search />
      </Button>
    </>
  )
}

function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md supports-backdrop-filter:bg-background/70 sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5" />
      <div className="min-w-0 flex-1">
        <TopbarBreadcrumbs />
      </div>
      <SearchButton />
      <NotificationsMenu />
      <UserMenu />
    </header>
  )
}

/** Show pending invitations once per sign-in session, after onboarding. */
function InvitationPrompt() {
  const { data: invitations } = useMyInvitations(true)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!invitations || invitations.length === 0) return
    let seen: string[] = []
    try {
      seen = JSON.parse(sessionStorage.getItem(PROMPTED_KEY) ?? "[]") as string[]
    } catch {
      seen = []
    }
    const fresh = invitations.filter((i) => !seen.includes(i.id))
    if (fresh.length === 0) return
    setOpen(true)
    try {
      sessionStorage.setItem(PROMPTED_KEY, JSON.stringify([...seen, ...fresh.map((i) => i.id)]))
    } catch {
      // Without storage we may prompt again next time; harmless.
    }
  }, [invitations])
  const pending = invitations ?? []
  return <InvitationsDialog open={open && pending.length > 0} onOpenChange={setOpen} invitations={pending} />
}

export function AppShell() {
  const match = useMatch("/w/:workspaceId/*")
  const adminMatch = useMatch("/admin/*")
  const { data: me } = useMe()
  const { data: workspaces } = useWorkspaces()
  const { setTheme } = useTheme()
  const syncedTheme = useRef(false)

  // The account's theme preference follows the user across devices.
  useEffect(() => {
    if (me && !syncedTheme.current) {
      syncedTheme.current = true
      setTheme(me.theme)
    }
  }, [me, setTheme])

  const known = (id: string | null | undefined) => (id && workspaces?.some((w) => w.id === id) ? id : null)
  const workspaceId =
    match?.params.workspaceId ??
    known(getLastWorkspace()) ??
    known(me?.default_workspace_id) ??
    workspaces?.[0]?.id ??
    null

  return (
    <BreadcrumbProvider>
      <CommandPaletteProvider workspaceId={workspaceId}>
        <SidebarProvider>
          {adminMatch ? <AdminSidebar /> : <AppSidebar workspaceId={workspaceId} />}
          <SidebarInset className="min-w-0">
            <Topbar />
            <PlatformBanners />
            <div className="flex-1">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
        <InvitationPrompt />
      </CommandPaletteProvider>
    </BreadcrumbProvider>
  )
}

/** Signed-in users only; sends first-time users through onboarding. */
export function RequireAuth() {
  const { data: me, isPending } = useMe()
  const location = useLocation()
  if (isPending) return <FullPageSpinner />
  if (!me) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} replace />
  }
  if (me.needs_onboarding && location.pathname !== "/onboarding") return <Navigate to="/onboarding" replace />
  return <Outlet />
}

/** Auth screens: bounce signed-in users into the app. */
export function PublicOnly() {
  const { data: me, isPending } = useMe()
  const location = useLocation()
  if (isPending) return <FullPageSpinner />
  // The verification link must work even if a different account is signed in.
  if (me && location.pathname !== "/verify-email") return <Navigate to="/app" replace />
  return <Outlet />
}

/** "/app" → the right place for this user. */
export function HomeRedirect() {
  const { data: me } = useMe()
  const { data: workspaces, isPending } = useWorkspaces()
  if (isPending) return <FullPageSpinner />
  const ids = new Set(workspaces?.map((w) => w.id))
  const last = getLastWorkspace()
  const target =
    (last && ids.has(last) ? last : null) ??
    (me?.default_workspace_id && ids.has(me.default_workspace_id) ? me.default_workspace_id : null) ??
    workspaces?.[0]?.id
  if (!target) return <Navigate to="/onboarding" replace />
  return <Navigate to={`/w/${target}`} replace />
}

/** Platform admins only (the API enforces this too; others see a 404). */
export function RequireAdmin() {
  const { data: me } = useMe()
  if (!me?.is_admin) return <NotFoundContent title="Page not found" />
  return <Outlet />
}
