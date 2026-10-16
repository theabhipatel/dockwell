import { useState } from "react"
import { Building2, Check, ChevronsUpDown, Plus, Star } from "lucide-react"
import { useNavigate } from "react-router"

import { CreateWorkspaceDialog } from "@/components/create-dialogs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspaces } from "@/hooks/api"
import type { WorkspaceSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

function WorkspaceGlyph({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-foreground shadow-xs",
        className,
      )}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || <Building2 className="size-4" />}
    </span>
  )
}

export function WorkspaceSwitcher({ currentId }: { currentId: string | null }) {
  const { data: workspaces, isPending } = useWorkspaces()
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()
  const [creating, setCreating] = useState(false)

  const current = workspaces?.find((w) => w.id === currentId) ?? null
  const owned = workspaces?.filter((w) => w.is_owner) ?? []
  const shared = workspaces?.filter((w) => !w.is_owner) ?? []

  const go = (ws: WorkspaceSummary) => {
    setOpenMobile(false)
    navigate(`/w/${ws.id}`)
  }

  const renderItem = (ws: WorkspaceSummary) => (
    <DropdownMenuItem key={ws.id} onSelect={() => go(ws)} className="gap-2.5 py-2">
      <WorkspaceGlyph name={ws.name} className="size-6 rounded-md text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{ws.name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {ws.is_owner ? `${ws.member_count} member${ws.member_count === 1 ? "" : "s"}` : `${ws.role_name} · owned by ${ws.owner_name}`}
        </p>
      </div>
      {ws.is_default ? <Star className="text-muted-foreground size-3.5" aria-label="Default workspace" /> : null}
      {ws.id === currentId ? <Check className="size-4 text-brand" /> : null}
    </DropdownMenuItem>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" aria-label="Switch workspace">
              {isPending ? (
                <Skeleton className="size-8 rounded-lg" />
              ) : (
                <WorkspaceGlyph name={current?.name ?? "?"} />
              )}
              <div className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{current?.name ?? (isPending ? "Loading..." : "Choose a workspace")}</span>
                <span className="text-muted-foreground truncate text-xs">{current ? current.role_name : "Workspace"}</span>
              </div>
              <ChevronsUpDown className="text-muted-foreground ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-72" align="start" side={isMobile ? "bottom" : "right"} sideOffset={6}>
            {owned.length > 0 ? (
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-muted-foreground text-xs">Your workspaces</DropdownMenuLabel>
                {owned.map(renderItem)}
              </DropdownMenuGroup>
            ) : null}
            {shared.length > 0 ? (
              <>
                {owned.length > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground text-xs">Shared with you</DropdownMenuLabel>
                  {shared.map(renderItem)}
                </DropdownMenuGroup>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCreating(true)} className="gap-2.5 py-2">
              <span className="flex size-6 items-center justify-center rounded-md border border-dashed">
                <Plus className="size-3.5" />
              </span>
              Create workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
