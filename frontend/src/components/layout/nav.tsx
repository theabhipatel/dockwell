import type { LucideIcon } from "lucide-react"
import { Link, useLocation } from "react-router"

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"

export interface NavItem {
  label: string
  icon: LucideIcon
  to: string
  exact?: boolean
  visible?: boolean
}

export function NavMenu({ items }: { items: NavItem[] }) {
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)
  return (
    <SidebarMenu>
      {items
        .filter((item) => item.visible !== false)
        .map((item) => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton asChild isActive={isActive(item)} tooltip={item.label}>
              <Link to={item.to} onClick={() => setOpenMobile(false)}>
                <item.icon />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
    </SidebarMenu>
  )
}
