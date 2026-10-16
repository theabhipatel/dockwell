import { useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Download, FilterX, MonitorSmartphone, ScrollText } from "lucide-react"

import { AuditEventSheet, ResultBadge } from "@/components/audit-event-sheet"
import type { AuditEvent } from "@/components/audit-event-sheet"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { useWorkspaceScope } from "@/components/layout/workspace-context"
import { Page, PageHeader } from "@/components/page"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { qk, useMembers } from "@/hooks/api"
import type { AuditFilters } from "@/hooks/api"
import { client, unwrap } from "@/lib/api"
import { ACTION_GROUPS, actionLabel, describeUserAgent, fullDate, shortDate } from "@/lib/format"
import { Perm } from "@/lib/permissions"
import { NotFoundContent } from "@/routes/not-found"

const PAGE_SIZE = 50
const ANY = "__any__"

export function AuditPage() {
  const { id, workspace, can } = useWorkspaceScope()
  const [filters, setFilters] = useState<AuditFilters>({})
  const [selected, setSelected] = useState<AuditEvent | null>(null)
  const members = useMembers(id)
  useBreadcrumbs([{ label: workspace.name, to: `/w/${id}` }, { label: "Activity log" }])

  const log = useInfiniteQuery({
    queryKey: qk.audit(id, filters),
    queryFn: ({ pageParam }) =>
      unwrap(
        client.GET("/api/workspaces/{workspace_id}/audit", {
          params: {
            path: { workspace_id: id },
            query: { ...filters, before_id: pageParam ?? undefined, limit: PAGE_SIZE },
          },
        }),
      ),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.length === PAGE_SIZE ? last[last.length - 1].id : null),
    enabled: can(Perm.viewAudit),
  })

  if (!can(Perm.viewAudit)) {
    return <NotFoundContent title="Activity log unavailable" description="Your role doesn't include access to the activity log." />
  }

  const set = (key: keyof AuditFilters, value: string | undefined) =>
    setFilters((f) => {
      const next = { ...f }
      if (value) next[key] = value
      else delete next[key]
      return next
    })

  const exportUrl = (() => {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => Boolean(v)) as [string, string][])
    return `/api/workspaces/${id}/audit/export.csv${q.toString() ? `?${q.toString()}` : ""}`
  })()

  const rows = log.data?.pages.flat() ?? []
  const hasFilters = Object.keys(filters).length > 0

  return (
    <Page wide>
      <PageHeader
        title="Activity log"
        description="An append-only record of sign-ins, members, roles, API keys, billing and settings changes, with IP and device. Select an event to see everything recorded about it."
        actions={
          <Button variant="outline" asChild>
            <a href={exportUrl} download>
              <Download /> Export CSV
            </a>
          </Button>
        }
      />
      <Card size="sm" className="mb-5">
        <div className="grid gap-3 px-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
          <Field>
            <FieldLabel>Member</FieldLabel>
            <Select value={filters.actor_id ?? ANY} onValueChange={(v) => set("actor_id", v === ANY ? undefined : v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Anyone</SelectItem>
                {members.data?.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Action</FieldLabel>
            <Select value={filters.action ?? ANY} onValueChange={(v) => set("action", v === ANY ? undefined : v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All actions</SelectItem>
                {ACTION_GROUPS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="audit-from">From</FieldLabel>
            <Input id="audit-from" type="date" value={filters.date_from ?? ""} max={filters.date_to} onChange={(e) => set("date_from", e.target.value || undefined)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="audit-to">To</FieldLabel>
            <Input id="audit-to" type="date" value={filters.date_to ?? ""} min={filters.date_from} onChange={(e) => set("date_to", e.target.value || undefined)} />
          </Field>
          <Button variant="ghost" disabled={!hasFilters} onClick={() => setFilters({})}>
            <FilterX /> Clear
          </Button>
        </div>
      </Card>

      {log.isPending ? (
        <ListSkeleton rows={6} />
      ) : log.error ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No matching events" description={hasFilters ? "Try widening your filters." : "Events will appear here as your team works."} />
      ) : (
        <Card className="gap-0 overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="hidden lg:table-cell">Project</TableHead>
                <TableHead className="hidden md:table-cell">From</TableHead>
                <TableHead className="pr-4">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                  <TableCell className="text-muted-foreground pl-4 text-xs whitespace-nowrap" title={fullDate(r.created_at)}>
                    {shortDate(r.created_at)}
                  </TableCell>
                  <TableCell className="max-w-48">
                    <p className="truncate text-sm font-medium">{r.actor_name ?? "Unknown"}</p>
                    <p className="text-muted-foreground truncate text-xs">{r.actor_email}</p>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-sm text-left hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelected(r)
                      }}
                    >
                      {actionLabel(r.action)}
                      {r.details?.source === "browser" ? <MonitorSmartphone className="text-muted-foreground size-3.5" aria-label="Reported by the browser" /> : null}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm">{r.target_label ?? "-"}</TableCell>
                  <TableCell className="text-muted-foreground hidden max-w-40 truncate text-xs lg:table-cell">{r.project_name ?? "-"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Tooltip>
                      <TooltipTrigger className="text-muted-foreground text-left text-xs">
                        <span className="block font-mono">{r.ip ?? "-"}</span>
                        <span className="block">{describeUserAgent(r.user_agent)}</span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm break-words">{r.user_agent ?? "No user agent"}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="pr-4">
                    <ResultBadge result={r.result} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {log.hasNextPage ? (
            <div className="border-t p-3 text-center">
              <Button variant="outline" size="sm" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
                {log.isFetchingNextPage ? <Spinner /> : null} Load older events
              </Button>
            </div>
          ) : null}
        </Card>
      )}
      <AuditEventSheet event={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </Page>
  )
}
