import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Clock,
  FolderCog,
  Mail,
  MoreHorizontal,
  RefreshCw,
  Search,
  ShieldHalf,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react"
import { Controller, useForm } from "react-hook-form"
import { useSearchParams } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { useWorkspaceScope } from "@/components/layout/workspace-context"
import { Page, PageHeader } from "@/components/page"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states"
import { UserAvatar } from "@/components/user-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { qk, useInvitations, useMe, useMembers, useProjects, useRoles } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { relativeTime, shortDate } from "@/lib/format"
import { Perm } from "@/lib/permissions"
import type { Member, Project, Role } from "@/lib/types"

export function MembersPage() {
  const { id, workspace, can } = useWorkspaceScope()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState("members")
  const [inviteOpen, setInviteOpen] = useState(false)
  const members = useMembers(id)
  const invitations = useInvitations(id, can(Perm.invite))
  useBreadcrumbs([{ label: workspace.name, to: `/w/${id}` }, { label: "Members" }])

  useEffect(() => {
    if (params.get("invite") === "1" && can(Perm.invite)) {
      setInviteOpen(true)
      params.delete("invite")
      setParams(params, { replace: true })
    }
  }, [params, setParams, can])

  const pendingCount = invitations.data?.length ?? 0

  return (
    <Page wide>
      <PageHeader
        title="Members"
        description="Everyone in this workspace, their role, and which projects they can see."
        actions={
          can(Perm.invite) ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus /> Invite people
            </Button>
          ) : null
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="members">
            <Users /> Members{members.data ? ` (${members.data.length})` : ""}
          </TabsTrigger>
          {can(Perm.invite) ? (
            <TabsTrigger value="pending">
              <Mail /> Pending{pendingCount > 0 ? ` (${pendingCount})` : ""}
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="members" className="mt-5">
          {members.isPending ? (
            <ListSkeleton rows={5} />
          ) : members.error ? (
            <ErrorState error={members.error} onRetry={() => void members.refetch()} />
          ) : (
            <MembersTable members={members.data} />
          )}
        </TabsContent>
        {can(Perm.invite) ? (
          <TabsContent value="pending" className="mt-5">
            <PendingInvitations onInvite={() => setInviteOpen(true)} />
          </TabsContent>
        ) : null}
      </Tabs>
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => setTab("pending")}
      />
    </Page>
  )
}

function MembersTable({ members }: { members: Member[] }) {
  const { id, can } = useWorkspaceScope()
  const { data: me } = useMe()
  const roles = useRoles(id)
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState("")
  const [removing, setRemoving] = useState<Member | null>(null)
  const [editingProjects, setEditingProjects] = useState<Member | null>(null)
  const [roleChange, setRoleChange] = useState<{ member: Member; role: Role } | null>(null)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.members(id) }),
      queryClient.invalidateQueries({ queryKey: qk.roles(id) }),
    ])
  }

  const changeRole = useMutation({
    mutationFn: ({ member, role }: { member: Member; role: Role }) =>
      unwrap(
        client.PATCH("/api/workspaces/{workspace_id}/members/{user_id}", {
          params: { path: { workspace_id: id, user_id: member.user_id } },
          body: { role_id: role.id },
        }),
      ),
    onSuccess: async (res) => {
      await refresh()
      toast.success(res.message)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (member: Member) =>
      unwrap(
        client.DELETE("/api/workspaces/{workspace_id}/members/{user_id}", {
          params: { path: { workspace_id: id, user_id: member.user_id } },
        }),
      ),
    onSuccess: async (res) => {
      await refresh()
      await queryClient.invalidateQueries({ queryKey: qk.workspaces })
      toast.success(res.message)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const assignable = (roles.data ?? []).filter((r) => r.can_assign)
  const q = filter.trim().toLowerCase()
  const shown = members.filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))

  return (
    <div className="space-y-3">
      <InputGroup className="sm:w-80">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput placeholder="Filter by name or email" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter members" />
      </InputGroup>
      <Card className="gap-0 overflow-x-auto py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-64 pl-4">Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="min-w-44">Projects</TableHead>
              <TableHead className="hidden lg:table-cell">Joined</TableHead>
              <TableHead className="w-12 pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((m) => {
              const isMe = m.user_id === me?.id
              return (
                <TableRow key={m.user_id}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-3">
                      <UserAvatar name={m.name} src={m.avatar_url} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate font-medium">
                          {m.name}
                          {isMe ? <Badge variant="secondary">You</Badge> : null}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">{m.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.is_owner ? "brand" : "outline"}>{m.role_name}</Badge>
                  </TableCell>
                  <TableCell>
                    {m.all_projects ? (
                      <span className="text-muted-foreground text-xs">All projects</span>
                    ) : m.projects.length === 0 ? (
                      <span className="text-muted-foreground text-xs">None</span>
                    ) : (
                      <div className="flex max-w-60 flex-wrap gap-1">
                        {m.projects.slice(0, 2).map((p) => (
                          <Badge key={p.id} variant="secondary" className="max-w-28 truncate">
                            {p.name}
                          </Badge>
                        ))}
                        {m.projects.length > 2 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline">+{m.projects.length - 2}</Badge>
                            </TooltipTrigger>
                            <TooltipContent>{m.projects.slice(2).map((p) => p.name).join(", ")}</TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">{shortDate(m.joined_at)}</TableCell>
                  <TableCell className="pr-4">
                    {m.can_manage || (can(Perm.manageProjectMembers) && !m.all_projects) ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuLabel className="text-muted-foreground truncate text-xs font-normal">{m.email}</DropdownMenuLabel>
                          {m.can_manage && can(Perm.changeRoles) ? (
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <ShieldHalf /> Change role
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                <DropdownMenuRadioGroup
                                  value={m.role_id}
                                  onValueChange={(roleId) => {
                                    const role = assignable.find((r) => r.id === roleId)
                                    if (role && role.id !== m.role_id) setRoleChange({ member: m, role })
                                  }}
                                >
                                  {assignable.map((r) => (
                                    <DropdownMenuRadioItem key={r.id} value={r.id}>
                                      {r.name}
                                    </DropdownMenuRadioItem>
                                  ))}
                                </DropdownMenuRadioGroup>
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          ) : null}
                          {can(Perm.manageProjectMembers) && !m.all_projects ? (
                            <DropdownMenuItem onSelect={() => setEditingProjects(m)}>
                              <FolderCog /> Edit project access
                            </DropdownMenuItem>
                          ) : null}
                          {m.can_manage && can(Perm.removeMembers) ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(m)}>
                                <UserMinus /> Remove from workspace
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {shown.length === 0 ? <p className="text-muted-foreground py-10 text-center text-sm">No members match “{filter}”.</p> : null}
      </Card>
      <p className="text-muted-foreground text-xs">
        Compare key fingerprints with teammates over another channel (in person, a call) before trusting them with secrets.
      </p>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? ""}?`}
        description={
          <>
            <p>They'll immediately lose access to this workspace and all of its projects.</p>
            <p>Project keys they could use will be rotated, so copies they may hold stop working for new changes.</p>
          </>
        }
        confirmLabel="Remove member"
        destructive
        onConfirm={() => (removing ? remove.mutateAsync(removing) : undefined)}
      />
      <ConfirmDialog
        open={roleChange !== null}
        onOpenChange={(o) => !o && setRoleChange(null)}
        title={`Change ${roleChange?.member.name ?? ""}'s role?`}
        description={
          <p>
            Their role changes from <span className="text-foreground font-medium">{roleChange?.member.role_name}</span> to{" "}
            <span className="text-foreground font-medium">{roleChange?.role.name}</span>. What they can see and do changes right away.
          </p>
        }
        confirmLabel="Change role"
        onConfirm={() => (roleChange ? changeRole.mutateAsync(roleChange) : undefined)}
      />
      {editingProjects ? (
        <MemberProjectsDialog member={editingProjects} onClose={() => setEditingProjects(null)} onSaved={refresh} />
      ) : null}
    </div>
  )
}

function ProjectPicker({ projects, value, onChange }: { projects: Project[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (projects.length === 0) return <p className="text-muted-foreground text-sm">There are no projects you can assign yet.</p>
  return (
    <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border p-1.5">
      {projects.map((p) => (
        <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
          <Checkbox
            checked={value.includes(p.id)}
            onCheckedChange={(v) => onChange(v ? [...value, p.id] : value.filter((x) => x !== p.id))}
          />
          <span className="truncate">{p.name}</span>
        </label>
      ))}
    </div>
  )
}

function MemberProjectsDialog({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => Promise<void> }) {
  const { id } = useWorkspaceScope()
  const projects = useProjects(id)
  const [value, setValue] = useState(member.projects.map((p) => p.id))
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PUT("/api/workspaces/{workspace_id}/members/{user_id}/projects", {
          params: { path: { workspace_id: id, user_id: member.user_id } },
          body: { project_ids: value },
        }),
      ),
    onSuccess: async (res) => {
      await onSaved()
      await queryClient.invalidateQueries({ queryKey: qk.projects(id) })
      toast.success(res.message)
      onClose()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const active = (projects.data ?? []).filter((p) => !p.archived_at)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project access for {member.name}</DialogTitle>
          <DialogDescription>
            They can only see, use and create keys in the projects selected here.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          {projects.isPending ? <ListSkeleton rows={3} /> : <ProjectPicker projects={active} value={value} onChange={setValue} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner /> : null} Save access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const inviteSchema = z.object({
  email: z.email("Enter a valid email address."),
  role_id: z.string().min(1, "Choose a role."),
  project_ids: z.array(z.string()),
})
type InviteValues = z.infer<typeof inviteSchema>

function InviteDialog({ open, onOpenChange, onInvited }: { open: boolean; onOpenChange: (open: boolean) => void; onInvited: () => void }) {
  const { id, workspace, can } = useWorkspaceScope()
  const roles = useRoles(id)
  const projects = useProjects(id)
  const queryClient = useQueryClient()
  const assignable = (roles.data ?? []).filter((r) => r.can_assign)
  const defaultRole = assignable.find((r) => r.system_key === "member") ?? assignable[assignable.length - 1]
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role_id: "", project_ids: [] },
  })

  useEffect(() => {
    if (open && defaultRole && !form.getValues("role_id")) form.setValue("role_id", defaultRole.id)
  }, [open, defaultRole, form])

  const invite = useMutation({
    mutationFn: (values: InviteValues) =>
      unwrap(
        client.POST("/api/workspaces/{workspace_id}/invitations", {
          params: { path: { workspace_id: id } },
          body: values,
        }),
      ),
    onSuccess: async (inv) => {
      await queryClient.invalidateQueries({ queryKey: qk.invitations(id) })
      toast.success(`Invitation sent to ${inv.email}.`)
      form.reset({ email: "", role_id: defaultRole?.id ?? "", project_ids: [] })
      onOpenChange(false)
      onInvited()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const selectedRole = assignable.find((r) => r.id === form.watch("role_id"))
  const roleSeesAll = selectedRole?.permissions.includes(Perm.accessAllProjects) ?? false
  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={form.handleSubmit((v) => invite.mutate(v))} noValidate>
          <DialogHeader>
            <DialogTitle>Invite to {workspace.name}</DialogTitle>
            <DialogDescription>
              They'll get an email. If they already have an account, the invitation also appears in the app.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <Field data-invalid={Boolean(errors.email)}>
              <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
              <Input id="invite-email" type="email" placeholder="teammate@company.com" autoFocus {...form.register("email")} />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field data-invalid={Boolean(errors.role_id)}>
              <FieldLabel>Role</FieldLabel>
              <Controller
                control={form.control}
                name="role_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignable.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {selectedRole?.description ? <FieldDescription>{selectedRole.description}</FieldDescription> : null}
              <FieldError errors={[errors.role_id]} />
            </Field>
            {can(Perm.manageProjectMembers) ? (
              <Field>
                <FieldLabel>Projects</FieldLabel>
                {roleSeesAll ? (
                  <FieldDescription>This role can access every project.</FieldDescription>
                ) : (
                  <Controller
                    control={form.control}
                    name="project_ids"
                    render={({ field }) => (
                      <ProjectPicker
                        projects={(projects.data ?? []).filter((p) => !p.archived_at)}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                )}
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={invite.isPending || assignable.length === 0}>
              {invite.isPending ? <Spinner /> : <Mail />} Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PendingInvitations({ onInvite }: { onInvite: () => void }) {
  const { id } = useWorkspaceScope()
  const invitations = useInvitations(id, true)
  const queryClient = useQueryClient()
  const [revoking, setRevoking] = useState<string | null>(null)

  const resend = useMutation({
    mutationFn: (invitationId: string) =>
      unwrap(
        client.POST("/api/workspaces/{workspace_id}/invitations/{invitation_id}/resend", {
          params: { path: { workspace_id: id, invitation_id: invitationId } },
        }),
      ),
    onSuccess: async (inv) => {
      await queryClient.invalidateQueries({ queryKey: qk.invitations(id) })
      toast.success(`Resent to ${inv.email}. It now expires in 7 days.`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      unwrap(
        client.DELETE("/api/workspaces/{workspace_id}/invitations/{invitation_id}", {
          params: { path: { workspace_id: id, invitation_id: invitationId } },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.invitations(id) })
      toast.success("Invitation revoked.")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  if (invitations.isPending) return <ListSkeleton rows={3} />
  if (invitations.error) return <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
  if (invitations.data.length === 0) {
    return (
      <EmptyState
        icon={Mail}
        title="No pending invitations"
        description="Invitations you send stay here until they're accepted, declined or expire after 7 days."
        action={
          <Button onClick={onInvite}>
            <UserPlus /> Invite people
          </Button>
        }
      />
    )
  }
  return (
    <Card className="gap-0 overflow-x-auto py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden md:table-cell">Projects</TableHead>
            <TableHead className="hidden lg:table-cell">Invited by</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="pr-4 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.data.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="pl-4 font-medium">{inv.email}</TableCell>
              <TableCell>
                <Badge variant="outline">{inv.role_name}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground hidden text-xs md:table-cell">
                {inv.projects.length ? inv.projects.map((p) => p.name).join(", ") : "None"}
              </TableCell>
              <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">
                {inv.invited_by_name ?? "Unknown"} · {relativeTime(inv.last_sent_at)}
              </TableCell>
              <TableCell>
                {inv.expired ? (
                  <Badge variant="warning">
                    <Clock /> Expired
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">{relativeTime(inv.expires_at)}</span>
                )}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <div className="inline-flex gap-1">
                  <Button variant="ghost" size="sm" disabled={resend.isPending} onClick={() => resend.mutate(inv.id)}>
                    <RefreshCw /> Resend
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRevoking(inv.id)}>
                    <X /> Revoke
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this invitation?"
        description="The link in their email will stop working. You can invite them again later."
        confirmLabel="Revoke invitation"
        destructive
        onConfirm={() => (revoking ? revoke.mutateAsync(revoking) : undefined)}
      />
    </Card>
  )
}
