import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Boxes, CircleStop, DollarSign, FileText, MoreHorizontal, Pencil, Play, Plus, RotateCw, Rocket, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { CopyButton } from "@/components/copy-button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { Page, PageHeader } from "@/components/page"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { Schemas } from "@/lib/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { contextLength, dollarsToMicros, fullDate, microsToDollars, perMillion, relativeTime, shortDate } from "@/lib/format"
import { cn } from "@/lib/utils"

type AdminModel = Schemas["AdminModelOut"]
type Capability = NonNullable<Schemas["ModelIn"]["capabilities"]>[number]
const CAPS: Capability[] = ["chat", "completions", "tools", "vision", "embeddings"]

const STATUS_VARIANT = { ready: "success", downloading: "info", starting: "warning", failed: "destructive", stopped: "secondary" } as const

function useInvalidate() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "models"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "deployments"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "providers"] }),
    ])
}

function CapabilityPicker({ value, onChange }: { value: Capability[]; onChange: (v: Capability[]) => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      {CAPS.map((c) => (
        <label key={c} className="flex items-center gap-1.5 text-sm capitalize">
          <Checkbox checked={value.includes(c)} onCheckedChange={(v) => onChange(v ? [...value, c] : value.filter((x) => x !== c))} />
          {c}
        </label>
      ))}
    </div>
  )
}

function PriceInputs({ input, output, setInput, setOutput }: { input: string; output: string; setInput: (v: string) => void; setOutput: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel>Input price / 1M tokens</FieldLabel>
        <InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={0} step="0.001" value={input} onChange={(e) => setInput(e.target.value)} /></InputGroup>
      </Field>
      <Field>
        <FieldLabel>Output price / 1M tokens</FieldLabel>
        <InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={0} step="0.001" value={output} onChange={(e) => setOutput(e.target.value)} /></InputGroup>
      </Field>
    </div>
  )
}

function DeployDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidate()
  const manager = useQuery({ queryKey: ["admin", "engine-manager"], queryFn: () => unwrap(client.GET("/api/admin/engine-manager")), enabled: open })
  const [engine, setEngine] = useState<"vllm" | "llamacpp">("vllm")
  const [repo, setRepo] = useState("")
  const [file, setFile] = useState("")
  const [publicId, setPublicId] = useState("")
  const [name, setName] = useState("")
  const [ctx, setCtx] = useState("8192")
  const [gpus, setGpus] = useState("1")
  const [quant, setQuant] = useState("none")
  const [dtype, setDtype] = useState("auto")
  const [mem, setMem] = useState("0.9")
  const [extra, setExtra] = useState("")
  const [caps, setCaps] = useState<Capability[]>(["chat", "completions"])
  const [input, setInput] = useState("0")
  const [output, setOutput] = useState("0")
  useEffect(() => {
    if (!publicId && repo.includes("/")) setPublicId(repo.split("/")[1].toLowerCase())
    if (!name && repo.includes("/")) setName(repo.split("/")[1])
  }, [repo, publicId, name])
  const deploy = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/api/admin/deployments", {
          body: {
            engine,
            hf_repo: repo.trim(),
            hf_file: engine === "llamacpp" && file.trim() ? file.trim() : null,
            public_id: publicId.trim(),
            display_name: name.trim(),
            capabilities: caps,
            context_length: Number(ctx),
            gpu_count: engine === "vllm" ? Number(gpus) : Number(gpus) > 0 ? 1 : 0,
            quantization: quant === "none" ? null : quant,
            dtype,
            gpu_memory_utilization: Number(mem),
            extra_args: extra.trim() ? extra.trim().split(/\s+/) : [],
            input_price_micros_per_m: dollarsToMicros(Number(input || 0)),
            output_price_micros_per_m: dollarsToMicros(Number(output || 0)),
          },
        }),
      ),
    onSuccess: async () => {
      await invalidate()
      toast.success("Deployment started. The engine is downloading the model.")
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Deploy a model</DialogTitle>
          <DialogDescription>DockWell starts an engine container that downloads the weights from Hugging Face and serves them.</DialogDescription>
        </DialogHeader>
        {manager.data && !manager.data.ok ? (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertTitle>Engine manager unavailable</AlertTitle>
            <AlertDescription>{manager.data.message} Attach an existing endpoint under Providers instead.</AlertDescription>
          </Alert>
        ) : null}
        <FieldGroup>
          <Tabs value={engine} onValueChange={(v) => setEngine(v as "vllm" | "llamacpp")}>
            <TabsList>
              <TabsTrigger value="vllm">vLLM (GPU)</TabsTrigger>
              <TabsTrigger value="llamacpp">llama.cpp (CPU, GGUF)</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="d-repo">Hugging Face id</FieldLabel>
              <Input id="d-repo" placeholder={engine === "vllm" ? "Qwen/Qwen2.5-7B-Instruct" : "Qwen/Qwen2.5-0.5B-Instruct-GGUF"} value={repo} onChange={(e) => setRepo(e.target.value)} />
            </Field>
            {engine === "llamacpp" ? (
              <Field>
                <FieldLabel htmlFor="d-file">GGUF file or quant tag</FieldLabel>
                <Input id="d-file" placeholder="qwen2.5-0.5b-instruct-q4_k_m.gguf" value={file} onChange={(e) => setFile(e.target.value)} />
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="d-gpus">GPU count</FieldLabel>
                <Input id="d-gpus" type="number" min={1} max={16} value={gpus} onChange={(e) => setGpus(e.target.value)} />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="d-public">Public model id</FieldLabel>
              <Input id="d-public" value={publicId} onChange={(e) => setPublicId(e.target.value)} />
              <FieldDescription>What clients send as "model".</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="d-name">Display name</FieldLabel>
              <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="d-ctx">Context length</FieldLabel>
              <Input id="d-ctx" type="number" min={256} value={ctx} onChange={(e) => setCtx(e.target.value)} />
            </Field>
            {engine === "vllm" ? (
              <>
                <Field>
                  <FieldLabel>Quantization</FieldLabel>
                  <Select value={quant} onValueChange={setQuant}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["none", "awq", "gptq", "fp8", "bitsandbytes", "gguf"].map((q) => <SelectItem key={q} value={q}>{q === "none" ? "None" : q}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Precision</FieldLabel>
                  <Select value={dtype} onValueChange={setDtype}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["auto", "bfloat16", "float16", "float32"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="d-mem">GPU memory share</FieldLabel>
                  <Input id="d-mem" type="number" min={0.1} max={1} step={0.05} value={mem} onChange={(e) => setMem(e.target.value)} />
                </Field>
              </>
            ) : (
              <Field>
                <FieldLabel htmlFor="d-gpu-cpp">GPU offload</FieldLabel>
                <Select value={gpus === "0" ? "0" : "1"} onValueChange={setGpus}>
                  <SelectTrigger id="d-gpu-cpp" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">CPU only</SelectItem>
                    <SelectItem value="1">Use 1 GPU (CUDA image)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          <Field>
            <FieldLabel>Capabilities</FieldLabel>
            <CapabilityPicker value={caps} onChange={setCaps} />
          </Field>
          <Field>
            <FieldLabel htmlFor="d-extra">Extra engine arguments</FieldLabel>
            <Input id="d-extra" placeholder={engine === "vllm" ? "--enable-prefix-caching" : "--threads 8"} value={extra} onChange={(e) => setExtra(e.target.value)} />
          </Field>
          <PriceInputs input={input} output={output} setInput={setInput} setOutput={setOutput} />
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!repo.includes("/") || !publicId.trim() || !name.trim() || deploy.isPending} onClick={() => deploy.mutate()}>
            {deploy.isPending ? <Spinner /> : <Rocket />} Deploy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddModelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidate()
  const providers = useQuery({ queryKey: ["admin", "providers"], queryFn: () => unwrap(client.GET("/api/admin/providers")), enabled: open })
  const [providerId, setProviderId] = useState("")
  const [upstream, setUpstream] = useState("")
  const [publicId, setPublicId] = useState("")
  const [name, setName] = useState("")
  const [ctx, setCtx] = useState("8192")
  const [caps, setCaps] = useState<Capability[]>(["chat", "completions"])
  const [input, setInput] = useState("0")
  const [output, setOutput] = useState("0")
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/api/admin/models", {
          body: {
            provider_id: providerId,
            upstream_id: upstream.trim(),
            public_id: (publicId || upstream).trim(),
            display_name: (name || upstream).trim(),
            context_length: Number(ctx),
            capabilities: caps,
            input_price_micros_per_m: dollarsToMicros(Number(input || 0)),
            output_price_micros_per_m: dollarsToMicros(Number(output || 0)),
          },
        }),
      ),
    onSuccess: async () => {
      await invalidate()
      toast.success("Model added.")
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const external = (providers.data ?? []).filter((p) => !p.managed)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a model from a provider</DialogTitle>
          <DialogDescription>Expose a model served by an attached provider (Groq, an existing vLLM or any OpenAI-compatible API).</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>Provider</FieldLabel>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a provider" /></SelectTrigger>
              <SelectContent>{external.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="m-up">Provider model name</FieldLabel><Input id="m-up" value={upstream} onChange={(e) => setUpstream(e.target.value)} placeholder="llama-3.1-8b-instant" /></Field>
            <Field><FieldLabel htmlFor="m-pub">Public id</FieldLabel><Input id="m-pub" value={publicId} onChange={(e) => setPublicId(e.target.value)} placeholder="Same as provider name" /></Field>
            <Field><FieldLabel htmlFor="m-name">Display name</FieldLabel><Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="m-ctx">Context length</FieldLabel><Input id="m-ctx" type="number" value={ctx} onChange={(e) => setCtx(e.target.value)} /></Field>
          </div>
          <Field><FieldLabel>Capabilities</FieldLabel><CapabilityPicker value={caps} onChange={setCaps} /></Field>
          <PriceInputs input={input} output={output} setInput={setInput} setOutput={setOutput} />
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!providerId || !upstream.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Spinner /> : null} Add model</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditModelSheet({ model, onClose }: { model: AdminModel; onClose: () => void }) {
  const invalidate = useInvalidate()
  const queryClient = useQueryClient()
  const workspaces = useQuery({ queryKey: ["admin", "workspaces", "", "all", 0], queryFn: () => unwrap(client.GET("/api/admin/workspaces", { params: { query: { limit: 200 } } })) })
  const [form, setForm] = useState({
    public_id: model.public_id,
    display_name: model.display_name,
    description: model.description,
    owned_by: model.owned_by,
    upstream_id: model.upstream_id,
    context_length: String(model.context_length),
    max_output_tokens: model.max_output_tokens ? String(model.max_output_tokens) : "",
    sort_order: String(model.sort_order),
  })
  const [caps, setCaps] = useState<Capability[]>(model.capabilities as Capability[])
  const [visibility, setVisibility] = useState(model.visibility)
  const [allowed, setAllowed] = useState<string[]>(model.allowed_workspace_ids)
  const [retire, setRetire] = useState(model.retirement_date ? model.retirement_date.slice(0, 10) : "")
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value })
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PATCH("/api/admin/models/{model_id}", {
          params: { path: { model_id: model.id } },
          body: {
            ...form,
            context_length: Number(form.context_length),
            max_output_tokens: form.max_output_tokens ? Number(form.max_output_tokens) : null,
            sort_order: Number(form.sort_order),
            capabilities: caps,
            visibility,
            allowed_workspace_ids: allowed,
          },
        }),
      ),
    onSuccess: async () => {
      await invalidate()
      toast.success("Model saved.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const deprecate = useMutation({
    mutationFn: (undo: boolean) =>
      unwrap(
        client.POST("/api/admin/models/{model_id}/deprecate", {
          params: { path: { model_id: model.id } },
          body: { undo, retirement_date: retire ? new Date(`${retire}T00:00:00Z`).toISOString() : null },
        }),
      ),
    onSuccess: async () => {
      await invalidate()
      toast.success("Deprecation updated. Workspaces that used this model were notified.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const prices = useQuery({ queryKey: ["admin", "prices", model.id], queryFn: () => unwrap(client.GET("/api/admin/models/{model_id}/prices", { params: { path: { model_id: model.id } } })) })
  const current = prices.data?.find((p) => p.current)
  const [pIn, setPIn] = useState("")
  const [pOut, setPOut] = useState("")
  const [pCached, setPCached] = useState("")
  const [pMin, setPMin] = useState("")
  const [pFree, setPFree] = useState(false)
  const [pFrom, setPFrom] = useState("")
  useEffect(() => {
    if (current) {
      setPIn(microsToDollars(current.input_micros_per_m))
      setPOut(microsToDollars(current.output_micros_per_m))
      setPCached(microsToDollars(current.cached_input_micros_per_m))
      setPMin(current.min_charge_micros ? microsToDollars(current.min_charge_micros) : "")
      setPFree(current.is_free)
    }
  }, [current])
  const setPrice = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/api/admin/models/{model_id}/prices", {
          params: { path: { model_id: model.id } },
          body: {
            input_micros_per_m: dollarsToMicros(Number(pIn || 0)),
            output_micros_per_m: dollarsToMicros(Number(pOut || 0)),
            cached_input_micros_per_m: pCached ? dollarsToMicros(Number(pCached)) : null,
            min_charge_micros: pMin ? dollarsToMicros(Number(pMin)) : 0,
            is_free: pFree,
            effective_from: pFrom ? new Date(pFrom).toISOString() : null,
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "prices", model.id] })
      await invalidate()
      toast.success(pFrom ? "Price scheduled." : "Price updated. It applies to new requests from now on.")
      setPFrom("")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{model.display_name}</SheetTitle>
          <SheetDescription className="flex items-center gap-1">
            <code>{model.public_id}</code>
            <CopyButton value={model.public_id} label="Copy model id" size="icon-xs" />
            via {model.provider_name}
          </SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="details" className="px-4 pb-6">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="pricing">Pricing</TabsTrigger>
            <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="pt-3">
            <FieldGroup>
              <div className="grid grid-cols-2 gap-3">
                <Field><FieldLabel>Public id</FieldLabel><Input value={form.public_id} onChange={set("public_id")} /></Field>
                <Field><FieldLabel>Display name</FieldLabel><Input value={form.display_name} onChange={set("display_name")} /></Field>
                <Field><FieldLabel>Provider model name</FieldLabel><Input value={form.upstream_id} onChange={set("upstream_id")} /></Field>
                <Field><FieldLabel>Owned by</FieldLabel><Input value={form.owned_by} onChange={set("owned_by")} /></Field>
                <Field><FieldLabel>Context length</FieldLabel><Input type="number" value={form.context_length} onChange={set("context_length")} /></Field>
                <Field><FieldLabel>Max output tokens</FieldLabel><Input type="number" placeholder="Context limit" value={form.max_output_tokens} onChange={set("max_output_tokens")} /></Field>
                <Field><FieldLabel>Sort order</FieldLabel><Input type="number" value={form.sort_order} onChange={set("sort_order")} /></Field>
              </div>
              <Field><FieldLabel>Description</FieldLabel><Textarea rows={3} value={form.description} onChange={set("description")} /></Field>
              <Field><FieldLabel>Capabilities</FieldLabel><CapabilityPicker value={caps} onChange={setCaps} /></Field>
              <Field>
                <FieldLabel>Visible to</FieldLabel>
                <Select value={visibility} onValueChange={(v) => setVisibility(v as "all" | "selected")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All workspaces</SelectItem>
                    <SelectItem value="selected">Selected workspaces only</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {visibility === "selected" ? (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {(workspaces.data?.items ?? []).map((w) => (
                    <label key={w.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={allowed.includes(w.id)} onCheckedChange={(v) => setAllowed(v ? [...allowed, w.id] : allowed.filter((x) => x !== w.id))} />
                      {w.name} <span className="text-muted-foreground text-xs">{w.owner?.email}</span>
                    </label>
                  ))}
                </div>
              ) : null}
              <Button className="w-fit" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Spinner /> : null} Save details</Button>
            </FieldGroup>
          </TabsContent>
          <TabsContent value="pricing" className="space-y-4 pt-3">
            <FieldGroup>
              <PriceInputs input={pIn} output={pOut} setInput={setPIn} setOutput={setPOut} />
              <div className="grid grid-cols-2 gap-3">
                <Field><FieldLabel>Cached input / 1M (optional)</FieldLabel><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={0} value={pCached} onChange={(e) => setPCached(e.target.value)} /></InputGroup></Field>
                <Field><FieldLabel>Minimum charge per request</FieldLabel><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={0} value={pMin} onChange={(e) => setPMin(e.target.value)} /></InputGroup></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={pFree} onCheckedChange={setPFree} /> Free model</label>
              <Field>
                <FieldLabel>Takes effect</FieldLabel>
                <Input type="datetime-local" value={pFrom} onChange={(e) => setPFrom(e.target.value)} />
                <FieldDescription>Leave empty for now. Past charges never change.</FieldDescription>
              </Field>
              <Button className="w-fit" disabled={setPrice.isPending} onClick={() => setPrice.mutate()}><DollarSign /> {pFrom ? "Schedule price" : "Set price"}</Button>
            </FieldGroup>
            <div>
              <p className="mb-2 text-sm font-medium">Price history</p>
              <ul className="divide-y rounded-lg border text-sm">
                {(prices.data ?? []).map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      {p.is_free ? "Free" : `${perMillion(p.input_micros_per_m)} in / ${perMillion(p.output_micros_per_m)} out`}
                      {p.current ? <Badge variant="success" className="ml-2">Current</Badge> : new Date(p.effective_from) > new Date() ? <Badge variant="info" className="ml-2">Scheduled</Badge> : null}
                    </span>
                    <span className="text-muted-foreground text-xs">from {fullDate(p.effective_from)}{p.created_by_name ? ` · ${p.created_by_name}` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          </TabsContent>
          <TabsContent value="lifecycle" className="space-y-4 pt-3">
            {model.deprecated_at ? (
              <Alert variant="warning">
                <TriangleAlert />
                <AlertTitle>Deprecated {relativeTime(model.deprecated_at)}</AlertTitle>
                <AlertDescription>{model.retirement_date ? `Retires on ${shortDate(model.retirement_date)}; it is disabled automatically then.` : "No retirement date."}</AlertDescription>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel>Retirement date</FieldLabel>
              <Input type="date" value={retire} onChange={(e) => setRetire(e.target.value)} />
              <FieldDescription>Admins of workspaces that used the model in the last 30 days are notified.</FieldDescription>
            </Field>
            <div className="flex gap-2">
              <Button variant="outline" disabled={deprecate.isPending} onClick={() => deprecate.mutate(false)}>{model.deprecated_at ? "Update retirement" : "Mark as deprecated"}</Button>
              {model.deprecated_at ? <Button variant="ghost" onClick={() => deprecate.mutate(true)}>Undo deprecation</Button> : null}
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

function LogsSheet({ deploymentId, onClose }: { deploymentId: string; onClose: () => void }) {
  const logs = useQuery({
    queryKey: ["admin", "deployment-logs", deploymentId],
    queryFn: () => unwrap(client.GET("/api/admin/deployments/{deployment_id}/logs", { params: { path: { deployment_id: deploymentId }, query: { tail: 400 } } })),
    refetchInterval: 4000,
  })
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Engine logs</SheetTitle>
          <SheetDescription>Last 400 lines, refreshed every few seconds.</SheetDescription>
        </SheetHeader>
        <pre className="bg-code text-code-foreground mx-4 mb-4 h-full overflow-auto rounded-lg border p-3 text-[0.72rem] leading-5">
          {logs.data ? logs.data.lines.join("\n") || "No output yet." : "Loading..."}
        </pre>
      </SheetContent>
    </Sheet>
  )
}

export function AdminModelsPage() {
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Models" }])
  const invalidate = useInvalidate()
  const models = useQuery({ queryKey: ["admin", "models"], queryFn: () => unwrap(client.GET("/api/admin/models")), refetchInterval: 8000 })
  const deployments = useQuery({ queryKey: ["admin", "deployments"], queryFn: () => unwrap(client.GET("/api/admin/deployments")), refetchInterval: 8000 })
  const [deploying, setDeploying] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<AdminModel | null>(null)
  const [logsFor, setLogsFor] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AdminModel | null>(null)
  const toggle = useMutation({
    mutationFn: (v: { model: AdminModel; enabled: boolean }) =>
      unwrap(client.PATCH("/api/admin/models/{model_id}", { params: { path: { model_id: v.model.id } }, body: { enabled: v.enabled } })),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const action = useMutation({
    mutationFn: (v: { id: string; action: "start" | "stop" | "restart" }) =>
      unwrap(client.POST("/api/admin/deployments/{deployment_id}/{action}", { params: { path: { deployment_id: v.id, action: v.action } } })),
    onSuccess: async () => {
      await invalidate()
      toast.success("Done.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (m: AdminModel) =>
      m.deployment_id
        ? unwrap(client.DELETE("/api/admin/deployments/{deployment_id}", { params: { path: { deployment_id: m.deployment_id } } }))
        : unwrap(client.DELETE("/api/admin/models/{model_id}", { params: { path: { model_id: m.id } } })),
    onSuccess: async (res) => {
      await invalidate()
      toast.success(res.message)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const deploymentFor = (id: string | null) => deployments.data?.find((d) => d.id === id)
  return (
    <Page wide>
      <PageHeader
        eyebrow="Admin"
        title="Models"
        description="Deploy open source models on this server, or expose models from attached providers. Prices are per 1M tokens."
        actions={
          <>
            <Button variant="outline" onClick={() => setAdding(true)}><Plus /> Add from provider</Button>
            <Button onClick={() => setDeploying(true)}><Rocket /> Deploy model</Button>
          </>
        }
      />
      {models.isPending ? (
        <ListSkeleton rows={4} />
      ) : models.error ? (
        <ErrorState error={models.error} onRetry={() => void models.refetch()} />
      ) : models.data.length === 0 ? (
        <EmptyState icon={Boxes} title="No models yet" description="Deploy a model from Hugging Face or attach a provider such as Groq." />
      ) : (
        <Card className="gap-0 overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Model</TableHead>
                <TableHead className="hidden md:table-cell">Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Price / 1M</TableHead>
                <TableHead className="hidden xl:table-cell">Requests (30d)</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-12 pr-4"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.data.map((m) => {
                const dep = deploymentFor(m.deployment_id)
                return (
                  <TableRow key={m.id} className={cn(!m.enabled && "opacity-60")}>
                    <TableCell className="pl-4">
                      <Button type="button" variant="link" className="text-foreground h-auto p-0 text-left font-normal" onClick={() => setEditing(m)}>
                        <p className="font-medium">{m.display_name}</p>
                      </Button>
                      <p className="text-muted-foreground text-xs">
                        <code>{m.public_id}</code>
                        <CopyButton value={m.public_id} label="Copy model id" size="icon-xs" className="-my-1 align-middle" />
                        {" · "}
                        {contextLength(m.context_length)} · {m.capabilities.join(", ")}
                      </p>
                      {m.deprecated_at ? <Badge variant="warning" className="mt-1">Deprecated{m.retirement_date ? `, retires ${shortDate(m.retirement_date)}` : ""}</Badge> : null}
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {m.provider_name}
                      <span className="text-muted-foreground block text-xs">{dep ? `${dep.engine} · ${dep.hf_repo}` : m.provider_kind}</span>
                    </TableCell>
                    <TableCell className="max-w-56">
                      <Badge variant={STATUS_VARIANT[m.status]}>{m.status}</Badge>
                      {m.status_message ? <p className="text-muted-foreground mt-1 truncate text-xs" title={m.status_message}>{m.status_message}</p> : null}
                    </TableCell>
                    <TableCell className="tabular hidden text-xs lg:table-cell">
                      {m.price ? (m.price.is_free ? "Free" : `${perMillion(m.price.input_micros_per_m)} / ${perMillion(m.price.output_micros_per_m)}`) : "Not set (free)"}
                    </TableCell>
                    <TableCell className="tabular hidden xl:table-cell">{m.requests_30d.toLocaleString()}</TableCell>
                    <TableCell>
                      <Switch checked={m.enabled} onCheckedChange={(v) => toggle.mutate({ model: m, enabled: v })} aria-label={`Enable ${m.public_id}`} />
                    </TableCell>
                    <TableCell className="pr-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.public_id}`}><MoreHorizontal /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(m)}><Pencil /> Edit, price, deprecate</DropdownMenuItem>
                          {dep ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => action.mutate({ id: dep.id, action: "start" })}><Play /> Start</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => action.mutate({ id: dep.id, action: "restart" })}><RotateCw /> Restart</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => action.mutate({ id: dep.id, action: "stop" })}><CircleStop /> Stop</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setLogsFor(dep.id)}><FileText /> Engine logs</DropdownMenuItem>
                            </>
                          ) : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(m)}><Trash2 /> {dep ? "Remove deployment" : "Delete model"}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <DeployDialog open={deploying} onOpenChange={setDeploying} />
      <AddModelDialog open={adding} onOpenChange={setAdding} />
      {editing ? <EditModelSheet key={editing.id} model={editing} onClose={() => setEditing(null)} /> : null}
      {logsFor ? <LogsSheet deploymentId={logsFor} onClose={() => setLogsFor(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.public_id ?? "model"}?`}
        description={deleting?.deployment_id ? "The engine container is removed. Downloaded weights stay cached. Usage history is kept." : "Clients can no longer call it. Usage history is kept."}
        confirmLabel="Delete"
        destructive
        confirmText={deleting?.public_id}
        onConfirm={() => (deleting ? remove.mutateAsync(deleting) : undefined)}
      />
    </Page>
  )
}
