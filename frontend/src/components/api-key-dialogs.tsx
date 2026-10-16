import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Check } from "lucide-react"
import { toast } from "sonner"

import { CodeSnippets } from "@/components/code-snippets"
import { CopyButton } from "@/components/copy-button"
import { ModelMultiSelect } from "@/components/model-picker"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { qk, useProjects, useWorkspaceModels } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { dollarsToMicros, microsToDollars } from "@/lib/format"
import type { ApiKey } from "@/lib/types"

interface KeyLimits {
  expires: string
  allowed: string[]
  spend: string
  rpm: string
  tpm: string
}

const EXPIRY_PRESETS = [
  { value: "never", label: "Never" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "custom", label: "Custom date" },
]

function limitsBody(l: KeyLimits) {
  return {
    allowed_models: l.allowed,
    spend_limit_micros: l.spend.trim() ? dollarsToMicros(Number(l.spend)) : null,
    rpm_limit: l.rpm.trim() ? Number(l.rpm) : null,
    tpm_limit: l.tpm.trim() ? Number(l.tpm) : null,
  }
}

function LimitFields({ workspaceId, value, onChange }: { workspaceId: string; value: KeyLimits; onChange: (v: KeyLimits) => void }) {
  const models = useWorkspaceModels(workspaceId)
  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel>Allowed models</FieldLabel>
        <ModelMultiSelect models={models.data ?? []} value={value.allowed} onChange={(allowed) => onChange({ ...value, allowed })} />
      </Field>
      <Field>
        <FieldLabel htmlFor="key-spend">Spend limit (lifetime)</FieldLabel>
        <InputGroup>
          <InputGroupAddon>$</InputGroupAddon>
          <InputGroupInput id="key-spend" type="number" min={0} step="0.01" placeholder="No limit" value={value.spend} onChange={(e) => onChange({ ...value, spend: e.target.value })} />
        </InputGroup>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="key-rpm">Requests / minute</FieldLabel>
          <Input id="key-rpm" type="number" min={1} placeholder="Default" value={value.rpm} onChange={(e) => onChange({ ...value, rpm: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="key-tpm">Tokens / minute</FieldLabel>
          <Input id="key-tpm" type="number" min={1} placeholder="Default" value={value.tpm} onChange={(e) => onChange({ ...value, tpm: e.target.value })} />
        </Field>
      </div>
    </FieldGroup>
  )
}

export function CreateKeyDialog({
  workspaceId,
  baseUrl,
  open,
  onOpenChange,
  defaultProjectId,
}: {
  workspaceId: string
  baseUrl: string
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultProjectId?: string | null
}) {
  const queryClient = useQueryClient()
  const projects = useProjects(workspaceId)
  const active = (projects.data ?? []).filter((p) => !p.archived_at)
  const [name, setName] = useState("")
  const [projectId, setProjectId] = useState("")
  const [expiry, setExpiry] = useState("never")
  const [customDate, setCustomDate] = useState("")
  const [limits, setLimits] = useState<KeyLimits>({ expires: "", allowed: [], spend: "", rpm: "", tpm: "" })
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (open) {
      setName("")
      setExpiry("never")
      setCustomDate("")
      setLimits({ expires: "", allowed: [], spend: "", rpm: "", tpm: "" })
      setSecret(null)
      setCopied(false)
    }
  }, [open])
  useEffect(() => {
    if (open && !projectId && active.length) {
      setProjectId(active.find((p) => p.id === defaultProjectId)?.id ?? active.find((p) => p.is_default)?.id ?? active[0].id)
    }
  }, [open, projectId, active, defaultProjectId])

  const expiresAt = () => {
    if (expiry === "never") return null
    if (expiry === "custom") return customDate ? new Date(`${customDate}T23:59:59`).toISOString() : null
    return new Date(Date.now() + Number(expiry) * 86_400_000).toISOString()
  }

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/api/workspaces/{workspace_id}/api-keys", {
          params: { path: { workspace_id: workspaceId } },
          body: { name: name.trim(), project_id: projectId, expires_at: expiresAt(), ...limitsBody(limits) },
        }),
      ),
    onSuccess: async (res) => {
      setSecret(res.secret)
      await queryClient.invalidateQueries({ queryKey: qk.keys(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(workspaceId) })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const close = (o: boolean) => {
    if (!o && secret && !copied && !window.confirm("You have not copied the key. It will not be shown again. Close anyway?")) return
    onOpenChange(o)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Save your API key</DialogTitle>
              <DialogDescription>Copy it now. For your security it is stored hashed and will never be shown again.</DialogDescription>
            </DialogHeader>
            <div className="bg-muted/60 flex items-center gap-2 rounded-lg border p-3">
              <code className="min-w-0 flex-1 text-sm break-all">{secret}</code>
              <span onClickCapture={() => setCopied(true)}>
                <CopyButton value={secret} secret label="Copy key" size="icon" className="border" />
              </span>
            </div>
            <Alert variant="warning">
              <AlertTriangle />
              <AlertDescription>Treat it like a password: keep it out of code, logs and URLs.</AlertDescription>
            </Alert>
            <CodeSnippets options={{ baseUrl, model: "your-model", apiKey: secret }} className="min-w-0" />
            <DialogFooter>
              <Button
                onClick={() => {
                  setCopied(true)
                  onOpenChange(false)
                }}
              >
                <Check /> Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim() && projectId) create.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>Keys belong to a project. Usage and limits are tracked per project and per key.</DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-5">
              <Field>
                <FieldLabel htmlFor="key-name">Name</FieldLabel>
                <Input id="key-name" autoFocus placeholder="e.g. Production backend" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              </Field>
              <Field>
                <FieldLabel>Project</FieldLabel>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {active.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Expires</FieldLabel>
                <div className="flex gap-2">
                  <Select value={expiry} onValueChange={setExpiry}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {expiry === "custom" ? (
                    <Input type="date" value={customDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setCustomDate(e.target.value)} />
                  ) : null}
                </div>
              </Field>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="link" className="h-auto px-0">
                    Restrictions and limits (optional)
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                  <LimitFields workspaceId={workspaceId} value={limits} onChange={setLimits} />
                </CollapsibleContent>
              </Collapsible>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || !projectId || create.isPending}>
                {create.isPending ? <Spinner /> : null} Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function EditKeyDialog({ workspaceId, apiKey, onClose }: { workspaceId: string; apiKey: ApiKey; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(apiKey.name)
  const [expires, setExpires] = useState(apiKey.expires_at ? apiKey.expires_at.slice(0, 10) : "")
  const [limits, setLimits] = useState<KeyLimits>({
    expires: "",
    allowed: apiKey.allowed_models,
    spend: microsToDollars(apiKey.spend_limit_micros),
    rpm: apiKey.rpm_limit ? String(apiKey.rpm_limit) : "",
    tpm: apiKey.tpm_limit ? String(apiKey.tpm_limit) : "",
  })
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PATCH("/api/workspaces/{workspace_id}/api-keys/{key_id}", {
          params: { path: { workspace_id: workspaceId, key_id: apiKey.id } },
          body: { name: name.trim(), expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null, ...limitsBody(limits) },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.keys(workspaceId) })
      toast.success("API key updated.")
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {apiKey.name}</DialogTitle>
          <DialogDescription>
            <code>{apiKey.display}</code> in {apiKey.project_name}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-2">
          <Field>
            <FieldLabel htmlFor="edit-key-name">Name</FieldLabel>
            <Input id="edit-key-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-key-expiry">Expiry date</FieldLabel>
            <Input id="edit-key-expiry" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            <FieldDescription>Leave empty for a key that never expires.</FieldDescription>
          </Field>
          <LimitFields workspaceId={workspaceId} value={limits} onChange={setLimits} />
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
