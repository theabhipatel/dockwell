import { useEffect, useState } from "react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Ban, Building2, Coins, Gauge, Percent, Search, Trash2, UserCheck } from "lucide-react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { Page, PageHeader } from "@/components/page"
import { StatCard } from "@/components/stat-card"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { client, errorMessage, unwrap } from "@/lib/api"
import { cents, dollarsToMicros, microsToDollars, perMillion, shortDate, tokens, usd } from "@/lib/format"
import { Pager } from "@/routes/admin/users"

export function AdminWorkspacesPage() {
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Workspaces" }])
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [state, setState] = useState("all")
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim())
      setOffset(0)
    }, 300)
    return () => window.clearTimeout(t)
  }, [search])
  const list = useQuery({
    queryKey: ["admin", "workspaces", q, state, offset],
    queryFn: () =>
      unwrap(
        client.GET("/api/admin/workspaces", {
          params: { query: { q: q || undefined, suspended: state === "all" ? undefined : state === "suspended", offset, limit: 50 } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
  return (
    <Page wide>
      <PageHeader eyebrow="Admin" title="Workspaces" description="Every workspace, its owner, balance and limits." />
      <div className="mb-4 flex flex-wrap gap-2">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput placeholder="Search name, slug or owner email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        <Select value={state} onValueChange={(v) => { setState(v); setOffset(0) }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {list.isPending ? (
        <ListSkeleton rows={6} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={Building2} title="No workspaces found" />
      ) : (
        <>
          <Card className="gap-0 overflow-x-auto py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Workspace</TableHead>
                  <TableHead className="hidden md:table-cell">Owner</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Spend this month</TableHead>
                  <TableHead className="hidden lg:table-cell">Members</TableHead>
                  <TableHead className="pr-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="pl-4">
                      <Link to={`/admin/workspaces/${w.id}`} className="font-medium hover:underline">{w.name}</Link>
                      <p className="text-muted-foreground text-xs">{w.slug} · {shortDate(w.created_at)}</p>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{w.owner?.email ?? "-"}</TableCell>
                    <TableCell className="tabular text-right">{usd(w.balance_micros)}</TableCell>
                    <TableCell className="tabular hidden text-right sm:table-cell">{usd(w.period_spend_micros)}</TableCell>
                    <TableCell className="hidden lg:table-cell">{w.member_count}</TableCell>
                    <TableCell className="pr-4">{w.suspended ? <Badge variant="destructive">Suspended</Badge> : <Badge variant="success">Active</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Pager offset={offset} total={list.data.total} onChange={setOffset} />
        </>
      )}
    </Page>
  )
}

function CreditsCard({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const [direction, setDirection] = useState("grant")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const adjust = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/api/admin/workspaces/{workspace_id}/credits", {
          params: { path: { workspace_id: workspaceId } },
          body: { amount_micros: dollarsToMicros(Number(amount)) * (direction === "grant" ? 1 : -1), reason },
        }),
      ),
    onSuccess: (res) => {
      toast.success(res.message)
      setAmount("")
      setReason("")
      onDone()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Coins className="size-4" /> Grant or deduct credits</CardTitle>
        <CardDescription>Recorded in the workspace ledger and the admin audit log with your reason.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <ToggleGroup type="single" variant="outline" value={direction} onValueChange={(v) => v && setDirection(v)}>
            <ToggleGroupItem value="grant">Grant</ToggleGroupItem>
            <ToggleGroupItem value="deduct">Deduct</ToggleGroupItem>
          </ToggleGroup>
          <Field>
            <FieldLabel htmlFor="adj-amount">Amount</FieldLabel>
            <InputGroup>
              <InputGroupAddon>$</InputGroupAddon>
              <InputGroupInput id="adj-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="adj-reason">Reason</FieldLabel>
            <Textarea id="adj-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Compensation for downtime on 3 Oct" />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button disabled={!(Number(amount) > 0) || reason.trim().length < 3 || adjust.isPending} onClick={() => adjust.mutate()}>
          {adjust.isPending ? <Spinner /> : null} {direction === "grant" ? "Grant credits" : "Deduct credits"}
        </Button>
      </CardFooter>
    </Card>
  )
}

function LimitsCard({ workspaceId, rpm, tpm, limit, onDone }: { workspaceId: string; rpm: number | null; tpm: number | null; limit: number | null; onDone: () => void }) {
  const [r, setR] = useState(rpm ? String(rpm) : "")
  const [t, setT] = useState(tpm ? String(tpm) : "")
  const [l, setL] = useState(microsToDollars(limit))
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PATCH("/api/admin/workspaces/{workspace_id}/limits", {
          params: { path: { workspace_id: workspaceId } },
          body: { rpm_limit: r ? Number(r) : null, tpm_limit: t ? Number(t) : null, monthly_spend_limit_micros: l ? dollarsToMicros(Number(l)) : null },
        }),
      ),
    onSuccess: (res) => {
      toast.success(res.message)
      onDone()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Gauge className="size-4" /> Custom limits</CardTitle>
        <CardDescription>Empty rate limits use the platform defaults.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <Field><FieldLabel htmlFor="w-rpm">Requests / minute</FieldLabel><Input id="w-rpm" type="number" min={1} placeholder="Default" value={r} onChange={(e) => setR(e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="w-tpm">Tokens / minute</FieldLabel><Input id="w-tpm" type="number" min={1} placeholder="Default" value={t} onChange={(e) => setT(e.target.value)} /></Field>
        <Field>
          <FieldLabel htmlFor="w-limit">Monthly spend limit</FieldLabel>
          <InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput id="w-limit" type="number" min={0} placeholder="None" value={l} onChange={(e) => setL(e.target.value)} /></InputGroup>
        </Field>
      </CardContent>
      <CardFooter>
        <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>Save limits</Button>
      </CardFooter>
    </Card>
  )
}

function PricesCard({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const prices = useQuery({
    queryKey: ["admin", "ws-prices", workspaceId],
    queryFn: () => unwrap(client.GET("/api/admin/workspaces/{workspace_id}/prices", { params: { path: { workspace_id: workspaceId } } })),
  })
  const models = useQuery({ queryKey: ["admin", "models"], queryFn: () => unwrap(client.GET("/api/admin/models")) })
  const [modelId, setModelId] = useState("all")
  const [discount, setDiscount] = useState("")
  const [input, setInput] = useState("")
  const [output, setOutput] = useState("")
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "ws-prices", workspaceId] })
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PUT("/api/admin/workspaces/{workspace_id}/prices", {
          params: { path: { workspace_id: workspaceId } },
          body: {
            model_id: modelId === "all" ? null : modelId,
            discount_percent: discount ? Number(discount) : 0,
            input_micros_per_m: input ? dollarsToMicros(Number(input)) : null,
            output_micros_per_m: output ? dollarsToMicros(Number(output)) : null,
          },
        }),
      ),
    onSuccess: async () => {
      await refresh()
      toast.success("Custom price saved.")
      setDiscount("")
      setInput("")
      setOutput("")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrap(client.DELETE("/api/admin/workspaces/{workspace_id}/prices/{price_id}", { params: { path: { workspace_id: workspaceId, price_id: id } } })),
    onSuccess: () => void refresh(),
  })
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Percent className="size-4" /> Discounts and custom prices</CardTitle>
        <CardDescription>A model-specific entry wins over an "all models" entry. Custom prices win over a discount.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(prices.data ?? []).length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {prices.data?.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  <code className="text-xs">{p.model_public_id ?? "All models"}</code>{" "}
                  {p.input_micros_per_m != null || p.output_micros_per_m != null
                    ? `custom ${p.input_micros_per_m != null ? perMillion(p.input_micros_per_m) : "list"} in / ${p.output_micros_per_m != null ? perMillion(p.output_micros_per_m) : "list"} out per 1M`
                    : `${p.discount_percent}% off`}
                </span>
                <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => remove.mutate(p.id)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">This workspace pays list prices.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-4">
          <Select value={modelId} onValueChange={setModelId}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All models</SelectItem>
              {(models.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.public_id}</SelectItem>)}
            </SelectContent>
          </Select>
          <InputGroup><InputGroupInput type="number" min={0} max={100} placeholder="Discount" value={discount} onChange={(e) => setDiscount(e.target.value)} /><InputGroupAddon align="inline-end">%</InputGroupAddon></InputGroup>
          <InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={0} placeholder="Input / 1M" value={input} onChange={(e) => setInput(e.target.value)} /></InputGroup>
          <InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={0} placeholder="Output / 1M" value={output} onChange={(e) => setOutput(e.target.value)} /></InputGroup>
        </div>
        <FieldDescription>Fill either a discount or custom prices.</FieldDescription>
      </CardContent>
      <CardFooter>
        <Button variant="outline" disabled={save.isPending || (!discount && !input && !output)} onClick={() => save.mutate()}>Save price</Button>
      </CardFooter>
    </Card>
  )
}

