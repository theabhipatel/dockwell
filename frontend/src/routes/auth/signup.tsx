import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { AlertCircle } from "lucide-react"
import { useForm } from "react-hook-form"
import { Link, useNavigate, useSearchParams } from "react-router"
import { z } from "zod"

import { PasswordInput } from "@/components/password-input"
import { PasswordStrength } from "@/components/password-strength"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useConfig } from "@/hooks/api"
import { client, errorMessage, unwrap } from "@/lib/api"

import { AuthHeading, AuthLayout, GoogleIcon } from "./layout"

const schema = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(120),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters.").max(256),
})
type Values = z.infer<typeof schema>

export function SignupPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { data: config } = useConfig()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: params.get("email") ?? "", password: "" },
  })
  const password = form.watch("password")
  const email = form.watch("email")
  const name = form.watch("name")

  const signup = useMutation({
    mutationFn: (values: Values) => unwrap(client.POST("/api/auth/signup", { body: values })),
    onSuccess: (_, values) =>
      navigate(
        config?.email_verification_required === false
          ? `/login?email=${encodeURIComponent(values.email)}&created=1`
          : `/check-email?email=${encodeURIComponent(values.email)}`,
      ),
  })

  const errors = form.formState.errors
  return (
    <AuthLayout>
      <AuthHeading title="Create your account" description={
          config?.email_verification_required === false
            ? "Serve open source models behind an OpenAI-compatible API. Your starter credit is added when you create your workspace."
            : "Serve open source models behind an OpenAI-compatible API. Your starter credit is added once you verify your email."
        }
      />

      {config?.google_enabled ? (
        <>
          <Button variant="outline" size="lg" className="w-full" asChild>
            <a href="/api/auth/google/start">
              <GoogleIcon /> Sign up with Google
            </a>
          </Button>
          <FieldSeparator className="my-5">or with email</FieldSeparator>
        </>
      ) : null}

      <form onSubmit={form.handleSubmit((v) => signup.mutate(v))} noValidate>
        <FieldGroup>
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="name">Full name</FieldLabel>
            <Input id="name" autoComplete="name" autoFocus aria-invalid={Boolean(errors.name)} {...form.register("name")} />
            <FieldError errors={[errors.name]} />
          </Field>
          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor="email">Your email</FieldLabel>
            <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" aria-invalid={Boolean(errors.email)} {...form.register("email")} />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field data-invalid={Boolean(errors.password)}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput id="password" autoComplete="new-password" aria-invalid={Boolean(errors.password)} {...form.register("password")} />
            <PasswordStrength password={password} userInputs={[email, name]} />
            <FieldDescription>
              At least 8 characters. Use a password you do not use anywhere else.
            </FieldDescription>
            <FieldError errors={[errors.password]} />
          </Field>
          {signup.error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{errorMessage(signup.error)}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={signup.isPending}>
            {signup.isPending ? <Spinner /> : null} Create account
          </Button>
        </FieldGroup>
      </form>

      <p className="text-muted-foreground mt-8 text-center text-sm">
        Already have an account?{" "}
        <Link to="/login" className="text-foreground font-medium underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
