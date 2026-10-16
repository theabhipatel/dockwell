import { useEffect, useState } from "react"
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, CreditCard, Download, ExternalLink, FileText, Plus, Receipt, Trash2, Wallet, XCircle } from "lucide-react"
import { useSearchParams } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { useWorkspaceScope } from "@/components/layout/workspace-context"
import { Page, PageHeader } from "@/components/page"
import { StatCard } from "@/components/stat-card"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { qk, useBilling, usePayments } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { cents, dollarsToMicros, microsToDollars, shortDate, usd } from "@/lib/format"
import { Perm } from "@/lib/permissions"
import type { BillingOverview } from "@/lib/types"
import { cn } from "@/lib/utils"

const PAYMENT_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  succeeded: "success",
  pending: "warning",
  failed: "destructive",
  expired: "secondary",
  refunded: "outline",
  partially_refunded: "outline",
}

const LEDGER_LABELS: Record<string, string> = {
  grant: "Grant",
  purchase: "Purchase",
  auto_recharge: "Auto recharge",
  charge: "Usage",
  refund: "Refund",
  adjustment: "Adjustment",
}

function AddCreditsDialog({ workspaceId, billing, open, onOpenChange }: { workspaceId: string; billing: BillingOverview; open: boolean; onOpenChange: (o: boolean) => void }) {
  const presets = billing.topup_presets_cents
  const [preset, setPreset] = useState<string>(String(presets[1] ?? presets[0] ?? 1000))
  const [custom, setCustom] = useState("")
  const [saveCard, setSaveCard] = useState(true)
  const amount = preset === "custom" ? Math.round(Number(custom) * 100) : Number(preset)
  const valid = Number.isFinite(amount) && amount >= billing.topup_min_cents && amount <= billing.topup_max_cents
  const checkout = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/api/workspaces/{workspace_id}/billing/checkout", {
          params: { path: { workspace_id: workspaceId } },
          body: { amount_cents: amount, save_card: saveCard },
        }),
      ),
    onSuccess: (res) => {
      window.location.href = res.url
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add credits</DialogTitle>
          <DialogDescription>
            Pay securely with Stripe. Credits are added as soon as Stripe confirms the payment.
          </DialogDescription>
        </DialogHeader>
        {billing.stripe_mode === "test" ? (
          <Alert variant="info">
            <AlertDescription>Test mode: use card 4242 4242 4242 4242, any future date and any CVC. No real money moves.</AlertDescription>
          </Alert>
        ) : null}
        <FieldGroup>
          <ToggleGroup type="single" variant="outline" value={preset} onValueChange={(v) => v && setPreset(v)} className="grid w-full grid-cols-3">
            {presets.map((p) => (
              <ToggleGroupItem key={p} value={String(p)} className="tabular">
                {cents(p)}
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
          </ToggleGroup>
          {preset === "custom" ? (
            <Field>
              <FieldLabel htmlFor="custom-amount">Amount</FieldLabel>
              <InputGroup>
                <InputGroupAddon>$</InputGroupAddon>
                <InputGroupInput id="custom-amount" type="number" min={billing.topup_min_cents / 100} max={billing.topup_max_cents / 100} step="1" autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} />
              </InputGroup>
              <FieldDescription>
                Between {cents(billing.topup_min_cents)} and {cents(billing.topup_max_cents)}.
              </FieldDescription>
            </Field>
          ) : null}
          <label className="flex items-start gap-3 text-sm">
            <Checkbox checked={saveCard} onCheckedChange={(v) => setSaveCard(v === true)} className="mt-0.5" />
            <span>
              Save card for auto recharge
              <span className="text-muted-foreground block text-xs">Stored by Stripe, never by DockWell. You can remove it any time.</span>
            </span>
          </label>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || checkout.isPending || billing.stripe_mode === "off"} onClick={() => checkout.mutate()}>
            {checkout.isPending ? <Spinner /> : <CreditCard />} Continue to payment{valid ? ` (${cents(amount)})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MoneyField({ id, label, value, onChange, placeholder, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupAddon>$</InputGroupAddon>
        <InputGroupInput id={id} type="number" min={0} step="0.01" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      </InputGroup>
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  )
}

function LimitsCard({ workspaceId, billing }: { workspaceId: string; billing: BillingOverview }) {
  const queryClient = useQueryClient()
  const [limit, setLimit] = useState(microsToDollars(billing.monthly_spend_limit_micros))
  const [alert, setAlert] = useState(microsToDollars(billing.spend_alert_micros))
  const [low, setLow] = useState(microsToDollars(billing.low_balance_threshold_micros))
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PATCH("/api/workspaces/{workspace_id}/billing/settings", {
          params: { path: { workspace_id: workspaceId } },
          body: {
            monthly_spend_limit_micros: limit ? dollarsToMicros(Number(limit)) : null,
            spend_alert_micros: alert ? dollarsToMicros(Number(alert)) : null,
            low_balance_threshold_micros: dollarsToMicros(Number(low || 0)),
          },
        }),
      ),
    onSuccess: (next) => {
      queryClient.setQueryData(qk.billing(workspaceId), next)
      toast.success("Limits saved.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spend limits and alerts</CardTitle>
        <CardDescription>The monthly limit is a hard stop: requests are refused once the workspace has spent it this month (UTC).</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <MoneyField id="limit" label="Monthly spend limit" value={limit} onChange={setLimit} placeholder="No limit" />
        <MoneyField id="alert" label="Alert threshold" value={alert} onChange={setAlert} placeholder="No alert" hint="Email and inbox alert, once a month." />
        <MoneyField id="low" label="Low balance alert" value={low} onChange={setLow} hint="Alert when the balance drops below this." />
      </CardContent>
      <CardFooter>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Spinner /> : null} Save limits
        </Button>
      </CardFooter>
    </Card>
  )
}

function AutoRechargeCard({ workspaceId, billing, onAddCredits }: { workspaceId: string; billing: BillingOverview; onAddCredits: () => void }) {
  const queryClient = useQueryClient()
  const [threshold, setThreshold] = useState(microsToDollars(billing.auto_recharge_threshold_micros))
  const [amount, setAmount] = useState(String(billing.auto_recharge_amount_cents / 100))
  const [confirmRemove, setConfirmRemove] = useState(false)
  const update = useMutation({
    mutationFn: (body: { auto_recharge_enabled?: boolean; auto_recharge_threshold_micros?: number; auto_recharge_amount_cents?: number }) =>
      unwrap(client.PATCH("/api/workspaces/{workspace_id}/billing/settings", { params: { path: { workspace_id: workspaceId } }, body })),
    onSuccess: (next) => {
      queryClient.setQueryData(qk.billing(workspaceId), next)
      toast.success("Auto recharge updated.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const removeCard = useMutation({
    mutationFn: () => unwrap(client.DELETE("/api/workspaces/{workspace_id}/billing/payment-method", { params: { path: { workspace_id: workspaceId } } })),
    onSuccess: (next) => {
      queryClient.setQueryData(qk.billing(workspaceId), next)
      toast.success("Card removed.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          Auto recharge
          <Switch
            checked={billing.auto_recharge_enabled}
            disabled={!billing.card || !billing.auto_recharge_allowed || update.isPending}
            onCheckedChange={(v) => update.mutate({ auto_recharge_enabled: v })}
            aria-label="Auto recharge"
          />
        </CardTitle>
        <CardDescription>Automatically buy credits with your saved card when the balance falls below a threshold.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!billing.auto_recharge_allowed ? (
          <p className="text-muted-foreground text-sm">Auto recharge is turned off on this platform.</p>
        ) : null}
        {billing.card ? (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <CreditCard className="text-muted-foreground size-5" />
            <div className="flex-1 text-sm">
              <p className="font-medium capitalize">
                {billing.card.brand ?? "Card"} ending {billing.card.last4}
              </p>
              {billing.card.exp ? <p className="text-muted-foreground text-xs">Expires {billing.card.exp}</p> : null}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
              <Trash2 /> Remove
            </Button>
          </div>
        ) : (
          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm">
            No saved card. Buy credits with "Save card" checked to enable auto recharge.
            <Button size="sm" variant="outline" onClick={onAddCredits}>
              <Plus /> Add credits
            </Button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField id="ar-threshold" label="When balance falls below" value={threshold} onChange={setThreshold} />
          <MoneyField id="ar-amount" label="Add this amount" value={amount} onChange={setAmount} hint={`Between ${cents(billing.topup_min_cents)} and ${cents(billing.topup_max_cents)}.`} />
        </div>
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({
              auto_recharge_threshold_micros: dollarsToMicros(Number(threshold || 0)),
              auto_recharge_amount_cents: Math.round(Number(amount || 0) * 100),
            })
          }
        >
          Save auto recharge
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove saved card?"
        description="Auto recharge is turned off. You can save a card again with your next purchase."
        confirmLabel="Remove card"
        destructive
        onConfirm={() => removeCard.mutateAsync()}
      />
    </Card>
  )
}

function DetailsCard({ workspaceId, billing }: { workspaceId: string; billing: BillingOverview }) {
  const queryClient = useQueryClient()
  const d = billing.details
  const address = d.address ?? {}
  const [form, setForm] = useState({
    name: d.name ?? "",
    email: d.email ?? "",
    line1: address.line1 ?? "",
    line2: address.line2 ?? "",
    city: address.city ?? "",
    state: address.state ?? "",
    postal_code: address.postal_code ?? "",
    country: address.country ?? "",
    tax_id_type: d.tax_id_type ?? "",
    tax_id: d.tax_id ?? "",
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PUT("/api/workspaces/{workspace_id}/billing/details", {
          params: { path: { workspace_id: workspaceId } },
          body: {
            name: form.name || null,
            email: form.email || null,
            address: {
              line1: form.line1 || null,
              line2: form.line2 || null,
              city: form.city || null,
              state: form.state || null,
              postal_code: form.postal_code || null,
              country: form.country ? form.country.toUpperCase() : null,
            },
            tax_id_type: form.tax_id_type || null,
            tax_id: form.tax_id || null,
          },
        }),
      ),
    onSuccess: (next) => {
      queryClient.setQueryData(qk.billing(workspaceId), next)
      toast.success("Billing details saved.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing details</CardTitle>
        <CardDescription>Shown on Stripe invoices and receipts.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="b-name">Company or name</FieldLabel>
          <Input id="b-name" value={form.name} onChange={set("name")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="b-email">Billing email</FieldLabel>
          <Input id="b-email" type="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="b-line1">Address</FieldLabel>
          <Input id="b-line1" value={form.line1} onChange={set("line1")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="b-line2">Address line 2</FieldLabel>
          <Input id="b-line2" value={form.line2} onChange={set("line2")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="b-city">City</FieldLabel>
          <Input id="b-city" value={form.city} onChange={set("city")} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field>
            <FieldLabel htmlFor="b-state">State</FieldLabel>
            <Input id="b-state" value={form.state} onChange={set("state")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="b-zip">Postal code</FieldLabel>
            <Input id="b-zip" value={form.postal_code} onChange={set("postal_code")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="b-country">Country</FieldLabel>
            <Input id="b-country" maxLength={2} placeholder="US" value={form.country} onChange={set("country")} />
          </Field>
        </div>
        <Field>
          <FieldLabel>Tax id type</FieldLabel>
          <Select value={form.tax_id_type || "none"} onValueChange={(v) => setForm({ ...form, tax_id_type: v === "none" ? "" : v })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="eu_vat">EU VAT</SelectItem>
              <SelectItem value="gb_vat">UK VAT</SelectItem>
              <SelectItem value="us_ein">US EIN</SelectItem>
              <SelectItem value="in_gst">India GST</SelectItem>
              <SelectItem value="au_abn">Australia ABN</SelectItem>
              <SelectItem value="ca_bn">Canada BN</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="b-tax">Tax id</FieldLabel>
          <Input id="b-tax" value={form.tax_id} onChange={set("tax_id")} />
        </Field>
      </CardContent>
      <CardFooter>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Spinner /> : null} Save details
        </Button>
      </CardFooter>
    </Card>
  )
}

function PaymentsTable({ workspaceId }: { workspaceId: string }) {
  const payments = usePayments(workspaceId)
  if (payments.isPending) return <ListSkeleton rows={3} />
  if (payments.error) return <ErrorState error={payments.error} onRetry={() => void payments.refetch()} />
  if (payments.data.length === 0) return <EmptyState icon={Receipt} title="No payments yet" description="Credit purchases and auto recharges appear here with receipts and invoices." />
  return (
    <Card className="gap-0 overflow-x-auto py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Date</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead className="hidden sm:table-cell">Type</TableHead>
            <TableHead className="hidden md:table-cell">By</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="pr-4 text-right">Documents</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.data.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="pl-4 text-sm">{shortDate(p.created_at)}</TableCell>
              <TableCell className="tabular font-medium">
                {cents(p.amount_cents)}
                {p.refunded_cents ? <span className="text-muted-foreground block text-xs">{cents(p.refunded_cents)} refunded</span> : null}
              </TableCell>
              <TableCell className="hidden text-sm sm:table-cell">{p.kind === "auto_recharge" ? "Auto recharge" : "Purchase"}</TableCell>
              <TableCell className="text-muted-foreground hidden text-sm md:table-cell">{p.user_name ?? "-"}</TableCell>
              <TableCell>
                <Badge variant={PAYMENT_VARIANT[p.status] ?? "secondary"}>{p.status.replace("_", " ")}</Badge>
                {p.failure_message ? <p className="text-destructive mt-1 max-w-48 text-xs">{p.failure_message}</p> : null}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <div className="flex justify-end gap-1">
                  {p.receipt_url ? (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={p.receipt_url} target="_blank" rel="noopener noreferrer">
                        <Receipt /> Receipt
                      </a>
                    </Button>
                  ) : null}
                  {p.invoice_pdf_url ? (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={p.invoice_pdf_url} target="_blank" rel="noopener noreferrer">
                        <FileText /> Invoice
                      </a>
                    </Button>
                  ) : p.invoice_url ? (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={p.invoice_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink /> Invoice
                      </a>
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

function LedgerTable({ workspaceId }: { workspaceId: string }) {
  const [kind, setKind] = useState<string>("all")
  const ledger = useInfiniteQuery({
    queryKey: qk.ledger(workspaceId, kind),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        client.GET("/api/workspaces/{workspace_id}/billing/ledger", {
          params: { path: { workspace_id: workspaceId }, query: { kind: kind === "all" ? undefined : kind, before_id: pageParam, limit: 50 } },
        }),
      ),
    getNextPageParam: (last) => last.next_before_id ?? undefined,
  })
  const rows = ledger.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entries</SelectItem>
            {Object.entries(LEDGER_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" className="ml-auto" asChild>
          <a href={`/api/workspaces/${workspaceId}/billing/ledger/export.csv`} download>
            <Download /> Export CSV
          </a>
        </Button>
      </div>
      {ledger.isPending ? (
        <ListSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Wallet} title="No ledger entries" description="Every grant, purchase, usage charge, refund and adjustment is listed here." />
      ) : (
        <Card className="gap-0 overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="pr-4 text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-4 text-xs whitespace-nowrap">{shortDate(e.created_at)}</TableCell>
                  <TableCell>
                    <Badge variant={e.amount_micros >= 0 ? "success" : "secondary"}>{LEDGER_LABELS[e.kind] ?? e.kind}</Badge>
                  </TableCell>
                  <TableCell className="max-w-96 truncate text-sm" title={e.description}>
                    {e.description}
                    {e.actor_name ? <span className="text-muted-foreground"> · {e.actor_name}</span> : null}
                  </TableCell>
                  <TableCell className={cn("tabular text-right text-sm", e.amount_micros >= 0 ? "text-success" : "")}>
                    {e.amount_micros >= 0 ? "+" : ""}
                    {usd(e.amount_micros, { precise: Math.abs(e.amount_micros) < 10_000 })}
                  </TableCell>
                  <TableCell className="tabular pr-4 text-right text-sm">{usd(e.balance_after_micros)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {ledger.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" disabled={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function BillingPage() {
  const { id, workspace, can } = useWorkspaceScope()
  useBreadcrumbs([{ label: workspace.name, to: `/w/${id}` }, { label: "Billing" }])
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const canView = can(Perm.viewBilling) || can(Perm.manageBilling)
  const billing = useBilling(id, canView)
  const [adding, setAdding] = useState(false)
  const checkout = params.get("checkout")

  useEffect(() => {
    if (params.get("add")) {
      setAdding(true)
      const next = new URLSearchParams(params)
      next.delete("add")
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  // After returning from Stripe, the webhook may land a moment later: poll briefly.
  useEffect(() => {
    if (checkout !== "success") return
    const timers = [1500, 4000, 8000, 15000].map((ms) =>
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: qk.billing(id) })
        void queryClient.invalidateQueries({ queryKey: qk.payments(id) })
      }, ms),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [checkout, id, queryClient])

  if (!canView) {
    return (
      <Page>
        <EmptyState icon={Wallet} title="No billing access" description="Your role does not include billing." />
      </Page>
    )
  }
  if (billing.error) {
    return (
      <Page>
        <ErrorState error={billing.error} onRetry={() => void billing.refetch()} />
      </Page>
    )
  }
  const b = billing.data
  const manage = b?.can_manage ?? false

  return (
    <Page wide>
      <PageHeader
        eyebrow="Manage"
        title="Billing"
        description="Pay as you go. Credits belong to the workspace and every request is charged at the model's price per token."
        actions={
          manage && b ? (
            <Button onClick={() => setAdding(true)} disabled={b.stripe_mode === "off"}>
              <Plus /> Add credits
            </Button>
          ) : null
        }
      />
      {checkout === "success" ? (
        <Alert variant="success" className="mb-5">
          <CheckCircle2 />
          <AlertTitle>Payment received</AlertTitle>
          <AlertDescription>Your credits appear as soon as Stripe confirms the payment, usually within seconds.</AlertDescription>
        </Alert>
      ) : checkout === "cancelled" ? (
        <Alert className="mb-5">
          <XCircle />
          <AlertTitle>Checkout cancelled</AlertTitle>
          <AlertDescription>No payment was made.</AlertDescription>
        </Alert>
      ) : null}
      {b?.stripe_mode === "off" ? (
        <Alert variant="warning" className="mb-5">
          <CreditCard />
          <AlertTitle>Payments are not configured</AlertTitle>
          <AlertDescription>The platform admin has not set up Stripe yet. Credits can still be granted by an admin.</AlertDescription>
        </Alert>
      ) : b?.stripe_mode === "test" ? (
        <Alert variant="info" className="mb-5">
          <CreditCard />
          <AlertDescription>Stripe is in test mode. No real money is charged.</AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Credit balance" icon={Wallet} loading={!b} value={b ? usd(b.balance_micros) : null} tone={b && b.balance_micros < b.low_balance_threshold_micros ? "warning" : "default"} />
        <StatCard label="Available now" loading={!b} value={b ? usd(b.available_micros) : null} hint={b && b.reserved_micros ? `${usd(b.reserved_micros, { precise: true })} held by requests in flight` : "Nothing reserved"} />
        <StatCard
          label="Spend this month"
          loading={!b}
          value={b ? usd(b.period_spend_micros) : null}
          hint={
            b?.monthly_spend_limit_micros ? (
              <div className="space-y-1">
                <Progress value={Math.min(100, (b.period_spend_micros / b.monthly_spend_limit_micros) * 100)} className="h-1.5" />
                <span>of {usd(b.monthly_spend_limit_micros)} limit</span>
              </div>
            ) : (
              "No monthly limit"
            )
          }
        />
        <StatCard label="Auto recharge" loading={!b} value={b ? (b.auto_recharge_enabled ? "On" : "Off") : null} hint={b?.auto_recharge_enabled ? `Adds ${cents(b.auto_recharge_amount_cents)} below ${usd(b.auto_recharge_threshold_micros)}` : "Manual top-ups"} />
      </div>

      <Tabs defaultValue="payments">
        <TabsList>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="ledger">Credit ledger</TabsTrigger>
          {manage ? <TabsTrigger value="settings">Limits and auto recharge</TabsTrigger> : null}
          {manage ? <TabsTrigger value="details">Billing details</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="payments" className="pt-2">
          <PaymentsTable workspaceId={id} />
        </TabsContent>
        <TabsContent value="ledger" className="pt-2">
          <LedgerTable workspaceId={id} />
        </TabsContent>
        {manage && b ? (
          <TabsContent value="settings" className="space-y-6 pt-2">
            <LimitsCard workspaceId={id} billing={b} />
            <AutoRechargeCard workspaceId={id} billing={b} onAddCredits={() => setAdding(true)} />
          </TabsContent>
        ) : null}
        {manage && b ? (
          <TabsContent value="details" className="pt-2">
            <DetailsCard workspaceId={id} billing={b} />
          </TabsContent>
        ) : null}
      </Tabs>
      {b ? <AddCreditsDialog workspaceId={id} billing={b} open={adding} onOpenChange={setAdding} /> : null}
    </Page>
  )
}
