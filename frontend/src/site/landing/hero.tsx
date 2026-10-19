import { useEffect, useRef, useState } from "react"
import { ArrowRight, AppWindow, Boxes, Check, Globe, Server } from "lucide-react"
import { Link } from "react-router"

import { cn } from "@/lib/utils"

import { GitHubIcon } from "../components/github-icon"
import { DEMO_MODE, GITHUB_URL, SIGNUP_URL } from "../config"

/** Each loop of the animation deploys the next of these. */
const MODELS = [
  { hf: "Qwen/Qwen2.5-7B-Instruct", id: "qwen2.5-7b-instruct", size: 15.2 },
  { hf: "meta-llama/Llama-3.1-8B-Instruct", id: "llama-3.1-8b-instruct", size: 16.1 },
  { hf: "mistralai/Mistral-7B-Instruct-v0.3", id: "mistral-7b-instruct", size: 14.5 },
  { hf: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", id: "deepseek-r1-distill-7b", size: 15.2 },
]

const STEPS = [
  { label: "Pick a model", detail: "Any Hugging Face id" },
  { label: "Dock it on your GPU", detail: "vLLM or llama.cpp" },
  { label: "Serve it at /v1", detail: "OpenAI-compatible" },
  { label: "Meter every token", detail: "Keys, usage, billing" },
]

/** Milliseconds spent on each step. */
const DURATIONS = [2800, 3600, 2000, 5600]
const TICK = 50
const TYPE_MS = 32
const PULL_MS = 2600
const STREAM_START = 900
const WORD_MS = 85

const PROMPT = "Summarise ticket #4521 in one line."
const REPLY_WORDS = "Customer is locked out after a 2FA reset: resend backup codes and confirm the new device.".split(" ")
const CHECKS = ["API key", "Rate limit", "Credit reserved"]

interface Clock {
  step: number
  elapsed: number
  model: number
}

/** Drives the loop while the stage is on screen. The first render (and the pre-rendered HTML)
 * shows the finished state, so the picture makes sense without JavaScript or with reduced motion. */
function useDeployLoop(stage: React.RefObject<HTMLElement | null>): Clock {
  const [clock, setClock] = useState<Clock>({ step: 3, elapsed: DURATIONS[3] - 1600, model: MODELS.length - 1 })
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const el = stage.current
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const io = new IntersectionObserver(([entry]) => setRunning(entry.isIntersecting), { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [stage])

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      if (document.hidden) return
      setClock((c) => {
        const elapsed = c.elapsed + TICK
        if (elapsed < DURATIONS[c.step]) return { ...c, elapsed }
        const step = (c.step + 1) % STEPS.length
        return { step, elapsed: 0, model: step === 0 ? (c.model + 1) % MODELS.length : c.model }
      })
    }, TICK)
    return () => window.clearInterval(id)
  }, [running])

  return clock
}

function StepRail({ clock }: { clock: Clock }) {
  return (
    <ol className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
      {STEPS.map((s, i) => {
        const fill = clock.step > i ? 1 : clock.step === i ? clock.elapsed / DURATIONS[i] : 0
        const current = clock.step === i
        return (
          <li key={s.label} className="min-w-0">
            <div className="bg-border h-[3px] overflow-hidden rounded-full">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--brand-2))]"
                style={{ width: `${Math.min(fill, 1) * 100}%` }}
              />
            </div>
            <p
              className={cn(
                "mt-3 flex items-baseline gap-2 text-sm font-medium transition-colors",
                current ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span className={cn("font-mono text-[11px]", current || clock.step > i ? "text-brand" : "")}>0{i + 1}</span>
              {s.label}
            </p>
            <p className="text-muted-foreground mt-0.5 pl-7 text-xs">{s.detail}</p>
          </li>
        )
      })}
    </ol>
  )
}

function Node({
  icon: Icon,
  title,
  meta,
  active,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  meta: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "bg-card relative flex min-h-[15.5rem] flex-col rounded-2xl border p-4 transition-[border-color,box-shadow] duration-500",
        active && "border-brand/50 shadow-[0_0_0_4px_color-mix(in_oklch,var(--brand)_12%,transparent),0_20px_50px_-24px_var(--brand)]",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-lg transition-colors",
            active ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-muted-foreground ml-auto truncate font-mono text-[10.5px]">{meta}</span>
      </div>
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </div>
  )
}

