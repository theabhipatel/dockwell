import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Ban, KeyRound, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { EditKeyDialog } from "@/components/api-key-dialogs"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { CopyButton } from "@/components/copy-button"
import { EmptyState } from "@/components/states"
import { UserAvatar } from "@/components/user-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { qk } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { relativeTime, shortDate, usd } from "@/lib/format"
import type { ApiKey } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS_VARIANT = { active: "success", revoked: "secondary", expired: "warning" } as const

export function ApiKeyTable({
  workspaceId,
  keys,
  showProject = true,
  highlight,
  emptyAction,
}: {
  workspaceId: string
  keys: ApiKey[]
  showProject?: boolean
  highlight?: string | null
  emptyAction?: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ApiKey | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [deleting, setDeleting] = useState<ApiKey | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.keys(workspaceId) })
  const path = (key: ApiKey) => ({ params: { path: { workspace_id: workspaceId, key_id: key.id } } })
  const revoke = useMutation({
    mutationFn: (key: ApiKey) => unwrap(client.POST("/api/workspaces/{workspace_id}/api-keys/{key_id}/revoke", path(key))),
    onSuccess: async () => {
      await refresh()
      toast.success("Key revoked. It stops working immediately.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (key: ApiKey) => unwrap(client.DELETE("/api/workspaces/{workspace_id}/api-keys/{key_id}", path(key))),
    onSuccess: async () => {
      await refresh()
      toast.success("Key deleted.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (keys.length === 0) {
    return <EmptyState icon={KeyRound} title="No API keys yet" description="Create a key to call the OpenAI-compatible API." action={emptyAction} />
  }

  return (
    <>
      <Card className="gap-0 overflow-x-auto py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Name</TableHead>
              <TableHead>Key</TableHead>
              {showProject ? <TableHead className="hidden md:table-cell">Project</TableHead> : null}
              <TableHead className="hidden lg:table-cell">Created by</TableHead>
              <TableHead className="hidden sm:table-cell">Last used</TableHead>
              <TableHead className="hidden xl:table-cell">Spend</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12 pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id} className={cn(highlight === k.id && "bg-brand-soft/40", k.status !== "active" && "opacity-70")}>
                <TableCell className="pl-4">
                  <p className="font-medium">{k.name}</p>
                  <p className="text-muted-foreground text-xs">
                    Created {shortDate(k.created_at)}
                    {k.expires_at ? ` · expires ${shortDate(k.expires_at)}` : ""}
                  </p>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1">
                    <code className="text-xs">{k.display}</code>
                    <CopyButton value={k.id} label="Copy key id" size="icon-xs" />
                  </span>
                  {k.allowed_models.length > 0 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <p className="text-muted-foreground text-xs">{k.allowed_models.length} allowed model{k.allowed_models.length === 1 ? "" : "s"}</p>
                      </TooltipTrigger>
                      <TooltipContent>{k.allowed_models.join(", ")}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </TableCell>
                {showProject ? <TableCell className="hidden text-sm md:table-cell">{k.project_name}</TableCell> : null}
                <TableCell className="hidden lg:table-cell">
                  {k.created_by ? (
                    <span className="flex items-center gap-2 text-sm">
                      <UserAvatar name={k.created_by.name} src={k.created_by.avatar_url} size="sm" />
                      <span className="truncate">{k.created_by.name}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">Deleted user</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">{k.last_used_at ? relativeTime(k.last_used_at) : "Never"}</TableCell>
                <TableCell className="tabular hidden text-xs xl:table-cell">
                  {usd(k.spent_micros)}
                  {k.spend_limit_micros != null ? <span className="text-muted-foreground"> / {usd(k.spend_limit_micros)}</span> : null}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[k.status]}>{k.status}</Badge>
                </TableCell>
                <TableCell className="pr-4">
                  {k.can_manage ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${k.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {k.status === "active" ? (
                          <>
                            <DropdownMenuItem onSelect={() => setEditing(k)}>
                              <Pencil /> Edit limits
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setRevoking(k)}>
                              <Ban /> Revoke
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        ) : null}
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(k)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {editing ? <EditKeyDialog workspaceId={workspaceId} apiKey={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Revoke ${revoking?.name ?? "key"}?`}
        description="Requests using this key fail immediately. Its usage history is kept."
        confirmLabel="Revoke key"
        destructive
        onConfirm={() => (revoking ? revoke.mutateAsync(revoking) : undefined)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "key"}?`}
        description="The key is removed permanently. Request logs keep showing it as a deleted key."
        confirmLabel="Delete key"
        destructive
        onConfirm={() => (deleting ? remove.mutateAsync(deleting) : undefined)}
      />
    </>
  )
}
