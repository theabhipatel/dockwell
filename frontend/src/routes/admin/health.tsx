import { useQuery } from "@tanstack/react-query"
import { Activity, Cpu, Database, Gauge, HeartPulse, Mail, Timer, TriangleAlert, Zap } from "lucide-react"

import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { Page, PageHeader } from "@/components/page"
import { StatCard } from "@/components/stat-card"
import { ErrorState, ListSkeleton } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { client, unwrap } from "@/lib/api"
import { ms } from "@/lib/format"

export function AdminHealthPage() {
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "System health" }])
  const h = useQuery({ queryKey: ["admin", "health"], queryFn: () => unwrap(client.GET("/api/admin/health")), refetchInterval: 10_000 })
  const d = h.data
  if (h.error) return <Page><ErrorState error={h.error} onRetry={() => void h.refetch()} /></Page>
  return (
    <Page wide>
      <PageHeader eyebrow="Admin" title="System health" description="Live engine status and the last five minutes of traffic. Refreshes every 10 seconds. Grafana has the long-term view." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Requests in flight" icon={Activity} loading={!d} value={d?.requests_in_flight} />
        <StatCard label="Requests (5 min)" icon={Gauge} loading={!d} value={d?.requests_5m.toLocaleString()} hint={d ? `avg latency ${ms(d.avg_latency_ms_5m)}` : null} />
        <StatCard label="Error rate (5 min)" icon={TriangleAlert} loading={!d} tone={d && d.error_rate_5m > 0.05 ? "danger" : "default"} value={d ? `${(d.error_rate_5m * 100).toFixed(1)}%` : null} hint={d ? `${d.errors_5m} errors` : null} />
        <StatCard label="Output tokens / second" icon={Zap} loading={!d} value={d ? d.tokens_per_second_5m.toFixed(1) : null} hint="Average over 5 minutes" />
        <StatCard label="Database" icon={Database} loading={!d} value={d ? (d.database_ok ? "Healthy" : "Down") : null} hint={d ? `${d.database_latency_ms} ms round trip` : null} />
        <StatCard label="Email outbox" icon={Mail} loading={!d} tone={d && d.email_failed > 0 ? "warning" : "default"} value={d ? `${d.email_pending} pending` : null} hint={d ? `${d.email_failed} failed` : null} />
      </div>
      <Card className="mt-6 gap-0 pb-0">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2"><HeartPulse className="size-4" /> Engines and providers</CardTitle>
          <CardDescription>Queue numbers come from each engine's own metrics endpoint (vLLM and llama.cpp).</CardDescription>
        </CardHeader>
        {!d ? <div className="p-6"><ListSkeleton rows={3} /></div> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Engine</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Models</TableHead>
                  <TableHead className="text-right">Running</TableHead>
                  <TableHead className="text-right">Queued</TableHead>
                  <TableHead className="text-right">KV cache</TableHead>
                  <TableHead className="pr-6 text-right">Tokens/s</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.engines.map((e) => (
                  <TableRow key={e.provider_id}>
                    <TableCell className="pl-6"><p className="font-medium">{e.provider_name}</p><p className="text-muted-foreground text-xs">{e.kind}{e.managed ? " · managed" : ""}</p></TableCell>
                    <TableCell>{e.ok ? <Badge variant="success">Up</Badge> : <Badge variant="destructive">Down</Badge>}<p className="text-muted-foreground mt-1 max-w-48 truncate text-xs">{e.message}</p></TableCell>
                    <TableCell className="max-w-56 truncate text-xs">{e.models.join(", ") || "-"}</TableCell>
                    <TableCell className="tabular text-right">{e.running ?? "-"}</TableCell>
                    <TableCell className="tabular text-right">{e.waiting ?? "-"}</TableCell>
                    <TableCell className="tabular text-right">{e.kv_cache_usage != null ? `${(e.kv_cache_usage * 100).toFixed(0)}%` : "-"}</TableCell>
                    <TableCell className="tabular pr-6 text-right">{e.tokens_per_second != null ? e.tokens_per_second.toFixed(1) : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Cpu className="size-4" /> GPUs</CardTitle>
          <CardDescription>{d?.gpu_source}</CardDescription>
        </CardHeader>
        <CardContent>
          {!d || d.gpus.length === 0 ? (
            <p className="text-muted-foreground text-sm">No GPU metrics available.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {d.gpus.map((g) => (
                <div key={g.gpu} className="space-y-2 rounded-lg border p-4">
                  <p className="font-medium">GPU {g.gpu}</p>
                  <div className="text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Utilisation</span><span>{g.utilization != null ? `${g.utilization.toFixed(0)}%` : "-"}</span></div>
                    <Progress value={g.utilization ?? 0} className="mt-1 h-1.5" />
                  </div>
                  <div className="text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Memory</span><span>{g.memory_used_mb != null ? `${(g.memory_used_mb / 1024).toFixed(1)} GB` : "-"}{g.memory_total_mb ? ` / ${(g.memory_total_mb / 1024).toFixed(1)} GB` : ""}</span></div>
                    <Progress value={g.memory_used_mb && g.memory_total_mb ? (g.memory_used_mb / g.memory_total_mb) * 100 : 0} className="mt-1 h-1.5" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-muted-foreground mt-4 flex items-center gap-1 text-xs"><Timer className="size-3" /> Live view only. Use Prometheus and Grafana for history.</p>
    </Page>
  )
}
