import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"

import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { LogsExplorer } from "@/components/logs-explorer"
import { Page, PageHeader } from "@/components/page"
import { UsageExplorer } from "@/components/usage-explorer"
import type { FilterOptions } from "@/components/usage-explorer"
import type { LogFilters, UsageFilters } from "@/hooks/api"
import { client, unwrap } from "@/lib/api"

function useAdminOptions(): FilterOptions {
  const models = useQuery({ queryKey: ["admin", "models"], queryFn: () => unwrap(client.GET("/api/admin/models")) })
  const workspaces = useQuery({ queryKey: ["admin", "workspaces", "", "all", 0], queryFn: () => unwrap(client.GET("/api/admin/workspaces", { params: { query: { limit: 200 } } })) })
  return {
    workspaces: (workspaces.data?.items ?? []).map((w) => ({ value: w.id, label: w.name })),
    models: (models.data ?? []).map((m) => ({ value: m.public_id, label: m.display_name })),
  }
}

export function AdminUsagePage() {
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Usage" }])
  const options = useAdminOptions()
  const useReport = (filters: UsageFilters) =>
    useQuery({
      queryKey: ["admin", "usage", filters],
      queryFn: () => unwrap(client.GET("/api/admin/usage", { params: { query: filters } })),
      placeholderData: keepPreviousData,
    })
  return (
    <Page wide>
      <PageHeader eyebrow="Admin" title="Platform usage" description="Usage across every workspace, filterable by workspace and model." />
      <UsageExplorer useReport={useReport} options={options} groups={["model", "workspace", "source"]} exportPath="/api/admin/usage/export.csv" />
    </Page>
  )
}

export function AdminLogsPage() {
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Request logs" }])
  const options = useAdminOptions()
  const useLogs = (filters: LogFilters) =>
    useInfiniteQuery({
      queryKey: ["admin", "logs", filters],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => unwrap(client.GET("/api/admin/logs", { params: { query: { ...filters, before: pageParam, limit: 50 } } })),
      getNextPageParam: (last) => last.next_before ?? undefined,
      placeholderData: keepPreviousData,
      refetchInterval: 15_000,
    })
  const useDetail = (id: string | null) =>
    useQuery({
      queryKey: ["admin", "log", id],
      queryFn: () => unwrap(client.GET("/api/admin/logs/{log_id}", { params: { path: { log_id: id ?? "" } } })),
      enabled: Boolean(id),
    })
  return (
    <Page wide>
      <PageHeader eyebrow="Admin" title="Request logs" description="Every request on the platform, with the same filters as workspaces plus workspace." />
      <LogsExplorer useLogs={useLogs} useDetail={useDetail} options={options} showWorkspace />
    </Page>
  )
}
