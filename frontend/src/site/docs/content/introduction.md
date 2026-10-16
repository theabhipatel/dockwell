DockWell is an open source, self-hosted platform for serving open source AI models behind an **OpenAI-compatible API**. You run it on your own server, deploy the models you want, and offer them to your team or your customers the way OpenAI offers its models: with accounts, workspaces, API keys, usage tracking, pay-as-you-go billing through Stripe, request logs and monitoring built in.

Any tool that already talks to OpenAI works with DockWell. You change the base URL and the API key, and nothing else.

DockWell is designed and built by [TheAbhiPatel](https://www.theabhipatel.com/) and released under the MIT licence.

## Who it's for

| You are | DockWell gives you |
|---|---|
| **A team with a GPU server** | One place to serve open models to every developer, with per-project keys, limits and a clear view of who used what. |
| **A company selling AI access** | A ready-made customer platform: sign up, starter credit, Stripe top-ups, invoices, usage dashboards and an admin area. |
| **A developer exploring open models** | A local setup that runs on a laptop CPU with one command, so you can build against the same API you'll use in production. |
| **An operator** | Model deployment from the browser, engine logs, GPU metrics, Prometheus and Grafana, and an audit log of every admin action. |

## Three ways to run it

DockWell is one codebase. The mode is pure configuration: environment variables decide where the models run, which database is used and whether payments are live.

| Mode | Where | Inference | Database | Payments |
|---|---|---|---|---|
| **Local development** | Your machine, CPU only | llama.cpp with a tiny GGUF model (Qwen2.5 0.5B Instruct) | PostgreSQL in Docker | Stripe test mode (optional) |
| **Self-hosted** | A Linux server with one or more NVIDIA GPUs | vLLM, any open source model you deploy | PostgreSQL in Docker | Stripe live mode |
| **Public demo** | Vercel (web app on the CDN, API as one serverless function) | Groq's API | Neon PostgreSQL (pooled) | Stripe test mode |

- **Local development** starts with `./scripts/dev.sh` and downloads the model on first run. No GPU needed. See [Running locally on CPU](/docs/running-locally).
- **Self-hosted** is the main product. Everything runs on one server with `docker compose`: PostgreSQL, the API, the web app, your inference engines and monitoring. See [Self-hosting on a GPU server](/docs/self-hosting).
- **The public demo** lets people try DockWell without installing anything. See [Deploying the demo on Vercel](/docs/vercel-demo).

> [!NOTE]
> Switching Stripe from test to live is only a configuration change: replace `sk_test_...` keys with `sk_live_...` keys. The payment code is the same in every mode.

## How a request flows

Every request, from the API or from the playground, goes through DockWell's own **gateway** before it reaches an engine. The engines (vLLM, llama.cpp, Groq or any OpenAI-compatible endpoint) only generate text. DockWell does all the accounting, the same way for every provider.

```text
Your app (OpenAI SDK)
   |  POST https://dockwell.example.com/v1/chat/completions
   v
DockWell gateway
   1. check the API key, project and workspace
   2. check the model is enabled, ready and allowed
   3. apply rate limits and spend limits
   4. reserve the most the request could cost
   5. forward to the engine and stream the reply back
   6. read the real token usage and charge the exact cost
   7. write the request log and usage, trigger alerts
   v
vLLM / llama.cpp / Groq / other OpenAI-compatible provider
```

Because the reservation happens in one atomic database update, parallel requests can never spend more than the workspace's balance.

## Key concepts at a glance

| Concept | What it is |
|---|---|
| **Workspace** | Your organisation or team. Credits, billing and the monthly spend limit belong to the workspace. A user can belong to many. |
| **Project** | A group of API keys inside a workspace. Usage and limits are tracked per project. |
| **API key** | A `dw-...` secret that authenticates requests to `/v1`. Created per project, shown once. |
| **Model** | A model offered through the API, with an id such as `qwen2.5-0.5b-instruct`, a context length, capabilities and a price per 1M tokens. |
| **Provider** | Where a model runs: a vLLM or llama.cpp engine, Groq, or any OpenAI-compatible endpoint. |
| **Credits** | Prepaid US dollars stored as exact integer micro-dollars. Requests draw them down at the model's price. |
| **Platform admin** | A person who runs the DockWell install and uses the admin area. Separate from workspace roles. |

Read [Core concepts](/docs/core-concepts) for the details.

## What's included

- Sign up with email and password or Google, email verification, two-factor authentication and session management.
- Workspaces, projects, invitations, built-in and custom roles, and project-level access.
- An OpenAI-compatible API: `/v1/chat/completions` (streaming, tools, vision), `/v1/completions`, `/v1/embeddings` and `/v1/models`.
- A playground with a model picker, saved conversations, per-reply cost and "View code".
- Usage charts with CSV export, request logs and an activity log.
- Pay-as-you-go billing with Stripe Checkout, saved cards, auto recharge, spend limits, alerts, invoices and a full credit ledger.
- An admin area for users, workspaces, models, deployments, pricing, platform settings, payments, system health and an audit log.

## Next steps

- New to DockWell? Follow the [Quick start](/docs/quick-start).
- Already have a key? Jump to [Using the OpenAI SDKs](/docs/openai-sdks).
- Ready to run your own? Start with [Running locally on CPU](/docs/running-locally) or [Self-hosting on a GPU server](/docs/self-hosting).
