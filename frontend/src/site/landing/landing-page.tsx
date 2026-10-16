import { useRef } from "react"
import {
  Activity,
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  Cloud,
  Cpu,
  CreditCard,
  Gauge,
  KeyRound,
  Laptop,
  MessageSquareText,
  ScrollText,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react"
import { Link } from "react-router"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"

import { DemoBanner } from "../components/demo-banner"
import { GitHubIcon } from "../components/github-icon"
import { SiteFooter } from "../components/site-footer"
import { SiteHeader } from "../components/site-header"
import { DEMO_MODE, GITHUB_URL, SIGNUP_URL } from "../config"
import { useReveal } from "./use-reveal"

const CODE = `from openai import OpenAI

client = OpenAI(
    base_url="https://dockwell.example.com/v1",
    api_key="dw-...",
)

stream = client.chat.completions.create(
    model="qwen2.5-7b-instruct",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`

function Hero() {
  return (
    <section className="relative overflow-hidden border-b">
      <div className="bg-glow pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="site-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pt-16 pb-20 sm:px-6 sm:pt-24 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <a data-reveal href={GITHUB_URL} target="_blank" rel="noopener" className="bg-card hover:border-foreground/20 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium shadow-xs">
            <span className="bg-success size-1.5 rounded-full" /> Open source, MIT licensed <ArrowRight className="size-3" />
          </a>
          <h1 data-reveal style={{ "--d": 1 } as React.CSSProperties} className="mt-6 text-4xl leading-[1.08] font-semibold tracking-tight sm:text-6xl">
            Serve open source AI models <span className="text-gradient-brand">like an API platform.</span>
          </h1>
          <p data-reveal style={{ "--d": 2 } as React.CSSProperties} className="text-muted-foreground font-reading mt-6 max-w-xl text-lg leading-relaxed">
            DockWell puts any open source model behind an OpenAI-compatible API, on your own GPU server. Accounts, workspaces, API keys, usage
            tracking, pay-as-you-go billing, logs and monitoring are built in.
          </p>
          <div data-reveal style={{ "--d": 3 } as React.CSSProperties} className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <a href={SIGNUP_URL}>{DEMO_MODE ? "Try the live demo" : "Get started"} <ArrowRight /></a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/docs/self-hosting"><Server /> Self-host it</Link>
            </Button>
            <Button size="lg" variant="ghost" asChild>
              <a href={GITHUB_URL} target="_blank" rel="noopener"><GitHubIcon className="size-4" /> GitHub</a>
            </Button>
          </div>
          <ul data-reveal style={{ "--d": 4 } as React.CSSProperties} className="text-muted-foreground mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {["vLLM, llama.cpp, Groq or any OpenAI-compatible endpoint", "Works with the official OpenAI SDKs", "Stripe billing included"].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><Check className="text-success size-4" />{t}</li>
            ))}
          </ul>
        </div>
        <div data-reveal="scale" className="glow-ring bg-card overflow-hidden rounded-2xl border">
          <div className="flex items-center gap-1.5 border-b px-4 py-3">
            <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
            <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
            <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
            <span className="text-muted-foreground ml-3 font-mono text-xs">app.py</span>
            <span className="bg-brand-soft text-brand ml-auto rounded-md px-2 py-0.5 text-[0.7rem] font-semibold">Only the base URL changes</span>
          </div>
          <pre className="bg-code text-code-foreground overflow-x-auto p-5 text-[0.8rem] leading-6"><code>{CODE}</code></pre>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-4 py-3 font-mono text-xs">
            <span>36 in / 128 out tokens</span>
            <span>cost $0.000043</span>
            <span>first token 180 ms</span>
          </div>
        </div>
      </div>
    </section>
  )
}

