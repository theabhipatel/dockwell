import { createContext, useContext, useEffect } from "react"
import { Outlet, useParams } from "react-router"

import { ApiError } from "@/lib/api"
import { setLastWorkspace } from "@/lib/last-workspace"
import { can } from "@/lib/permissions"
import type { PermKey } from "@/lib/permissions"
import type { WorkspaceDetail } from "@/lib/types"
import { useWorkspace } from "@/hooks/api"
import { Page } from "@/components/page"
import { ErrorState } from "@/components/states"
import { Skeleton } from "@/components/ui/skeleton"
import { NotFoundContent } from "@/routes/not-found"

interface WorkspaceScope {
  id: string
  workspace: WorkspaceDetail
  can: (perm: PermKey) => boolean
}

const WorkspaceContext = createContext<WorkspaceScope | null>(null)

export function useWorkspaceScope(): WorkspaceScope {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspaceScope must be used inside a workspace route")
  return ctx
}

/** Route element for /w/:workspaceId/*. Loads the workspace and the user's permissions in it. */
export function WorkspaceLayout() {
  const { workspaceId = "" } = useParams()
  const { data, error, isPending, refetch } = useWorkspace(workspaceId)

  useEffect(() => {
    if (data) setLastWorkspace(data.id)
  }, [data])

  if (isPending) {
    return (
      <Page>
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="mb-8 h-8 w-72" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </Page>
    )
  }
  if (error instanceof ApiError && (error.status === 404 || error.status === 422)) {
    return <NotFoundContent title="Workspace not found" description="It may have been deleted, or you may no longer be a member." />
  }
  if (error || !data) {
    return (
      <Page>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Page>
    )
  }

  const scope: WorkspaceScope = {
    id: data.id,
    workspace: data,
    can: (perm) => can(data.permissions, perm),
  }
  return (
    <WorkspaceContext.Provider value={scope}>
      <Outlet />
    </WorkspaceContext.Provider>
  )
}
