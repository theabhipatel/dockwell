# DockWell

**Serve open source AI models behind an OpenAI-compatible API, on your own servers.**

DockWell is an open source, self-hosted platform for serving open source models the way OpenAI serves
its own. Accounts, workspaces, API keys, usage tracking, pay-as-you-go billing, request logs and
monitoring are built in. Run it on a GPU server, pick any open source model, and offer it to your team
or your customers.

Built by [TheAbhiPatel](https://www.theabhipatel.com/). MIT licensed.

- **Any open source model.** Deploy a model by its Hugging Face id: DockWell starts a vLLM engine on
  your GPUs (or llama.cpp on CPU), or attach Groq or any OpenAI-compatible endpoint.
- **Drop-in OpenAI API.** `/v1/chat/completions` (streaming, tools), `/v1/completions`,
  `/v1/embeddings`, `/v1/models`. The official SDKs work by changing only the base URL and key.
- **A metering gateway of its own.** Every request is authenticated, rate limited, reserved against
  the balance (parallel requests can never overspend) and charged exactly from real token usage, in
  integer micro-dollars. Failed requests are free.
- **Billing.** Stripe Checkout, webhook-confirmed credits, auto recharge, invoices and receipts,
  monthly hard spend limits, alerts and a credit ledger. Test mode to live mode is configuration only.
- **Teams.** Workspaces, projects, invitations, Owner / Admin / Manager / Member and custom roles,
  per-project access, an append-only activity log and notifications.
- **Observability.** Usage charts and CSV export, request logs with latency and time to first token,
  an admin area with system health, plus Prometheus and Grafana.

## Live demo

The public demo runs on Vercel with Groq as the provider and Stripe in test mode (card
`4242 4242 4242 4242`). Data may be reset. See [Deploying the demo on Vercel](frontend/src/site/docs/content/vercel-demo.md).

## Run locally (CPU, one command)

You need Docker, [uv](https://docs.astral.sh/uv/) and Node 22.12+.

```bash
./scripts/dev.sh          # Linux, macOS, WSL
scripts\dev.cmd           # Windows
```

It checks prerequisites, starts Postgres, Mailpit and llama.cpp in Docker, creates `backend/.env` with
random secrets, installs packages, runs migrations, downloads Qwen2.5 0.5B Instruct on the first run and
starts the API and the web app. When it is up it prints the admin login.

| Service | Address |
|---|---|
| Web app and public site | http://localhost:31180 |
| OpenAI-compatible base URL | http://localhost:31180/v1 |
| API docs (OpenAPI) | http://localhost:31100/api/docs |
| Mailpit (every email) | http://localhost:31825 |
| llama.cpp | http://localhost:31800 |
| Postgres | localhost:31432 |
| Engines deployed from the admin area | 31810 and up |

Then create an API key in the app and call it:

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:31180/v1", api_key="dw-...")
reply = client.chat.completions.create(
    model="qwen2.5-0.5b-instruct",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(reply.choices[0].message.content, reply.usage)
```

Optional, for payments in test mode: set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in
`backend/.env`, then run `stripe listen --forward-to localhost:31100/api/stripe/webhook`.

## Self-host on a GPU server

```bash
cp backend/.env.example .env.prod   # edit APP_URL, secrets, POSTGRES_PASSWORD, GRAFANA_PASSWORD, SMTP, Stripe
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile gpu up -d --build
```

This runs Postgres, the API (migrations on start), nginx serving the app and proxying `/api` and
`/v1`, a vLLM engine with NVIDIA GPU access, the NVIDIA DCGM exporter, Prometheus and Grafana. Use
`--profile cpu` for a CPU-only server with llama.cpp. Put TLS in front of the `web` service. Full guide:
[Self-hosting on a GPU server](frontend/src/site/docs/content/self-hosting.md).

## Repository layout

```
backend/     FastAPI app (uv, src layout): routers, services, schemas, models, Alembic migrations, tests
frontend/    React + Vite + shadcn/ui app, the pre-rendered public site and the docs
api/         Vercel entry point (one serverless function for the demo)
docker/      Postgres init, Prometheus and Grafana provisioning
scripts/     dev.sh, dev.ps1, dev.cmd
```

## Development

```bash
make test                 # backend (pytest, real Postgres) and frontend (vitest) tests
make check                # ruff, strict mypy, tsc, oxlint and the production build
make gen-api              # regenerate the typed frontend API client from the OpenAPI schema
make vercel-requirements  # regenerate requirements.txt for the Vercel demo from backend/uv.lock
```

## Documentation

The docs ship with the app at `/docs` (source in `frontend/src/site/docs/content/`): quick start,
API keys, chat completions, streaming, the OpenAI SDKs, models, rate limits, errors, billing,
workspaces and roles, self-hosting, running locally, the Vercel demo, the configuration reference,
the admin guide, upgrading and the FAQ.

## Licence

[MIT](LICENSE)
