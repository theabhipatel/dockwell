import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Archive, ArchiveRestore, KeyRound, Plus, Trash2, Users } from "lucide-react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { CreateKeyDialog } from "@/components/api-key-dialogs"
import { ApiKeyTable } from "@/components/api-key-table"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { CopyField } from "@/components/copy-button"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { useWorkspaceScope } from "@/components/layout/workspace-context"
import { Page, PageHeader } from "@/components/page"
import { StatCard } from "@/components/stat-card"
import { ErrorState, ListSkeleton } from "@/components/states"
import { UserAvatar } from "@/components/user-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { qk, useApiKeys, useMembers, useProject, useProjectMembers } from "@/hooks/api"
import { ApiError, client, errorMessage, unwrap } from "@/lib/api"
import { dollarsToMicros, microsToDollars, plural, usd } from "@/lib/format"
import { Perm } from "@/lib/permissions"
import type { Project } from "@/lib/types"
import { NotFoundContent } from "@/routes/not-found"

function SettingsCard({ workspaceId, project, canManage }: { workspaceId: string; project: Project; canManage: boolean }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [rpm, setRpm] = useState(project.rpm_limit ? String(project.rpm_limit) : "")
  const [tpm, setTpm] = useState(project.tpm_limit ? String(project.tpm_limit) : "")
  const [limit, setLimit] = useState(microsToDollars(project.monthly_spend_limit_micros))
  useEffect(() => {
    setName(project.name)
    setDescription(project.description)
  }, [project.name, project.description])
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PATCH("/api/workspaces/{workspace_id}/projects/{project_id}", {
          params: { path: { workspace_id: workspaceId, project_id: project.id } },
          body: {
            name: name.trim(),
            description,
            rpm_limit: rpm ? Number(rpm) : null,
            tpm_limit: tpm ? Number(tpm) : null,
            monthly_spend_limit_micros: limit ? dollarsToMicros(Number(limit)) : null,
          },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.project(workspaceId, project.id) }),
        queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) }),
      ])
      toast.success("Project updated.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings and limits</CardTitle>
        <CardDescription>Limits apply to all keys in this project, on top of each key's own limits. Leave empty for no project limit.</CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canManage}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="p-name">Name</FieldLabel>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </Field>
            <Field>
              <FieldLabel htmlFor="p-desc">Description</FieldLabel>
              <Textarea id="p-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="p-rpm">Requests / minute</FieldLabel>
                <Input id="p-rpm" type="number" min={1} placeholder="No limit" value={rpm} onChange={(e) => setRpm(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="p-tpm">Tokens / minute</FieldLabel>
                <Input id="p-tpm" type="number" min={1} placeholder="No limit" value={tpm} onChange={(e) => setTpm(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="p-limit">Monthly spend limit</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>$</InputGroupAddon>
                  <InputGroupInput id="p-limit" type="number" min={0} step="0.01" placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value)} />
                </InputGroup>
              </Field>
            </div>
          </FieldGroup>
        </fieldset>
      </CardContent>
      {canManage ? (
        <CardFooter>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner /> : null} Save changes
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function AccessCard({ workspaceId, projectId, canManage }: { workspaceId: string; projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const access = useProjectMembers(workspaceId, projectId)
  const members = useMembers(workspaceId)
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const assignable = (members.data ?? []).filter((m) => !m.all_projects)
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        client.PUT("/api/workspaces/{workspace_id}/projects/{project_id}/members", {
          params: { path: { workspace_id: workspaceId, project_id: projectId } },
          body: { user_ids: selected },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.projectMembers(workspaceId, projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) }),
      ])
      setEditing(false)
      toast.success("Project access updated.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" /> Who can access this project
        </CardTitle>
        <CardDescription>Owners, admins and roles with "Access all projects" always see every project.</CardDescription>
      </CardHeader>
      <CardContent>
        {access.isPending ? (
          <ListSkeleton rows={2} />
        ) : (
          <ul className="divide-y rounded-xl border">
            {(access.data ?? []).map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
                <UserAvatar name={m.name} src={m.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="text-muted-foreground truncate text-xs">{m.email}</p>
                </div>
                <Badge variant={m.via === "all_projects" ? "secondary" : "outline"}>{m.via === "all_projects" ? m.role_name : "Assigned"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {canManage ? (
        <CardFooter>
          <Button
            variant="outline"
            onClick={() => {
              setSelected((access.data ?? []).filter((m) => m.via === "assigned").map((m) => m.user_id))
              setEditing(true)
            }}
          >
            Manage access
          </Button>
        </CardFooter>
      ) : null}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage project access</DialogTitle>
            <DialogDescription>Selected members can see this project, its usage and create keys in it (if their role allows).</DialogDescription>
          </DialogHeader>
          {assignable.length === 0 ? (
            <FieldDescription>Every member already sees all projects.</FieldDescription>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {assignable.map((m) => (
                <li key={m.user_id}>
                  <label className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md px-2 py-2">
                    <Checkbox
                      checked={selected.includes(m.user_id)}
                      onCheckedChange={(v) => setSelected((s) => (v ? [...s, m.user_id] : s.filter((x) => x !== m.user_id)))}
                    />
                    <UserAvatar name={m.name} src={m.avatar_url} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                    <span className="text-muted-foreground text-xs">{m.role_name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Spinner /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export function ProjectPage() {
  const { projectId = "" } = useParams()
  const { id, workspace, can } = useWorkspaceScope()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const project = useProject(id, projectId)
  const keys = useApiKeys(id)
  const [creatingKey, setCreatingKey] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useBreadcrumbs([
    { label: workspace.name, to: `/w/${id}` },
    { label: "Projects", to: `/w/${id}/projects` },
    { label: project.data?.name ?? "Project" },
  ])
  const path = { params: { path: { workspace_id: id, project_id: projectId } } }
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.project(id, projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.projects(id) }),
    ])
  const archive = useMutation({
    mutationFn: (restore: boolean) =>
      unwrap(
        restore
          ? client.POST("/api/workspaces/{workspace_id}/projects/{project_id}/unarchive", path)
          : client.POST("/api/workspaces/{workspace_id}/projects/{project_id}/archive", path),
      ),
    onSuccess: async (res) => {
      await refresh()
      toast.success(res.message)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: () => unwrap(client.DELETE("/api/workspaces/{workspace_id}/projects/{project_id}", path)),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: qk.projects(id) })
      toast.success(res.message)
      navigate(`/w/${id}/projects`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (project.error instanceof ApiError && project.error.status === 404) {
    return <NotFoundContent title="Project not found" description="It may have been deleted, or you no longer have access." />
  }
  if (project.error) {
    return (
      <Page>
        <ErrorState error={project.error} onRetry={() => void project.refetch()} />
      </Page>
    )
  }
  const p = project.data
  const projectKeys = (keys.data ?? []).filter((k) => k.project_id === projectId)
  const canKeys = can(Perm.manageAllKeys) || can(Perm.manageOwnKeys)

  return (
    <Page wide>
      <PageHeader
        eyebrow="Project"
        title={
          <span className="flex items-center gap-2">
            {p?.name ?? "..."}
            {p?.is_default ? <Badge variant="secondary">Default</Badge> : null}
            {p?.archived_at ? <Badge variant="outline">Archived</Badge> : null}
          </span>
        }
        description={p?.description || undefined}
        actions={
          p && can(Perm.manageProjects) && !p.is_default ? (
            <>
              <Button variant="outline" disabled={archive.isPending} onClick={() => archive.mutate(Boolean(p.archived_at))}>
                {p.archived_at ? <ArchiveRestore /> : <Archive />} {p.archived_at ? "Restore" : "Archive"}
              </Button>
              <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </Button>
            </>
          ) : null
        }
      />
      {p ? (
        <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Project id</span>
          <CopyField value={p.id} />
        </div>
      ) : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Spend this month" loading={!p} value={p ? usd(p.period_spend_micros) : null} hint={p?.monthly_spend_limit_micros != null ? `Limit ${usd(p.monthly_spend_limit_micros)}` : "No monthly limit"} />
        <StatCard label="Active keys" icon={KeyRound} loading={!p} value={p?.key_count} />
        <StatCard label="Members with access" icon={Users} loading={!p} value={p ? plural(p.member_count, "assigned member") : null} />
      </div>
      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="keys" className="space-y-4 pt-2">
          {canKeys && !p?.archived_at ? (
            <div className="flex justify-end">
              <Button onClick={() => setCreatingKey(true)}>
                <Plus /> Create key
              </Button>
            </div>
          ) : null}
          {keys.isPending ? <ListSkeleton rows={3} /> : <ApiKeyTable workspaceId={id} keys={projectKeys} showProject={false} />}
        </TabsContent>
        <TabsContent value="access" className="pt-2">
          <AccessCard workspaceId={id} projectId={projectId} canManage={can(Perm.manageProjectMembers)} />
        </TabsContent>
        <TabsContent value="settings" className="pt-2">
          {p ? <SettingsCard workspaceId={id} project={p} canManage={can(Perm.manageProjects)} /> : <ListSkeleton rows={3} />}
        </TabsContent>
      </Tabs>
      <CreateKeyDialog workspaceId={id} baseUrl={workspace.api_base_url} open={creatingKey} onOpenChange={setCreatingKey} defaultProjectId={projectId} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${p?.name ?? "project"}?`}
        description="All API keys in this project stop working and are deleted. Usage history and logs are kept."
        confirmLabel="Delete project"
        destructive
        confirmText={p?.name}
        onConfirm={() => remove.mutateAsync()}
      />
    </Page>
  )
}
