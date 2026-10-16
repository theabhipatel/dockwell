import { Activity as ActivityIcon, AlertTriangle, ArrowRight, CheckCircle2, Circle, Coins, CreditCard, Hash, KeyRound, MessageSquareText, Plus, Sparkles, Wallet } from "lucide-react"
import { Link, useSearchParams } from "react-router"

import { useBreadcrumbs } from "@/components/layout/breadcrumbs"
import { useWorkspaceScope } from "@/components/layout/workspace-context"
import { CodeSnippets } from "@/components/code-snippets"
import { CopyField } from "@/components/copy-button"
import { Page, PageHeader } from "@/components/page"
import { StatCard } from "@/components/stat-card"
import { ErrorState, ListSkeleton } from "@/components/states"
import { DailyChart } from "@/components/usage-chart"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { useDashboard } from "@/hooks/api"
import { actionLabel, plural, relativeTime, tokens, usd } from "@/lib/format"
import { Perm } from "@/lib/permissions"
import { cn } from "@/lib/utils"

export function DashboardPage() {
  const { id, workspace, can } = useWorkspaceScope()
  const [params] = useSearchParams()
  const { data, error, isPending, refetch } = useDashboard(id)
  useBreadcrumbs([{ label: workspace.name }])
  const base = `/w/${id}`

  if (error) {
    return (
      <Page>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Page>
    )
  }

  const checklist = data
    ? [
        { done: data.checklist.has_api_key, label: "Create an API key", to: `${base}/api-keys?new=1`, icon: KeyRound },
        { done: data.checklist.used_playground, label: "Try the playground", to: `${base}/playground`, icon: MessageSquareText },
        { done: data.checklist.added_credits, label: "Add credits", to: `${base}/billing`, icon: CreditCard },
      ]
    : []
  const allDone = checklist.length > 0 && checklist.every((c) => c.done)
  const limitShare =
    data?.monthly_spend_limit_micros ? Math.min(100, (data.period_spend_micros / data.monthly_spend_limit_micros) * 100) : null

  return (
    <Page>
      <PageHeader
        eyebrow="Dashboard"
        title={params.get("welcome") ? `Welcome to ${workspace.name}` : workspace.name}
        description="Credits, usage and everything you need to make your first request."
        actions={
          <>
            {can(Perm.usePlayground) ? (
              <Button variant="outline" asChild>
                <Link to={`${base}/playground`}>
                  <MessageSquareText /> Playground
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link to={`${base}/api-keys?new=1`}>
                <Plus /> Create API key
              </Link>
            </Button>
          </>
        }
      />

      {workspace.suspended ? (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle />
          <AlertTitle>This workspace is suspended</AlertTitle>
          <AlertDescription>{workspace.suspended_reason || "API keys and the playground are disabled. Contact the platform administrator."}</AlertDescription>
        </Alert>
      ) : null}

      {data?.low_balance ? (
        <Alert variant="warning" className="mb-6">
          <Wallet />
          <AlertTitle>{data.balance_micros <= 0 ? "You are out of credits" : "Your balance is running low"}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Requests are refused when the balance reaches zero. Balance: {usd(data.balance_micros)}.</span>
            {data.can_manage_billing ? (
              <Button size="sm" asChild>
                <Link to={`${base}/billing?add=1`}>
                  <CreditCard /> Add credits
                </Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Credit balance"
          icon={Wallet}
          loading={isPending}
          tone={data?.low_balance ? "warning" : "default"}
          value={data ? usd(data.balance_micros) : null}
          hint={data && data.available_micros !== data.balance_micros ? `${usd(data.available_micros)} available` : "Pay as you go"}
          action={
            data?.can_manage_billing ? (
              <Button size="xs" variant="outline" asChild>
                <Link to={`${base}/billing?add=1`}>
                  <Plus /> Add credits
                </Link>
              </Button>
            ) : null
          }
        />
        <StatCard
          label="Spend this month"
          icon={Coins}
          loading={isPending}
          value={data ? usd(data.period_spend_micros) : null}
          hint={
            data?.monthly_spend_limit_micros ? (
              <div className="space-y-1">
                <Progress value={limitShare ?? 0} className="h-1.5" />
                <span>of {usd(data.monthly_spend_limit_micros)} monthly limit</span>
              </div>
            ) : (
              "No monthly limit"
            )
          }
        />
        <StatCard
          label="Requests today"
          icon={Hash}
          loading={isPending}
          value={data ? (data.can_view_usage ? data.requests_today.toLocaleString() : "-") : null}
          hint={data?.can_view_usage ? `${plural(data.requests_month, "request")} this month` : "Needs usage access"}
        />
        <StatCard
          label="Tokens today"
          icon={Sparkles}
          loading={isPending}
          value={data ? (data.can_view_usage ? tokens(data.tokens_today) : "-") : null}
          hint={
            data?.can_view_usage
              ? `${tokens(data.input_tokens_month)} in / ${tokens(data.output_tokens_month)} out this month`
              : "Needs usage access"
          }
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {data?.can_view_usage ? (
            <Card>
              <CardHeader>
                <CardTitle>Spend, last 14 days</CardTitle>
                <CardDescription>
                  <Link to={`${base}/usage`} className="hover:text-foreground inline-flex items-center gap-1">
                    Open usage <ArrowRight className="size-3" />
                  </Link>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DailyChart
                  data={data.daily.map((p) => ({ day: p.day, cost: p.cost_micros }))}
                  series={[{ key: "cost", label: "Cost" }]}
                  metric="cost_micros"
                  kind="bar"
                  height={220}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Quick start</CardTitle>
              <CardDescription>
                DockWell speaks the OpenAI API. Use the official SDKs and change only the base URL and key.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Base URL</span>
                <CopyField value={workspace.api_base_url} />
              </div>
              <CodeSnippets options={{ baseUrl: workspace.api_base_url, model: data?.example_model ?? "your-model" }} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {!allDone ? (
            <Card>
              <CardHeader>
                <CardTitle>Getting started</CardTitle>
                <CardDescription>Three steps to your first production request.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {checklist.map((c) => (
                    <li key={c.label}>
                      <Link to={c.to} className="hover:bg-muted flex items-center gap-3 rounded-lg px-2 py-2 text-sm">
                        {c.done ? <CheckCircle2 className="text-success size-4" /> : <Circle className="text-muted-foreground size-4" />}
                        <span className={cn(c.done && "text-muted-foreground line-through")}>{c.label}</span>
                        <c.icon className="text-muted-foreground ml-auto size-4" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {data?.can_view_usage ? (
            <Card>
              <CardHeader>
                <CardTitle>Top models this month</CardTitle>
              </CardHeader>
              <CardContent>
                {data.top_models.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No requests yet this month.</p>
                ) : (
                  <ul className="space-y-3">
                    {data.top_models.map((m) => (
                      <li key={m.model} className="flex items-center justify-between gap-3 text-sm">
                        <code className="truncate text-xs">{m.model}</code>
                        <span className="text-muted-foreground tabular shrink-0 text-xs">
                          {plural(m.requests, "req")} · {usd(m.cost_micros)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          {can(Perm.viewAudit) ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ActivityIcon className="size-4" /> Recent activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isPending ? (
                  <ListSkeleton rows={3} />
                ) : !data || data.recent_activity.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Nothing yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {data.recent_activity.map((a) => (
                      <li key={a.id} className="text-sm">
                        <p>
                          <span className="font-medium">{a.actor_name ?? "System"}</span>{" "}
                          <span className="text-muted-foreground">{actionLabel(a.action).toLowerCase()}</span>
                          {a.target_label ? <span> {a.target_label}</span> : null}
                        </p>
                        <p className="text-muted-foreground text-xs">{relativeTime(a.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <Button variant="link" className="mt-2 h-auto px-0" asChild>
                  <Link to={`${base}/activity`}>View activity log</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </Page>
  )
}
