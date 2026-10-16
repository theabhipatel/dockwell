import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, Download, KeyRound, Mail, ShieldCheck, ShieldOff } from "lucide-react"
import QRCode from "qrcode"
import { useSearchParams } from "react-router"
import { toast } from "sonner"

import { GoogleIcon } from "@/routes/auth/layout"
import { CopyButton } from "@/components/copy-button"
import { PasswordInput } from "@/components/password-input"
import { ListSkeleton } from "@/components/states"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { qk, useConfig, useMe, useNotificationCategories } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import type { Me } from "@/lib/types"

function BackupCodesView({ codes }: { codes: string[] }) {
  const text = codes.join("\n")
  const download = () => {
    const url = URL.createObjectURL(new Blob([`DockWell backup codes\n\n${text}\n`], { type: "text/plain" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "dockwell-backup-codes.txt"
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-3">
      <Alert variant="warning">
        <AlertDescription>
          Save these codes somewhere safe. Each one signs you in once if you lose your authenticator. They are shown only now.
        </AlertDescription>
      </Alert>
      <div className="bg-muted/50 grid grid-cols-2 gap-2 rounded-lg border p-4 font-mono text-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <CopyButton value={text} label="Copy codes" size="icon" className="border" />
        <Button variant="outline" onClick={download}>
          <Download /> Download
        </Button>
      </div>
    </div>
  )
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <InputOTP maxLength={6} value={value} onChange={onChange} autoFocus>
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  )
}

function EnableTwoFactorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient()
  const [qr, setQr] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [codes, setCodes] = useState<string[] | null>(null)
  const setup = useMutation({
    mutationFn: () => unwrap(client.POST("/api/account/2fa/setup")),
    onSuccess: async (data) => setQr(await QRCode.toDataURL(data.otpauth_url, { margin: 1, width: 200 })),
    onError: (error) => toast.error(errorMessage(error)),
  })
  const enable = useMutation({
    mutationFn: () => unwrap(client.POST("/api/account/2fa/enable", { body: { code } })),
    onSuccess: async (data) => {
      setCodes(data.codes)
      await queryClient.invalidateQueries({ queryKey: qk.me })
      toast.success("Two-factor authentication is on.")
    },
  })
  const start = setup.mutate
  useEffect(() => {
    if (open) {
      setCode("")
      setCodes(null)
      setQr(null)
      start()
    }
  }, [open, start])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{codes ? "Save your backup codes" : "Set up two-factor authentication"}</DialogTitle>
          <DialogDescription>
            {codes ? "You will need a code from your app (or a backup code) every time you sign in." : "Scan the QR code with an authenticator app such as Google Authenticator, 1Password or Authy, then enter the 6-digit code."}
          </DialogDescription>
        </DialogHeader>
        {codes ? (
          <BackupCodesView codes={codes} />
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              {qr ? <img src={qr} alt="QR code for your authenticator app" className="size-48 rounded-lg border bg-white p-2" /> : <div className="bg-muted size-48 animate-pulse rounded-lg" />}
            </div>
            {setup.data ? (
              <div className="text-muted-foreground flex items-center justify-center gap-1 text-xs">
                Or enter this key: <code className="text-foreground">{setup.data.secret}</code>
                <CopyButton value={setup.data.secret} size="icon-xs" />
              </div>
            ) : null}
            <div className="flex justify-center">
              <CodeInput value={code} onChange={setCode} />
            </div>
            {enable.error ? <p className="text-destructive text-center text-sm">{errorMessage(enable.error)}</p> : null}
          </div>
        )}
        <DialogFooter>
          {codes ? (
            <Button onClick={() => onOpenChange(false)}>
              <Check /> I saved them
            </Button>
          ) : (
            <Button disabled={code.length !== 6 || enable.isPending || !setup.data} onClick={() => enable.mutate()}>
              {enable.isPending ? <Spinner /> : null} Turn on
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmCodeDialog({
  open,
  onOpenChange,
  title,
  description,
  askPassword,
  confirmLabel,
  onConfirm,
  pending,
  error,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: string
  askPassword: boolean
  confirmLabel: string
  onConfirm: (code: string, password: string) => void
  pending: boolean
  error: unknown
}) {
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  useEffect(() => {
    if (open) {
      setCode("")
      setPassword("")
    }
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="confirm-code">Authenticator or backup code</FieldLabel>
            <Input id="confirm-code" className="font-mono" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          {askPassword ? (
            <Field>
              <FieldLabel htmlFor="confirm-password">Password</FieldLabel>
              <PasswordInput id="confirm-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          ) : null}
          {error ? <p className="text-destructive text-sm">{errorMessage(error)}</p> : null}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={code.trim().length < 6 || pending} onClick={() => onConfirm(code.trim(), password)}>
            {pending ? <Spinner /> : null} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TwoFactorCard({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [enabling, setEnabling] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [newCodes, setNewCodes] = useState<string[] | null>(null)
  const disable = useMutation({
    mutationFn: (v: { code: string; password: string }) =>
      unwrap(client.POST("/api/account/2fa/disable", { body: { code: v.code, password: v.password || null } })),
    onSuccess: (next) => {
      queryClient.setQueryData(qk.me, next)
      setDisabling(false)
      toast.success("Two-factor authentication is off.")
    },
  })
  const regenerate = useMutation({
    mutationFn: (code: string) => unwrap(client.POST("/api/account/2fa/backup-codes", { body: { code } })),
    onSuccess: async (data) => {
      setRegenerating(false)
      setNewCodes(data.codes)
      await queryClient.invalidateQueries({ queryKey: qk.me })
    },
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Two-factor authentication
          {me.two_factor_enabled ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>}
        </CardTitle>
        <CardDescription>Ask for a code from an authenticator app when signing in, in addition to your password.</CardDescription>
      </CardHeader>
      {me.two_factor_enabled ? (
        <CardContent className="text-muted-foreground text-sm">
          {me.backup_codes_remaining} backup code{me.backup_codes_remaining === 1 ? "" : "s"} left.
        </CardContent>
      ) : null}
      <CardFooter className="flex-wrap gap-2">
        {me.two_factor_enabled ? (
          <>
            <Button variant="outline" onClick={() => setRegenerating(true)}>
              <KeyRound /> New backup codes
            </Button>
            <Button variant="outline" onClick={() => setDisabling(true)}>
              <ShieldOff /> Turn off
            </Button>
          </>
        ) : (
          <Button onClick={() => setEnabling(true)}>
            <ShieldCheck /> Set up 2FA
          </Button>
        )}
      </CardFooter>
      <EnableTwoFactorDialog open={enabling} onOpenChange={setEnabling} />
      <ConfirmCodeDialog
        open={disabling}
        onOpenChange={setDisabling}
        title="Turn off two-factor authentication?"
        description="Your account will be protected by your password only."
        askPassword={me.has_password}
        confirmLabel="Turn off"
        onConfirm={(code, password) => disable.mutate({ code, password })}
        pending={disable.isPending}
        error={disable.error}
      />
      <ConfirmCodeDialog
        open={regenerating}
        onOpenChange={setRegenerating}
        title="Create new backup codes?"
        description="Your old backup codes stop working."
        askPassword={false}
        confirmLabel="Create codes"
        onConfirm={(code) => regenerate.mutate(code)}
        pending={regenerate.isPending}
        error={regenerate.error}
      />
      <Dialog open={newCodes !== null} onOpenChange={(o) => !o && setNewCodes(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your new backup codes</DialogTitle>
          </DialogHeader>
          {newCodes ? <BackupCodesView codes={newCodes} /> : null}
          <DialogFooter>
            <Button onClick={() => setNewCodes(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export function GoogleCard({ me }: { me: Me }) {
  const { data: config } = useConfig()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const linked = params.get("linked")
  const error = params.get("error")
  useEffect(() => {
    if (linked) toast.success("Google account linked.")
    if (error) toast.error(error)
    if (linked || error) setParams({}, { replace: true })
  }, [linked, error, setParams])
  const unlink = useMutation({
    mutationFn: () => unwrap(client.POST("/api/account/google/unlink")),
    onSuccess: (next) => {
      queryClient.setQueryData(qk.me, next)
      toast.success("Google account unlinked.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (!config?.google_enabled && !me.google_linked) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GoogleIcon /> Google sign-in {me.google_linked ? <Badge variant="success">Linked</Badge> : null}
        </CardTitle>
        <CardDescription>Sign in with your Google account instead of a password.</CardDescription>
      </CardHeader>
      <CardFooter>
        {me.google_linked ? (
          <Button variant="outline" disabled={unlink.isPending || !me.has_password} onClick={() => unlink.mutate()}>
            {unlink.isPending ? <Spinner /> : null} Unlink Google
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <a href="/api/auth/google/start?link=true">Link Google account</a>
          </Button>
        )}
        {me.google_linked && !me.has_password ? (
          <p className="text-muted-foreground ml-3 text-xs">Set a password before unlinking.</p>
        ) : null}
      </CardFooter>
    </Card>
  )
}

export function EmailChangeCard({ me }: { me: Me }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const change = useMutation({
    mutationFn: () => unwrap(client.POST("/api/account/email", { body: { email, password: password || null } })),
    onSuccess: (res) => {
      toast.success(res.message)
      setEmail("")
      setPassword("")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email address</CardTitle>
        <CardDescription>
          Currently <strong className="text-foreground">{me.email}</strong>. We send a confirmation link to the new address; the change applies once you click it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            change.mutate()
          }}
        >
          <Field>
            <FieldLabel htmlFor="new-email">New email</FieldLabel>
            <Input id="new-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {me.has_password ? (
            <Field>
              <FieldLabel htmlFor="email-password">Password</FieldLabel>
              <PasswordInput id="email-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" variant="outline" disabled={!email.includes("@") || change.isPending}>
              {change.isPending ? <Spinner /> : <Mail />} Send confirmation link
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export function NotificationsSection() {
  const { data: me } = useMe()
  const categories = useNotificationCategories()
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (prefs: Record<string, boolean>) => unwrap(client.PUT("/api/account/notification-prefs", { body: { prefs } })),
    onSuccess: (next) => queryClient.setQueryData(qk.me, next),
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (!me) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email notifications</CardTitle>
        <CardDescription>
          Everything also appears in your in-app inbox. Security emails (new sign-ins, password and 2FA changes) are always sent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {categories.isPending ? (
          <ListSkeleton rows={4} />
        ) : (
          <ul className="divide-y rounded-xl border">
            {(categories.data ?? []).map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  <FieldDescription>{c.description}</FieldDescription>
                </div>
                <Switch
                  checked={me.notification_prefs[c.key] ?? true}
                  onCheckedChange={(v) => save.mutate({ [c.key]: v })}
                  aria-label={`Email me about ${c.label.toLowerCase()}`}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
