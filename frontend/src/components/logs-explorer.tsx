import { useEffect, useState } from "react"
import type { InfiniteData, UseInfiniteQueryResult, UseQueryResult } from "@tanstack/react-query"
import { ScrollText, Search } from "lucide-react"

import { CopyButton } from "@/components/copy-button"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states"
import { DateRangePicker, FilterBar, FilterSelect, useDateRange } from "@/components/usage-explorer"
import type { FilterOptions } from "@/components/usage-explorer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { LogFilters } from "@/hooks/api"
import { clean } from "@/hooks/api"
import { fullDate, ms, shortDate, usd } from "@/lib/format"
import type { RequestLog, RequestLogDetail } from "@/lib/types"

const STATUS_VARIANT = { success: "success", error: "destructive", cancelled: "warning" } as const

type LogPage = { items: RequestLog[]; next_before?: string | null }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function LogDetail({ log, detail }: { log: RequestLog; detail: UseQueryResult<RequestLogDetail> }) {
  const d = detail.data
  return (
    <div className="space-y-6 p-4">
      <dl className="divide-y">
        <Row label="Request id">
          <span className="inline-flex items-center gap-1">
            <code className="text-xs">{log.id}</code>
            <CopyButton value={log.id} size="icon-xs" />
          </span>
        </Row>
        <Row label="Time">{fullDate(log.created_at)}</Row>
        {log.workspace_name ? <Row label="Workspace">{log.workspace_name}</Row> : null}
        <Row label="Status">
          <Badge variant={STATUS_VARIANT[log.status as keyof typeof STATUS_VARIANT] ?? "secondary"}>{log.status}</Badge>{" "}
          <span className="text-muted-foreground text-xs">HTTP {log.http_status}</span>
        </Row>
        {log.error_message ? (
          <Row label="Error">
            <span className="text-destructive">{log.error_message}</span>
            {log.error_code ? <code className="text-muted-foreground block text-xs">{log.error_code}</code> : null}
          </Row>
        ) : null}
        <Row label="Model">
          <code className="text-xs">{log.model}</code>
        </Row>
        <Row label="Endpoint">
          /v1/{log.endpoint.replace(".", "/")} {log.stream ? <Badge variant="outline">stream</Badge> : null}
        </Row>
        <Row label="Source">{log.source === "api" ? "API" : "Playground"}</Row>
        <Row label="Project">{log.project_name ?? "-"}</Row>
        <Row label="API key">{log.api_key_name ?? "-"}</Row>
        <Row label="Member">{log.user_name ?? "-"}</Row>
        <Row label="Tokens">
          {log.input_tokens.toLocaleString()} in / {log.output_tokens.toLocaleString()} out
          {log.cached_tokens ? ` (${log.cached_tokens.toLocaleString()} cached)` : ""}
        </Row>
        <Row label="Cost">{usd(log.cost_micros, { precise: true })}</Row>
        <Row label="Latency">{ms(log.latency_ms)}</Row>
        <Row label="Time to first token">{ms(log.ttft_ms)}</Row>
        <Row label="IP address">{detail.isPending ? <Skeleton className="h-4 w-24" /> : (d?.ip ?? "-")}</Row>
      </dl>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Prompt and response</h3>
        {detail.isPending ? (
          <Skeleton className="h-24" />
        ) : d?.content_logged ? (
          <>
            <pre className="bg-code text-code-foreground max-h-72 overflow-auto rounded-lg border p-3 text-xs">{JSON.stringify(d.request_body, null, 2)}</pre>
            {d.response_body ? <pre className="bg-code text-code-foreground max-h-72 overflow-auto rounded-lg border p-3 text-xs whitespace-pre-wrap">{d.response_body}</pre> : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Content is not stored. Prompt logging is off by default; a platform admin can allow it and each workspace can opt out.
          </p>
        )}
      </section>
    </div>
  )
}

/** Request logs with filters, search, infinite scrolling and a detail sheet. */
export function LogsExplorer({
  useLogs,
  useDetail,
  options,
  showWorkspace = false,
}: {
  useLogs: (filters: LogFilters) => UseInfiniteQueryResult<InfiniteData<LogPage>>
  useDetail: (id: string | null) => UseQueryResult<RequestLogDetail>
  options: FilterOptions
  showWorkspace?: boolean
}) {
  const range = useDateRange("7")
  const [filters, setFilters] = useState<LogFilters>({})
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<RequestLog | null>(null)
  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 300)
    return () => window.clearTimeout(t)
  }, [search])
  const logs = useLogs({ ...clean(filters), ...range.dates, q: q || undefined })
  const detail = useDetail(selected?.id ?? null)
  const rows = logs.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search model, error or request id" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        <DateRangePicker state={range} />
        <FilterSelect
          label="Statuses"
          width="w-36"
          value={filters.status}
          onChange={(v) => setFilters({ ...filters, status: v as LogFilters["status"] })}
          options={[
            { value: "success", label: "Success" },
            { value: "error", label: "Error" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
        <FilterBar filters={filters} setFilters={(f) => setFilters({ ...filters, ...f })} options={options} />
      </div>
      {logs.isPending ? (
        <ListSkeleton rows={6} />
      ) : logs.error ? (
        <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No requests found" description="Requests from the API and the playground appear here as they happen." />
      ) : (
        <>
          <Card className="gap-0 overflow-x-auto py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Time</TableHead>
                  {showWorkspace ? <TableHead>Workspace</TableHead> : null}
                  <TableHead>Model</TableHead>
                  <TableHead className="hidden md:table-cell">Project / key</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Latency</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">TTFT</TableHead>
                  <TableHead className="pr-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                    <TableCell className="pl-4 text-xs whitespace-nowrap" title={fullDate(r.created_at)}>
                      {shortDate(r.created_at)}
                      <span className="text-muted-foreground block">{new Date(r.created_at).toLocaleTimeString()}</span>
                    </TableCell>
                    {showWorkspace ? <TableCell className="max-w-40 truncate text-sm">{r.workspace_name ?? "-"}</TableCell> : null}
                    <TableCell>
                      <code className="text-xs">{r.model}</code>
                      <span className="text-muted-foreground block text-xs">{r.source === "api" ? "API" : "Playground"}</span>
                    </TableCell>
                    <TableCell className="hidden max-w-48 text-xs md:table-cell">
                      <span className="block truncate">{r.project_name ?? "-"}</span>
                      <span className="text-muted-foreground block truncate">{r.api_key_name ?? r.user_name ?? ""}</span>
                    </TableCell>
                    <TableCell className="tabular text-right text-xs">
                      {r.input_tokens.toLocaleString()} / {r.output_tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="tabular text-right text-xs">{usd(r.cost_micros, { precise: true })}</TableCell>
                    <TableCell className="tabular hidden text-right text-xs sm:table-cell">{ms(r.latency_ms)}</TableCell>
                    <TableCell className="tabular hidden text-right text-xs lg:table-cell">{ms(r.ttft_ms)}</TableCell>
                    <TableCell className="pr-4">
                      <Badge variant={STATUS_VARIANT[r.status as keyof typeof STATUS_VARIANT] ?? "secondary"}>{r.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {logs.hasNextPage ? (
            <div className="flex justify-center">
              <Button variant="outline" disabled={logs.isFetchingNextPage} onClick={() => void logs.fetchNextPage()}>
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <SheetHeader className="border-b">
                <SheetTitle>Request details</SheetTitle>
                <SheetDescription>{fullDate(selected.created_at)}</SheetDescription>
              </SheetHeader>
              <LogDetail log={selected} detail={detail} />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
