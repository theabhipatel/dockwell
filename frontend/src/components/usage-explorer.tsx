import { useMemo, useState } from "react"
import type { UseQueryResult } from "@tanstack/react-query"
import { BarChart3, Download } from "lucide-react"

import { StatCard } from "@/components/stat-card"
import { EmptyState, ErrorState } from "@/components/states"
import { DailyChart, METRIC_LABEL, formatMetric } from "@/components/usage-chart"
import type { Metric } from "@/components/usage-chart"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { UsageFilters } from "@/hooks/api"
import { clean } from "@/hooks/api"
import { tokens, usd } from "@/lib/format"
import type { GroupBy, UsageReport } from "@/lib/types"

export interface Option {
  value: string
  label: string
}

export interface FilterOptions {
  projects?: Option[]
  keys?: Option[]
  models?: Option[]
  members?: Option[]
  workspaces?: Option[]
}

const GROUP_LABELS: Record<GroupBy, string> = {
  model: "Model",
  project: "Project",
  api_key: "API key",
  user: "Member",
  workspace: "Workspace",
  source: "Source",
}

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom range" },
]

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function useDateRange(initial = "30") {
  const [range, setRange] = useState(initial)
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 29 * 86_400_000)))
  const [to, setTo] = useState(isoDay(new Date()))
  const dates = useMemo(() => {
    const today = new Date()
    if (range === "custom") return { date_from: from, date_to: to }
    if (range === "month") return { date_from: isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), date_to: isoDay(today) }
    return { date_from: isoDay(new Date(Date.now() - (Number(range) - 1) * 86_400_000)), date_to: isoDay(today) }
  }, [range, from, to])
  return { range, setRange, from, setFrom, to, setTo, dates }
}

