import { useRef, useState } from "react"
import { Activity, AlertTriangle, ArrowDownToLine, Check, Cpu, Gauge, Lock, Receipt, Undo2, Zap } from "lucide-react"

import { cn } from "@/lib/utils"

import { noise, useActive, useInterval } from "./use-loop"
import { Button } from "@/components/ui/button"

/* ---------------------------------------------------------------------------------------------
 * Models strip: two rows of open models drifting in opposite directions.
 * ------------------------------------------------------------------------------------------- */

const ROW_A = [
  { name: "Llama 3.1 8B Instruct", meta: "128k ctx", engine: "vLLM", tone: 1 },
  { name: "Qwen2.5 7B Instruct", meta: "32k ctx", engine: "vLLM", tone: 2 },
  { name: "Mistral 7B Instruct", meta: "32k ctx", engine: "vLLM", tone: 3 },
  { name: "Gemma 2 9B", meta: "8k ctx", engine: "vLLM", tone: 4 },
  { name: "DeepSeek R1 Distill 7B", meta: "reasoning", engine: "vLLM", tone: 5 },
  { name: "Llama 3.3 70B Instruct", meta: "128k ctx", engine: "vLLM", tone: 1 },
  { name: "Phi-3.5 mini", meta: "128k ctx", engine: "vLLM", tone: 2 },
]
const ROW_B = [
  { name: "Qwen2.5 Coder 7B", meta: "code", engine: "vLLM", tone: 3 },
  { name: "Qwen2.5 0.5B Instruct", meta: "GGUF", engine: "llama.cpp", tone: 4 },
  { name: "BGE M3", meta: "embeddings", engine: "vLLM", tone: 5 },
  { name: "Mistral Nemo 12B", meta: "128k ctx", engine: "vLLM", tone: 1 },
  { name: "Llama 3.1 8B Instant", meta: "hosted", engine: "Groq", tone: 2 },
  { name: "nomic-embed-text v1.5", meta: "embeddings", engine: "llama.cpp", tone: 3 },
  { name: "Gemma 2 2B", meta: "GGUF", engine: "llama.cpp", tone: 4 },
]

function ModelChip({ name, meta, engine, tone }: (typeof ROW_A)[number]) {
  return (
    <div className="bg-card flex shrink-0 items-center gap-3 rounded-xl border py-2.5 pr-4 pl-2.5 shadow-xs">
      <span
        className="flex size-8 items-center justify-center rounded-lg font-mono text-xs font-bold text-brand-foreground"
        style={{ background: `var(--chart-${tone})` }}
      >
        {name[0]}
      </span>
      <span>
        <span className="block text-sm font-medium whitespace-nowrap">{name}</span>
        <span className="text-muted-foreground block font-mono text-[11px] whitespace-nowrap">
          {meta} · {engine}
        </span>
      </span>
    </div>
  )
}

function MarqueeRow({ items, reverse = false }: { items: typeof ROW_A; reverse?: boolean }) {
  return (
    <div className="marquee overflow-hidden mask-[linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
      <div className={cn("marquee-track flex w-max gap-3 pr-3", reverse && "marquee-reverse")}>
        {[...items, ...items].map((m, i) => (
          <ModelChip key={i} {...m} />
        ))}
      </div>
    </div>
  )
}

