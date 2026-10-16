import { ArrowRight, Check, Gift, Receipt, Scale, Wallet } from "lucide-react"

import { Button } from "@/components/ui/button"

import { SitePage } from "./components/site-page"
import { DEMO_MODE, SIGNUP_URL } from "./config"
import { money, usePublicConfig, usePublicModels } from "./live-data"
import { ModelPriceTable } from "./model-table"

const STEPS = [
  { icon: Wallet, title: "Add credits", body: "Buy credits in US dollars with Stripe Checkout, from a preset or any amount in range. Credits belong to the workspace." },
  { icon: Scale, title: "Pay per token", body: "Each request costs its input tokens times the input price plus output tokens times the output price. Nothing else." },
  { icon: Receipt, title: "See every cent", body: "Usage charts, request logs and a credit ledger with a running balance. Invoices and receipts for every payment." },
]

export function PricingPage() {
  const models = usePublicModels()
  const config = usePublicConfig()
  const credit = config.data?.free_credit_micros ?? 0
  return (
    <SitePage
      eyebrow="Pricing"
      title="Pay as you go. Per token, to the micro-dollar."
      intro="No subscriptions and no seats. Add credits, use any model, and pay only for the tokens you process. Prices below are live from this install."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} data-reveal style={{ "--d": i } as React.CSSProperties} className="bg-card rounded-xl border p-5">
            <s.icon className="text-brand size-5" />
            <h2 className="mt-3 font-semibold">{s.title}</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="bg-brand-soft mt-8 flex flex-col items-start justify-between gap-4 rounded-xl border p-5 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <Gift className="text-brand mt-0.5 size-5" />
          <div>
            <p className="font-semibold">{credit > 0 ? `${money(credit)} free starter credit` : "Starter credit"}</p>
            <p className="text-muted-foreground text-sm">
              {credit > 0 ? "Every new account gets it once, after verifying its email. Enough to try every model." : "The operator decides whether new accounts get free credit."}
            </p>
          </div>
        </div>
        <Button asChild>
          <a href={SIGNUP_URL}>{DEMO_MODE ? "Try the demo" : "Create an account"} <ArrowRight /></a>
        </Button>
      </div>

      <h2 className="mt-14 mb-4 text-2xl font-semibold">Model prices</h2>
      <ModelPriceTable models={models.data} error={models.error} />
      <p className="text-muted-foreground mt-3 text-xs">Prices in US dollars per one million tokens. A price change applies to new requests only, never to past charges.</p>

      <div className="mt-14 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="text-xl font-semibold">How charging works</h2>
          <ul className="text-muted-foreground mt-4 space-y-3 text-sm">
            {[
              "Before a request runs, the most it could cost is reserved, so parallel requests can never overspend your balance.",
              "When it finishes, the exact cost is charged from the real token usage and the rest is released.",
              "Failed requests are free. A stream you cancel is charged for what was generated.",
              "Money is stored as whole micro-dollars, never floating point, and costs round up to the next micro-dollar.",
            ].map((t) => (
              <li key={t} className="flex gap-2"><Check className="text-success mt-0.5 size-4 shrink-0" />{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-xl font-semibold">Stay in control</h2>
          <ul className="text-muted-foreground mt-4 space-y-3 text-sm">
            {[
              `Top up from ${config.data ? money(config.data.topup_min_cents * 10_000) : "a small amount"} to ${config.data ? money(config.data.topup_max_cents * 10_000) : "a large amount"} at a time.`,
              "Optional auto recharge buys credits when the balance falls below your threshold.",
              "A monthly hard spend limit and an alert threshold per workspace, plus limits per project and per key.",
              "Low and zero balance emails, receipts and downloadable invoices for every payment.",
            ].map((t) => (
              <li key={t} className="flex gap-2"><Check className="text-success mt-0.5 size-4 shrink-0" />{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </SitePage>
  )
}
