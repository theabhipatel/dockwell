import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, MoreHorizontal, Plug, Plus, RefreshCw, Server, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { Page, PageHeader } from "@/components/page"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Schemas } from "@/lib/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { dollarsToMicros, relativeTime } from "@/lib/format"
import { PasswordInput } from "@/components/password-input"

type Provider = Schemas["ProviderOut"]
type Kind = Schemas["ProviderIn"]["kind"]

const KIND_LABEL: Record<Kind, string> = { vllm: "vLLM", llamacpp: "llama.cpp", groq: "Groq", openai_compatible: "OpenAI-compatible" }
const DEFAULT_URL: Record<Kind, string> = {
  vllm: "http://vllm:8000/v1",
  llamacpp: "http://llamacpp:8080/v1",
  groq: "https://api.groq.com/openai/v1",
  openai_compatible: "https://",
}

function ProviderDialog({ provider, open, onOpenChange }: { provider: Provider | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(provider?.name ?? "")
  const [kind, setKind] = useState<Kind>((provider?.kind as Kind) ?? "groq")
  const [url, setUrl] = useState(provider?.base_url ?? DEFAULT_URL.groq)
  const [key, setKey] = useState("")
  const save = useMutation({
    mutationFn: () =>
      provider
        ? unwrap(client.PATCH("/api/admin/providers/{provider_id}", { params: { path: { provider_id: provider.id } }, body: { name, base_url: url, api_key: key || null } }))
        : unwrap(client.POST("/api/admin/providers", { body: { name, kind, base_url: url, api_key: key || null } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "providers"] })
      toast.success(provider ? "Provider updated." : "Provider added. Test it, then import its models.")
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{provider ? `Edit ${provider.name}` : "Attach a provider"}</DialogTitle>
          <DialogDescription>Any OpenAI-compatible endpoint: Groq, a vLLM or llama.cpp server you run yourself, or another API. Keys are stored encrypted.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field><FieldLabel htmlFor="pv-name">Name</FieldLabel><Input id="pv-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {!provider ? (
            <Field>
              <FieldLabel>Kind</FieldLabel>
              <Select value={kind} onValueChange={(v) => { setKind(v as Kind); setUrl(DEFAULT_URL[v as Kind]) }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(KIND_LABEL) as Kind[]).map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="pv-url">Base URL</FieldLabel>
            <Input id="pv-url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={provider?.managed} />
            <FieldDescription>Including /v1, e.g. https://api.groq.com/openai/v1</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="pv-key">API key</FieldLabel>
            <PasswordInput id="pv-key" autoComplete="off" placeholder={provider?.has_api_key ? `Saved (${provider.api_key_hint}). Leave empty to keep.` : "Optional for self-hosted engines"} value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim() || !/^https?:\/\/.+/.test(url) || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Spinner /> : null} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportDialog({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const queryClient = useQueryClient()
  const check = useQuery({
    queryKey: ["admin", "provider-check", provider.id],
    queryFn: () => unwrap(client.POST("/api/admin/providers/{provider_id}/check", { params: { path: { provider_id: provider.id } } })),
  })
  const [selected, setSelected] = useState<string[]>([])
  const [input, setInput] = useState("0")
  const [output, setOutput] = useState("0")
  const doImport = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/api/admin/providers/{provider_id}/import", {
          params: { path: { provider_id: provider.id } },
          body: { upstream_ids: selected, input_price_micros_per_m: dollarsToMicros(Number(input || 0)), output_price_micros_per_m: dollarsToMicros(Number(output || 0)) },
        }),
      ),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "models"] })
      await queryClient.invalidateQueries({ queryKey: ["admin", "providers"] })
      toast.success(`${res.length} model${res.length === 1 ? "" : "s"} added. Review their prices and context lengths under Models.`)
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const models = check.data?.models ?? []
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Models offered by {provider.name}</DialogTitle>
          <DialogDescription>Pick which models to offer on this platform.</DialogDescription>
        </DialogHeader>
        {check.isPending ? (
          <ListSkeleton rows={4} />
        ) : check.data && !check.data.ok ? (
          <p className="text-destructive text-sm">Connection failed: {check.data.message}</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {models.map((m) => (
              <li key={m.id}>
                <label className="hover:bg-muted flex items-center gap-3 rounded-md px-2 py-1.5 text-sm">
                  <Checkbox disabled={m.already_added} checked={m.already_added || selected.includes(m.id)} onCheckedChange={(v) => setSelected(v ? [...selected, m.id] : selected.filter((x) => x !== m.id))} />
                  <code className="flex-1 truncate text-xs">{m.id}</code>
                  {m.context_length ? <span className="text-muted-foreground text-xs">{m.context_length.toLocaleString()} ctx</span> : null}
                  {m.already_added ? <Badge variant="secondary">Added</Badge> : null}
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel>Input price / 1M</FieldLabel><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={0} step="0.01" value={input} onChange={(e) => setInput(e.target.value)} /></InputGroup></Field>
          <Field><FieldLabel>Output price / 1M</FieldLabel><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={0} step="0.01" value={output} onChange={(e) => setOutput(e.target.value)} /></InputGroup></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={selected.length === 0 || doImport.isPending} onClick={() => doImport.mutate()}>{doImport.isPending ? <Spinner /> : <Download />} Add {selected.length || ""} models</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdminProvidersPage() {
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Providers" }])
  const queryClient = useQueryClient()
  const providers = useQuery({ queryKey: ["admin", "providers"], queryFn: () => unwrap(client.GET("/api/admin/providers")) })
  const [editing, setEditing] = useState<Provider | null | undefined>(undefined)
  const [importing, setImporting] = useState<Provider | null>(null)
  const [deleting, setDeleting] = useState<Provider | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "providers"] })
  const test = useMutation({
    mutationFn: (p: Provider) => unwrap(client.POST("/api/admin/providers/{provider_id}/check", { params: { path: { provider_id: p.id } } })),
    onSuccess: async (res) => {
      await refresh()
      if (res.ok) toast.success(`Connected. ${res.models.length} models available.`)
      else toast.error(res.message)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const toggle = useMutation({
    mutationFn: (v: { p: Provider; enabled: boolean }) => unwrap(client.PATCH("/api/admin/providers/{provider_id}", { params: { path: { provider_id: v.p.id } }, body: { enabled: v.enabled } })),
    onSuccess: () => void refresh(),
  })
  const remove = useMutation({
    mutationFn: (p: Provider) => unwrap(client.DELETE("/api/admin/providers/{provider_id}", { params: { path: { provider_id: p.id } } })),
    onSuccess: async (res) => {
      await refresh()
      await queryClient.invalidateQueries({ queryKey: ["admin", "models"] })
      toast.success(res.message)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Page wide>
      <PageHeader
        eyebrow="Admin"
        title="Providers"
        description="Inference endpoints the gateway forwards to. Engines deployed from the Models page appear here as managed providers."
        actions={<Button onClick={() => setEditing(null)}><Plus /> Attach provider</Button>}
      />
      {providers.isPending ? (
        <ListSkeleton rows={3} />
      ) : providers.error ? (
        <ErrorState error={providers.error} onRetry={() => void providers.refetch()} />
      ) : providers.data.length === 0 ? (
        <EmptyState icon={Server} title="No providers" description="Attach Groq or any OpenAI-compatible endpoint, or deploy a model." />
      ) : (
        <Card className="gap-0 overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Provider</TableHead>
                <TableHead className="hidden md:table-cell">Base URL</TableHead>
                <TableHead>Models</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-12 pr-4"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-muted-foreground text-xs">{KIND_LABEL[p.kind as Kind] ?? p.kind}{p.managed ? " · managed engine" : ""}{p.has_api_key ? " · key saved" : ""}</p>
                  </TableCell>
                  <TableCell className="hidden max-w-72 truncate md:table-cell"><code className="text-xs">{p.base_url}</code></TableCell>
                  <TableCell>{p.model_count}</TableCell>
                  <TableCell>
                    {p.last_check_ok === null ? <Badge variant="secondary">Unknown</Badge> : p.last_check_ok ? <Badge variant="success">Healthy</Badge> : <Badge variant="destructive">Failing</Badge>}
                    {p.last_check_at ? <p className="text-muted-foreground mt-1 text-xs">{relativeTime(p.last_check_at)}</p> : null}
                    {p.last_error ? <p className="text-destructive max-w-48 truncate text-xs" title={p.last_error}>{p.last_error}</p> : null}
                  </TableCell>
                  <TableCell><Switch checked={p.enabled} onCheckedChange={(v) => toggle.mutate({ p, enabled: v })} aria-label={`Enable ${p.name}`} /></TableCell>
                  <TableCell className="pr-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => test.mutate(p)}><RefreshCw /> Test connection</DropdownMenuItem>
                        {!p.managed ? <DropdownMenuItem onSelect={() => setImporting(p)}><Plug /> Browse and add models</DropdownMenuItem> : null}
                        <DropdownMenuItem onSelect={() => setEditing(p)}>Edit</DropdownMenuItem>
                        {!p.managed ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(p)}><Trash2 /> Delete</DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {editing !== undefined ? <ProviderDialog key={editing?.id ?? "new"} provider={editing} open onOpenChange={(o) => !o && setEditing(undefined)} /> : null}
      {importing ? <ImportDialog provider={importing} onClose={() => setImporting(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "provider"}?`}
        description="Its models are removed from the catalogue. Usage history is kept."
        confirmLabel="Delete provider"
        destructive
        onConfirm={() => (deleting ? remove.mutateAsync(deleting) : undefined)}
      />
    </Page>
  )
}
