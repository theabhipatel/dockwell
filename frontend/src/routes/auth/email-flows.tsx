import { useEffect, useRef, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, ArrowLeft, CheckCircle2, MailCheck } from "lucide-react"
import { useForm } from "react-hook-form"
import { Link, useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { PasswordInput } from "@/components/password-input"
import { PasswordStrength } from "@/components/password-strength"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { qk } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"

import { AuthHeading, AuthLayout } from "./layout"

function useCooldown(seconds: number): [number, () => void] {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (left <= 0) return
    const t = window.setTimeout(() => setLeft((v) => v - 1), 1000)
    return () => window.clearTimeout(t)
  }, [left])
  return [left, () => setLeft(seconds)]
}

export function CheckEmailPage() {
  const [params] = useSearchParams()
  const email = params.get("email") ?? ""
  const [cooldown, startCooldown] = useCooldown(60)
  const resend = useMutation({
    mutationFn: () => unwrap(client.POST("/api/auth/resend-verification", { body: { email } })),
    onSuccess: () => {
      startCooldown()
      toast.success("We sent another link.")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <AuthLayout>
      <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand ring-1 ring-brand/20">
        <MailCheck className="size-6" />
      </div>
      <AuthHeading
        title="Check your email"
        description={
          <>
            If <span className="text-foreground font-medium">{email || "your address"}</span> can receive email from us, a
            verification link is on its way. It expires in 48 hours.
          </>
        }
      />
      <div className="space-y-3">
        <Button variant="outline" className="w-full" disabled={!email || resend.isPending || cooldown > 0} onClick={() => resend.mutate()}>
          {resend.isPending ? <Spinner /> : null}
          {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend the link"}
        </Button>
        <Button variant="ghost" className="w-full" asChild>
          <Link to="/login">
            <ArrowLeft /> Back to sign in
          </Link>
        </Button>
      </div>
    </AuthLayout>
  )
}

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const started = useRef(false)
  const verify = useMutation({
    mutationFn: () => unwrap(client.POST("/api/auth/verify-email", { body: { token } })),
    onSuccess: (me) => {
      queryClient.setQueryData(qk.me, me)
      toast.success("Email verified. Welcome to DockWell.")
      navigate("/app", { replace: true })
    },
  })

  useEffect(() => {
    // Tokens are single-use: guard against React StrictMode's double effect.
    if (started.current || !token) return
    started.current = true
    verify.mutate()
  }, [token, verify])

  return (
    <AuthLayout>
      {verify.isError || !token ? (
        <>
          <AuthHeading title="This link didn't work" />
          <Alert variant="destructive" className="mb-6">
            <AlertCircle />
            <AlertTitle>Verification failed</AlertTitle>
            <AlertDescription>
              {token ? errorMessage(verify.error) : "The link is missing its token."} Sign in to request a new link.
            </AlertDescription>
          </Alert>
          <Button className="w-full" asChild>
            <Link to="/login">Go to sign in</Link>
          </Button>
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <Spinner className="size-6 text-brand" />
          <p className="text-muted-foreground text-sm">Verifying your email...</p>
        </div>
      )}
    </AuthLayout>
  )
}

const forgotSchema = z.object({ email: z.email("Enter a valid email address.") })

export function ForgotPasswordPage() {
  const form = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema), defaultValues: { email: "" } })
  const request = useMutation({
    mutationFn: (email: string) => unwrap(client.POST("/api/auth/forgot-password", { body: { email } })),
  })
  return (
    <AuthLayout>
      <AuthHeading
        title="Reset your password"
        description="Enter your account email and we'll send you a single-use link to choose a new password."
      />
      {request.isSuccess ? (
        <Alert variant="success" className="mb-6">
          <CheckCircle2 />
          <AlertTitle>Check your inbox</AlertTitle>
          <AlertDescription>{request.data.message}</AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={form.handleSubmit((v) => request.mutate(v.email))} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(form.formState.errors.email)}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" type="email" autoComplete="email" autoFocus {...form.register("email")} />
              <FieldError errors={[form.formState.errors.email]} />
            </Field>
            {request.error ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{errorMessage(request.error)}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" size="lg" className="w-full" disabled={request.isPending}>
              {request.isPending ? <Spinner /> : null} Send reset link
            </Button>
          </FieldGroup>
        </form>
      )}
      <Button variant="ghost" className="mt-4 w-full" asChild>
        <Link to="/login">
          <ArrowLeft /> Back to sign in
        </Link>
      </Button>
    </AuthLayout>
  )
}

const resetSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters.").max(256),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The passwords don't match.", path: ["confirm"] })

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const navigate = useNavigate()
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirm: "" },
  })
  const reset = useMutation({
    mutationFn: (password: string) => unwrap(client.POST("/api/auth/reset-password", { body: { token, password } })),
    onSuccess: (res) => {
      toast.success(res.message)
      navigate("/login", { replace: true })
    },
  })
  const errors = form.formState.errors
  return (
    <AuthLayout>
      <AuthHeading title="Choose a new password" description="All your other sessions will be signed out." />
      <form onSubmit={form.handleSubmit((v) => reset.mutate(v.password))} noValidate>
        <FieldGroup>
          <Field data-invalid={Boolean(errors.password)}>
            <FieldLabel htmlFor="password">New login password</FieldLabel>
            <PasswordInput id="password" autoComplete="new-password" autoFocus {...form.register("password")} />
            <PasswordStrength password={form.watch("password")} />
            <FieldError errors={[errors.password]} />
          </Field>
          <Field data-invalid={Boolean(errors.confirm)}>
            <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
            <PasswordInput id="confirm" autoComplete="new-password" {...form.register("confirm")} />
            <FieldError errors={[errors.confirm]} />
          </Field>
          {reset.error || !token ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>
                {token ? errorMessage(reset.error) : "This link is missing its token."}{" "}
                <Link to="/forgot-password" className="underline underline-offset-2">Request a new link</Link>
              </AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={reset.isPending || !token}>
            {reset.isPending ? <Spinner /> : null} Set new password
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  )
}

/** The link sent to a new address when a user changes their email. Works signed in or out. */
export function ConfirmEmailPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const queryClient = useQueryClient()
  const started = useRef(false)
  const confirm = useMutation({
    mutationFn: () => unwrap(client.POST("/api/auth/confirm-email", { body: { token } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.me }),
  })
  useEffect(() => {
    if (started.current || !token) return
    started.current = true
    confirm.mutate()
  }, [token, confirm])
  return (
    <AuthLayout>
      {confirm.isSuccess ? (
        <>
          <AuthHeading title="Email updated" description={confirm.data.message} />
          <Button className="w-full" asChild>
            <Link to="/app">Continue</Link>
          </Button>
        </>
      ) : confirm.isError || !token ? (
        <>
          <AuthHeading title="This link didn't work" />
          <Alert variant="destructive" className="mb-6">
            <AlertCircle />
            <AlertDescription>{token ? errorMessage(confirm.error) : "The link is missing its token."}</AlertDescription>
          </Alert>
          <Button className="w-full" asChild>
            <Link to="/settings/profile">Back to settings</Link>
          </Button>
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <Spinner className="text-brand size-6" />
          <p className="text-muted-foreground text-sm">Confirming your new email...</p>
        </div>
      )}
    </AuthLayout>
  )
}
