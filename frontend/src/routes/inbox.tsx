import { Bell, CheckCheck, Mail } from "lucide-react"

import { InvitationRow } from "@/components/invitations"
import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { NotificationRow, useNotificationActions } from "@/components/layout/notifications-menu"
import { Page, PageHeader, SectionTitle } from "@/components/page"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useMyInvitations, useNotifications } from "@/hooks/api"

export function NotificationsPage() {
  const notifications = useNotifications(true)
  const invitations = useMyInvitations(true)
  const { markAll } = useNotificationActions()
  useBreadcrumbs([{ label: "Notifications" }])
  const items = (notifications.data?.items ?? []).filter((n) => n.type !== "invitation.received" || n.read_at)

  return (
    <Page className="max-w-3xl">
      <PageHeader
        title="Notifications"
        description="Invitations, access changes and security events."
        actions={
          <Button variant="outline" disabled={!notifications.data?.unread_count || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      {invitations.data && invitations.data.length > 0 ? (
        <section className="mb-8">
          <SectionTitle>Pending invitations</SectionTitle>
          <div className="space-y-3">
            {invitations.data.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} />
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <SectionTitle>Recent</SectionTitle>
        {notifications.isPending ? (
          <ListSkeleton rows={4} />
        ) : notifications.error ? (
          <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={Bell} title="You're all caught up" description="New notifications will appear here." />
        ) : (
          <Card className="py-2">
            <CardContent className="space-y-0.5 px-2">
              {items.map((item) => (
                <NotificationRow key={item.id} item={item} />
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </Page>
  )
}

export function InvitationsPage() {
  const invitations = useMyInvitations(true)
  useBreadcrumbs([{ label: "Invitations" }])
  return (
    <Page className="max-w-3xl">
      <PageHeader title="Invitations" description="Workspaces you've been invited to join." />
      {invitations.isPending ? (
        <ListSkeleton rows={2} />
      ) : invitations.error ? (
        <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
      ) : invitations.data.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No pending invitations"
          description="Invitations expire after 7 days. If you expected one, ask the sender to resend it to the email you signed up with."
        />
      ) : (
        <div className="space-y-3">
          {invitations.data.map((inv) => (
            <InvitationRow key={inv.id} invitation={inv} />
          ))}
        </div>
      )}
    </Page>
  )
}
