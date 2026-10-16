import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCircle2, Mail, XCircle } from "lucide-react"
import { toast } from "sonner"

import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { Page, PageHeader } from "@/components/page"
import { ErrorState, ListSkeleton } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { client, errorMessage, unwrap } from "@/lib/api"
import { relativeTime } from "@/lib/format"

type Status = { ok: boolean; label: string; detail: string }

function ServiceCard({ title, status, children }: { title: string; status: Status; children?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {status.ok ? <CheckCircle2 className="text-success size-4" /> : <XCircle className="text-destructive size-4" />} {title}
          <Badge variant={status.ok ? "success" : "warning"} className="ml-auto">{status.label}</Badge>
        </CardTitle>
        <CardDescription>{status.detail}</CardDescription>
      </CardHeader>
      {children}
    </Card>
  )
}

export function AdminStatusPage() {
  useBreadcrumbs([{ label: "Admin", to: "/admin" }, { label: "Service status" }])
  const status = useQuery({ queryKey: ["admin", "status"], queryFn: () => unwrap(client.GET("/api/admin/status")) })
  const [to, setTo] = useState("")
  const test = useMutation({
    mutationFn: () => unwrap(client.POST("/api/admin/settings/test-email", { body: { to: to || null } })),
    onSuccess: (res) => (res.ok ? toast.success(res.message) : toast.error(res.message)),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const s = status.data
  if (status.error) return <Page><ErrorState error={status.error} /></Page>
  return (
    <Page>
      <PageHeader eyebrow="Admin" title="Service status" description={s ? `DockWell ${s.version}${s.serverless ? " · serverless mode" : ""}${s.demo_mode ? " · demo mode" : ""}` : undefined} />
      {!s ? <ListSkeleton rows={4} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ServiceCard title="Database" status={s.database} />
          <ServiceCard title="Email (SMTP)" status={s.email}>
            <CardContent>
              <Input type="email" placeholder="Send to (defaults to your address)" value={to} onChange={(e) => setTo(e.target.value)} />
            </CardContent>
            <CardFooter>
              <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? <Spinner /> : <Mail />} Send test email</Button>
            </CardFooter>
          </ServiceCard>
          <ServiceCard title="Stripe" status={s.stripe}>
            <CardContent className="text-muted-foreground text-sm">
              Last webhook: {s.stripe_last_event_at ? `${s.stripe_last_event_type} ${relativeTime(s.stripe_last_event_at)}` : "none received yet"}
            </CardContent>
          </ServiceCard>
          <ServiceCard title="Google sign-in" status={s.google} />
          <ServiceCard title="Engine manager" status={s.engine_manager} />
        </div>
      )}
    </Page>
  )
}
