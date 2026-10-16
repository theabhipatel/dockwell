import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Upload } from "lucide-react"
import { toast } from "sonner"

import { CopyField } from "@/components/copy-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { qk, useProjects } from "@/hooks/api"
import { client, errorMessage, rawRequest, unwrap } from "@/lib/api"
import type { WorkspaceDetail } from "@/lib/types"

export function WorkspaceGeneralCards({ workspace, canEdit }: { workspace: WorkspaceDetail; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const projects = useProjects(workspace.id)
  const fileInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(workspace.name)
  const [slug, setSlug] = useState(workspace.slug)
  const [defaultProject, setDefaultProject] = useState(workspace.default_project_id ?? "")
  const [retention, setRetention] = useState(workspace.log_retention_days ? String(workspace.log_retention_days) : "")
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.workspace(workspace.id) }),
      queryClient.invalidateQueries({ queryKey: qk.workspaces }),
    ])
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unwrap(client.PATCH("/api/workspaces/{workspace_id}", { params: { path: { workspace_id: workspace.id } }, body })),
    onSuccess: async () => {
      await refresh()
      toast.success("Workspace updated.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const logo = useMutation({
    mutationFn: async (file: File | null) => {
      if (!file) return unwrap(client.DELETE("/api/workspaces/{workspace_id}/logo", { params: { path: { workspace_id: workspace.id } } }))
      const body = new FormData()
      body.append("file", file)
      await rawRequest(`/api/workspaces/${workspace.id}/logo`, { method: "PUT", body })
      return { message: "Logo updated." }
    },
    onSuccess: async (res) => {
      await refresh()
      toast.success(res.message)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>{canEdit ? "Name, slug, logo and the project used by the playground." : "Only roles with workspace settings access can change these."}</CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={!canEdit}>
            <FieldGroup>
              <div className="flex items-center gap-4">
                {workspace.logo_url ? (
                  <img src={workspace.logo_url} alt="" className="size-14 rounded-xl border object-cover" />
                ) : (
                  <span className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-xl text-xl font-bold">
                    {workspace.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) logo.mutate(f)
                    e.target.value = ""
                  }}
                />
                <Button variant="outline" size="sm" disabled={logo.isPending} onClick={() => fileInput.current?.click()}>
                  {logo.isPending ? <Spinner /> : <Upload />} Upload logo
                </Button>
                {workspace.logo_url ? (
                  <Button variant="ghost" size="sm" onClick={() => logo.mutate(null)}>
                    Remove
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="ws-name">Workspace name</FieldLabel>
                  <Input id="ws-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ws-slug">Slug</FieldLabel>
                  <Input id="ws-slug" value={slug} maxLength={60} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
                  <FieldDescription>Lowercase letters, numbers and hyphens.</FieldDescription>
                </Field>
              </div>
              <Field>
                <FieldLabel>Default project</FieldLabel>
                <Select value={defaultProject} onValueChange={setDefaultProject}>
                  <SelectTrigger className="w-full sm:w-80">
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects.data ?? [])
                      .filter((p) => !p.archived_at)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Playground usage is charged to this project unless another one is chosen.</FieldDescription>
              </Field>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Workspace id</span>
                <CopyField value={workspace.id} />
              </div>
            </FieldGroup>
          </fieldset>
        </CardContent>
        {canEdit ? (
          <CardFooter>
            <Button
              disabled={!name.trim() || update.isPending}
              onClick={() =>
                update.mutate({
                  name: name.trim() !== workspace.name ? name.trim() : undefined,
                  slug: slug !== workspace.slug ? slug : undefined,
                  default_project_id: defaultProject && defaultProject !== workspace.default_project_id ? defaultProject : undefined,
                })
              }
            >
              {update.isPending ? <Spinner /> : null} Save
            </Button>
          </CardFooter>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data and logs</CardTitle>
          <CardDescription>
            Request logs are kept for {workspace.effective_log_retention_days} days. The platform allows up to its own retention period.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={!canEdit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="ws-retention">Log retention (days)</FieldLabel>
                <div className="flex gap-2">
                  <Input id="ws-retention" type="number" min={1} max={3650} className="w-40" placeholder="Platform default" value={retention} onChange={(e) => setRetention(e.target.value)} />
                  {canEdit ? (
                    <Button
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() => update.mutate(retention ? { log_retention_days: Number(retention) } : { clear_log_retention: true })}
                    >
                      Save
                    </Button>
                  ) : null}
                </div>
              </Field>
              <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Store prompts and responses</p>
                  <p className="text-muted-foreground text-xs">
                    {workspace.prompt_logging_allowed
                      ? "Allowed by the platform admin. Turn off to never store request content for this workspace."
                      : "Content logging is off for the whole platform, so nothing is stored regardless of this setting."}
                  </p>
                </div>
                <Switch
                  checked={workspace.store_prompts && workspace.prompt_logging_allowed}
                  disabled={!workspace.prompt_logging_allowed || !canEdit}
                  onCheckedChange={(v) => update.mutate({ store_prompts: v })}
                  aria-label="Store prompts and responses"
                />
              </div>
            </FieldGroup>
          </fieldset>
        </CardContent>
      </Card>
    </>
  )
}
