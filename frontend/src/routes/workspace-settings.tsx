import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Crown, DoorOpen, Star, Trash2 } from "lucide-react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { useWorkspaceScope } from "@/components/layout/workspace-context"
import { Page, PageHeader } from "@/components/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { qk, useMembers } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { shortDate } from "@/lib/format"
import { Perm } from "@/lib/permissions"
import { WorkspaceGeneralCards } from "@/routes/workspace-general"

export function WorkspaceSettingsPage() {
  const { id, workspace, can } = useWorkspaceScope()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<"leave" | "delete" | "transfer" | null>(null)
  const [newOwner, setNewOwner] = useState("")
  const members = useMembers(id)
  useBreadcrumbs([{ label: workspace.name, to: `/w/${id}` }, { label: "Settings" }])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.workspace(id) }),
      queryClient.invalidateQueries({ queryKey: qk.workspaces }),
      queryClient.invalidateQueries({ queryKey: qk.members(id) }),
      queryClient.invalidateQueries({ queryKey: qk.roles(id) }),
    ])
  }

  const makeDefault = useMutation({
    mutationFn: () => unwrap(client.POST("/api/workspaces/{workspace_id}/default", { params: { path: { workspace_id: id } } })),
    onSuccess: async () => {
      await refresh()
      await queryClient.invalidateQueries({ queryKey: qk.me })
      toast.success(`${workspace.name} is now your default workspace.`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const leave = useMutation({
    mutationFn: () => unwrap(client.POST("/api/workspaces/{workspace_id}/leave", { params: { path: { workspace_id: id } } })),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: qk.workspaces })
      await queryClient.invalidateQueries({ queryKey: qk.me })
      queryClient.removeQueries({ queryKey: qk.workspace(id) })
      toast.success(res.message)
      navigate("/app", { replace: true })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const remove = useMutation({
    mutationFn: (confirmName: string) =>
      unwrap(
        client.POST("/api/workspaces/{workspace_id}/delete", {
          params: { path: { workspace_id: id } },
          body: { confirm_name: confirmName },
        }),
      ),
    onSuccess: async (res) => {
      queryClient.removeQueries({ queryKey: qk.workspace(id) })
      await queryClient.invalidateQueries({ queryKey: qk.workspaces })
      await queryClient.invalidateQueries({ queryKey: qk.me })
      toast.success(res.message)
      navigate("/app", { replace: true })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const transfer = useMutation({
    mutationFn: (confirmName: string) =>
      unwrap(
        client.POST("/api/workspaces/{workspace_id}/transfer", {
          params: { path: { workspace_id: id } },
          body: { user_id: newOwner, confirm_name: confirmName },
        }),
      ),
    onSuccess: async (res) => {
      await refresh()
      toast.success(res.message)
      setNewOwner("")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const others = (members.data ?? []).filter((m) => !m.is_owner)
  const target = others.find((m) => m.user_id === newOwner)
  const canRename = can(Perm.workspaceSettings)

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Workspace settings" description={`Created ${shortDate(workspace.created_at)}. You are ${workspace.is_owner ? "the owner" : `a${/^[aeiou]/i.test(workspace.role.name) ? "n" : ""} ${workspace.role.name}`}.`} />
      <div className="space-y-6">
        <WorkspaceGeneralCards workspace={workspace} canEdit={canRename} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Default workspace {workspace.is_default ? <Badge variant="brand"><Star /> Default</Badge> : null}
            </CardTitle>
            <CardDescription>Your default workspace opens when you sign in.</CardDescription>
          </CardHeader>
          {!workspace.is_default ? (
            <CardFooter>
              <Button variant="outline" disabled={makeDefault.isPending} onClick={() => makeDefault.mutate()}>
                <Star /> Make this my default
              </Button>
            </CardFooter>
          ) : null}
        </Card>

        {workspace.is_owner ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="size-4 text-warning" /> Transfer ownership
              </CardTitle>
              <CardDescription>
                Hand the workspace to another member. They become the owner and you become an Admin. There is always exactly
                one owner.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field className="flex-1">
                <FieldLabel>New owner</FieldLabel>
                <Select value={newOwner} onValueChange={setNewOwner}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={others.length ? "Choose a member" : "No other members yet"} />
                  </SelectTrigger>
                  <SelectContent>
                    {others.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.name} · {m.role_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button variant="outline" disabled={!newOwner} onClick={() => setDialog("transfer")}>
                Transfer...
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card className="ring-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>These actions can't be undone.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {workspace.is_owner ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Delete this workspace</p>
                  <p className="text-muted-foreground text-sm">Permanently deletes every project, document, secret and membership.</p>
                </div>
                <Button variant="destructive" onClick={() => setDialog("delete")}>
                  <Trash2 /> Delete workspace
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Leave this workspace</p>
                  <p className="text-muted-foreground text-sm">You'll lose access to all of its projects. You'd need a new invitation to return.</p>
                </div>
                <Button variant="destructive" onClick={() => setDialog("leave")}>
                  <DoorOpen /> Leave workspace
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={dialog === "leave"}
        onOpenChange={(o) => setDialog(o ? "leave" : null)}
        title={`Leave ${workspace.name}?`}
        description="You'll immediately lose access to its projects and documents."
        confirmLabel="Leave workspace"
        destructive
        onConfirm={() => leave.mutateAsync()}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => setDialog(o ? "delete" : null)}
        title={`Delete ${workspace.name}?`}
        description={
          <>
            <p>This permanently deletes the workspace for everyone: all projects, API keys, usage history, credits and its billing settings. Remaining credit is not refunded.</p>
            <p className="font-medium">Nobody, including the operators, can recover it.</p>
          </>
        }
        confirmLabel="Delete workspace forever"
        destructive
        confirmText={workspace.name}
        onConfirm={(typed) => remove.mutateAsync(typed)}
      />
      <ConfirmDialog
        open={dialog === "transfer"}
        onOpenChange={(o) => setDialog(o ? "transfer" : null)}
        title={`Make ${target?.name ?? "this member"} the owner?`}
        description={
          <>
            <p>{target?.name} will get full control, including deleting the workspace. You'll become an Admin.</p>
            <p>Only the new owner can transfer ownership back.</p>
          </>
        }
        confirmLabel="Transfer ownership"
        confirmText={workspace.name}
        onConfirm={(typed) => transfer.mutateAsync(typed)}
      />
    </Page>
  )
}
