import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Bell,
  BellRing,
  Boxes,
  CheckCheck,
  CreditCard,
  FolderPlus,
  KeyRound,
  Mail,
  ShieldAlert,
  UserCog,
  UserMinus,
  Wallet,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Link, useNavigate } from "react-router"

import { InvitationRow } from "@/components/invitations"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { qk, useMyInvitations, useNotifications } from "@/hooks/api"
import { client, unwrap } from "@/lib/api"
import { relativeTime } from "@/lib/format"
import type { NotificationItem } from "@/lib/types"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = {
  "invitation.received": Mail,
  "invitation.accepted": Mail,
  "invitation.declined": Mail,
  "project.access_granted": FolderPlus,
  "member.role_changed": UserCog,
  "member.removed": UserMinus,
  "workspace.deleted": ShieldAlert,
  "workspace.ownership_received": KeyRound,
  "billing.low_balance": Wallet,
  "billing.zero_balance": AlertTriangle,
  "billing.payment_succeeded": CreditCard,
  "billing.payment_failed": AlertTriangle,
  "billing.credit_granted": CreditCard,
  "billing.spend_alert": AlertTriangle,
  "billing.spend_limit_reached": AlertTriangle,
  "api_key.expiring": KeyRound,
  "model.retiring": Boxes,
}

export function useNotificationActions() {
  const queryClient = useQueryClient()
  const markRead = useMutation({
    mutationFn: (id: string) =>
      unwrap(client.POST("/api/notifications/{notification_id}/read", { params: { path: { notification_id: id } } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  })
  const markAll = useMutation({
    mutationFn: () => unwrap(client.POST("/api/notifications/read-all")),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  })
  return { markRead, markAll }
}

export function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen?: () => void }) {
  const navigate = useNavigate()
  const { markRead } = useNotificationActions()
  const Icon = ICONS[item.type] ?? BellRing
  const unread = !item.read_at
  const open = () => {
    if (unread) markRead.mutate(item.id)
    onOpen?.()
    if (item.link) navigate(item.link)
  }
  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "flex w-full gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted",
        unread && "bg-brand-soft/40",
      )}
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug font-medium">{item.title}</span>
        {item.body ? <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">{item.body}</span> : null}
        <span className="text-muted-foreground mt-1 block text-[0.7rem]">{relativeTime(item.created_at)}</span>
      </span>
      {unread ? <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" /> : null}
    </button>
  )
}

export function NotificationsMenu() {
  const { data } = useNotifications(true)
  const { data: invitations } = useMyInvitations(true)
  const { markAll } = useNotificationActions()
  const pending = invitations ?? []
  // Invitation notifications are represented by the live invitation rows above the list.
  const items = (data?.items ?? []).filter((n) => n.type !== "invitation.received" || n.read_at)
  const unread = (data?.unread_count ?? 0)
  const badge = Math.max(unread, pending.length)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${badge ? `, ${badge} unread` : ""}`}>
          <Bell />
          {badge > 0 ? (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.65rem] font-bold text-brand-foreground ring-2 ring-background">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-1.5rem))] gap-0 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-heading font-semibold">Notifications</p>
          <Button variant="ghost" size="sm" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-[min(28rem,70vh)]">
          {pending.length > 0 ? (
            <div className="space-y-2 border-b p-3">
              <p className="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">Pending invitations</p>
              {pending.map((inv) => (
                <InvitationRow key={inv.id} invitation={inv} />
              ))}
            </div>
          ) : null}
          <div className="p-1.5">
            {items.length === 0 && pending.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 px-6 py-10 text-center text-sm">
                <Bell className="size-5" />
                You're all caught up.
              </div>
            ) : (
              items.slice(0, 15).map((item) => <NotificationRow key={item.id} item={item} />)
            )}
          </div>
        </ScrollArea>
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link to="/notifications">View all notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
