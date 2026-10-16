import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Building2, Check, X } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { qk } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { relativeTime } from "@/lib/format"
import type { MyInvitation } from "@/lib/types"

export function useInvitationActions() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.myInvitations }),
      queryClient.invalidateQueries({ queryKey: qk.notifications }),
      queryClient.invalidateQueries({ queryKey: qk.workspaces }),
    ])
  }
  const accept = useMutation({
    mutationFn: (inv: MyInvitation) =>
      unwrap(client.POST("/api/invitations/{invitation_id}/accept", { params: { path: { invitation_id: inv.id } } })),
    onSuccess: async (res, inv) => {
      await refresh()
      toast.success(`You joined ${inv.workspace_name}.`, {
        action: { label: "Open", onClick: () => navigate(`/w/${res.workspace_id}`) },
      })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const decline = useMutation({
    mutationFn: (inv: MyInvitation) =>
      unwrap(client.POST("/api/invitations/{invitation_id}/decline", { params: { path: { invitation_id: inv.id } } })),
    onSuccess: async (_, inv) => {
      await refresh()
      toast(`Declined the invitation to ${inv.workspace_name}.`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return { accept, decline }
}

export function InvitationRow({ invitation }: { invitation: MyInvitation }) {
  const { accept, decline } = useInvitationActions()
  const [confirmDecline, setConfirmDecline] = useState(false)
  const busy = accept.isPending || decline.isPending
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Building2 className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{invitation.workspace_name}</p>
        <p className="text-muted-foreground text-sm">
          {invitation.invited_by_name ? `${invitation.invited_by_name} invited you` : "You were invited"} as{" "}
          <span className="text-foreground font-medium">{invitation.role_name}</span> · {relativeTime(invitation.created_at)}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmDecline(true)}>
          {decline.isPending ? <Spinner /> : <X />} Decline
        </Button>
        <Button size="sm" disabled={busy} onClick={() => accept.mutate(invitation)}>
          {accept.isPending ? <Spinner /> : <Check />} Accept
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDecline}
        onOpenChange={setConfirmDecline}
        title={`Decline the invitation to ${invitation.workspace_name}?`}
        description="You won't be able to accept it later. Someone in the workspace would need to invite you again."
        confirmLabel="Decline invitation"
        destructive
        onConfirm={() => decline.mutateAsync(invitation)}
      />
    </div>
  )
}

export function InvitationsDialog({
  open,
  onOpenChange,
  invitations,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invitations: MyInvitation[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>You've been invited</DialogTitle>
          <DialogDescription>
            Accept to join these workspaces now, or decide later from your notifications.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto py-1">
          {invitations.map((inv) => (
            <InvitationRow key={inv.id} invitation={inv} />
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Decide later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
