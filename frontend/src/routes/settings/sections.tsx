import { useRef, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  BadgeCheck,
  Check,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Smartphone,
  Sun,
  Trash2,
  Upload,
} from "lucide-react"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { PasswordInput } from "@/components/password-input"
import { PasswordStrength } from "@/components/password-strength"
import { EmailChangeCard, GoogleCard, TwoFactorCard } from "@/routes/settings/account-extra"
import { ErrorState, ListSkeleton } from "@/components/states"
import { UserAvatar } from "@/components/user-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { qk, useAccountActivity, useMe, useSessions } from "@/hooks/api"
import { useSetTheme } from "@/hooks/session"
import { client, errorMessage, rawRequest, unwrap } from "@/lib/api"
import { actionLabel, describeUserAgent, fullDate, relativeTime } from "@/lib/format"
import { useTheme } from "@/lib/theme"
import type { Me, ThemePreference } from "@/lib/types"
import { cn } from "@/lib/utils"

// ---- Profile ----------------------------------------------------------------------------------

export function ProfileSection() {
  const { data: me } = useMe()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(me?.name ?? "")
  const [confirmRemoveAvatar, setConfirmRemoveAvatar] = useState(false)

  const setMe = (next: Me) => queryClient.setQueryData(qk.me, next)
  const saveName = useMutation({
    mutationFn: () => unwrap(client.PATCH("/api/account", { body: { name: name.trim() } })),
    onSuccess: (next) => {
      setMe(next)
      toast.success("Profile updated.")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData()
      body.append("file", file)
      const res = await rawRequest("/api/account/avatar", { method: "PUT", body })
      return (await res.json()) as Me
    },
    onSuccess: (next) => {
      setMe(next)
      toast.success("Avatar updated.")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const removeAvatar = useMutation({
    mutationFn: () => unwrap(client.DELETE("/api/account/avatar")),
    onSuccess: setMe,
    onError: (error) => toast.error(errorMessage(error)),
  })

  if (!me) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How teammates see you across workspaces.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <UserAvatar name={me.name} src={me.avatar_url} size="lg" className="size-16" />
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) upload.mutate(file)
                e.target.value = ""
              }}
            />
            <Button variant="outline" size="sm" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
              {upload.isPending ? <Spinner /> : <Upload />} Upload photo
            </Button>
            {me.avatar_url ? (
              <Button variant="ghost" size="sm" disabled={removeAvatar.isPending} onClick={() => setConfirmRemoveAvatar(true)}>
                Remove
              </Button>
            ) : null}
            <p className="text-muted-foreground w-full text-xs">PNG, JPEG, GIF or WebP, up to 1 MB.</p>
          </div>
        </div>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && name.trim() !== me.name) saveName.mutate()
          }}
        >
          <Field>
            <FieldLabel htmlFor="profile-name">Name</FieldLabel>
            <Input id="profile-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-email">Email</FieldLabel>
            <Input id="profile-email" value={me.email} disabled />
            <FieldDescription className="flex flex-wrap items-center gap-2">
              {me.email_verified ? (
                <Badge variant="success">
                  <BadgeCheck /> Verified
                </Badge>
              ) : null}
              {me.google_linked ? <Badge variant="secondary">Google sign-in linked</Badge> : null}
            </FieldDescription>
          </Field>
          <Button type="submit" disabled={!name.trim() || name.trim() === me.name || saveName.isPending}>
            {saveName.isPending ? <Spinner /> : null} Save profile
          </Button>
        </form>
      </CardContent>
      <ConfirmDialog
        open={confirmRemoveAvatar}
        onOpenChange={setConfirmRemoveAvatar}
        title="Remove your photo?"
        description="Teammates will see your initials instead."
        confirmLabel="Remove photo"
        destructive
        onConfirm={() => removeAvatar.mutateAsync()}
      />
    </Card>
  )
}

export function ProfilePage() {
  const { data: me } = useMe()
  if (!me) return null
  return (
    <>
      <ProfileSection />
      <EmailChangeCard me={me} />
    </>
  )
}

// ---- Appearance -------------------------------------------------------------------------------

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun; description: string }[] = [
  { value: "light", label: "Light", icon: Sun, description: "Bright and crisp." },
  { value: "dark", label: "Dark", icon: Moon, description: "Easy on the eyes at night." },
  { value: "system", label: "System", icon: Monitor, description: "Follows your device." },
]