/** The line between two nodes; lights up once the flow has reached it. */
function Connector({ on, children }: { on: boolean; children?: React.ReactNode }) {
  return (
    <div className="dock-connector relative mx-auto h-9 w-px self-center lg:h-px lg:w-full" data-on={on || undefined} aria-hidden="true">
      <span className="bg-border absolute inset-0" />
      <span className="dock-connector-fill absolute inset-0" />
      {children}
    </div>
  )
}

function DeployStage({ clock }: { clock: Clock }) {
  const { step, elapsed } = clock
  const model = MODELS[clock.model]

  const typed = step === 0 ? Math.min(model.hf.length, Math.floor(elapsed / TYPE_MS)) : model.hf.length
  const pressed = step === 0 && elapsed > model.hf.length * TYPE_MS + 350
  const pull = step === 1 ? Math.min(1, elapsed / PULL_MS) : step > 1 ? 1 : 0
  const engine = step < 1 ? "idle" : step === 1 && pull < 1 ? "pulling" : step === 1 ? "starting" : "ready"
  const checks = step === 3 ? Math.min(CHECKS.length, Math.floor(elapsed / 250) + 1) : 0
  const words = step === 3 ? Math.max(0, Math.min(REPLY_WORDS.length, Math.floor((elapsed - STREAM_START) / WORD_MS))) : 0
  const tokens = Math.round(words * 1.35)
  const cost = (12 * 0.1 + tokens * 0.2) / 1_000_000

  return (
    <div className="dock-stage grid items-stretch gap-y-0 lg:grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)_3rem_minmax(0,1fr)_3rem_minmax(0,1fr)]">
      {/* 1. Pick a model */}
      <Node icon={Boxes} title="Model hub" meta="huggingface.co" active={step === 0}>
        <label className="text-muted-foreground text-[11px] font-medium">Model id</label>
        <div
          className={cn(
            "bg-background mt-1.5 flex h-9 items-center rounded-lg border px-2.5 font-mono text-[11.5px] transition-colors",
            step === 0 && "border-brand/60",
          )}
        >
          <span className="truncate">{model.hf.slice(0, typed)}</span>
          {step === 0 && !pressed ? <span className="blink-caret bg-brand ml-px inline-block h-3.5 w-[2px] shrink-0" /> : null}
        </div>
        <div className="text-muted-foreground mt-3 space-y-1.5 font-mono text-[10.5px]">
          {MODELS.filter((_, i) => i !== clock.model)
            .slice(0, 2)
            .map((m) => (
              <p key={m.hf} className="truncate opacity-60">
                {m.hf}
              </p>
            ))}
        </div>
        <span
          className={cn(
            "mt-auto inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-all duration-200",
            pressed
              ? "bg-brand text-brand-foreground scale-95"
              : step === 0
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground",
          )}
        >
          {step === 0 ? (
            pressed ? (
              "Deploying..."
            ) : (
              "Deploy"
            )
          ) : (
            <>
              <Check className="size-3.5" /> Deployed
            </>
          )}
        </span>
      </Node>

      <Connector on={step >= 1}>
        {step === 1 && elapsed < 1100 ? (
          <span
            key={`${clock.model}-crate`}
            className="dock-crate bg-brand text-brand-foreground absolute rounded-md px-1.5 py-0.5 font-mono text-[9px] font-semibold whitespace-nowrap shadow-lg"
          >
            {model.size} GB
          </span>
        ) : null}
      </Connector>

      {/* 2. Dock it on your GPU */}
      <Node icon={Server} title="GPU server" meta="node-01" active={step === 1}>
        <div className="grid grid-cols-2 gap-2">
          {["GPU 0", "GPU 1"].map((gpu, g) => (
            <div key={gpu} className="bg-background rounded-lg border p-2">
              <p className="text-muted-foreground font-mono text-[10px]">{gpu} · L40S</p>
              <div className="mt-2 flex h-8 items-end gap-[3px]" data-busy={engine === "ready" || undefined}>
                {Array.from({ length: 7 }, (_, b) => (
                  <span
                    key={b}
                    className="gpu-bar bg-brand/80 w-full origin-bottom rounded-[2px]"
                    style={{ animationDelay: `${-(b * 137 + g * 290) % 900}ms` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <dl className="text-muted-foreground mt-3 grid grid-cols-2 gap-2 font-mono text-[10.5px]">
          <div>
            <dt>engine</dt>
            <dd className="text-foreground">{engine === "idle" ? "-" : "vLLM"}</dd>
          </div>
          <div>
            <dt>context</dt>
            <dd className="text-foreground">{engine === "ready" ? "32k tokens" : "-"}</dd>
          </div>
        </dl>
        <div className="mt-auto pt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 font-medium">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  engine === "ready" ? "bg-chart-5" : engine === "idle" ? "bg-muted-foreground/40" : "bg-warning animate-pulse",
                )}
              />
              {engine === "idle"
                ? "Waiting for a model"
                : engine === "pulling"
                  ? "Pulling weights"
                  : engine === "starting"
                    ? "Starting vLLM"
                    : "vLLM ready"}
            </span>
            <span className="text-muted-foreground font-mono text-[10.5px] tabular-nums">
              {engine === "ready" ? "1.4k tok/s" : `${(model.size * pull).toFixed(1)} / ${model.size} GB`}
            </span>
          </div>
          <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--brand-2))]"
              style={{ width: `${pull * 100}%` }}
            />
          </div>
        </div>
      </Node>

      <Connector on={step >= 2} />

      {/* 3. Serve it at /v1 */}
      <Node icon={Globe} title="Your API" meta="ai.yourco.com" active={step === 2}>
        <div className="bg-code text-code-foreground space-y-1 rounded-lg border p-2.5 font-mono text-[10.5px] leading-relaxed">
          <p>
            <span className="text-brand">POST</span> /v1/chat/completions
          </p>
          <p className="text-muted-foreground truncate">
            model: <span className="text-code-foreground">{step >= 2 ? model.id : "..."}</span>
          </p>
          <p className="text-muted-foreground">auth: Bearer dw-••••</p>
        </div>
        <ul className="mt-3 mb-4 space-y-1.5 text-[11px]">
          {CHECKS.map((c, i) => (
            <li
              key={c}
              className={cn("flex items-center gap-1.5 transition-colors", i < checks ? "text-foreground" : "text-muted-foreground/60")}
            >
              <span
                className={cn(
                  "flex size-3.5 items-center justify-center rounded-full transition-colors",
                  i < checks ? "bg-success text-primary-foreground" : "border",
                )}
              >
                {i < checks ? <Check className="size-2.5" strokeWidth={3} /> : null}
              </span>
              {c}
            </li>
          ))}
        </ul>
        <span
          className={cn(
            "mt-auto inline-flex w-fit translate-y-1 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold transition-colors",
            step >= 2 ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
          )}
        >
          <span className={cn("size-1.5 rounded-full", step >= 2 ? "bg-success animate-pulse" : "bg-muted-foreground/40")} />
          {step >= 2 ? "Live, OpenAI-compatible" : "Waiting for the engine"}
        </span>
      </Node>

      <Connector on={step >= 3}>
        {step === 3 ? (
          <>
            <span className="dock-packet bg-brand absolute size-1.5 rounded-full shadow-[0_0_8px_var(--brand)]" />
            <span className="dock-packet bg-brand absolute size-1.5 rounded-full shadow-[0_0_8px_var(--brand)] [animation-delay:-0.45s]" />
            <span className="dock-packet dock-packet-back bg-chart-2 absolute size-1.5 rounded-full [animation-delay:-0.2s]" />
          </>
        ) : null}
      </Connector>

      {/* 4. Meter every token */}
      <Node icon={AppWindow} title="Your app" meta="openai sdk" active={step === 3}>
        <div className="space-y-2 text-[11.5px] leading-snug">
          <p
            className={cn(
              "bg-muted ml-6 rounded-xl rounded-br-sm px-2.5 py-1.5 transition-opacity",
              step === 3 ? "opacity-100" : "opacity-40",
            )}
          >
            {PROMPT}
          </p>
          <p className="border-brand/30 bg-brand-soft/60 mr-4 min-h-[3.4rem] rounded-xl rounded-bl-sm border px-2.5 py-1.5">
            {words > 0 ? (
              REPLY_WORDS.slice(0, words).join(" ")
            ) : (
              <span className="text-muted-foreground">{step === 3 ? "Thinking..." : "Waiting for the API..."}</span>
            )}
            {step === 3 && words > 0 && words < REPLY_WORDS.length ? (
              <span className="blink-caret bg-brand ml-0.5 inline-block h-3 w-[2px] align-middle" />
            ) : null}
          </p>
        </div>
        <div className="text-muted-foreground mt-auto grid grid-cols-3 gap-1 border-t pt-2.5 font-mono text-[10px] tabular-nums">
          <span>
            <span className="text-foreground block text-[11.5px] font-semibold">{tokens}</span>tokens
          </span>
          <span>
            <span className="text-foreground block text-[11.5px] font-semibold">{tokens > 0 ? `$${cost.toFixed(6)}` : "-"}</span>cost
          </span>
          <span>
            <span className="text-foreground block text-[11.5px] font-semibold">{words > 0 ? "182 ms" : "-"}</span>1st token
          </span>
        </div>
      </Node>
    </div>
  )
}

export function Hero() {
  const stageRef = useRef<HTMLDivElement>(null)
  const clock = useDeployLoop(stageRef)

  return (
    <section className="relative overflow-hidden border-b">
      <div className="bg-glow pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        className="site-grid pointer-events-none absolute inset-0 mask-[radial-gradient(ellipse_at_top,black,transparent_65%)]"
        aria-hidden="true"
      />
      <div
        className="hero-orb pointer-events-none absolute top-[38%] left-1/2 size-[46rem] -translate-x-1/2 rounded-full"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-7xl px-4 pt-14 pb-20 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <a
            data-reveal
            href={GITHUB_URL}
            target="_blank"
            rel="noopener"
            className="bg-card/80 hover:border-brand/40 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium shadow-xs backdrop-blur transition-colors"
          >
            <span className="bg-brand size-1.5 rounded-full shadow-[0_0_8px_var(--brand)]" /> Open source, MIT licensed, self-hosted
            <ArrowRight className="size-3" />
          </a>
          <h1
            data-reveal
            style={{ "--d": 1 } as React.CSSProperties}
            className="-mx-12 mt-6 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl lg:text-[4rem]"
          >
            Run your own AI.
            <span className="text-gradient-brand sm:block">Serve it like an API platform.</span>
          </h1>
          <p
            data-reveal
            style={{ "--d": 2 } as React.CSSProperties}
            className="text-muted-foreground font-reading mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty"
          >
            Pick any open source model, dock it on your own GPU server and serve it behind an OpenAI-compatible API. Keys, usage, billing,
            logs and monitoring are built in.
          </p>
          <div data-reveal style={{ "--d": 3 } as React.CSSProperties} className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href={SIGNUP_URL}
              className="group bg-brand text-brand-foreground inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold shadow-[var(--glow-brand)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--glow-brand-strong)]"
            >
              {DEMO_MODE ? "Try the live demo" : "Get started"}{" "}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <Link
              to="/docs/self-hosting"
              className="bg-card/80 hover:border-foreground/25 inline-flex h-11 items-center gap-2 rounded-xl border px-5 text-sm font-semibold backdrop-blur transition-colors"
            >
              <Server className="size-4" /> Self-host it
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener"
              className="text-muted-foreground hover:text-foreground inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors"
            >
              <GitHubIcon className="size-4" /> GitHub
            </a>
          </div>
        </div>

        <div
          ref={stageRef}
          data-reveal="scale"
          style={{ "--d": 4 } as React.CSSProperties}
          role="img"
          aria-label="How DockWell works: pick a model from Hugging Face, it is deployed on your GPU server with vLLM, served at your own OpenAI-compatible /v1 endpoint, and every request from your app is checked and metered token by token."
          className="bg-background/60 mx-auto mt-16 max-w-6xl rounded-3xl border p-4 shadow-xl backdrop-blur-sm sm:p-6"
        >
          <StepRail clock={clock} />
          <div className="mt-6">
            <DeployStage clock={clock} />
          </div>
        </div>

        <ul className="text-muted-foreground mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
          {[
            "vLLM, llama.cpp, Groq or any OpenAI-compatible endpoint",
            "Works with the official OpenAI SDKs",
            "Stripe billing included",
          ].map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <Check className="text-success size-4" />
              {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
