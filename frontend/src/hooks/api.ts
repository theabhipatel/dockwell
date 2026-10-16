import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { ApiError, client, unwrap } from "@/lib/api"
import type { GroupBy, Me } from "@/lib/types"

export interface UsageFilters {
  date_from?: string
  date_to?: string
  group_by?: GroupBy
  project_id?: string
  api_key_id?: string
  model?: string
  user_id?: string
  source?: "api" | "playground"
  workspace_id?: string
}

export interface LogFilters extends Omit<UsageFilters, "group_by"> {
  status?: "success" | "error" | "cancelled"
  q?: string
}

export interface AuditFilters {
  actor_id?: string
  action?: string
  date_from?: string
  date_to?: string
}

export const qk = {
  me: ["me"] as const,
  config: ["config"] as const,
  permissions: ["permissions"] as const,
  publicModels: ["public-models"] as const,
  workspaces: ["workspaces"] as const,
  workspace: (id: string) => ["workspace", id] as const,
  members: (id: string) => ["workspace", id, "members"] as const,
  roles: (id: string) => ["workspace", id, "roles"] as const,
  invitations: (id: string) => ["workspace", id, "invitations"] as const,
  projects: (id: string) => ["workspace", id, "projects"] as const,
  project: (id: string, pid: string) => ["workspace", id, "project", pid] as const,
  projectMembers: (id: string, pid: string) => ["workspace", id, "project", pid, "members"] as const,
  keys: (id: string) => ["workspace", id, "keys"] as const,
  models: (id: string) => ["workspace", id, "models"] as const,
  dashboard: (id: string) => ["workspace", id, "dashboard"] as const,
  usage: (id: string, f: UsageFilters) => ["workspace", id, "usage", f] as const,
  logs: (id: string, f: LogFilters) => ["workspace", id, "logs", f] as const,
  log: (id: string, lid: string) => ["workspace", id, "log", lid] as const,
  billing: (id: string) => ["workspace", id, "billing"] as const,
  payments: (id: string) => ["workspace", id, "payments"] as const,
  ledger: (id: string, kind?: string) => ["workspace", id, "ledger", kind ?? "all"] as const,
  audit: (id: string, filters: AuditFilters) => ["workspace", id, "audit", filters] as const,
  conversations: (id: string) => ["workspace", id, "conversations"] as const,
  conversation: (id: string, cid: string) => ["workspace", id, "conversation", cid] as const,
  notifications: ["notifications"] as const,
  notificationCategories: ["notification-categories"] as const,
  myInvitations: ["my-invitations"] as const,
  sessions: ["sessions"] as const,
  accountActivity: ["account-activity"] as const,
}

const no404Retry = (count: number, error: unknown) =>
  !(error instanceof ApiError && (error.status === 404 || error.status === 403)) && count < 2

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async (): Promise<Me | null> => {
      try {
        return await unwrap(client.GET("/api/auth/me"))
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    staleTime: 60_000,
  })
}

export function useConfig() {
  return useQuery({
    queryKey: qk.config,
    queryFn: () => unwrap(client.GET("/api/public/config")),
    staleTime: 60_000,
  })
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: qk.permissions,
    queryFn: () => unwrap(client.GET("/api/permissions")),
    staleTime: Infinity,
  })
}

export function useWorkspaces(enabled = true) {
  return useQuery({ queryKey: qk.workspaces, queryFn: () => unwrap(client.GET("/api/workspaces")), enabled })
}

const ws = (id: string) => ({ params: { path: { workspace_id: id } } })

export function useWorkspace(id: string | undefined) {
  return useQuery({
    queryKey: qk.workspace(id ?? ""),
    queryFn: () => unwrap(client.GET("/api/workspaces/{workspace_id}", ws(id ?? ""))),
    enabled: Boolean(id),
    retry: no404Retry,
  })
}

export function useMembers(id: string) {
  return useQuery({
    queryKey: qk.members(id),
    queryFn: () => unwrap(client.GET("/api/workspaces/{workspace_id}/members", ws(id))),
  })
}

export function useRoles(id: string) {
  return useQuery({
    queryKey: qk.roles(id),
    queryFn: () => unwrap(client.GET("/api/workspaces/{workspace_id}/roles", ws(id))),
  })
}

