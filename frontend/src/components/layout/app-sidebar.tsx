import {
  Activity,
  BarChart3,
  BookOpen,
  CreditCard,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  MessageSquareText,
  ScrollText,
  Settings,
  Shield,
  ShieldHalf,
  Users,
} from "lucide-react"
import { Link } from "react-router"

import { Logo } from "@/components/brand"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useBilling, useMe, useWorkspace } from "@/hooks/api"
import { usd } from "@/lib/format"
import { Perm, can } from "@/lib/permissions"

import { NavMenu } from "./nav"
import type { NavItem } from "./nav"
import { WorkspaceSwitcher } from "./workspace-switcher"

export function AppSidebar({ workspaceId }: { workspaceId: string | null }) {
  const { data: workspace } = useWorkspace(workspaceId ?? undefined)
  const { data: me } = useMe()
  const perms = workspace?.permissions
  const base = workspaceId ? `/w/${workspaceId}` : null

  const build: NavItem[] = base
    ? [
        { label: "Dashboard", icon: LayoutDashboard, to: base, exact: true },
        { label: "Playground", icon: MessageSquareText, to: `${base}/playground`, visible: can(perms, Perm.usePlayground) },
        { label: "API keys", icon: KeyRound, to: `${base}/api-keys` },
        { label: "Projects", icon: FolderKanban, to: `${base}/projects` },
      ]
    : []
  const observe: NavItem[] = base
    ? [
        { label: "Usage", icon: BarChart3, to: `${base}/usage`, visible: can(perms, Perm.viewUsage) },
        { label: "Logs", icon: ScrollText, to: `${base}/logs`, visible: can(perms, Perm.viewLogs) },
        { label: "Activity", icon: Activity, to: `${base}/activity`, visible: can(perms, Perm.viewAudit) },
      ]
    : []
  const manage: NavItem[] = base
    ? [
        {
          label: "Billing",
          icon: CreditCard,
          to: `${base}/billing`,
          visible: can(perms, Perm.viewBilling) || can(perms, Perm.manageBilling),
        },
        { label: "Members", icon: Users, to: `${base}/members` },
        {
          label: "Roles",
          icon: ShieldHalf,
          to: `${base}/roles`,
          visible: can(perms, Perm.manageRoles) || can(perms, Perm.changeRoles),
        },
        { label: "Settings", icon: Settings, to: `${base}/settings` },
      ]
    : []

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="gap-3 pt-3">
        <Link to="/app" className="px-2 group-data-[collapsible=icon]:hidden">
          <Logo />
        </Link>
        <WorkspaceSwitcher currentId={workspaceId} />
      </SidebarHeader>
      <SidebarContent>
        {base ? (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>Build</SidebarGroupLabel>
              <SidebarGroupContent>
                <NavMenu items={build} />
              </SidebarGroupContent>
            </SidebarGroup>
            {observe.some((i) => i.visible !== false) ? (
              <SidebarGroup>
                <SidebarGroupLabel>Observe</SidebarGroupLabel>
                <SidebarGroupContent>
                  <NavMenu items={observe} />
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null}
            <SidebarGroup>
              <SidebarGroupLabel>Manage</SidebarGroupLabel>
              <SidebarGroupContent>
                <NavMenu items={manage} />
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {workspace && (can(perms, Perm.viewBilling) || can(perms, Perm.manageBilling)) ? (
            <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
              <Link
                to={`${base}/billing`}
                className="hover:bg-sidebar-accent flex items-center justify-between rounded-md border bg-background px-3 py-2 text-xs"
              >
                <span className="text-muted-foreground">Credit balance</span>
                <BalanceValue workspaceId={workspace.id} />
              </Link>
            </SidebarMenuItem>
          ) : null}
          {me?.is_admin ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Admin">
                <Link to="/admin">
                  <Shield />
                  <span>Admin</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Documentation">
              <a href="/docs" target="_blank" rel="noopener">
                <BookOpen />
                <span>Docs</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function BalanceValue({ workspaceId }: { workspaceId: string }) {
  const { data } = useBillingBalance(workspaceId)
  return <span className="tabular font-semibold">{data === undefined ? "..." : usd(data)}</span>
}

function useBillingBalance(workspaceId: string) {
  const query = useBilling(workspaceId)
  return { ...query, data: query.data?.balance_micros }
}