export function AdminWorkspacePage() {
  const { workspaceId = "" } = useParams()
  const queryClient = useQueryClient()
  const ws = useQuery({
    queryKey: ["admin", "workspace", workspaceId],
    queryFn: () => unwrap(client.GET("/api/admin/workspaces/{workspace_id}", { params: { path: { workspace_id: workspaceId } } })),
  })
  const w = ws.data
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Workspaces", to: "/admin/workspaces" }, { label: w?.name ?? "Workspace" }])
  const [suspending, setSuspending] = useState(false)
  const [reason, setReason] = useState("")
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "workspace", workspaceId] })
  const toggle = useMutation({
    mutationFn: (suspend: boolean) =>
      unwrap(
        suspend
          ? client.POST("/api/admin/workspaces/{workspace_id}/suspend", { params: { path: { workspace_id: workspaceId } }, body: { reason } })
          : client.POST("/api/admin/workspaces/{workspace_id}/unsuspend", { params: { path: { workspace_id: workspaceId } } }),
      ),
    onSuccess: async (res) => {
      await refresh()
      toast.success(res.message)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (ws.error) return <Page><ErrorState error={ws.error} onRetry={() => void ws.refetch()} /></Page>
  if (!w) return <Page><ListSkeleton rows={4} /></Page>
  return (
    <Page wide>
      <PageHeader
        eyebrow="Workspace"
        title={<span className="flex items-center gap-2">{w.name}{w.suspended ? <Badge variant="destructive">Suspended</Badge> : null}</span>}
        description={`${w.slug} · owned by ${w.owner?.email ?? "unknown"} · created ${shortDate(w.created_at)}`}
        actions={
          w.suspended ? (
            <Button variant="outline" onClick={() => toggle.mutate(false)}><UserCheck /> Unsuspend</Button>
          ) : (
            <Button variant="outline" onClick={() => setSuspending(true)}><Ban /> Suspend</Button>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Balance" value={usd(w.balance_micros)} hint={w.reserved_micros ? `${usd(w.reserved_micros)} reserved` : undefined} />
        <StatCard label="Spend this month" value={usd(w.period_spend_micros)} hint={w.monthly_spend_limit_micros != null ? `Limit ${usd(w.monthly_spend_limit_micros)}` : "No limit"} />
        <StatCard label="Usage (30 days)" value={`${w.usage_30d.requests.toLocaleString()} requests`} hint={`${tokens(w.usage_30d.input_tokens + w.usage_30d.output_tokens)} tokens, ${usd(w.usage_30d.cost_micros)}`} />
        <StatCard label="Projects and keys" value={`${w.project_count} / ${w.key_count}`} hint={w.auto_recharge_enabled ? `Auto recharge on (card ${w.card_last4})` : "Auto recharge off"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <CreditsCard workspaceId={w.id} onDone={() => void refresh()} />
        <LimitsCard workspaceId={w.id} rpm={w.rpm_limit} tpm={w.tpm_limit} limit={w.monthly_spend_limit_micros} onDone={() => void refresh()} />
        <PricesCard workspaceId={w.id} />
        <Card>
          <CardHeader><CardTitle>Members</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {w.members.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <Link to={`/admin/users/${m.user_id}`} className="hover:underline">{m.name} <span className="text-muted-foreground text-xs">{m.email}</span></Link>
                  <Badge variant={m.is_owner ? "brand" : "outline"}>{m.role_name}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
          <CardContent>
            {w.payments.length === 0 ? <p className="text-muted-foreground text-sm">No payments.</p> : (
              <ul className="divide-y rounded-lg border">
                {w.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{shortDate(p.created_at)} · {p.kind === "auto_recharge" ? "Auto recharge" : "Purchase"}</span>
                    <span className="tabular">{cents(p.amount_cents)} <Badge variant="outline">{p.status}</Badge></span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={suspending}
        onOpenChange={setSuspending}
        title={`Suspend ${w.name}?`}
        description="All API keys and the playground stop working immediately. Members can still sign in and see the workspace."
        confirmLabel="Suspend workspace"
        destructive
        onConfirm={() => toggle.mutateAsync(true)}
      >
        <Textarea placeholder="Reason (shown to the workspace)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </Page>
  )
}