export function DateRangePicker({ state }: { state: ReturnType<typeof useDateRange> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={state.range} onValueChange={state.setRange}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGES.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {state.range === "custom" ? (
        <>
          <Input type="date" className="w-40" value={state.from} max={state.to} onChange={(e) => state.setFrom(e.target.value)} aria-label="From" />
          <Input type="date" className="w-40" value={state.to} min={state.from} onChange={(e) => state.setTo(e.target.value)} aria-label="To" />
        </>
      ) : null}
    </div>
  )
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  width = "w-44",
}: {
  label: string
  value: string | undefined
  onChange: (v: string | undefined) => void
  options: Option[]
  width?: string
}) {
  return (
    <Select value={value ?? "all"} onValueChange={(v) => onChange(v === "all" ? undefined : v)}>
      <SelectTrigger className={width} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {label.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function FilterBar({
  filters,
  setFilters,
  options,
}: {
  filters: UsageFilters
  setFilters: (f: UsageFilters) => void
  options: FilterOptions
}) {
  const set = (patch: Partial<UsageFilters>) => setFilters({ ...filters, ...patch })
  return (
    <>
      {options.workspaces ? <FilterSelect label="Workspaces" value={filters.workspace_id} onChange={(v) => set({ workspace_id: v })} options={options.workspaces} /> : null}
      {options.projects ? <FilterSelect label="Projects" value={filters.project_id} onChange={(v) => set({ project_id: v })} options={options.projects} /> : null}
      {options.keys ? <FilterSelect label="Keys" value={filters.api_key_id} onChange={(v) => set({ api_key_id: v })} options={options.keys} /> : null}
      {options.models ? <FilterSelect label="Models" value={filters.model} onChange={(v) => set({ model: v })} options={options.models} /> : null}
      {options.members ? <FilterSelect label="Members" value={filters.user_id} onChange={(v) => set({ user_id: v })} options={options.members} /> : null}
      <FilterSelect
        label="Sources"
        width="w-36"
        value={filters.source}
        onChange={(v) => set({ source: v as UsageFilters["source"] })}
        options={[
          { value: "api", label: "API" },
          { value: "playground", label: "Playground" },
        ]}
      />
    </>
  )
}

export function toQuery(filters: object): string {
  const entries = Object.entries(clean(filters)).map(([k, v]) => [k, String(v)])
  return new URLSearchParams(entries).toString()
}

/** Usage charts with filters, grouping and CSV export. */
export function UsageExplorer({
  useReport,
  options,
  groups,
  exportPath,
}: {
  useReport: (filters: UsageFilters) => UseQueryResult<UsageReport>
  options: FilterOptions
  groups: GroupBy[]
  exportPath: string
}) {
  const range = useDateRange()
  const [filters, setFilters] = useState<UsageFilters>({})
  const [groupBy, setGroupBy] = useState<GroupBy>(groups[0] ?? "model")
  const [metric, setMetric] = useState<Metric>("cost_micros")
  const query = { ...clean(filters), ...range.dates, group_by: groupBy }
  const report = useReport(query)
  const data = report.data

  const chart = useMemo(() => {
    if (!data) return { rows: [], series: [] }
    const top = data.breakdown.slice(0, 6)
    const keyFor = new Map(top.map((g, i) => [g.key, `g${i}`]))
    const series = top.map((g, i) => ({ key: `g${i}`, label: g.label }))
    const byDay = new Map<string, Record<string, number | string>>()
    for (const p of data.series) byDay.set(p.day, { day: p.day, ...Object.fromEntries(series.map((s) => [s.key, 0])) })
    const pick = (p: { cost_micros: number; requests: number; input_tokens: number; output_tokens: number }) =>
      metric === "cost_micros" ? p.cost_micros : metric === "requests" ? p.requests : metric === "input_tokens" ? p.input_tokens : metric === "output_tokens" ? p.output_tokens : p.input_tokens + p.output_tokens
    for (const p of data.group_series) {
      const row = byDay.get(p.day)
      const key = keyFor.get(p.key)
      if (row && key) row[key] = (Number(row[key]) || 0) + pick(p)
    }
    return { rows: [...byDay.values()], series }
  }, [data, metric])

  const exportUrl = `${exportPath}?${toQuery({ ...filters, ...range.dates })}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker state={range} />
        <FilterBar filters={filters} setFilters={setFilters} options={options} />
        <Button variant="outline" className="ml-auto" asChild>
          <a href={exportUrl} download>
            <Download /> Export CSV
          </a>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Cost" loading={!data} value={data ? usd(data.totals.cost_micros) : null} />
        <StatCard label="Requests" loading={!data} value={data?.totals.requests.toLocaleString()} hint={data && data.totals.errors ? `${data.totals.errors.toLocaleString()} errors` : "No errors"} />
        <StatCard label="Input tokens" loading={!data} value={data ? tokens(data.totals.input_tokens) : null} />
        <StatCard label="Output tokens" loading={!data} value={data ? tokens(data.totals.output_tokens) : null} />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>
            {METRIC_LABEL[metric]} by {GROUP_LABELS[groupBy].toLowerCase()}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" variant="outline" size="sm" value={metric} onValueChange={(v) => v && setMetric(v as Metric)}>
              <ToggleGroupItem value="cost_micros">Cost</ToggleGroupItem>
              <ToggleGroupItem value="requests">Requests</ToggleGroupItem>
              <ToggleGroupItem value="input_tokens">Input</ToggleGroupItem>
              <ToggleGroupItem value="output_tokens">Output</ToggleGroupItem>
            </ToggleGroup>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="w-40" aria-label="Group by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g} value={g}>
                    Group by {GROUP_LABELS[g].toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {report.error ? (
            <ErrorState error={report.error} onRetry={() => void report.refetch()} />
          ) : !data ? (
            <Skeleton className="h-72 w-full" />
          ) : data.totals.requests === 0 ? (
            <EmptyState icon={BarChart3} title="No usage in this period" description="Make a request with an API key or in the playground and it shows up here." />
          ) : (
            <DailyChart data={chart.rows} series={chart.series} metric={metric} kind="bar" height={300} />
          )}
        </CardContent>
      </Card>

      {data && data.breakdown.length > 0 ? (
        <Card className="gap-0 overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{GROUP_LABELS[groupBy]}</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="text-right">Input tokens</TableHead>
                <TableHead className="text-right">Output tokens</TableHead>
                <TableHead className="pr-4 text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.breakdown.map((g) => (
                <TableRow key={g.key}>
                  <TableCell className="max-w-72 truncate pl-4 font-medium">{g.label}</TableCell>
                  <TableCell className="tabular text-right">{g.requests.toLocaleString()}</TableCell>
                  <TableCell className="tabular text-right">{g.errors.toLocaleString()}</TableCell>
                  <TableCell className="tabular text-right">{g.input_tokens.toLocaleString()}</TableCell>
                  <TableCell className="tabular text-right">{g.output_tokens.toLocaleString()}</TableCell>
                  <TableCell className="tabular pr-4 text-right">{formatMetric("cost_micros", g.cost_micros)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </div>
  )
}
