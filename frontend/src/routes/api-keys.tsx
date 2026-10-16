import { useEffect, useState } from "react"
import { Plus, Search } from "lucide-react"
import { useSearchParams } from "react-router"

import { CreateKeyDialog } from "@/components/api-key-dialogs"
import { ApiKeyTable } from "@/components/api-key-table"
import { CopyField } from "@/components/copy-button"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { useWorkspaceScope } from "@/components/layout/workspace-context"
import { Page, PageHeader } from "@/components/page"
import { ErrorState, ListSkeleton } from "@/components/states"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useApiKeys, useProjects } from "@/hooks/api"
import { Perm } from "@/lib/permissions"

export function ApiKeysPage() {
  const { id, workspace, can } = useWorkspaceScope()
  useBreadcrumbs([{ label: workspace.name, to: `/w/${id}` }, { label: "API keys" }])
  const [params, setParams] = useSearchParams()
  const keys = useApiKeys(id)
  const projects = useProjects(id)
  const [creating, setCreating] = useState(false)
  const [project, setProject] = useState("all")
  const [query, setQuery] = useState("")
  const [showInactive, setShowInactive] = useState(false)
  const canCreate = can(Perm.manageAllKeys) || can(Perm.manageOwnKeys)

  useEffect(() => {
    if (params.get("new") && canCreate) {
      setCreating(true)
      const next = new URLSearchParams(params)
      next.delete("new")
      setParams(next, { replace: true })
    }
  }, [params, setParams, canCreate])

  const shown = (keys.data ?? []).filter(
    (k) =>
      (project === "all" || k.project_id === project) &&
      (showInactive || k.status === "active") &&
      (!query || `${k.name} ${k.display}`.toLowerCase().includes(query.toLowerCase())),
  )

  const newButton = canCreate ? (
    <Button onClick={() => setCreating(true)}>
      <Plus /> Create API key
    </Button>
  ) : null

  return (
    <Page wide>
      <PageHeader
        eyebrow="Build"
        title="API keys"
        description="Keys authenticate requests to the OpenAI-compatible API. The full key is shown once; only its prefix and last characters afterwards."
        actions={newButton}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Base URL</span>
        <CopyField value={workspace.api_base_url} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search keys" value={query} onChange={(e) => setQuery(e.target.value)} />
        </InputGroup>
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {(projects.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
          <Label htmlFor="show-inactive" className="font-normal">
            Show revoked and expired
          </Label>
        </div>
      </div>
      {keys.isPending ? (
        <ListSkeleton rows={4} />
      ) : keys.error ? (
        <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
      ) : (
        <ApiKeyTable workspaceId={id} keys={shown} highlight={params.get("key")} emptyAction={newButton} />
      )}
      <CreateKeyDialog
        workspaceId={id}
        baseUrl={workspace.api_base_url}
        open={creating}
        onOpenChange={setCreating}
        defaultProjectId={project !== "all" ? project : workspace.default_project_id}
      />
    </Page>
  )
}
