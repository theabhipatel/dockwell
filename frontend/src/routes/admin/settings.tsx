import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Upload } from "lucide-react"
import { toast } from "sonner"

import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { Page, PageHeader } from "@/components/page"
import { PasswordInput } from "@/components/password-input"
import { ErrorState, ListSkeleton } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { Schemas } from "@/lib/api"
import { client, errorMessage, rawRequest, unwrap } from "@/lib/api"
import { dollarsToMicros, microsToDollars } from "@/lib/format"

type Settings = Schemas["PlatformSettingsOut"]
type Patch = Schemas["PlatformSettingsIn"]

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

const num = (v: string): number | null => (v.trim() ? Number(v) : null)
const str = (v: number | null | undefined): string => (v == null ? "" : String(v))

function SettingsForm({ s }: { s: Settings }) {
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [f, setF] = useState(() => ({
    platform_name: s.platform_name,
    free_credit: microsToDollars(s.free_credit_micros),
    presets: s.topup_presets_cents.map((c) => c / 100).join(", "),
    min: String(s.topup_min_cents / 100),
    max: String(s.topup_max_cents / 100),
    ws_rpm: str(s.default_workspace_rpm),
    ws_tpm: str(s.default_workspace_tpm),
    ws_limit: microsToDollars(s.default_workspace_monthly_limit_micros),
    key_rpm: str(s.default_key_rpm),
    key_tpm: str(s.default_key_tpm),
    key_limit: microsToDollars(s.default_key_spend_limit_micros),
    platform_rpm: str(s.platform_rpm),
    retention: String(s.log_retention_days),
    domains: s.blocked_email_domains.join("\n"),
    ips: s.blocked_ips.join("\n"),
    maintenance_message: s.maintenance_message,
    announcement: s.announcement.message,
    announcement_level: s.announcement.level,
    announcement_link: s.announcement.link ?? "",
  }))
  const [hfToken, setHfToken] = useState("")
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const save = useMutation({
    mutationFn: (body: Patch) => unwrap(client.PATCH("/api/admin/settings", { body })),
    onSuccess: (next) => {
      queryClient.setQueryData(["admin", "settings"], next)
      void queryClient.invalidateQueries({ queryKey: ["config"] })
      toast.success("Settings saved.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const toggle = (key: keyof Patch) => (v: boolean) => save.mutate({ [key]: v } as Patch)
  const hf = useMutation({
    mutationFn: (token: string | null) => unwrap(client.PUT("/api/admin/settings/hf-token", { body: { token } })),
    onSuccess: (next) => {
      queryClient.setQueryData(["admin", "settings"], next)
      setHfToken("")
      toast.success("Hugging Face token saved.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const logo = useMutation({
    mutationFn: async (file: File | null) => {
      if (!file) return unwrap(client.DELETE("/api/admin/settings/logo"))
      const body = new FormData()
      body.append("file", file)
      const res = await rawRequest("/api/admin/settings/logo", { method: "PUT", body })
      return (await res.json()) as Settings
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["admin", "settings"], next)
      void queryClient.invalidateQueries({ queryKey: ["config"] })
      toast.success("Logo updated.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const lines = (v: string) => v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Accounts</CardTitle><CardDescription>Who can join and how they sign in.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Sign up" description="Allow new accounts. Off also blocks invited people from signing up." checked={s.signup_enabled} onChange={toggle("signup_enabled")} />
          <Toggle label="Google sign-in" description="Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." checked={s.google_signin_enabled} onChange={toggle("google_signin_enabled")} />
          <Toggle label="Require email verification" description="Users must verify before signing in. Starter credit always waits for verification." checked={s.require_email_verification} onChange={toggle("require_email_verification")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Credits and purchases</CardTitle><CardDescription>Starter credit is granted once per account, ever, after the email is verified.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <Toggle label="Starter credit" description="Give each new account free credit on its first workspace." checked={s.free_credit_enabled} onChange={toggle("free_credit_enabled")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel>Starter credit amount</FieldLabel><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={0} step="0.01" value={f.free_credit} onChange={set("free_credit")} /></InputGroup></Field>
            <Field><FieldLabel>Preset amounts</FieldLabel><Input value={f.presets} onChange={set("presets")} /><FieldDescription>Dollars, comma separated.</FieldDescription></Field>
            <Field><FieldLabel>Minimum top-up</FieldLabel><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={0.5} value={f.min} onChange={set("min")} /></InputGroup></Field>
            <Field><FieldLabel>Maximum top-up</FieldLabel><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min={1} value={f.max} onChange={set("max")} /></InputGroup></Field>
          </div>
          <Toggle label="Auto recharge" description="Let workspaces charge their saved card automatically." checked={s.auto_recharge_allowed} onChange={toggle("auto_recharge_allowed")} />
        </CardContent>
        <CardFooter>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                free_credit_micros: dollarsToMicros(Number(f.free_credit || 0)),
                topup_presets_cents: lines(f.presets).map((v) => Math.round(Number(v) * 100)).filter((v) => v > 0),
                topup_min_cents: Math.round(Number(f.min) * 100),
                topup_max_cents: Math.round(Number(f.max) * 100),
              })
            }
          >
            Save credits
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader><CardTitle>Default limits</CardTitle><CardDescription>Empty means unlimited. Admins can override per workspace. The new key spend limit applies when a key is created without one; members can still change it.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field><FieldLabel>Workspace requests / min</FieldLabel><Input type="number" value={f.ws_rpm} onChange={set("ws_rpm")} /></Field>
          <Field><FieldLabel>Workspace tokens / min</FieldLabel><Input type="number" value={f.ws_tpm} onChange={set("ws_tpm")} /></Field>
          <Field><FieldLabel>New workspace monthly limit</FieldLabel><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" value={f.ws_limit} onChange={set("ws_limit")} /></InputGroup></Field>
          <Field><FieldLabel>Key requests / min</FieldLabel><Input type="number" value={f.key_rpm} onChange={set("key_rpm")} /></Field>
          <Field><FieldLabel>Key tokens / min</FieldLabel><Input type="number" value={f.key_tpm} onChange={set("key_tpm")} /></Field>
          <Field><FieldLabel>New key spend limit</FieldLabel><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" value={f.key_limit} onChange={set("key_limit")} /></InputGroup></Field>
          <Field><FieldLabel>Platform requests / min</FieldLabel><Input type="number" value={f.platform_rpm} onChange={set("platform_rpm")} /></Field>
        </CardContent>
        <CardFooter>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                default_workspace_rpm: num(f.ws_rpm),
                default_workspace_tpm: num(f.ws_tpm),
                default_workspace_monthly_limit_micros: f.ws_limit ? dollarsToMicros(Number(f.ws_limit)) : null,
                default_key_rpm: num(f.key_rpm),
                default_key_tpm: num(f.key_tpm),
                default_key_spend_limit_micros: f.key_limit ? dollarsToMicros(Number(f.key_limit)) : null,
                platform_rpm: num(f.platform_rpm),
              })
            }
          >
            Save limits
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader><CardTitle>Logs and privacy</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Toggle label="Allow prompt and response logging" description="Off by default. When on, each workspace can still opt out." checked={s.prompt_logging_allowed} onChange={toggle("prompt_logging_allowed")} />
          <Field className="max-w-xs">
            <FieldLabel>Log retention (days)</FieldLabel>
            <div className="flex gap-2">
              <Input type="number" min={1} value={f.retention} onChange={set("retention")} />
              <Button variant="outline" onClick={() => save.mutate({ log_retention_days: Number(f.retention) })}>Save</Button>
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Abuse controls</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field><FieldLabel>Blocked email domains</FieldLabel><Textarea rows={5} placeholder="mailinator.com" value={f.domains} onChange={set("domains")} /><FieldDescription>One per line. Subdomains are blocked too.</FieldDescription></Field>
          <Field><FieldLabel>Blocked IPs and ranges</FieldLabel><Textarea rows={5} placeholder="203.0.113.0/24" value={f.ips} onChange={set("ips")} /><FieldDescription>One IP or CIDR range per line. Applies to the app and the API.</FieldDescription></Field>
        </CardContent>
        <CardFooter><Button variant="outline" onClick={() => save.mutate({ blocked_email_domains: lines(f.domains), blocked_ips: lines(f.ips) })}>Save abuse controls</Button></CardFooter>
      </Card>

      <Card>
        <CardHeader><CardTitle>Operations</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Toggle label="Maintenance mode" description="API and playground requests answer 503 with the message below. The web app shows a banner." checked={s.maintenance_mode} onChange={toggle("maintenance_mode")} />
          <Field><FieldLabel>Maintenance message</FieldLabel><Input value={f.maintenance_message} onChange={set("maintenance_message")} /></Field>
          <FieldGroup className="rounded-lg border p-3">
            <Field><FieldLabel>Announcement banner</FieldLabel><Textarea rows={2} placeholder="Empty hides the banner" value={f.announcement} onChange={set("announcement")} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={f.announcement_level} onValueChange={(v) => setF({ ...f, announcement_level: v as typeof f.announcement_level })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="info">Info</SelectItem><SelectItem value="warning">Warning</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
              </Select>
              <Input placeholder="Optional link" value={f.announcement_link} onChange={set("announcement_link")} />
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={() => save.mutate({ maintenance_message: f.maintenance_message, announcement: { message: f.announcement, level: f.announcement_level, link: f.announcement_link || null } })}>Save operations</Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader><CardTitle>Branding</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field className="max-w-sm">
            <FieldLabel>Platform name</FieldLabel>
            <div className="flex gap-2"><Input value={f.platform_name} onChange={set("platform_name")} /><Button variant="outline" onClick={() => save.mutate({ platform_name: f.platform_name })}>Save</Button></div>
          </Field>
          <div className="flex items-center gap-3">
            {s.has_logo ? <img src={`/api/public/logo?v=${Date.now()}`} alt="Platform logo" className="size-12 rounded-lg border object-contain" /> : null}
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) logo.mutate(file); e.target.value = "" }} />
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={logo.isPending}>{logo.isPending ? <Spinner /> : <Upload />} Upload logo</Button>
            {s.has_logo ? <Button variant="ghost" size="sm" onClick={() => logo.mutate(null)}>Remove</Button> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Hugging Face token</CardTitle><CardDescription>Used by engines to download gated models. Stored encrypted. {s.hf_token_set ? "A token is saved." : "No token saved."}</CardDescription></CardHeader>
        <CardContent><PasswordInput autoComplete="off" placeholder="hf_..." value={hfToken} onChange={(e) => setHfToken(e.target.value)} /></CardContent>
        <CardFooter className="gap-2">
          <Button variant="outline" disabled={!hfToken.trim() || hf.isPending} onClick={() => hf.mutate(hfToken.trim())}>Save token</Button>
          {s.hf_token_set ? <Button variant="ghost" onClick={() => hf.mutate(null)}>Remove token</Button> : null}
        </CardFooter>
      </Card>
    </div>
  )
}

export function AdminSettingsPage() {
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Settings" }])
  const settings = useQuery({ queryKey: ["admin", "settings"], queryFn: () => unwrap(client.GET("/api/admin/settings")) })
  return (
    <Page className="max-w-4xl">
      <PageHeader eyebrow="Admin" title="Platform settings" description="Applied immediately to the whole install. Prices are set per model on the Models page." />
      {settings.isPending ? <ListSkeleton rows={6} /> : settings.error ? <ErrorState error={settings.error} /> : <SettingsForm s={settings.data} />}
    </Page>
  )
}
