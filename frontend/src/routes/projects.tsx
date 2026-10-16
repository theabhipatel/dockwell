import { useState } from "react"
import { Archive, FolderKanban, KeyRound, Plus, Users } from "lucide-react"
import { Link } from "react-router"

import { CreateProjectDialog } from "@/components/create-dialogs"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { useWorkspaceScope } from "@/components/layout/workspace-context"
import { Page, PageHeader } from "@/components/page"
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useProjects } from "@/hooks/api"
import { plural, usd } from "@/lib/format"
import { Perm } from "@/lib/permissions"

export function ProjectsPage() {
  const { id, workspace, can } = useWorkspaceScope()
  useBreadcrumbs([{ label: workspace.name, to: `/w/${id}` }, { label: "Projects" }])
  const projects = useProjects(id)
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const all = projects.data ?? []
  const shown = all.filter((p) => showArchived || !p.archived_at)
  const archivedCount = all.filter((p) => p.archived_at).length

  return (
    <Page>
      <PageHeader
        eyebrow="Build"
        title="Projects"
        description="Projects group API keys. Usage, rate limits and monthly spend limits are tracked per project, and you choose which members can see each one."
        actions={
          can(Perm.createProjects) ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New project
            </Button>
          ) : null
        }
      />
      {archivedCount > 0 ? (
        <div className="mb-4 flex items-center gap-2">
          <Switch id="archived" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="archived" className="font-normal">
            Show {plural(archivedCount, "archived project")}
          </Label>
        </div>
      ) : null}
      {projects.isPending ? (
        <CardGridSkeleton count={3} />
      ) : projects.error ? (
        <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects you can access" description="Ask a workspace admin to give you access to a project." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <Link key={p.id} to={`/w/${id}/projects/${p.id}`} className="group rounded-xl focus-visible:outline-none">
              <Card className="group-hover:border-foreground/20 h-full transition-colors">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span className="truncate">{p.name}</span>
                    {p.is_default ? <Badge variant="secondary">Default</Badge> : null}
                    {p.archived_at ? (
                      <Badge variant="outline">
                        <Archive /> Archived
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <CardDescription className="line-clamp-2 min-h-10">{p.description || "No description."}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-muted-foreground flex gap-4 text-xs">
                    <span className="flex items-center gap-1">
                      <KeyRound className="size-3.5" /> {plural(p.key_count, "active key")}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="size-3.5" /> {plural(p.member_count, "member")}
                    </span>
                  </div>
                  <div className="text-xs">
                    <div className="mb-1 flex justify-between">
                      <span className="text-muted-foreground">Spend this month</span>
                      <span className="tabular font-medium">
                        {usd(p.period_spend_micros)}
                        {p.monthly_spend_limit_micros != null ? ` / ${usd(p.monthly_spend_limit_micros)}` : ""}
                      </span>
                    </div>
                    {p.monthly_spend_limit_micros ? (
                      <Progress value={Math.min(100, (p.period_spend_micros / p.monthly_spend_limit_micros) * 100)} className="h-1.5" />
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <CreateProjectDialog open={creating} onOpenChange={setCreating} workspaceId={id} />
    </Page>
  )
}
