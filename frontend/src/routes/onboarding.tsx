import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Building2, Gift, LogOut } from "lucide-react"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { Logo } from "@/components/brand"
import { SignOutDialog } from "@/components/sign-out-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { qk, useConfig, useMe, useMyInvitations } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"
import { usd } from "@/lib/format"
import { setLastWorkspace } from "@/lib/last-workspace"
import { InvitationRow } from "@/components/invitations"

const schema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  workspace: z.string().trim().min(1, "Give your workspace a name.").max(80),
})
type Values = z.infer<typeof schema>

/** First run: confirm your name and create your default workspace (or accept an invitation). */
export function OnboardingPage() {
  const { data: me } = useMe()
  const { data: config } = useConfig()
  const { data: invitations } = useMyInvitations(true)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = useState(false)
  const firstName = me?.name.split(" ")[0] ?? ""
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: me?.name ?? "", workspace: firstName ? `${firstName}'s workspace` : "" },
  })

  const create = useMutation({
    mutationFn: async (values: Values) => {
      if (values.name !== me?.name) await unwrap(client.PATCH("/api/account", { body: { name: values.name } }))
      return unwrap(client.POST("/api/workspaces", { body: { name: values.workspace } }))
    },
    onSuccess: async (ws) => {
      setLastWorkspace(ws.id)
      if (ws.free_credit_micros > 0) toast.success(`${usd(ws.free_credit_micros)} starter credit added to ${ws.name}.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.me }),
        queryClient.invalidateQueries({ queryKey: qk.workspaces }),
      ])
      navigate(`/w/${ws.id}?welcome=1`, { replace: true })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const credit = config?.free_credit_micros ?? 0
  const pending = invitations ?? []

  return (
    <div className="bg-glow relative flex min-h-dvh flex-col">
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_65%)]" aria-hidden="true" />
      <header className="relative flex items-center justify-between px-4 py-5 sm:px-8">
        <Logo />
        <Button variant="ghost" size="sm" onClick={() => setSigningOut(true)}>
          <LogOut /> Sign out
        </Button>
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-14">
        <div className="w-full max-w-lg space-y-5">
          {pending.length > 0 ? (
            <Card>
              <CardContent className="space-y-3">
                <p className="font-medium">You have {pending.length === 1 ? "an invitation" : "invitations"}</p>
                {pending.map((inv) => (
                  <InvitationRow key={inv.id} invitation={inv} />
                ))}
                <p className="text-muted-foreground text-xs">Or create your own workspace below.</p>
              </CardContent>
            </Card>
          ) : null}
          <Card className="shadow-lg">
            <CardContent className="space-y-6">
              <div className="bg-brand-soft text-brand ring-brand/20 flex size-12 items-center justify-center rounded-2xl ring-1">
                <Building2 className="size-6" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold">Welcome{firstName ? `, ${firstName}` : ""}. Let's set up your workspace.</h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  A workspace holds your projects, API keys, credits and team. You will be its owner and it becomes your default.
                </p>
              </div>
              {credit > 0 && me?.email_verified ? (
                <Alert variant="brand">
                  <Gift />
                  <AlertTitle>{usd(credit)} starter credit</AlertTitle>
                  <AlertDescription>Your first workspace gets free credit to try any model.</AlertDescription>
                </Alert>
              ) : null}
              <form onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
                <FieldGroup>
                  <Field data-invalid={Boolean(form.formState.errors.name)}>
                    <FieldLabel htmlFor="your-name">Your name</FieldLabel>
                    <Input id="your-name" autoComplete="name" {...form.register("name")} />
                    <FieldError errors={[form.formState.errors.name]} />
                  </Field>
                  <Field data-invalid={Boolean(form.formState.errors.workspace)}>
                    <FieldLabel htmlFor="ws-name">Workspace name</FieldLabel>
                    <Input id="ws-name" autoFocus {...form.register("workspace")} />
                    <FieldDescription>Usually your company or team name. You can rename it later.</FieldDescription>
                    <FieldError errors={[form.formState.errors.workspace]} />
                  </Field>
                  <Button type="submit" size="lg" className="w-full" disabled={create.isPending}>
                    {create.isPending ? <Spinner /> : null} Create workspace <ArrowRight />
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
      <SignOutDialog open={signingOut} onOpenChange={setSigningOut} />
    </div>
  )
}
