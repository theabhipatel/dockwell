import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, CheckCircle2, MailWarning } from "lucide-react"
import { useForm } from "react-hook-form"
import { Link, useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { z } from "zod"

import { PasswordInput } from "@/components/password-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { qk, useConfig } from "@/hooks/api"
import { ApiError, client, errorMessage, unwrap } from "@/lib/api"

import { AuthHeading, AuthLayout, GoogleIcon, safeNext } from "./layout"

const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
})
type Values = z.infer<typeof schema>

export function LoginPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get("next"))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: config } = useConfig()
  const [unverified, setUnverified] = useState<string | null>(null)
  const googleError = params.get("error")
  const created = params.get("created") === "1"

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: params.get("email") ?? "", password: "" } })

  const signin = useMutation({
    mutationFn: (values: Values) => unwrap(client.POST("/api/auth/signin", { body: values })),
    onSuccess: (result) => {
      if (result.two_factor_required && result.challenge) {
        navigate(`/login/2fa?challenge=${encodeURIComponent(result.challenge)}&next=${encodeURIComponent(next)}`)
        return
      }
      queryClient.setQueryData(qk.me, result.me)
      navigate(next, { replace: true })
    },
    onError: (error, values) => {
      if (error instanceof ApiError && error.status === 403) setUnverified(values.email)
    },
  })

  const resend = useMutation({
    mutationFn: (email: string) => unwrap(client.POST("/api/auth/resend-verification", { body: { email } })),
    onSuccess: () => toast.success("Verification email sent. Check your inbox."),
    onError: (error) => toast.error(errorMessage(error)),
  })

  const submitError = signin.error && !(signin.error instanceof ApiError && signin.error.status === 403) ? signin.error : null

  return (
    <AuthLayout>
      <AuthHeading title="Welcome back" description="Sign in to your DockWell account." />

      {created ? (
        <Alert className="mb-5">
          <CheckCircle2 />
          <AlertTitle>Your account is ready</AlertTitle>
          <AlertDescription>Sign in with the password you just chose.</AlertDescription>
        </Alert>
      ) : null}

      {googleError ? (
        <Alert variant="destructive" className="mb-5">
          <AlertCircle />
          <AlertTitle>Google sign-in didn't complete</AlertTitle>
          <AlertDescription>{googleError}</AlertDescription>
        </Alert>
      ) : null}

      {unverified ? (
        <Alert variant="warning" className="mb-5">
          <MailWarning />
          <AlertTitle>Verify your email first</AlertTitle>
          <AlertDescription>
            <p>We sent a verification link to {unverified} when you signed up.</p>
            <Button variant="link" className="h-auto px-0" disabled={resend.isPending} onClick={() => resend.mutate(unverified)}>
              Send a new link
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {config?.google_enabled ? (
        <>
          <Button variant="outline" size="lg" className="w-full" asChild>
            <a href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}>
              <GoogleIcon /> Continue with Google
            </a>
          </Button>
          <FieldSeparator className="my-5">or with email</FieldSeparator>
        </>
      ) : null}

      <form onSubmit={form.handleSubmit((v) => { setUnverified(null); signin.mutate(v) })} noValidate>
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.email)}>
            <FieldLabel htmlFor="email">Your email</FieldLabel>
            <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" autoFocus aria-invalid={Boolean(form.formState.errors.email)} {...form.register("email")} />
            <FieldError errors={[form.formState.errors.email]} />
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.password)}>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline">
                Forgot password?
              </Link>
            </div>
            <PasswordInput id="password" autoComplete="current-password" aria-invalid={Boolean(form.formState.errors.password)} {...form.register("password")} />
            <FieldError errors={[form.formState.errors.password]} />
          </Field>
          {submitError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{errorMessage(submitError)}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={signin.isPending}>
            {signin.isPending ? <Spinner /> : null} Sign in
          </Button>
        </FieldGroup>
      </form>

      <p className="text-muted-foreground mt-8 text-center text-sm">
        New here?{" "}
        <Link to={`/signup${params.toString() ? `?${params.toString()}` : ""}`} className="text-foreground font-medium underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  )
}

const codeSchema = z.object({ code: z.string().trim().min(6, "Enter the 6-digit code or a backup code.") })

/** Second step of sign-in when two-factor authentication is on. */
export function TwoFactorPage() {
  const [params] = useSearchParams()
  const challenge = params.get("challenge") ?? ""
  const next = safeNext(params.get("next"))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [useBackup, setUseBackup] = useState(false)
  const form = useForm<{ code: string }>({ resolver: zodResolver(codeSchema), defaultValues: { code: "" } })
  const verify = useMutation({
    mutationFn: (code: string) => unwrap(client.POST("/api/auth/signin/2fa", { body: { challenge, code } })),
    onSuccess: (result) => {
      queryClient.setQueryData(qk.me, result.me)
      navigate(next, { replace: true })
    },
  })
  return (
    <AuthLayout>
      <AuthHeading
        title="Two-factor authentication"
        description={useBackup ? "Enter one of your backup codes." : "Enter the 6-digit code from your authenticator app."}
      />
      {!challenge ? (
        <Alert variant="destructive" className="mb-5">
          <AlertCircle />
          <AlertDescription>This sign-in attempt is missing. Please sign in again.</AlertDescription>
        </Alert>
      ) : null}
      <form onSubmit={form.handleSubmit((v) => verify.mutate(v.code))} noValidate>
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.code)}>
            <FieldLabel htmlFor="code">{useBackup ? "Backup code" : "Authentication code"}</FieldLabel>
            <Input
              id="code"
              autoFocus
              autoComplete="one-time-code"
              inputMode={useBackup ? "text" : "numeric"}
              placeholder={useBackup ? "xxxxx-xxxxx" : "123456"}
              className="font-mono tracking-widest"
              {...form.register("code")}
            />
            <FieldError errors={[form.formState.errors.code]} />
          </Field>
          {verify.error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{errorMessage(verify.error)}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={verify.isPending || !challenge}>
            {verify.isPending ? <Spinner /> : null} Verify and sign in
          </Button>
        </FieldGroup>
      </form>
      <div className="mt-6 flex items-center justify-between text-sm">
        <Button variant="link" className="h-auto px-0" onClick={() => setUseBackup((v) => !v)}>
          {useBackup ? "Use authenticator code" : "Use a backup code"}
        </Button>
        <Link to="/login" className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  )
}
