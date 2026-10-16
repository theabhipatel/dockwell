import { useEffect, useState } from "react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BadgeCheck, Ban, KeyRound, LogOut, MoreHorizontal, Plus, Search, Shield, ShieldOff, Trash2, UserCheck, Users } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { Page, PageHeader } from "@/components/page"
import { StatCard } from "@/components/stat-card"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states"
import { UserAvatar } from "@/components/user-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { client, errorMessage, unwrap } from "@/lib/api"
import { actionLabel, cents, describeUserAgent, relativeTime, shortDate, tokens, usd } from "@/lib/format"
import type { Schemas } from "@/lib/api"
import { PasswordInput } from "@/components/password-input"

type AdminUser = Schemas["AdminUserOut"]
const PAGE = 50

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [admin, setAdmin] = useState(false)
  useEffect(() => {
    if (open) {
      setEmail("")
      setName("")
      setPassword("")
      setAdmin(false)
    }
  }, [open])
  const create = useMutation({
    mutationFn: () => unwrap(client.POST("/api/admin/users", { body: { email, name, password: password || null, is_admin: admin } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
      toast.success(password ? "User created." : "User created. They were emailed a link to set a password.")
      onOpenChange(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>The account is created verified. They create or join a workspace on first sign-in.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="nu-email">Email</FieldLabel>
            <Input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="nu-name">Name</FieldLabel>
            <Input id="nu-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="nu-password">Password</FieldLabel>
            <PasswordInput id="nu-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <FieldDescription>Leave empty to email them a link to choose one.</FieldDescription>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={admin} onCheckedChange={(v) => setAdmin(v === true)} /> Platform admin
          </label>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!email.includes("@") || !name.trim() || (password.length > 0 && password.length < 8) || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner /> : null} Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function useUserActions(onDeleted?: () => void) {
  const queryClient = useQueryClient()
  const done = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    await queryClient.invalidateQueries({ queryKey: ["admin", "user"] })
    toast.success(message)
  }
  const action = useMutation({
    mutationFn: async (v: { user: AdminUser; kind: string; reason?: string }) => {
      const path = { params: { path: { user_id: v.user.id } } }
      switch (v.kind) {
        case "suspend":
          return unwrap(client.POST("/api/admin/users/{user_id}/suspend", { ...path, body: { reason: v.reason ?? "" } }))
        case "unsuspend":
          return unwrap(client.POST("/api/admin/users/{user_id}/unsuspend", path))
        case "signout":
          return unwrap(client.POST("/api/admin/users/{user_id}/signout", path))
        case "reset2fa":
          return unwrap(client.POST("/api/admin/users/{user_id}/reset-2fa", path))
        case "verify":
          return unwrap(client.POST("/api/admin/users/{user_id}/verify-email", path))
        case "promote":
          return unwrap(client.POST("/api/admin/users/{user_id}/admin", { ...path, body: { is_admin: true } }))
        case "demote":
          return unwrap(client.POST("/api/admin/users/{user_id}/admin", { ...path, body: { is_admin: false } }))
        default:
          return unwrap(client.DELETE("/api/admin/users/{user_id}", path))
      }
    },
    onSuccess: async (res, v) => {
      await done(res.message)
      if (v.kind === "delete") onDeleted?.()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return action
}

function UserMenu({ user, onDeleted }: { user: AdminUser; onDeleted?: () => void }) {
  const action = useUserActions(onDeleted)
  const [confirm, setConfirm] = useState<"delete" | "suspend" | null>(null)
  const [reason, setReason] = useState("")
  const run = (kind: string) => action.mutate({ user, kind })
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.email}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {user.suspended ? (
            <DropdownMenuItem onSelect={() => run("unsuspend")}><UserCheck /> Unsuspend</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setConfirm("suspend")}><Ban /> Suspend</DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => run("signout")}><LogOut /> Force sign out</DropdownMenuItem>
          {user.two_factor_enabled ? <DropdownMenuItem onSelect={() => run("reset2fa")}><KeyRound /> Reset 2FA</DropdownMenuItem> : null}
          {!user.email_verified ? <DropdownMenuItem onSelect={() => run("verify")}><BadgeCheck /> Mark email verified</DropdownMenuItem> : null}
          {user.is_admin ? (
            <DropdownMenuItem onSelect={() => run("demote")}><ShieldOff /> Remove admin</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => run("promote")}><Shield /> Make admin</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}><Trash2 /> Delete user</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm === "suspend"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Suspend ${user.email}?`}
        description="They are signed out everywhere and cannot sign in until unsuspended. Their workspaces keep working for other members."
        confirmLabel="Suspend"
        destructive
        onConfirm={() => action.mutateAsync({ user, kind: "suspend", reason })}
      >
        <Textarea placeholder="Reason (optional, recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${user.email}?`}
        description="Their solo workspaces are deleted with the account. Workspaces they own with other members must be transferred first."
        confirmLabel="Delete user"
        destructive
        confirmText={user.email}
        onConfirm={() => action.mutateAsync({ user, kind: "delete" })}
      />
    </>
  )
}

export function AdminUsersPage() {
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Users" }])
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("all")
  const [offset, setOffset] = useState(0)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim())
      setOffset(0)
    }, 300)
    return () => window.clearTimeout(t)
  }, [search])
  const users = useQuery({
    queryKey: ["admin", "users", q, filter, offset],
    queryFn: () =>
      unwrap(
        client.GET("/api/admin/users", {
          params: { query: { q: q || undefined, filter: filter === "all" ? undefined : (filter as "admins"), offset, limit: PAGE } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
  return (
    <Page wide>
      <PageHeader
        eyebrow="Admin"
        title="Users"
        description="Everyone with an account on this install."
        actions={<Button onClick={() => setCreating(true)}><Plus /> Create user</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        <Select value={filter} onValueChange={(v) => { setFilter(v); setOffset(0) }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            <SelectItem value="admins">Admins</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="unverified">Unverified</SelectItem>
            <SelectItem value="two_factor">With 2FA</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {users.isPending ? (
        <ListSkeleton rows={6} />
      ) : users.error ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : users.data.items.length === 0 ? (
        <EmptyState icon={Users} title="No users found" />
      ) : (
        <>
          <Card className="gap-0 overflow-x-auto py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Workspaces</TableHead>
                  <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  <TableHead className="w-12 pr-4"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="pl-4">
                      <Link to={`/admin/users/${u.id}`} className="flex items-center gap-3 hover:underline">
                        <UserAvatar name={u.name} src={u.avatar_url} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{u.name}</p>
                          <p className="text-muted-foreground truncate text-xs">{u.email}</p>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.is_admin ? <Badge variant="brand">Admin</Badge> : null}
                        {u.suspended ? <Badge variant="destructive">Suspended</Badge> : null}
                        {!u.email_verified ? <Badge variant="warning">Unverified</Badge> : null}
                        {u.two_factor_enabled ? <Badge variant="secondary">2FA</Badge> : null}
                        {!u.is_admin && !u.suspended && u.email_verified && !u.two_factor_enabled ? <Badge variant="outline">Active</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{u.workspace_count}</TableCell>
                    <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">{u.last_sign_in_at ? relativeTime(u.last_sign_in_at) : "Never"}</TableCell>
                    <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">{shortDate(u.created_at)}</TableCell>
                    <TableCell className="pr-4"><UserMenu user={u} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Pager offset={offset} total={users.data.total} onChange={setOffset} />
        </>
      )}
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
    </Page>
  )
}

export function Pager({ offset, total, onChange, size = PAGE }: { offset: number; total: number; onChange: (o: number) => void; size?: number }) {
  return (
    <div className="text-muted-foreground mt-3 flex items-center justify-between text-sm">
      <span>
        {total === 0 ? 0 : offset + 1}-{Math.min(offset + size, total)} of {total.toLocaleString()}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - size))}>Previous</Button>
        <Button variant="outline" size="sm" disabled={offset + size >= total} onClick={() => onChange(offset + size)}>Next</Button>
      </div>
    </div>
  )
}

export function AdminUserPage() {
  const { userId = "" } = useParams()
  const navigate = useNavigate()
  const user = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: () => unwrap(client.GET("/api/admin/users/{user_id}", { params: { path: { user_id: userId } } })),
  })
  const u = user.data
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Users", to: "/admin/users" }, { label: u?.email ?? "User" }])
  if (user.error) return <Page><ErrorState error={user.error} onRetry={() => void user.refetch()} /></Page>
  if (!u) return <Page><ListSkeleton rows={4} /></Page>
  return (
    <Page wide>
      <PageHeader
        eyebrow="User"
        title={
          <span className="flex items-center gap-3">
            <UserAvatar name={u.name} src={u.avatar_url} size="lg" />
            {u.name}
          </span>
        }
        description={u.email}
        actions={<UserMenu user={u} onDeleted={() => navigate("/admin/users")} />}
      />
      <div className="mb-6 flex flex-wrap gap-2">
        {u.is_admin ? <Badge variant="brand">Platform admin</Badge> : null}
        {u.suspended ? <Badge variant="destructive">Suspended{u.suspended_reason ? `: ${u.suspended_reason}` : ""}</Badge> : null}
        <Badge variant={u.email_verified ? "success" : "warning"}>{u.email_verified ? "Email verified" : "Email not verified"}</Badge>
        <Badge variant="secondary">{u.two_factor_enabled ? "2FA on" : "2FA off"}</Badge>
        {u.google_linked ? <Badge variant="secondary">Google linked</Badge> : null}
        <Badge variant="outline">{u.session_count} active sessions</Badge>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Requests (30 days)" value={u.usage_30d.requests.toLocaleString()} />
        <StatCard label="Tokens (30 days)" value={tokens(u.usage_30d.input_tokens + u.usage_30d.output_tokens)} />
        <StatCard label="Spend (30 days)" value={usd(u.usage_30d.cost_micros)} />
        <StatCard label="Joined" value={shortDate(u.created_at)} hint={u.last_sign_in_at ? `Last sign-in ${relativeTime(u.last_sign_in_at)}` : "Never signed in"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Workspaces</CardTitle></CardHeader>
          <CardContent>
            {u.workspaces.length === 0 ? <p className="text-muted-foreground text-sm">Not a member of any workspace.</p> : (
              <ul className="divide-y rounded-lg border">
                {u.workspaces.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <Link to={`/admin/workspaces/${w.id}`} className="font-medium hover:underline">{w.name}</Link>
                    <span className="text-muted-foreground text-xs">{w.is_owner ? "Owner" : w.role_name} · {usd(w.balance_micros)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
          <CardContent>
            {u.payments.length === 0 ? <p className="text-muted-foreground text-sm">No payments.</p> : (
              <ul className="divide-y rounded-lg border">
                {u.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{shortDate(p.created_at)} · {p.workspace_name}</span>
                    <span className="tabular">{cents(p.amount_cents)} <Badge variant="outline">{p.status}</Badge></span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {u.activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span>
                    {actionLabel(a.action)}
                    {a.target_label ? <span className="text-muted-foreground"> · {a.target_label}</span> : null}
                    {a.result !== "success" ? <span className="text-destructive"> (failed)</span> : null}
                  </span>
                  <span className="text-muted-foreground text-xs">{relativeTime(a.created_at)} · {describeUserAgent(a.user_agent)} · {a.ip ?? "-"}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