function ThemePreview({ dark }: { dark: boolean }) {
  // A miniature of the app, rendered with the real theme tokens of the given mode.
  return (
    <div className={cn(dark && "dark", "overflow-hidden rounded-lg")} aria-hidden="true">
      <div className="flex h-20 bg-background">
        <div className="w-1/4 space-y-1.5 border-r bg-sidebar p-2">
          <div className="h-2 w-3/4 rounded-full bg-brand" />
          <div className="h-1.5 w-full rounded-full bg-muted" />
          <div className="h-1.5 w-2/3 rounded-full bg-muted" />
        </div>
        <div className="flex-1 space-y-2 p-2.5">
          <div className="h-2 w-1/2 rounded-full bg-foreground/70" />
          <div className="flex gap-1.5">
            <div className="h-7 flex-1 rounded-md border bg-card" />
            <div className="h-7 flex-1 rounded-md border border-brand/40 bg-brand-soft" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppearanceSection() {
  const { theme } = useTheme()
  const setTheme = useSetTheme()
  const systemDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Your choice is saved to your account and follows you to other devices.</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.value
            return (
              <Button
                key={opt.value}
                type="button"
                variant="ghost"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(opt.value)}
                className={cn(
                  "h-auto flex-col items-stretch justify-start gap-3 rounded-xl border bg-card p-2.5 text-left font-normal whitespace-normal transition-all hover:bg-card dark:hover:bg-card",
                  active ? "border-brand ring-3 ring-brand/20" : "hover:border-foreground/20",
                )}
              >
                <ThemePreview dark={opt.value === "dark" || (opt.value === "system" && systemDark)} />
                <div className="flex items-center gap-2 px-1 pb-1">
                  <opt.icon className="text-muted-foreground size-4" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-muted-foreground text-xs">{opt.description}</p>
                  </div>
                  {active ? <Check className="size-4 text-brand" /> : null}
                </div>
              </Button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ---- Security ---------------------------------------------------------------------------------

const passwordSchema = z
  .object({
    current: z.string(),
    next: z.string().min(8, "Use at least 8 characters.").max(256),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "The passwords don't match.", path: ["confirm"] })

function PasswordCard({ me }: { me: Me }) {
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: "", next: "", confirm: "" },
  })
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: (v: z.infer<typeof passwordSchema>) =>
      unwrap(client.POST("/api/account/password", { body: { current_password: v.current || null, new_password: v.next } })),
    onSuccess: async (res) => {
      form.reset()
      await queryClient.invalidateQueries({ queryKey: qk.sessions })
      await queryClient.invalidateQueries({ queryKey: qk.me })
      toast.success(res.message)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const sendSetLink = useMutation({
    mutationFn: () => unwrap(client.POST("/api/auth/forgot-password", { body: { email: me.email } })),
    onSuccess: () => toast.success(`We emailed ${me.email} a link to set a password.`),
    onError: (error) => toast.error(errorMessage(error)),
  })
  const errors = form.formState.errors

  if (!me.has_password) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>You sign in with Google, so you don't have a login password.</CardDescription>
        </CardHeader>
        <CardFooter className="flex-wrap gap-3">
          <Button variant="outline" disabled={sendSetLink.isPending} onClick={() => sendSetLink.mutate()}>
            {sendSetLink.isPending ? <Spinner /> : <KeyRound />} Email me a link to set one
          </Button>
          <p className="text-muted-foreground text-xs">Optional.</p>
        </CardFooter>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Changing it signs out your other devices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit((v) => change.mutate(v))} noValidate>
          <FieldGroup className="max-w-md">
            <Field>
              <FieldLabel htmlFor="pw-current">Current password</FieldLabel>
              <PasswordInput id="pw-current" autoComplete="current-password" {...form.register("current")} />
            </Field>
            <Field data-invalid={Boolean(errors.next)}>
              <FieldLabel htmlFor="pw-next">New password</FieldLabel>
              <PasswordInput id="pw-next" autoComplete="new-password" {...form.register("next")} />
              <PasswordStrength password={form.watch("next")} userInputs={[me.email, me.name]} />
              <FieldError errors={[errors.next]} />
            </Field>
            <Field data-invalid={Boolean(errors.confirm)}>
              <FieldLabel htmlFor="pw-confirm">Confirm new password</FieldLabel>
              <PasswordInput id="pw-confirm" autoComplete="new-password" {...form.register("confirm")} />
              <FieldError errors={[errors.confirm]} />
            </Field>
            <Button type="submit" className="w-fit" disabled={change.isPending}>
              {change.isPending ? <Spinner /> : null} Change password
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function SessionsCard() {
  const sessions = useSessions()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirmOthers, setConfirmOthers] = useState(false)
  const [revoking, setRevoking] = useState<{ id: string; current: boolean } | null>(null)
  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(client.DELETE("/api/account/sessions/{session_id}", { params: { path: { session_id: id } } })),
    onSuccess: async (res, id) => {
      const wasCurrent = sessions.data?.find((s) => s.id === id)?.current
      if (wasCurrent) {
        queryClient.clear()
        navigate("/login", { replace: true })
        return
      }
      await queryClient.invalidateQueries({ queryKey: qk.sessions })
      toast.success(res.message)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const revokeOthers = useMutation({
    mutationFn: () => unwrap(client.POST("/api/account/sessions/revoke-others")),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: qk.sessions })
      toast.success(res.message)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const others = (sessions.data ?? []).filter((s) => !s.current).length
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices currently signed in to your account. Sign out any you don't recognise.</CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <ListSkeleton rows={2} />
        ) : sessions.error ? (
          <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : (
          <ul className="divide-y rounded-xl border">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  {/Android|iPhone|iPad/.test(s.user_agent ?? "") ? <Smartphone className="size-4" /> : <Monitor className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {describeUserAgent(s.user_agent)}
                    {s.current ? <Badge variant="success">This device</Badge> : null}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {s.ip ?? "Unknown IP"} · active {relativeTime(s.last_seen_at)} · signed in {relativeTime(s.created_at)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => setRevoking({ id: s.id, current: s.current })}>
                  <LogOut /> Sign out
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {others > 0 ? (
        <CardFooter>
          <Button variant="outline" onClick={() => setConfirmOthers(true)}>
            <LogOut /> Sign out all other devices
          </Button>
        </CardFooter>
      ) : null}
      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Sign out all other devices?"
        description={`${others} other session${others === 1 ? "" : "s"} will be signed out immediately. This device stays signed in.`}
        confirmLabel="Sign out others"
        onConfirm={() => revokeOthers.mutateAsync()}
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking?.current ? "Sign out of this device?" : "Sign out this device?"}
        description={revoking?.current ? "You'll go back to the sign-in page." : "That device will be signed out immediately."}
        confirmLabel="Sign out"
        destructive
        onConfirm={() => (revoking ? revoke.mutateAsync(revoking.id) : undefined)}
      />
    </Card>
  )
}

function ActivityCard() {
  const activity = useAccountActivity()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent security activity</CardTitle>
        <CardDescription>Sign-ins and account changes, including failed attempts.</CardDescription>
      </CardHeader>
      <CardContent>
        {activity.isPending ? (
          <ListSkeleton rows={3} />
        ) : activity.error ? (
          <ErrorState error={activity.error} />
        ) : (
          <ul className="space-y-2.5">
            {activity.data.slice(0, 12).map((a) => (
              <li key={a.id} className="flex items-start gap-3 text-sm">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", a.result === "success" ? "bg-success" : "bg-destructive")} />
                <div className="min-w-0 flex-1">
                  <p>
                    {actionLabel(a.action)}
                    {a.result !== "success" ? <span className="text-destructive"> (failed)</span> : null}
                  </p>
                  <p className="text-muted-foreground truncate text-xs" title={fullDate(a.created_at)}>
                    {relativeTime(a.created_at)} · {describeUserAgent(a.user_agent)} · {a.ip ?? "unknown IP"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function SecuritySection() {
  const { data: me } = useMe()
  if (!me) return null
  return (
    <>
      <PasswordCard me={me} />
      <TwoFactorCard me={me} />
      <GoogleCard me={me} />
      <SessionsCard />
      <ActivityCard />
    </>
  )
}

// ---- Account (danger zone) --------------------------------------------------------------------

export function AccountSection() {
  const { data: me } = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const remove = useMutation({
    mutationFn: (email: string) =>
      unwrap(client.POST("/api/account/delete", { body: { confirm_email: email, password: password || null } })),
    onSuccess: () => {
      queryClient.clear()
      queryClient.setQueryData(qk.me, null)
      toast.success("Your account has been deleted.")
      navigate("/login", { replace: true })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  if (!me) return null
  return (
    <Card className="ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Delete account</CardTitle>
        <CardDescription>
          Permanently delete your account. Workspaces you own that have no other members are deleted with it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert variant="warning">
          <AlertDescription>
            If you own a workspace that has other members, transfer ownership (or remove them) first. You'll be told which
            workspaces are blocking deletion.
          </AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> Delete my account
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setPassword("")
        }}
        title="Delete your account?"
        description="This can't be undone. You'll be removed from every workspace and your solo workspaces, keys and credits are deleted."
        confirmLabel="Delete account"
        destructive
        confirmText={me.email}
        onConfirm={(typed) => remove.mutateAsync(typed)}
      >
        {me.has_password ? (
          <Field>
            <FieldLabel htmlFor="delete-password">Your password</FieldLabel>
            <PasswordInput id="delete-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        ) : null}
      </ConfirmDialog>
    </Card>
  )
}