export function useInvitations(id: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.invitations(id),
    queryFn: () => unwrap(client.GET("/api/workspaces/{workspace_id}/invitations", ws(id))),
    enabled,
  })
}

export function useProjects(id: string | undefined) {
  return useQuery({
    queryKey: qk.projects(id ?? ""),
    queryFn: () =>
      unwrap(
        client.GET("/api/workspaces/{workspace_id}/projects", {
          params: { path: { workspace_id: id ?? "" }, query: { include_archived: true } },
        }),
      ),
    enabled: Boolean(id),
  })
}

export function useProject(id: string, pid: string) {
  return useQuery({
    queryKey: qk.project(id, pid),
    queryFn: () =>
      unwrap(
        client.GET("/api/workspaces/{workspace_id}/projects/{project_id}", {
          params: { path: { workspace_id: id, project_id: pid } },
        }),
      ),
    retry: no404Retry,
  })
}

export function useProjectMembers(id: string, pid: string) {
  return useQuery({
    queryKey: qk.projectMembers(id, pid),
    queryFn: () =>
      unwrap(
        client.GET("/api/workspaces/{workspace_id}/projects/{project_id}/members", {
          params: { path: { workspace_id: id, project_id: pid } },
        }),
      ),
  })
}

export function useApiKeys(id: string | undefined) {
  return useQuery({
    queryKey: qk.keys(id ?? ""),
    queryFn: () =>
      unwrap(
        client.GET("/api/workspaces/{workspace_id}/api-keys", {
          params: { path: { workspace_id: id ?? "" }, query: { include_revoked: true } },
        }),
      ),
    enabled: Boolean(id),
  })
}

export function useWorkspaceModels(id: string | undefined) {
  return useQuery({
    queryKey: qk.models(id ?? ""),
    queryFn: () => unwrap(client.GET("/api/workspaces/{workspace_id}/models", ws(id ?? ""))),
    enabled: Boolean(id),
    staleTime: 30_000,
  })
}

export function useDashboard(id: string) {
  return useQuery({
    queryKey: qk.dashboard(id),
    queryFn: () => unwrap(client.GET("/api/workspaces/{workspace_id}/dashboard", ws(id))),
    refetchInterval: 30_000,
  })
}

export function useUsage(id: string, filters: UsageFilters) {
  return useQuery({
    queryKey: qk.usage(id, filters),
    queryFn: () =>
      unwrap(
        client.GET("/api/workspaces/{workspace_id}/usage", {
          params: { path: { workspace_id: id }, query: { ...filters, workspace_id: undefined } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useBilling(id: string, enabled = true) {
  return useQuery({
    queryKey: qk.billing(id),
    queryFn: () => unwrap(client.GET("/api/workspaces/{workspace_id}/billing", ws(id))),
    enabled,
  })
}

export function usePayments(id: string, enabled = true) {
  return useQuery({
    queryKey: qk.payments(id),
    queryFn: () => unwrap(client.GET("/api/workspaces/{workspace_id}/billing/payments", ws(id))),
    enabled,
  })
}

export function useConversations(id: string) {
  return useQuery({
    queryKey: qk.conversations(id),
    queryFn: () => unwrap(client.GET("/api/workspaces/{workspace_id}/playground/conversations", ws(id))),
  })
}

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => unwrap(client.GET("/api/notifications", { params: { query: { limit: 50 } } })),
    enabled,
    refetchInterval: 30_000,
  })
}

export function useNotificationCategories() {
  return useQuery({
    queryKey: qk.notificationCategories,
    queryFn: () => unwrap(client.GET("/api/account/notification-categories")),
    staleTime: Infinity,
  })
}

export function useMyInvitations(enabled: boolean) {
  return useQuery({
    queryKey: qk.myInvitations,
    queryFn: () => unwrap(client.GET("/api/invitations")),
    enabled,
    refetchInterval: 60_000,
  })
}

export function useSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: () => unwrap(client.GET("/api/account/sessions")) })
}

export function useAccountActivity() {
  return useQuery({ queryKey: qk.accountActivity, queryFn: () => unwrap(client.GET("/api/account/activity")) })
}

/** Drop undefined / empty values so they are not sent as query parameters. */
export function clean<T extends object>(filters: T): T {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== "")) as T
}
