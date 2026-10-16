import { useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { ShieldCheck } from "lucide-react"

import { AuditEventSheet } from "@/components/audit-event-sheet"
import type { AuditEvent } from "@/components/audit-event-sheet"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { Page, PageHeader } from "@/components/page"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { client, unwrap } from "@/lib/api"
import { actionLabel, fullDate, shortDate } from "@/lib/format"

const GROUPS = [
  { value: "admin.user", label: "Users" },
  { value: "admin.workspace", label: "Workspaces" },
  { value: "admin.credits", label: "Credits" },
  { value: "admin.model", label: "Models" },
  { value: "admin.deployment", label: "Deployments" },
  { value: "admin.provider", label: "Providers" },
  { value: "admin.price", label: "Prices" },
  { value: "admin.settings", label: "Settings" },
  { value: "admin.payment", label: "Refunds" },
]

export function AdminAuditPage() {
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Audit log" }])
  const [action, setAction] = useState("all")
  const [selected, setSelected] = useState<AuditEvent | null>(null)
  const audit = useInfiniteQuery({
    queryKey: ["admin", "audit", action],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => unwrap(client.GET("/api/admin/audit", { params: { query: { action: action === "all" ? undefined : action, before_id: pageParam, limit: 50 } } })),
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1]?.id : undefined),
  })
  const rows = audit.data?.pages.flat() ?? []
  return (
    <Page wide>
      <PageHeader eyebrow="Admin" title="Admin audit log" description="Every action taken by a platform admin: who, what, when and from where. Append-only, enforced by the database." />
      <Select value={action} onValueChange={setAction}>
        <SelectTrigger className="mb-4 w-48"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All admin actions</SelectItem>
          {GROUPS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {audit.isPending ? <ListSkeleton rows={6} /> : audit.error ? <ErrorState error={audit.error} /> : rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No admin actions yet" />
      ) : (
        <Card className="gap-0 overflow-x-auto py-0">
          <Table>
            <TableHeader><TableRow><TableHead className="pl-4">When</TableHead><TableHead>Admin</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead className="pr-4">IP</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                  <TableCell className="pl-4 text-xs" title={fullDate(r.created_at)}>{shortDate(r.created_at)}</TableCell>
                  <TableCell className="text-sm">{r.actor_name ?? "-"}<span className="text-muted-foreground block text-xs">{r.actor_email}</span></TableCell>
                  <TableCell className="text-sm">{actionLabel(r.action)}</TableCell>
                  <TableCell className="max-w-64 truncate text-sm">{r.target_label ?? "-"}</TableCell>
                  <TableCell className="pr-4 font-mono text-xs">{r.ip ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {audit.hasNextPage ? <div className="mt-3 flex justify-center"><Button variant="outline" onClick={() => void audit.fetchNextPage()}>Load more</Button></div> : null}
      <AuditEventSheet event={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </Page>
  )
}
