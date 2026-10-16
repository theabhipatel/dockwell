import { Bell, Palette, ShieldCheck, TriangleAlert, UserRound } from "lucide-react"
import { NavLink, Outlet } from "react-router"

import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { Page, PageHeader } from "@/components/page"
import { cn } from "@/lib/utils"

const SECTIONS = [
  { to: "/settings/profile", label: "Profile", icon: UserRound },
  { to: "/settings/appearance", label: "Appearance", icon: Palette },
  { to: "/settings/security", label: "Security", icon: ShieldCheck },
  { to: "/settings/notifications", label: "Notifications", icon: Bell },
  { to: "/settings/account", label: "Account", icon: TriangleAlert },
]

export function SettingsLayout() {
  useBreadcrumbs([{ label: "Account settings" }])
  return (
    <Page className="max-w-5xl">
      <PageHeader title="Account settings" description="Your profile, sign-in security and preferences. These apply across every workspace." />
      <div className="grid gap-8 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 md:flex-col md:overflow-visible">
          {SECTIONS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 space-y-6">
          <Outlet />
        </div>
      </div>
    </Page>
  )
}