export function ModelsStrip() {
  return (
    <section className="border-b py-14 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 text-center sm:px-6">
        <p data-reveal className="text-muted-foreground text-sm">
          Serve the open models you trust: anything vLLM can load on your GPUs, GGUF models on CPU, or any OpenAI-compatible provider.
        </p>
      </div>
      <div data-reveal className="mt-8 space-y-3" aria-hidden="true">
        <MarqueeRow items={ROW_A} />
        <MarqueeRow items={ROW_B} reverse />
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------------------------------------
 * Drop-in: OpenAI SDK code where only the base URL, key and model change.
 * ------------------------------------------------------------------------------------------- */

const OLD = { url: "https://api.openai.com/v1", key: "sk-proj-...", model: "gpt-4o-mini" }
const NEW = { url: "https://ai.yourco.com/v1", key: "dw-...", model: "qwen2.5-7b-instruct" }
const ANSWER = "Hello! I'm running on your own GPUs. How can I help today?".split(" ")

const SNIPPETS: { label: string; file: string; lines: string[] }[] = [
  {
    label: "Python",
    file: "app.py",
    lines: [
      "from openai import OpenAI",
      "",
      "client = OpenAI(",
      '    base_url="§URL§",',
      '    api_key="§KEY§",',
      ")",
      "",
      "stream = client.chat.completions.create(",
      '    model="§MODEL§",',
      '    messages=[{"role": "user", "content": "Hello!"}],',
      "    stream=True,",
      ")",
    ],
  },
  {
    label: "JavaScript",
    file: "app.ts",
    lines: [
      'import OpenAI from "openai"',
      "",
      "const client = new OpenAI({",
      '  baseURL: "§URL§",',
      '  apiKey: "§KEY§",',
      "})",
      "",
      "const stream = await client.chat.completions.create({",
      '  model: "§MODEL§",',
      '  messages: [{ role: "user", content: "Hello!" }],',
      "  stream: true,",
      "})",
    ],
  },
  {
    label: "curl",
    file: "terminal",
    lines: [
      "curl §URL§/chat/completions \\",
      '  -H "Authorization: Bearer §KEY§" \\',
      '  -H "Content-Type: application/json" \\',
      "  -d '{",
      '    "model": "§MODEL§",',
      '    "messages": [{"role": "user", "content": "Hello!"}],',
      '    "stream": true',
      "  }'",
    ],
  },
]

/** Ticks of 100 ms within one tab. */
const T_STRIKE = 14
const T_TYPE = 20
const T_TYPED = 34
const T_DONE = 72
const T_TAB = 92

function Swap({ kind, t }: { kind: "url" | "key" | "model"; t: number }) {
  if (t < T_TYPE) {
    return (
      <span className={cn("rounded-sm transition-colors", t >= T_STRIKE && "bg-destructive/15 text-destructive line-through")}>
        {OLD[kind]}
      </span>
    )
  }
  const value = NEW[kind]
  const shown = t >= T_TYPED ? value : value.slice(0, Math.ceil(((t - T_TYPE) / (T_TYPED - T_TYPE)) * value.length))
  return <span className="bg-brand/15 text-brand rounded-sm">{shown}</span>
}

function CodeLine({ line, t }: { line: string; t: number }) {
  const parts = line.split(/(§URL§|§KEY§|§MODEL§)/)
  const changed = parts.length > 1
  return (
    <div className={cn("-mx-5 px-5 transition-colors", changed && t >= T_STRIKE && "bg-brand/[0.06]")}>
      <span className={cn("mr-3 inline-block w-3 select-none", changed && t >= T_TYPE ? "text-brand" : "text-transparent")}>+</span>
      {parts.map((p, i) =>
        p === "§URL§" ? (
          <Swap key={i} kind="url" t={t} />
        ) : p === "§KEY§" ? (
          <Swap key={i} kind="key" t={t} />
        ) : p === "§MODEL§" ? (
          <Swap key={i} kind="model" t={t} />
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
      {line === "" ? " " : null}
    </div>
  )
}

export function DropIn() {
  const ref = useRef<HTMLDivElement>(null)
  const active = useActive(ref)
  const [state, setState] = useState({ tab: 0, t: T_TAB - 1 })
  useInterval(() => setState((s) => (s.t + 1 >= T_TAB ? { tab: (s.tab + 1) % SNIPPETS.length, t: 0 } : { ...s, t: s.t + 1 })), 100, active)

  const { tab, t } = state
  const words = t < T_TYPED + 4 ? 0 : Math.min(ANSWER.length, Math.floor((t - T_TYPED - 4) / 2.2))
  const done = words >= ANSWER.length && t >= T_DONE - 20

  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <p data-reveal className="text-brand font-mono text-xs font-semibold tracking-[0.18em] uppercase">
            Drop-in compatible
          </p>
          <h2 data-reveal className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Already on the OpenAI SDK? <span className="text-gradient-brand">Change one line.</span>
          </h2>
          <p data-reveal className="text-muted-foreground mt-4 text-lg leading-relaxed">
            DockWell speaks the OpenAI API. Point the base URL at your server, use a DockWell key and pick one of your models. Everything
            else in your code stays the same.
          </p>
          <ul data-reveal className="mt-8 space-y-3 text-sm">
            {[
              "Chat completions, completions, embeddings and model listing",
              "Streaming with token usage in every stream",
              "Tool calling where the model supports it",
              "OpenAI-format errors your retry logic already understands",
            ].map((item) => (
              <li key={item} className="flex gap-2.5">
                <span className="bg-brand-soft text-brand mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div
          ref={ref}
          data-reveal="scale"
          className="bg-card overflow-hidden rounded-2xl border shadow-xl"
        >
          <div className="flex items-center gap-1 border-b px-3 py-2">
            {SNIPPETS.map((s, i) => (
              <Button
                key={s.label}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setState({ tab: i, t: T_TYPED })}
                className={cn(
                  "h-auto rounded-md px-3 py-1.5 text-xs font-medium",
                  i === tab
                    ? "bg-brand-soft text-brand hover:bg-brand-soft hover:text-brand dark:hover:bg-brand-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </Button>
            ))}
            <span className="text-muted-foreground ml-auto font-mono text-[11px]">{SNIPPETS[tab].file}</span>
          </div>
          <pre
            className="bg-code text-code-foreground min-h-[19rem] overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-6"
            aria-label={`${SNIPPETS[tab].label} example`}
          >
            <code>
              {SNIPPETS[tab].lines.map((line, i) => (
                <CodeLine key={`${tab}-${i}`} line={line} t={t} />
              ))}
            </code>
          </pre>
          <div className="border-t px-5 py-3.5 font-mono text-[12px]">
            <div className="text-muted-foreground flex items-center justify-between text-[11px]">
              <span>output</span>
              <span className={cn("transition-opacity", done ? "opacity-100" : "opacity-0")}>
                12 in · 15 out · $0.000004 · 168 ms to first token
              </span>
            </div>
            <p className="mt-1.5 min-h-[1.5rem]">
              {words > 0 ? (
                ANSWER.slice(0, words).join(" ")
              ) : (
                <span className="text-muted-foreground">{t >= T_TYPED ? "connecting..." : " "}</span>
              )}
              {words > 0 && words < ANSWER.length ? (
                <span className="blink-caret bg-brand ml-0.5 inline-block h-3.5 w-[2px] align-middle" />
              ) : null}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------------------------------------
 * Metering: reserve the maximum, run, charge the exact usage, release the rest.
 * ------------------------------------------------------------------------------------------- */

const PRICE_IN = 0.1 // $ per 1M input tokens
const PRICE_OUT = 0.2 // $ per 1M output tokens
const MAX_TOKENS = 1024
const START_BALANCE = 5

interface Req {
  n: number
  input: number
  output: number
  failed: boolean
  hold: number
  charge: number
}

function makeReq(n: number): Req {
  const input = 18 + Math.floor(noise(n) * 60)
  const failed = n % 5 === 3
  const output = failed ? 0 : 60 + Math.floor(noise(n + 101) * 260)
  const hold = (input * PRICE_IN + MAX_TOKENS * PRICE_OUT) / 1e6
  const charge = failed ? 0 : (input * PRICE_IN + output * PRICE_OUT) / 1e6
  return { n, input, output, failed, hold, charge }
}

/** Ticks of 100 ms per request. */
const M_RESERVE = 8
const M_RUN = 16
const M_SETTLE = 42
const M_NEXT = 58

const money = (v: number) => `$${v.toFixed(6)}`

export function Metering() {
  const ref = useRef<HTMLDivElement>(null)
  const active = useActive(ref)
  const [state, setState] = useState({ n: 4, t: M_SETTLE + 6 })
  useInterval(() => setState((s) => (s.t + 1 >= M_NEXT ? { n: s.n + 1, t: 0 } : { ...s, t: s.t + 1 })), 100, active)

  const { n, t } = state
  const req = makeReq(n)
  const history = Array.from({ length: n }, (_, i) => makeReq(i))
  const settledBefore = history.reduce((sum, r) => sum + r.charge, 0)
  const balance = START_BALANCE - settledBefore - (t >= M_SETTLE ? req.charge : 0)
  const held = t >= M_RESERVE && t < M_SETTLE ? req.hold : 0
  const runFrac = t < M_RUN ? 0 : Math.min(1, (t - M_RUN) / (M_SETTLE - M_RUN - 4))
  const failNow = req.failed && runFrac > 0.35
  const outNow = req.failed ? Math.round(runFrac * 40) * (failNow ? 0 : 1) : Math.round(req.output * runFrac)
  const phase = t < M_RESERVE ? 0 : t < M_RUN ? 1 : t < M_SETTLE ? 2 : 3
  const ledger = [...(t >= M_SETTLE ? [req] : []), ...history.slice().reverse()].slice(0, 4)

  const STEPS = [
    {
      icon: Lock,
      title: "Reserve the maximum",
      body: "Before the request runs, the most it could cost is held against the balance. No balance, no request.",
    },
    { icon: Zap, title: "Stream the answer", body: "Tokens stream back from your engine while the gateway counts them." },
    {
      icon: Receipt,
      title: "Charge the exact usage",
      body: "The real token count is charged, the rest of the hold is released, and the log and usage charts update.",
    },
  ]

  return (
    <section className="bg-surface border-y">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div
          ref={ref}
          data-reveal="scale"
          className="bg-card order-2 overflow-hidden rounded-2xl border shadow-xl lg:order-1"
        >
          <div className="grid grid-cols-2 border-b sm:grid-cols-3">
            <div className="border-r p-4">
              <p className="text-muted-foreground text-xs">Credit balance</p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{money(balance)}</p>
            </div>
            <div className="p-4 sm:border-r">
              <p className="text-muted-foreground text-xs">On hold</p>
              <p
                className={cn(
                  "mt-1 font-mono text-xl font-semibold tabular-nums transition-colors",
                  held ? "text-warning" : "text-muted-foreground",
                )}
              >
                {money(held)}
              </p>
            </div>
            <div className="col-span-2 border-t p-4 sm:col-span-1 sm:border-t-0">
              <p className="text-muted-foreground text-xs">Price per 1M tokens</p>
              <p className="mt-1 font-mono text-sm">
                ${PRICE_IN.toFixed(2)} in · ${PRICE_OUT.toFixed(2)} out
              </p>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div
              className={cn(
                "rounded-xl border p-4 transition-colors",
                phase === 3 ? (req.failed ? "border-destructive/40" : "border-success/40") : "border-brand/40",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px]">
                <span className="text-brand font-semibold">POST</span>
                <span>/v1/chat/completions</span>
                <span className="text-muted-foreground">req_{(4810 + n).toString(36)}</span>
                <span
                  className={cn(
                    "ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                    phase === 3
                      ? req.failed
                        ? "bg-danger-soft text-destructive"
                        : "bg-success-soft text-success"
                      : "bg-brand-soft text-brand",
                  )}
                >
                  {phase === 0
                    ? "authenticating"
                    : phase === 1
                      ? "reserving"
                      : phase === 2
                        ? failNow
                          ? "engine error"
                          : "streaming"
                        : req.failed
                          ? "502 · not charged"
                          : "200 · settled"}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-[11.5px]">
                <div>
                  <p className="text-muted-foreground">input</p>
                  <p className="mt-0.5 text-sm tabular-nums">{phase >= 1 ? req.input : "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">output</p>
                  <p className="mt-0.5 text-sm tabular-nums">
                    {phase >= 2 ? outNow : "-"}
                    <span className="text-muted-foreground"> / {MAX_TOKENS}</span>
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">model</p>
                  <p className="mt-0.5 truncate text-sm">qwen2.5-7b</p>
                </div>
              </div>
              <div className="bg-muted mt-4 h-2 overflow-hidden rounded-full">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-100",
                    failNow ? "bg-destructive" : "bg-[linear-gradient(90deg,var(--brand),var(--brand-2))]",
                  )}
                  style={{
                    width: `${phase === 3 ? (req.failed ? 0 : (req.output / MAX_TOKENS) * 100) : phase === 2 ? (outNow / MAX_TOKENS) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11.5px]">
                <span className={cn("flex items-center gap-1.5", phase >= 1 ? "text-foreground" : "text-muted-foreground/60")}>
                  <Lock className="size-3.5" /> held {phase >= 1 ? money(req.hold) : "-"}
                </span>
                <span className={cn("flex items-center gap-1.5", phase === 3 ? "text-foreground" : "text-muted-foreground/60")}>
                  <Receipt className="size-3.5" /> charged {phase === 3 ? money(req.charge) : "-"}
                </span>
                <span className={cn("flex items-center gap-1.5", phase === 3 ? "text-foreground" : "text-muted-foreground/60")}>
                  <Undo2 className="size-3.5" /> released {phase === 3 ? money(req.hold - req.charge) : "-"}
                </span>
              </div>
            </div>

            <p className="text-muted-foreground mt-5 mb-2 text-xs font-medium">Ledger</p>
            <ul className="divide-y rounded-xl border font-mono text-[11.5px]">
              {ledger.map((r) => (
                <li key={r.n} className="ledger-row flex items-center gap-3 px-3 py-2">
                  {r.failed ? <AlertTriangle className="text-destructive size-3.5" /> : <ArrowDownToLine className="text-brand size-3.5" />}
                  <span className="text-muted-foreground">req_{(4810 + r.n).toString(36)}</span>
                  <span className="hidden sm:inline">{r.failed ? "failed, nothing charged" : `${r.input} in · ${r.output} out`}</span>
                  <span className={cn("ml-auto tabular-nums", r.failed ? "text-muted-foreground" : "")}>-{money(r.charge)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <p data-reveal className="text-brand font-mono text-xs font-semibold tracking-[0.18em] uppercase">
            Metering gateway
          </p>
          <h2 data-reveal className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Every token accounted for, to the micro-dollar.
          </h2>
          <p data-reveal className="text-muted-foreground mt-4 text-lg leading-relaxed">
            Pay-as-you-go that you can trust: balances never go negative, failed requests are free and cancelled streams pay only for what
            was generated.
          </p>
          <ol className="mt-8 space-y-3">
            {STEPS.map((s, i) => {
              const current = (i === 0 && phase <= 1) || (i === 1 && phase === 2) || (i === 2 && phase === 3)
              return (
                <li
                  key={s.title}
                  data-reveal
                  style={{ "--d": i } as React.CSSProperties}
                  className={cn(
                    "flex gap-4 rounded-xl border p-4 transition-all duration-300",
                    current ? "bg-card border-brand/40 glow-brand" : "border-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                      current ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <s.icon className="size-4" />
                  </span>
                  <span>
                    <span className="block font-semibold">{s.title}</span>
                    <span className="text-muted-foreground mt-1 block text-sm leading-relaxed">{s.body}</span>
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------------------------------------
 * Observability: the admin health view, live.
 * ------------------------------------------------------------------------------------------- */

const POINTS = 48
const ENGINES = [
  { model: "qwen2.5-7b-instruct", engine: "vLLM", where: "gpu-node-01" },
  { model: "llama-3.1-8b-instruct", engine: "vLLM", where: "gpu-node-02" },
  { model: "qwen2.5-0.5b-instruct", engine: "llama.cpp", where: "cpu-01" },
  { model: "llama-3.1-8b-instant", engine: "Groq", where: "provider" },
]
const LOG_MODELS = ["qwen2.5-7b-instruct", "llama-3.1-8b-instruct", "qwen2.5-0.5b-instruct", "llama-3.1-8b-instant"]

function traffic(t: number): number {
  return 46 + 18 * Math.sin(t / 6) + 9 * Math.sin(t / 2.3) + 10 * noise(t)
}

/** hh:mm:ss for a request `seconds` after noon. */
function clock(seconds: number): string {
  const pad = (v: number) => String(v).padStart(2, "0")
  return `${pad(12 + (Math.floor(seconds / 3600) % 12))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}

function logRow(n: number) {
  const model = LOG_MODELS[Math.floor(noise(n + 7) * LOG_MODELS.length)]
  const out = 40 + Math.floor(noise(n + 13) * 420)
  const status = n % 17 === 9 ? 429 : 200
  return {
    n,
    model,
    out,
    status,
    latency: 180 + Math.floor(noise(n + 29) * 1400),
    cost: status === 200 ? (30 * 0.1 + out * 0.2) / 1e6 : 0,
    time: clock(n * 7),
  }
}

export function Observability() {
  const ref = useRef<HTMLDivElement>(null)
  const active = useActive(ref)
  const [t, setT] = useState(200)
  useInterval(() => setT((v) => v + 1), 700, active)

  const values = Array.from({ length: POINTS }, (_, i) => traffic(t - POINTS + 1 + i))
  const max = 90
  const W = 600
  const H = 150
  const pts = values.map((v, i) => [(i / (POINTS - 1)) * W, H - (v / max) * H] as const)
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")
  const area = `${line} L${W} ${H} L0 ${H} Z`
  const last = pts[pts.length - 1]

  const inFlight = 3 + Math.floor(noise(t) * 7)
  const req5m = 4100 + Math.floor(values.reduce((a, b) => a + b, 0) * 1.7)
  const errRate = 0.2 + noise(t + 3) * 0.4
  const tps = 1180 + Math.floor(noise(t + 5) * 320)
  const gpus = [0, 1, 2, 3].map((g) => Math.round(52 + 38 * Math.abs(Math.sin((t + g * 5) / 4)) * (0.7 + 0.3 * noise(t + g))))
  const rows = Array.from({ length: 5 }, (_, i) => logRow(t - i))

  const stats = [
    { icon: Activity, label: "Requests in flight", value: String(inFlight) },
    { icon: Gauge, label: "Requests (5 min)", value: req5m.toLocaleString("en-US") },
    { icon: AlertTriangle, label: "Error rate (5 min)", value: `${errRate.toFixed(1)}%` },
    { icon: Zap, label: "Output tokens / s", value: tps.toLocaleString("en-US") },
  ]

  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <p data-reveal className="text-brand font-mono text-xs font-semibold tracking-[0.18em] uppercase">
          Monitoring
        </p>
        <h2 data-reveal className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Know what every engine and GPU is doing.
        </h2>
        <p data-reveal className="text-muted-foreground mt-4 text-lg leading-relaxed">
          Engine health, live traffic, error rates and GPU utilisation in the admin area, every request in the logs, and Prometheus metrics
          with a ready-made Grafana dashboard.
        </p>
      </div>

      <div
        ref={ref}
        data-reveal="scale"
        className="bg-card mt-12 overflow-hidden rounded-2xl border shadow-xl"
      >
        <div className="flex items-center gap-2 border-b px-5 py-3">
          <span className="text-sm font-semibold">System health</span>
          <span className="bg-success-soft text-success inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold">
            <span className="bg-success size-1.5 animate-pulse rounded-full" /> live
          </span>
          <span className="text-muted-foreground ml-auto font-mono text-[11px]">admin / health</span>
        </div>

        <div className="grid grid-cols-2 border-b lg:grid-cols-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={cn("p-4 sm:p-5", i % 2 === 0 && "border-r", i < 2 && "border-b lg:border-b-0", i === 1 && "lg:border-r")}
            >
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <s.icon className="size-3.5" /> {s.label}
              </p>
              <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="border-b p-5 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Requests per second</p>
              <p className="text-muted-foreground font-mono text-[11px]">last 5 min</p>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-40 w-full overflow-visible" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="obs-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: "var(--brand)", stopOpacity: 0.35 }} />
                  <stop offset="100%" style={{ stopColor: "var(--brand)", stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75].map((f) => (
                <line
                  key={f}
                  x1="0"
                  x2={W}
                  y1={H * f}
                  y2={H * f}
                  stroke="var(--border)"
                  strokeDasharray="4 6"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <path d={area} fill="url(#obs-area)" />
              <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              <circle cx={last[0]} cy={last[1]} r="4" fill="var(--brand)" className="obs-pulse" />
            </svg>

            <p className="mt-6 text-sm font-medium">Live requests</p>
            <ul className="mt-2 space-y-1 font-mono text-[11.5px]">
              {rows.map((r, i) => (
                <li
                  key={r.n}
                  className={cn(
                    "grid grid-cols-[4.2rem_minmax(0,1fr)_4.2rem_2.2rem] items-center gap-2 rounded-md px-2 py-1 sm:grid-cols-[4.2rem_minmax(0,1fr)_4rem_4rem_5.4rem_3rem]",
                    i === 0 && "log-in bg-brand/[0.07]",
                  )}
                >
                  <span className="text-muted-foreground">{r.time}</span>
                  <span className="truncate">{r.model}</span>
                  <span className="text-muted-foreground hidden text-right tabular-nums sm:inline">{r.out} tok</span>
                  <span className="text-muted-foreground text-right tabular-nums">{r.latency} ms</span>
                  <span className="hidden text-right tabular-nums sm:inline">{money(r.cost)}</span>
                  <span className={cn("text-right font-semibold", r.status === 200 ? "text-success" : "text-warning")}>{r.status}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="p-5">
            <p className="text-sm font-medium">Engines and providers</p>
            <ul className="mt-3 space-y-2">
              {ENGINES.map((e) => (
                <li key={e.model} className="bg-background flex items-center gap-3 rounded-lg border px-3 py-2">
                  <span className="relative flex size-2">
                    <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-50" />
                    <span className="bg-success relative inline-flex size-2 rounded-full" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px]">{e.model}</span>
                    <span className="text-muted-foreground block text-[11px]">
                      {e.engine} · {e.where}
                    </span>
                  </span>
                  <span className="text-success text-[11px] font-medium">ready</span>
                </li>
              ))}
            </ul>

            <p className="mt-6 flex items-center gap-1.5 text-sm font-medium">
              <Cpu className="size-4" /> GPUs
            </p>
            <ul className="mt-3 space-y-2.5">
              {gpus.map((u, g) => (
                <li key={g} className="font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      GPU {g} · {g < 2 ? "gpu-node-01" : "gpu-node-02"}
                    </span>
                    <span className="tabular-nums">{u}%</span>
                  </div>
                  <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--brand-2))] transition-[width] duration-700 ease-out"
                      style={{ width: `${u}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