const FEATURES = [
  { icon: Boxes, title: "Deploy any open source model", body: "Add a model by its Hugging Face id. DockWell downloads the weights and starts a vLLM engine on your GPUs, or llama.cpp on CPU." },
  { icon: KeyRound, title: "OpenAI-compatible API", body: "Chat completions, completions, embeddings and models, streaming and tools. Point the official SDKs at your URL." },
  { icon: Gauge, title: "Metering gateway", body: "Every request is authenticated, rate limited, reserved against the balance and charged exactly from real token usage." },
  { icon: CreditCard, title: "Pay-as-you-go billing", body: "Credits via Stripe Checkout, auto recharge, invoices, monthly spend limits and alerts. Test mode to live is configuration only." },
  { icon: Users, title: "Workspaces and roles", body: "Teams, projects, invitations, Owner, Admin, Manager, Member and custom roles with fine-grained permissions." },
  { icon: BarChart3, title: "Usage and logs", body: "Charts by project, key, model and member. Every request with tokens, cost, latency and time to first token. CSV export." },
  { icon: MessageSquareText, title: "Playground", body: "Chat with any model, tune parameters, see the cost of every reply and copy the request as code." },
  { icon: ShieldCheck, title: "Secure by default", body: "Hashed keys and sessions, encrypted provider secrets, 2FA, CSRF protection, strict CSP and an append-only audit log." },
  { icon: Activity, title: "Monitoring", body: "Engine health, queues, GPU utilisation and error rates in the admin area, with Prometheus and Grafana for operators." },
]

