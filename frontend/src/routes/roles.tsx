import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Crown, Info, Lock, Pencil, Plus, ShieldHalf, Trash2, Users } from "lucide-react"
import { toast } from "sonner"

import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { useWorkspaceScope } from "@/components/layout/workspace-context"
import { Page, PageHeader } from "@/components/page"
import { ErrorState, ListSkeleton } from "@/components/states"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { qk, usePermissionCatalog, useRoles } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { plural } from "@/lib/format"
import { Perm } from "@/lib/permissions"
import type { PermissionInfo, Role } from "@/lib/types"

function groupCatalog(catalog: PermissionInfo[]): [string, PermissionInfo[]][] {
  const groups = new Map<string, PermissionInfo[]>()
  for (const p of catalog) groups.set(p.group, [...(groups.get(p.group) ?? []), p])
  return [...groups.entries()]
}

export function RolesPage() {
  const { id, workspace, can } = useWorkspaceScope()
  const roles = useRoles(id)
  const catalog = usePermissionCatalog()
  const [editing, setEditing] = useState<Role | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Role | null>(null)
  useBreadcrumbs([{ label: workspace.name, to: `/w/${id}` }, { label: "Roles" }])

  const canManage = can(Perm.manageRoles)

  return (
    <Page>
      <PageHeader
        title="Roles & permissions"
        description="A role decides what someone can do. Project assignment decides where. Roles are ranked from most to least powerful."
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New role
            </Button>
          ) : null
        }
      />
      <Alert variant="brand" className="mb-6">
        <Info />
        <AlertDescription>
          You can only manage roles and people ranked below you, and only grant permissions you hold yourself. The server
          enforces this on every request.
        </AlertDescription>
      </Alert>
      {roles.isPending || catalog.isPending ? (
        <ListSkeleton rows={4} />
      ) : roles.error || catalog.error ? (
        <ErrorState error={roles.error ?? catalog.error} onRetry={() => void roles.refetch()} />
      ) : (
        <ol className="space-y-3">
          {roles.data.map((role, i) => (
            <li key={role.id}>
              <Card size="sm">
                <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3 sm:w-72">
                    <span className="text-muted-foreground w-5 text-center font-mono text-xs">{i + 1}</span>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      {role.system_key === "owner" ? <Crown className="size-4 text-warning" /> : <ShieldHalf className="text-muted-foreground size-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold">
                        {role.name}
                        {role.system_key ? <Badge variant="secondary">Built-in</Badge> : <Badge variant="brand">Custom</Badge>}
                      </p>
                      <p className="text-muted-foreground line-clamp-1 text-xs">{role.description || "No description"}</p>
                    </div>
                  </div>
                  <div className="text-muted-foreground flex flex-1 flex-wrap gap-x-5 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-3.5" /> {plural(role.member_count, "member")}
                    </span>
                    <span>
                      {role.system_key === "owner" ? "Every permission" : `${role.permissions.length} of ${catalog.data.length} permissions`}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(role)}>
                      {role.can_edit ? <Pencil /> : <Lock />} {role.can_edit ? "Edit" : "View"}
                    </Button>
                    {role.can_delete ? (
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${role.name}`} onClick={() => setDeleting(role)}>
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
      {editing && catalog.data && roles.data ? (
        <RoleEditor role={editing} roles={roles.data} catalog={catalog.data} onClose={() => setEditing(null)} />
      ) : null}
      {creating && catalog.data && roles.data ? (
        <RoleEditor role={null} roles={roles.data} catalog={catalog.data} onClose={() => setCreating(false)} />
      ) : null}
      {deleting && roles.data ? <DeleteRoleDialog role={deleting} roles={roles.data} onClose={() => setDeleting(null)} /> : null}
    </Page>
  )
}

function RoleEditor({
  role,
  roles,
  catalog,
  onClose,
}: {
  role: Role | null
  roles: Role[]
  catalog: PermissionInfo[]
  onClose: () => void
}) {
  const { id, workspace } = useWorkspaceScope()
  const queryClient = useQueryClient()
  const isNew = role === null
  const editable = isNew || role.can_edit
  const isOwnerRole = role?.system_key === "owner"
  const myPerms = new Set(workspace.permissions)
  const [name, setName] = useState(role?.name ?? "")
  const [description, setDescription] = useState(role?.description ?? "")
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? [Perm.usePlayground, Perm.manageOwnKeys, Perm.viewUsage])

  // Position: the role directly above. Only roles at or below my own rank can be anchors.
  const myRank = workspace.role.rank
  const anchors = roles.filter((r) => r.id !== role?.id && (workspace.is_owner || r.rank <= myRank))
  const currentAnchor = role ? [...roles].reverse().find((r) => r.rank > role.rank && r.id !== role.id) : undefined
  const [anchor, setAnchor] = useState<string>(
    currentAnchor?.id ?? roles.find((r) => r.system_key === "manager")?.id ?? anchors[0]?.id ?? "",
  )
  const grouped = useMemo(() => groupCatalog(catalog), [catalog])

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return unwrap(
          client.POST("/api/workspaces/{workspace_id}/roles", {
            params: { path: { workspace_id: id } },
            body: { name: name.trim(), description, permissions: perms, place_below_role_id: anchor },
          }),
        )
      }
      return unwrap(
        client.PATCH("/api/workspaces/{workspace_id}/roles/{role_id}", {
          params: { path: { workspace_id: id, role_id: role.id } },
          body: {
            name: name.trim(),
            description,
            permissions: perms,
            place_below_role_id: anchor && anchor !== currentAnchor?.id ? anchor : null,
          },
        }),
      )
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: qk.roles(id) })
      await queryClient.invalidateQueries({ queryKey: qk.members(id) })
      await queryClient.invalidateQueries({ queryKey: qk.workspace(id) })
      toast.success(isNew ? `Role ${saved.name} created.` : `Role ${saved.name} updated.`)
      onClose()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const toggle = (key: string, on: boolean) => setPerms((p) => (on ? [...new Set([...p, key])] : p.filter((k) => k !== key)))

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>{isNew ? "New role" : editable ? `Edit ${role.name}` : role.name}</SheetTitle>
          <SheetDescription>
            {isOwnerRole
              ? "The Owner always has every permission. It can't be edited, only transferred."
              : editable
                ? "Changes apply immediately to everyone with this role."
                : "You can't edit this role because it ranks at or above your own."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <Field>
            <FieldLabel htmlFor="role-name">Name</FieldLabel>
            <Input id="role-name" value={name} maxLength={50} disabled={!editable} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="role-description">Description</FieldLabel>
            <Textarea id="role-description" rows={2} maxLength={300} value={description} disabled={!editable} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {!isOwnerRole && editable ? (
            <Field>
              <FieldLabel>Rank</FieldLabel>
              <Select value={anchor} onValueChange={setAnchor}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a position" />
                </SelectTrigger>
                <SelectContent>
                  {anchors.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      Directly below {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>People can only manage roles ranked below their own.</FieldDescription>
            </Field>
          ) : null}
          <div className="space-y-5">
            {grouped.map(([group, items]) => (
              <fieldset key={group} className="space-y-2">
                <legend className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">{group}</legend>
                {items.map((p) => {
                  const checked = isOwnerRole || perms.includes(p.key)
                  // You can only grant or remove permissions you hold yourself.
                  const lockedByMe = !workspace.is_owner && !myPerms.has(p.key)
                  const disabled = !editable || isOwnerRole || lockedByMe
                  return (
                    <label
                      key={p.key}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card px-3 py-2.5 has-disabled:cursor-not-allowed has-disabled:opacity-70"
                    >
                      <Checkbox className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={(v) => toggle(p.key, v === true)} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          
                          {p.label}
                        </span>
                        <span className="text-muted-foreground block text-xs">{p.description}</span>
                        {lockedByMe && editable ? (
                          <span className="text-muted-foreground mt-0.5 block text-xs italic">You don't hold this permission.</span>
                        ) : null}
                      </span>
                    </label>
                  )
                })}
              </fieldset>
            ))}
          </div>
        </div>
        {editable && !isOwnerRole ? (
          <SheetFooter className="flex-row justify-end border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!name.trim() || !anchor || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Spinner /> : null} {isNew ? "Create role" : "Save role"}
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function DeleteRoleDialog({ role, roles, onClose }: { role: Role; roles: Role[]; onClose: () => void }) {
  const { id } = useWorkspaceScope()
  const queryClient = useQueryClient()
  const replacements = roles.filter((r) => r.id !== role.id && r.can_assign)
  const [replacement, setReplacement] = useState(replacements.find((r) => r.system_key === "member")?.id ?? replacements[0]?.id ?? "")
  const remove = useMutation({
    mutationFn: () =>
      unwrap(
        client.POST("/api/workspaces/{workspace_id}/roles/{role_id}/delete", {
          params: { path: { workspace_id: id, role_id: role.id } },
          body: { replacement_role_id: replacement || null },
        }),
      ),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: qk.roles(id) })
      await queryClient.invalidateQueries({ queryKey: qk.members(id) })
      toast.success(res.message)
      onClose()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete the {role.name} role?</DialogTitle>
          <DialogDescription>
            {role.member_count > 0
              ? `${plural(role.member_count, "member")} and any pending invitations will move to the role you choose.`
              : "Nobody has this role, so nothing else changes."}
          </DialogDescription>
        </DialogHeader>
        {role.member_count > 0 ? (
          <Field className="py-2">
            <FieldLabel>Replacement role</FieldLabel>
            <Select value={replacement} onValueChange={setReplacement}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {replacements.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={remove.isPending || (role.member_count > 0 && !replacement)} onClick={() => remove.mutate()}>
            {remove.isPending ? <Spinner /> : <Trash2 />} Delete role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
