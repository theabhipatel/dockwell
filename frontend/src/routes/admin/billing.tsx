import { useState } from "react"
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CreditCard, Download, ExternalLink, Receipt, RotateCcw, Search } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { Page, PageHeader } from "@/components/page"
import { StatCard } from "@/components/stat-card"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states"
import { DailyChart } from "@/components/usage-chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { Schemas } from "@/lib/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { cents, shortDate, usd } from "@/lib/format"
import { Pager } from "@/routes/admin/users"
import { toQuery } from "@/components/usage-explorer"

type Payment = Schemas["PaymentOut"]
const VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  succeeded: "success", pending: "warning", failed: "destructive", expired: "secondary", refunded: "outline", partially_refunded: "outline",
}

function RefundDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const queryClient = useQueryClient()
  const remaining = payment.amount_cents - payment.refunded_cents
  const [amount, setAmount] = useState(String(remaining / 100))
  const [reason, setReason] = useState("")
  const refund = useMutation({
    mutationFn: () => unwrap(client.POST("/api/admin/payments/{payment_id}/refund", { params: { path: { payment_id: payment.id } }, body: { amount_cents: Math.round(Number(amount) * 100), reason } })),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "payments"] })
      toast.success(res.message)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Refund ${payment.workspace_name}`}
      description={`The refund is issued through Stripe. When Stripe confirms it, the same amount of credit is removed from the workspace. Up to ${cents(remaining)} can be refunded.`}
      confirmLabel="Issue refund"
      destructive
      onConfirm={async () => {
        if (reason.trim().length < 3) {
          toast.error("Enter a reason.")
          throw new Error("reason")
        }
        await refund.mutateAsync()
      }}
    >
      <div className="space-y-3">
        <Field>
          <FieldLabel>Amount</FieldLabel>
          <InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={0.5} max={remaining / 100} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></InputGroup>
        </Field>
        <Textarea placeholder="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </ConfirmDialog>
  )
}

function Payments() {
  const [status, setStatus] = useState("all")
  const [q, setQ] = useState("")
  const [offset, setOffset] = useState(0)
  const [refunding, setRefunding] = useState<Payment | null>(null)
  const query = { status: status === "all" ? undefined : status, q: q || undefined }
  const payments = useQuery({
    queryKey: ["admin", "payments", query, offset],
    queryFn: () => unwrap(client.GET("/api/admin/payments", { params: { query: { ...query, offset, limit: 50 } } })),
    placeholderData: keepPreviousData,
  })
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput placeholder="Workspace or payment intent" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0) }} />
        </InputGroup>
        <Select value={status} onValueChange={(v) => { setStatus(v); setOffset(0) }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payments</SelectItem>
            <SelectItem value="succeeded">Succeeded</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" className="ml-auto" asChild>
          <a href={`/api/admin/payments/export.csv?${toQuery(query)}`} download><Download /> Export CSV</a>
        </Button>
      </div>
      {payments.isPending ? <ListSkeleton rows={5} /> : payments.error ? <ErrorState error={payments.error} /> : payments.data.items.length === 0 ? (
        <EmptyState icon={CreditCard} title="No payments" />
      ) : (
        <>
          <Card className="gap-0 overflow-x-auto py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Date</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-4 text-sm">{shortDate(p.created_at)}{p.livemode === false ? <Badge variant="outline" className="ml-2">test</Badge> : null}</TableCell>
                    <TableCell>{p.workspace_id ? <Link className="hover:underline" to={`/admin/workspaces/${p.workspace_id}`}>{p.workspace_name}</Link> : <span className="text-muted-foreground">{p.workspace_name} (deleted)</span>}</TableCell>
                    <TableCell className="tabular">{cents(p.amount_cents)}{p.refunded_cents ? <span className="text-muted-foreground block text-xs">-{cents(p.refunded_cents)}</span> : null}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{p.kind === "auto_recharge" ? "Auto recharge" : "Checkout"}</TableCell>
                    <TableCell><Badge variant={VARIANT[p.status] ?? "secondary"}>{p.status.replace("_", " ")}</Badge>{p.failure_message ? <p className="text-destructive mt-1 max-w-48 truncate text-xs">{p.failure_message}</p> : null}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <div className="flex justify-end gap-1">
                        {p.receipt_url ? <Button variant="ghost" size="icon-sm" asChild><a href={p.receipt_url} target="_blank" rel="noopener noreferrer" aria-label="Receipt"><Receipt /></a></Button> : null}
                        {p.invoice_url ? <Button variant="ghost" size="icon-sm" asChild><a href={p.invoice_url} target="_blank" rel="noopener noreferrer" aria-label="Invoice"><ExternalLink /></a></Button> : null}
                        {(p.status === "succeeded" || p.status === "partially_refunded") ? <Button variant="ghost" size="sm" onClick={() => setRefunding(p)}><RotateCcw /> Refund</Button> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Pager offset={offset} total={payments.data.total} onChange={setOffset} />
        </>
      )}
      {refunding ? <RefundDialog payment={refunding} onClose={() => setRefunding(null)} /> : null}
    </div>
  )
}

function Ledger() {
  const [kind, setKind] = useState("all")
  const ledger = useInfiniteQuery({
    queryKey: ["admin", "ledger", kind],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => unwrap(client.GET("/api/admin/ledger", { params: { query: { kind: kind === "all" ? undefined : kind, before_id: pageParam, limit: 50 } } })),
    getNextPageParam: (last) => last.next_before_id ?? undefined,
  })
  const rows = ledger.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="space-y-3">
      <Select value={kind} onValueChange={setKind}>
        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All except usage</SelectItem>
          {["grant", "purchase", "auto_recharge", "refund", "adjustment", "charge"].map((k) => <SelectItem key={k} value={k}>{k.replace("_", " ")}</SelectItem>)}
        </SelectContent>
      </Select>
      {ledger.isPending ? <ListSkeleton rows={5} /> : (
        <Card className="gap-0 overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead className="pl-4">Date</TableHead><TableHead>Workspace</TableHead><TableHead>Type</TableHead><TableHead>Description</TableHead><TableHead className="pr-4 text-right">Amount</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-4 text-xs">{shortDate(e.created_at)}</TableCell>
                  <TableCell><Link className="text-sm hover:underline" to={`/admin/workspaces/${e.workspace_id}`}>Open</Link></TableCell>
                  <TableCell><Badge variant="outline">{e.kind}</Badge></TableCell>
                  <TableCell className="max-w-96 truncate text-sm">{e.description}{e.actor_name ? <span className="text-muted-foreground"> · {e.actor_name}</span> : null}</TableCell>
                  <TableCell className="tabular pr-4 text-right">{usd(e.amount_micros, { precise: Math.abs(e.amount_micros) < 10_000 })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {ledger.hasNextPage ? <div className="flex justify-center"><Button variant="outline" onClick={() => void ledger.fetchNextPage()}>Load more</Button></div> : null}
    </div>
  )
}

export function AdminBillingPage() {
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Billing" }])
  const [days, setDays] = useState("90")
  const revenue = useQuery({ queryKey: ["admin", "revenue", days], queryFn: () => unwrap(client.GET("/api/admin/revenue", { params: { query: { days: Number(days) } } })) })
  const r = revenue.data
  return (
    <Page wide>
      <PageHeader eyebrow="Admin" title="Billing" description="Payments across all workspaces, refunds through Stripe, the platform ledger and revenue." />
      <div className="mb-4 flex justify-end">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{["30", "90", "365"].map((d) => <SelectItem key={d} value={d}>Last {d} days</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Revenue" loading={!r} value={r ? cents(r.total_cents) : null} />
        <StatCard label="Refunds" loading={!r} value={r ? cents(r.refunds_cents) : null} />
        <StatCard label="Payments" loading={!r} value={r?.payments.toLocaleString()} />
        <StatCard label="Failed payments" loading={!r} tone={r && r.failed ? "warning" : "default"} value={r?.failed.toLocaleString()} />
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Revenue per day</CardTitle></CardHeader>
        <CardContent>
          {r ? <DailyChart data={r.series.map((p) => ({ day: p.day, rev: p.revenue_cents * 10_000, ref: p.refunds_cents * 10_000 }))} series={[{ key: "rev", label: "Revenue" }, { key: "ref", label: "Refunds" }]} metric="cost_micros" kind="bar" /> : <Skeleton className="h-64" />}
        </CardContent>
      </Card>
      <Tabs defaultValue="payments">
        <TabsList><TabsTrigger value="payments">Payments</TabsTrigger><TabsTrigger value="ledger">Ledger</TabsTrigger></TabsList>
        <TabsContent value="payments" className="pt-2"><Payments /></TabsContent>
        <TabsContent value="ledger" className="pt-2"><Ledger /></TabsContent>
      </Tabs>
    </Page>
  )
}
