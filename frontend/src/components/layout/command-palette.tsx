import { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  CreditCard,
  Folder,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Monitor,
  Moon,
  ScrollText,
  Settings,
  Shield,
  ShieldHalf,
  Sun,
  UserRound,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useNavigate } from "react-router"

import { SignOutDialog } from "@/components/sign-out-dialog"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { useApiKeys, useMe, useProjects, useWorkspace, useWorkspaceModels } from "@/hooks/api"
import { useSetTheme } from "@/hooks/session"
import { Perm, can } from "@/lib/permissions"

interface PaletteState {
  open: () => void
}

const PaletteContext = createContext<PaletteState | null>(null)

export function useCommandPalette(): PaletteState {
  const ctx = useContext(PaletteContext)
  if (!ctx) throw new Error("useCommandPalette must be used inside CommandPaletteProvider")
  return ctx
}

interface StaticItem {
  id: string
  label: string
  icon: LucideIcon
  run: () => void
  keywords?: string
  visible?: boolean
}

function matches(item: { label: string; keywords?: string }, q: string): boolean {
  if (!q) return true
  return `${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(q.toLowerCase())
}

/** Ctrl/Cmd + K: jump to pages, projects, API keys and models. */
export function CommandPaletteProvider({ workspaceId, children }: { workspaceId: string | null; children: ReactNode }) {
  const [isOpen, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const navigate = useNavigate()
  const setTheme = useSetTheme()
  const [signingOut, setSigningOut] = useState(false)
  const { data: me } = useMe()
  const { data: workspace } = useWorkspace(workspaceId ?? undefined)
  const { data: projects } = useProjects(isOpen ? (workspaceId ?? undefined) : undefined)
  const { data: keys } = useApiKeys(isOpen ? (workspaceId ?? undefined) : undefined)
  const { data: models } = useWorkspaceModels(isOpen ? (workspaceId ?? undefined) : undefined)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const run = (fn: () => void) => {
    setOpen(false)
    setQuery("")
    fn()
  }

  const base = workspaceId ? `/w/${workspaceId}` : null
  const perms = workspace?.permissions
  const go = (path: string) => () => navigate(path)
  const navItems: StaticItem[] = [
    ...(base
      ? [
          { id: "dash", label: "Dashboard", icon: LayoutDashboard, run: go(base) },
          { id: "play", label: "Playground", icon: MessageSquareText, keywords: "chat try", run: go(`${base}/playground`), visible: can(perms, Perm.usePlayground) },
          { id: "keys", label: "API keys", icon: KeyRound, keywords: "token secret", run: go(`${base}/api-keys`) },
          { id: "projects", label: "Projects", icon: FolderKanban, run: go(`${base}/projects`) },
          { id: "usage", label: "Usage", icon: BarChart3, keywords: "tokens cost charts", run: go(`${base}/usage`), visible: can(perms, Perm.viewUsage) },
          { id: "logs", label: "Request logs", icon: ScrollText, run: go(`${base}/logs`), visible: can(perms, Perm.viewLogs) },
          { id: "activity", label: "Activity log", icon: Activity, keywords: "audit", run: go(`${base}/activity`), visible: can(perms, Perm.viewAudit) },
          {
            id: "billing",
            label: "Billing and credits",
            icon: CreditCard,
            keywords: "add credits payments invoices",
            run: go(`${base}/billing`),
            visible: can(perms, Perm.viewBilling) || can(perms, Perm.manageBilling),
          },
          { id: "members", label: "Members", icon: Users, keywords: "people team invite", run: go(`${base}/members`) },
          { id: "roles", label: "Roles and permissions", icon: ShieldHalf, run: go(`${base}/roles`), visible: can(perms, Perm.manageRoles) || can(perms, Perm.changeRoles) },
          { id: "ws-settings", label: "Workspace settings", icon: Settings, run: go(`${base}/settings`) },
        ]
      : []),
    { id: "profile", label: "Account settings", icon: UserRound, keywords: "profile password sessions 2fa", run: go("/settings/profile") },
    { id: "notifications", label: "Notifications", icon: Bell, run: go("/notifications") },
    { id: "admin", label: "Admin area", icon: Shield, run: go("/admin"), visible: Boolean(me?.is_admin) },
  ]
  const actionItems: StaticItem[] = [
    { id: "light", label: "Switch to light theme", icon: Sun, keywords: "appearance", run: () => setTheme("light") },
    { id: "dark", label: "Switch to dark theme", icon: Moon, keywords: "appearance", run: () => setTheme("dark") },
    { id: "system", label: "Use system theme", icon: Monitor, keywords: "appearance", run: () => setTheme("system") },
    { id: "signout", label: "Sign out", icon: LogOut, run: () => setSigningOut(true) },
  ]

  const visibleNav = navItems.filter((i) => i.visible !== false && matches(i, query))
  const visibleActions = actionItems.filter((i) => i.visible !== false && matches(i, query))
  const limit = query ? 8 : 4
  const foundProjects = (projects ?? []).filter((p) => matches({ label: p.name }, query)).slice(0, limit)
  const foundKeys = (keys ?? []).filter((k) => matches({ label: k.name, keywords: `${k.display} ${k.project_name}` }, query)).slice(0, limit)
  const foundModels = (models ?? []).filter((m) => matches({ label: m.name, keywords: m.id }, query)).slice(0, limit)
  const nothing = visibleNav.length + visibleActions.length + foundProjects.length + foundKeys.length + foundModels.length === 0

  const ctx = useMemo(() => ({ open: () => setOpen(true) }), [])

  return (
    <PaletteContext.Provider value={ctx}>
      {children}
      <CommandDialog
        open={isOpen}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) setQuery("")
        }}
        title="Search and commands"
        description="Jump to pages, projects, API keys and models."
      >
        <Command shouldFilter={false} loop>
          <CommandInput placeholder="Search pages, projects, keys, models..." value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[min(60vh,28rem)]">
            {nothing ? <CommandEmpty>No results for "{query}".</CommandEmpty> : null}
            {visibleNav.length > 0 ? (
              <CommandGroup heading="Go to">
                {visibleNav.map((item) => (
                  <CommandItem key={item.id} value={`nav-${item.id}`} onSelect={() => run(item.run)}>
                    <item.icon /> {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {base && foundProjects.length > 0 ? (
              <CommandGroup heading="Projects">
                {foundProjects.map((p) => (
                  <CommandItem key={p.id} value={`project-${p.id}`} onSelect={() => run(go(`${base}/projects/${p.id}`))}>
                    <Folder />
                    <span className="truncate">{p.name}</span>
                    {p.archived_at ? <span className="text-muted-foreground ml-auto text-xs">Archived</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {base && foundKeys.length > 0 ? (
              <CommandGroup heading="API keys">
                {foundKeys.map((k) => (
                  <CommandItem key={k.id} value={`key-${k.id}`} onSelect={() => run(go(`${base}/api-keys?key=${k.id}`))}>
                    <KeyRound />
                    <span className="truncate">{k.name}</span>
                    <code className="text-muted-foreground ml-auto text-xs">{k.display}</code>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {base && foundModels.length > 0 ? (
              <CommandGroup heading="Models">
                {foundModels.map((m) => (
                  <CommandItem key={m.id} value={`model-${m.id}`} onSelect={() => run(go(`${base}/playground?model=${encodeURIComponent(m.id)}`))}>
                    <Boxes />
                    <span className="truncate">{m.name}</span>
                    <code className="text-muted-foreground ml-auto truncate text-xs">{m.id}</code>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {visibleActions.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Actions">
                  {visibleActions.map((item) => (
                    <CommandItem key={item.id} value={`action-${item.id}`} onSelect={() => run(item.run)}>
                      <item.icon /> {item.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
      <SignOutDialog open={signingOut} onOpenChange={setSigningOut} />
    </PaletteContext.Provider>
  )
}
