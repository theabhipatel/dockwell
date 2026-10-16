import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"

import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { useWorkspaceScope } from "@/components/layout/workspace-context"
import { LogsExplorer } from "@/components/logs-explorer"
import { Page, PageHeader } from "@/components/page"
import { UsageExplorer } from "@/components/usage-explorer"
import type { FilterOptions } from "@/components/usage-explorer"
import { EmptyState } from "@/components/states"
import { qk, useApiKeys, useMembers, useProjects, useUsage, useWorkspaceModels } from "@/hooks/api"
import type { LogFilters, UsageFilters } from "@/hooks/api"
import { client, unwrap } from "@/lib/api"
import { Perm } from "@/lib/permissions"
import { Lock } from "lucide-react"

function useFilterOptions(id: string): FilterOptions {
  const projects = useProjects(id)
  const keys = useApiKeys(id)
  const models = useWorkspaceModels(id)
  const members = useMembers(id)
  return {
    projects: (projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
    keys: (keys.data ?? []).map((k) => ({ value: k.id, label: `${k.name} (${k.display})` })),
    models: (models.data ?? []).map((m) => ({ value: m.id, label: m.name })),
    members: (members.data ?? []).map((m) => ({ value: m.user_id, label: m.name })),
  }
}

function useWorkspaceUsageReport(filters: UsageFilters) {
  const { id } = useWorkspaceScope()
  return useUsage(id, filters)
}

export function UsagePage() {
  const { id, workspace, can } = useWorkspaceScope()
  useBreadcrumbs([{ label: workspace.name, to: `/w/${id}` }, { label: "Usage" }])
  const options = useFilterOptions(id)
  if (!can(Perm.viewUsage)) {
    return (
      <Page>
        <EmptyState icon={Lock} title="No access to usage" description="Your role does not include viewing usage." />
      </Page>
    )
  }
  return (
    <Page wide>
      <PageHeader
        eyebrow="Observe"
        title="Usage"
        description="Tokens, requests and cost over time. Filter and group by project, API key, model and member. Times are UTC."
      />
      <UsageExplorer
        useReport={useWorkspaceUsageReport}
        options={options}
        groups={["model", "project", "api_key", "user", "source"]}
        exportPath={`/api/workspaces/${id}/usage/export.csv`}
      />
    </Page>
  )
}

export function LogsPage() {
  const { id, workspace, can } = useWorkspaceScope()
  useBreadcrumbs([{ label: workspace.name, to: `/w/${id}` }, { label: "Logs" }])
  const options = useFilterOptions(id)
  const useLogs = (filters: LogFilters) =>
    useInfiniteQuery({
      queryKey: qk.logs(id, filters),
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        unwrap(
          client.GET("/api/workspaces/{workspace_id}/logs", {
            params: { path: { workspace_id: id }, query: { ...filters, before: pageParam, limit: 50 } },
          }),
        ),
      getNextPageParam: (last) => last.next_before ?? undefined,
      placeholderData: keepPreviousData,
      refetchInterval: 15_000,
    })
  const useDetail = (logId: string | null) =>
    useQuery({
      queryKey: qk.log(id, logId ?? ""),
      queryFn: () =>
        unwrap(client.GET("/api/workspaces/{workspace_id}/logs/{log_id}", { params: { path: { workspace_id: id, log_id: logId ?? "" } } })),
      enabled: Boolean(logId),
    })
  if (!can(Perm.viewLogs)) {
    return (
      <Page>
        <EmptyState icon={Lock} title="No access to logs" description="Your role does not include viewing request logs." />
      </Page>
    )
  }
  return (
    <Page wide>
      <PageHeader
        eyebrow="Observe"
        title="Request logs"
        description={`Every API and playground request with tokens, cost, latency and status. Kept for ${workspace.effective_log_retention_days} days.`}
      />
      <LogsExplorer useLogs={useLogs} useDetail={useDetail} options={options} />
    </Page>
  )
}
