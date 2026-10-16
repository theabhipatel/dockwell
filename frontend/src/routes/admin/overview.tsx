import { useQuery } from "@tanstack/react-query"
import { Activity, Building2, Coins, Gauge, Hash, Sparkles, TriangleAlert, Users } from "lucide-react"

import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { Page, PageHeader } from "@/components/page"
import { StatCard } from "@/components/stat-card"
import { ErrorState } from "@/components/states"
import { DailyChart } from "@/components/usage-chart"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { client, unwrap } from "@/lib/api"
import { cents, compact, ms, plural, tokens, usd } from "@/lib/format"

export function AdminOverviewPage() {
  useBreadcrumbs([{ label: "Admin" }, { label: "Overview" }])
  const q = useQuery({ queryKey: ["admin", "overview"], queryFn: () => unwrap(client.GET("/api/admin/overview")), refetchInterval: 60_000 })
  const d = q.data
  if (q.error) return <Page><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Page>
  const errorRate = d && d.requests_30d ? (d.errors_30d / d.requests_30d) * 100 : 0
  return (
    <Page wide>
      <PageHeader eyebrow="Admin" title="Platform overview" description="Users, revenue, credits and traffic across the whole install. Last 30 days unless noted." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Users" icon={Users} loading={!d} value={d?.users_total.toLocaleString()} hint={d ? `${d.users_active_30d} active, ${d.users_new_7d} new this week` : null} />
        <StatCard label="Workspaces" icon={Building2} loading={!d} value={d?.workspaces_total.toLocaleString()} />
        <StatCard label="Revenue (30 days)" icon={Coins} loading={!d} value={d ? cents(d.revenue_cents_30d) : null} hint={d ? `${cents(d.revenue_cents_total)} all time, net of refunds` : null} />
        <StatCard label="Credits sold vs used" icon={Gauge} loading={!d} value={d ? `${usd(d.credits_sold_micros)} / ${usd(d.credits_used_micros)}` : null} hint={d ? `${usd(d.credits_granted_micros)} granted, ${usd(d.outstanding_balance_micros)} outstanding` : null} />
        <StatCard label="Requests" icon={Hash} loading={!d} value={d ? compact(d.requests_30d) : null} hint={d ? `${d.requests_today.toLocaleString()} today` : null} />
        <StatCard label="Tokens" icon={Sparkles} loading={!d} value={d ? tokens(d.tokens_30d) : null} />
        <StatCard label="Errors" icon={TriangleAlert} loading={!d} tone={errorRate > 5 ? "warning" : "default"} value={d ? d.errors_30d.toLocaleString() : null} hint={d ? `${errorRate.toFixed(2)}% of requests` : null} />
        <StatCard label="Average latency" icon={Activity} loading={!d} value={d ? ms(d.avg_latency_ms_30d) : null} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Requests per day</CardTitle></CardHeader>
          <CardContent>
            {d ? <DailyChart data={d.daily.map((x) => ({ day: x.day, req: x.requests, err: x.errors }))} series={[{ key: "req", label: "Requests" }, { key: "err", label: "Errors" }]} metric="requests" /> : <Skeleton className="h-64" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Revenue and usage per day</CardTitle></CardHeader>
          <CardContent>
            {d ? <DailyChart data={d.daily.map((x) => ({ day: x.day, revenue: x.revenue_cents * 10_000, used: x.cost_micros }))} series={[{ key: "revenue", label: "Revenue" }, { key: "used", label: "Credits used" }]} metric="cost_micros" kind="bar" /> : <Skeleton className="h-64" />}
          </CardContent>
        </Card>
        <TopTable title="Top models" rows={d?.top_models} />
        <TopTable title="Top workspaces" rows={d?.top_workspaces} />
      </div>
    </Page>
  )
}

function TopTable({ title, rows }: { title: string; rows?: { id: string; label: string; requests: number; tokens: number; cost_micros: number }[] }) {
  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="pb-4"><CardTitle>{title}</CardTitle></CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6">Name</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="pr-6 text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).length === 0 ? (
            <TableRow><TableCell colSpan={4} className="text-muted-foreground py-6 text-center text-sm">{rows ? "No traffic yet." : "Loading..."}</TableCell></TableRow>
          ) : (
            rows?.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-56 truncate pl-6">{r.label}</TableCell>
                <TableCell className="tabular text-right">{plural(r.requests, "req")}</TableCell>
                <TableCell className="tabular text-right">{tokens(r.tokens)}</TableCell>
                <TableCell className="tabular pr-6 text-right">{usd(r.cost_micros)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  )
}