function Features() {
  return (
    <section id="features" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28">
      <div className="max-w-2xl">
        <p data-reveal className="text-brand font-mono text-xs font-semibold tracking-[0.18em] uppercase">Everything included</p>
        <h2 data-reveal className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">The platform around your models, not just the inference.</h2>
        <p data-reveal className="text-muted-foreground mt-4 text-lg">Engines only generate text. DockWell does everything else, the same way for every provider.</p>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <div key={f.title} data-reveal style={{ "--d": i % 3 } as React.CSSProperties} className="bg-card hover:border-foreground/15 rounded-xl border p-6 transition-colors">
            <span className="bg-brand-soft text-brand flex size-10 items-center justify-center rounded-lg"><f.icon className="size-5" /></span>
            <h3 className="mt-4 font-semibold">{f.title}</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const STEPS = [
  { n: "1", title: "Run DockWell", body: "One docker compose command on a GPU server starts Postgres, the API, the web app, vLLM and monitoring." },
  { n: "2", title: "Add models and prices", body: "Deploy models from Hugging Face or attach providers, then set input and output prices per million tokens." },
  { n: "3", title: "Invite your users", body: "They sign up, get starter credit, create API keys per project and call your models with any OpenAI SDK." },
]

function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-surface scroll-mt-20 border-y">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
        <h2 data-reveal className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">From bare GPU server to your own model API in three steps.</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.n} data-reveal style={{ "--d": i } as React.CSSProperties} className="relative">
              <span className="text-brand font-mono text-5xl font-semibold opacity-30">{s.n}</span>
              <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
        <div data-reveal className="bg-card mt-12 rounded-xl border p-5">
          <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">The path of every request</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {["Your app", "API key check", "Model and limits", "Reserve max cost", "vLLM / llama.cpp / Groq", "Exact charge", "Logs and usage"].map((step, i, all) => (
              <span key={step} className="flex items-center gap-2">
                <span className={i === 4 ? "bg-brand text-brand-foreground rounded-md px-2.5 py-1" : "bg-muted rounded-md px-2.5 py-1"}>{step}</span>
                {i < all.length - 1 ? <ArrowRight className="text-muted-foreground size-3.5" /> : null}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

const MODES = [
  { icon: Laptop, title: "Local development", where: "Your laptop, CPU only", engine: "llama.cpp with a tiny model, downloaded on first run", cmd: "./scripts/dev.sh", href: "/docs/running-locally" },
  { icon: Server, title: "Self-hosted", where: "A server with one or more GPUs", engine: "vLLM, any open source model you deploy", cmd: "docker compose --profile gpu up -d", href: "/docs/self-hosting" },
  { icon: Cloud, title: "Public demo", where: "Vercel and Neon, serverless", engine: "Groq with free API keys", cmd: "vercel deploy", href: "/docs/vercel-demo" },
]

function SelfHost() {
  return (
    <section id="self-host" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28">
      <p data-reveal className="text-brand font-mono text-xs font-semibold tracking-[0.18em] uppercase">One codebase</p>
      <h2 data-reveal className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Three ways to run it. Same code, different configuration.</h2>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {MODES.map((m, i) => (
          <Link key={m.title} to={m.href} data-reveal style={{ "--d": i } as React.CSSProperties} className="group bg-card hover:border-foreground/20 flex flex-col rounded-xl border p-6 transition-colors">
            <m.icon className="text-brand size-6" />
            <h3 className="mt-4 text-lg font-semibold">{m.title}</h3>
            <dl className="text-muted-foreground mt-3 space-y-1 text-sm">
              <div><dt className="text-foreground inline font-medium">Where: </dt><dd className="inline">{m.where}</dd></div>
              <div><dt className="text-foreground inline font-medium">Inference: </dt><dd className="inline">{m.engine}</dd></div>
            </dl>
            <code className="bg-code text-code-foreground mt-5 block rounded-md border px-3 py-2 text-xs">{m.cmd}</code>
            <span className="text-brand mt-4 inline-flex items-center gap-1 text-sm font-medium">Read the guide <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span>
          </Link>
        ))}
      </div>
      <div data-reveal className="text-muted-foreground mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5"><Cpu className="size-4" /> NVIDIA GPUs with vLLM</span>
        <span className="flex items-center gap-1.5"><ScrollText className="size-4" /> Prometheus and Grafana included</span>
        <span className="flex items-center gap-1.5"><CreditCard className="size-4" /> Stripe test mode on the demo</span>
      </div>
    </section>
  )
}

const FAQ = [
  { q: "Do I need to change my code?", a: "No. DockWell implements the OpenAI API. Set the base URL to your DockWell address plus /v1 and use a DockWell API key; the official Python and JavaScript SDKs work unchanged." },
  { q: "Which models can I serve?", a: "Any model vLLM supports on your GPUs (Llama, Qwen, Mistral, Gemma, DeepSeek and many more), GGUF models with llama.cpp on CPU, and any model from an OpenAI-compatible provider such as Groq." },
  { q: "How is usage billed?", a: "Per token at the price you set for each model. The gateway reserves the maximum cost before a request, then charges the exact cost from the real usage. Failed requests are free." },
  { q: "Are prompts stored?", a: "Not by default. Only the numbers needed for billing and logs are kept. An admin can enable content logging, and each workspace can still opt out." },
  { q: "Is it free?", a: "DockWell is open source under the MIT licence. You pay only for your own hardware, or for whatever an operator charges on their install." },
]

function Faq() {
  return (
    <section className="bg-surface border-t">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
        <h2 data-reveal className="text-3xl font-semibold tracking-tight sm:text-4xl">Questions</h2>
        <Accordion type="single" collapsible className="mt-8">
          {FAQ.map((f) => (
            <AccordionItem key={f.q} value={f.q}>
              <AccordionTrigger className="text-base">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
      <div data-reveal="scale" className="bg-card glow-ring relative overflow-hidden rounded-3xl border px-6 py-14 text-center sm:px-12">
        <div className="bg-glow pointer-events-none absolute inset-0" aria-hidden="true" />
        <h2 className="relative text-3xl font-semibold tracking-tight sm:text-4xl">Your models. Your servers. Your API platform.</h2>
        <p className="text-muted-foreground relative mx-auto mt-4 max-w-xl text-lg">Try the demo in a minute, or run DockWell on your own hardware today.</p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" asChild><a href={SIGNUP_URL}>{DEMO_MODE ? "Try the demo" : "Create an account"} <ArrowRight /></a></Button>
          <Button size="lg" variant="outline" asChild><Link to="/docs/quick-start">Read the docs</Link></Button>
        </div>
      </div>
    </section>
  )
}

export function LandingPage() {
  const ref = useRef<HTMLDivElement>(null)
  useReveal(ref)
  return (
    <div ref={ref} className="overflow-x-clip">
      <DemoBanner />
      <SiteHeader />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <SelfHost />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  )
}
