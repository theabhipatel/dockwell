import {
  Activity,
  ArrowLeft,
  BarChart3,
  Boxes,
  Building2,
  CreditCard,
  Gauge,
  HeartPulse,
  ScrollText,
  Server,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react"
import { Link } from "react-router"

import { Logo } from "@/components/brand"
import { Badge } from "@/components/ui/badge"
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

import { NavMenu } from "./nav"

export function AdminSidebar() {
  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="pt-3">
        <Link to="/admin" className="flex items-center gap-2 px-2 group-data-[collapsible=icon]:hidden">
          <Logo />
          <Badge variant="brand">Admin</Badge>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMenu
              items={[
                { label: "Overview", icon: Gauge, to: "/admin", exact: true },
                { label: "Users", icon: Users, to: "/admin/users" },
                { label: "Workspaces", icon: Building2, to: "/admin/workspaces" },
              ]}
            />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Inference</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMenu
              items={[
                { label: "Models", icon: Boxes, to: "/admin/models" },
                { label: "Providers", icon: Server, to: "/admin/providers" },
                { label: "System health", icon: HeartPulse, to: "/admin/health" },
              ]}
            />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Business</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMenu
              items={[
                { label: "Billing", icon: CreditCard, to: "/admin/billing" },
                { label: "Usage", icon: BarChart3, to: "/admin/usage" },
                { label: "Request logs", icon: ScrollText, to: "/admin/logs" },
              ]}
            />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Configuration</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMenu
              items={[
                { label: "Settings", icon: Settings2, to: "/admin/settings" },
                { label: "Audit log", icon: ShieldCheck, to: "/admin/audit" },
                { label: "Service status", icon: Activity, to: "/admin/status" },
              ]}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Back to app">
              <Link to="/app">
                <ArrowLeft />
                <span>Back to app</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
