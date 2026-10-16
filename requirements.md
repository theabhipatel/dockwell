# DockWell - Requirements

**DockWell is an open source, self-hosted platform for serving open source AI models behind an OpenAI-compatible API**, with accounts, workspaces, API keys, usage tracking, pay-as-you-go billing, logs and monitoring built in. Anyone can run it on their own GPU server, pick any open source model, and offer it to their team or customers the way OpenAI offers its models.

Built by [TheAbhiPatel](https://www.theabhipatel.com/).

This file is the source of truth for **what** to build. It lists features and the tech stack only. Database schema, endpoint design, folder layout and other technical details are decided by whoever builds it.

---

## 1. Working reference: Secure Vault

**Reference project: https://github.com/theabhipatel/vault**

Secure Vault is a different product (an encrypted team document vault), but it is the working reference for **how** DockWell is structured, built and shipped. Before building, read it and follow it for:

- Repository layout (`backend/`, `frontend/`, `api/index.py`, `docker/`, `scripts/`, `Makefile`, `vercel.json`, `docker-compose.yml`, `docker-compose.prod.yml`).
- Backend style: FastAPI with `uv`, src layout, routers / services / schemas / models, pydantic-settings config, Alembic migrations, strict mypy, ruff, pytest.
- Frontend style: React + Vite + shadcn, typed API client generated from the backend OpenAPI schema, TanStack Query, theme handling.
- Workspaces, members, invitations, roles (Owner, Admin, Manager, Member, custom roles) and permissions.
- Onboarding flow where a new user creates their default workspace.
- Audit log, notifications, security emails, sessions.
- The public site: pre-rendered landing page, docs, privacy page, sitemap, robots, demo banner.
- The two deployment modes: self-hosted with Docker, and a demo on Vercel through one serverless function (`SERVERLESS=true`, Neon Postgres, Vercel Cron, `requirements.txt` generated from `uv.lock`).
- One-command local setup (`./scripts/dev.sh` and `scripts\dev.cmd`), uncommon port range, Mailpit for emails.

Do not copy vault's product features (encryption, documents, secrets). Copy its structure, quality and deployment approach.

---

## 2. Three ways to run it (one codebase)

| Mode | Where | Inference | Database | Payments |
|---|---|---|---|---|
| **Local dev** | Developer's machine, CPU only | llama.cpp server with a tiny GGUF model (for example Qwen2.5 0.5B Instruct) | Postgres in Docker | Stripe test mode |
| **Self-hosted (main product)** | A bare server with one or more GPUs | vLLM, any open source model the admin deploys | Postgres in Docker | Stripe live mode |
| **Public demo** | Vercel (frontend on CDN, backend as one Python serverless function) | Groq API with free keys | Neon Postgres (pooled) | Stripe test mode |

- The mode is pure configuration (env variables). No separate code paths beyond what serverless hosting strictly needs, same idea as vault's `SERVERLESS` flag.
- Self-hosted runs **everything** on the one server with `docker compose`: Postgres, API, web (nginx), inference engine(s), and monitoring.
- Local dev runs with **one command**, downloads the tiny model automatically on first run, and works with no GPU.
- The demo shows a dismissible "this is a demo" banner (like vault) linking to the self-hosting guide, and clearly says payments are test mode.
- **Stripe code must be production ready.** The demo uses test keys, but switching to live keys is only a configuration change on a self-hosted install.

---

## 3. Tech stack

### Backend
- Python 3.12+, **FastAPI**, `uv` for packages.
- SQLAlchemy 2 (async) + asyncpg, **PostgreSQL**, **Alembic** migrations.
- pydantic / pydantic-settings for validation and config. All config read in one place.
- httpx for calling inference engines (streaming).
- **Stripe** Python SDK for payments.
- argon2 for passwords, aiosmtplib for email.
- ruff, strict mypy, pytest.

### Inference
- **vLLM** on GPU (self-hosted).
- **llama.cpp server** on CPU (local dev and small CPU-only self-hosts).
- **Groq** (demo).
- Any other **OpenAI-compatible endpoint** can be attached by an admin as a provider.
- All of these speak the OpenAI API format, so the gateway treats them the same way.

### Frontend
- **React + Vite + TypeScript (strict)**, Tailwind CSS v4.
- **shadcn/ui** for every UI primitive, with one central theme (light and dark).
- TanStack Query for server state, typed client generated from the backend OpenAPI schema (`openapi-typescript` + `openapi-fetch`, like vault).
- react-hook-form + zod for forms, react-router, sonner for toasts, lucide icons.
- shadcn charts (Recharts) for all graphs.
- oxlint, vitest.

### Monitoring
- Prometheus + Grafana on self-hosted (vLLM already exposes metrics). The in-app dashboards cover what users and admins need day to day; Grafana is for the operator.

### Frontend setup rule (save AI tokens)
- Create the app with `npm create vite@latest` and set up shadcn with `npx shadcn@latest init`.
- **Add every shadcn component with `npx shadcn@latest add <component>`. Never hand-write a component shadcn provides.** Use shadcn blocks (sidebar, login, dashboard, charts) through the CLI where they fit.
- Only hand-write a component when shadcn has nothing for it.

---

## 4. UI and theme

- Clean, modern, minimal. Think of OpenAI's platform dashboard and Vercel's dashboard.
- **One central theme file** holds every colour, font and radius as tokens. Components never hardcode a colour. Changing the theme file restyles the whole app.
- **Light and dark mode** everywhere, plus "system". A theme toggle in the user menu and on the public site.
- Responsive: works on phones (collapsible sidebar, usable tables).
- Good empty states, loading skeletons, error states and confirm dialogs everywhere (like vault).
- Command palette (Ctrl/Cmd + K) to jump to pages, projects, keys and models.
- Copy buttons on every key, id and code snippet.

---

## 5. Public site (SEO ready)

All public pages are **pre-rendered to static HTML at build time** (same approach as vault's `prerender.mjs`), with proper titles, meta descriptions, Open Graph and Twitter images, canonical URLs, JSON-LD, `sitemap.xml` and `robots.txt`.

- **Landing page**: what DockWell is, features, how it works, self-host vs demo, call to action (try demo, self-host, GitHub).
- **Pricing page**: the live model price list (input and output price per 1M tokens), free starter credit, how pay-as-you-go works.
- **Models page**: catalog of available models with context length, capabilities and price.
- **Docs**: introduction, quick start, authentication and API keys, chat completions, streaming, using the OpenAI SDKs (Python, JavaScript, curl) by changing only the base URL, models, rate limits, errors, billing and credits, workspaces and roles, self-hosting on a GPU server, running locally on CPU, deploying the demo on Vercel, configuration reference, upgrading, FAQ. With search (like vault).
- **Privacy policy** and **Terms of service**.
- Custom 404 page.

---

## 6. User platform

### 6.1 Sign up, sign in and account security
- Sign up with **email and password** or **Google**.
- Email verification, forgot password, reset password.
- Sign in with email and password or Google; link Google to an existing account.
- Optional **two-factor authentication** (authenticator app) with backup codes.
- Active sessions list with device and IP, sign out one or all other sessions.
- Rate limiting and lockout on repeated failed sign-ins; security emails (new sign-in, password changed, 2FA changed).

### 6.2 Onboarding
- After sign up the user sets their name and **creates their default workspace** (same flow as vault).
- The first time an account is created it receives **$3.00 free credit**, once per account, ever (amount and on/off controlled by admin). Granted only after the email is verified, to limit abuse. Creating more workspaces never grants more free credit.
- A short getting started checklist: create an API key, try the playground, add credits.

### 6.3 Workspaces, projects, members and roles
- A user can belong to many workspaces and switch between them (workspace switcher, like vault).
- **Credits, billing and spend limits belong to the workspace** (like an OpenAI organization).
- Workspaces contain **projects**. API keys, usage and limits are tracked per project.
- **Roles**: Owner, Admin, Manager, Member, plus **custom roles** with chosen permissions (like vault).
- Permissions cover at least: manage workspace settings, manage billing and add credits, view billing, manage members and invitations, manage roles, create and delete projects, manage API keys (all or own), view usage, view logs, view activity log, use the playground.
- Project level access: choose which members can see which projects.
- **Invite members by email** with a chosen role; resend, revoke, expiry; accept or decline from email or the inbox.
- Remove members, change roles, leave a workspace, **transfer ownership**, delete a workspace (with confirmation).

### 6.4 Dashboard (home)
- Credit balance, spend this month, requests and tokens today and this month, top models, recent activity.
- Low balance warning and quick "Add credits" button.
- Quick start snippet with the workspace's base URL.

### 6.5 Playground
- Chat with any available model.
- **Model picker inside the chat input**, showing each model's price and context length.
- System prompt, temperature, max tokens, top p and other common parameters.
- Streaming replies with a stop button; regenerate; copy; markdown and code highlighting.
- Each reply shows tokens used and **its cost**. Playground usage is **charged to the workspace** at the model's price, same as the API.
- Saved conversations (list, rename, delete, new chat), scoped to the user.
- "View code" button: the same request as curl, Python and JavaScript using the OpenAI SDK.
- Clear message when credits run out, with an "Add credits" link.

### 6.6 API keys
- Create keys **per project** with a name. The full key is **shown once**; afterwards only a prefix and last characters.
- Optional per key: expiry date, allowed models, spend limit, rate limit (requests and tokens per minute).
- See created by, created at, last used; revoke and delete.
- Keys are stored hashed and never logged.

### 6.7 OpenAI-compatible API
- `POST /v1/chat/completions` (streaming and non-streaming, tools / function calling where the model supports it), `POST /v1/completions`, `POST /v1/embeddings` (for embedding models), `GET /v1/models`.
- Works with the official OpenAI SDKs by changing only the base URL and key.
- Errors use OpenAI's error format and status codes (invalid key, insufficient credits, rate limited, model not found, model unavailable).
- Usage is returned in every response, including streamed ones.

### 6.8 Usage
- Charts of tokens, requests and cost over time.
- Filter and group by project, API key, model, member and date range.
- Separate input and output tokens.
- CSV export.

### 6.9 Request logs
- Every request: time, project, key, model, input / output tokens, cost, latency, time to first token, status, error, source (API or playground).
- Filters and search; detail view.
- Prompt and response content is **not stored by default** (admin setting, and a workspace can opt out even when the admin allows it).

### 6.10 Billing
- **Add credits in US dollars with Stripe Checkout**: preset amounts plus a custom amount, within admin min / max.
- Credits are added **only after Stripe's webhook confirms payment** (never from the redirect), handled idempotently so a credit can never be added twice.
- Payment history with Stripe receipts and downloadable invoices.
- Saved payment method and optional **auto recharge** (when balance falls below X, add Y).
- Workspace **monthly spend limit** (hard stop) and **alert threshold** (email + in-app).
- Low balance and zero balance emails.
- Credit ledger: every grant, purchase, charge, refund and admin adjustment, with running balance.
- Billing details (name, address, tax id) passed to Stripe for invoices.

### 6.11 Activity log
- Append-only log of who did what in the workspace: sign-ins, keys created / revoked, members invited / removed, role changes, credits added, settings changed, with IP and device (like vault).
- Visible to the Owner and anyone with the permission; filter by member, action and date.

### 6.12 Notifications
- In-app inbox (invitations, low balance, payment success / failure, key expiring, model retired).
- Email for the important ones, with per-user preferences.

### 6.13 Profile and settings
- Profile: name, **profile picture** upload, email change with re-verification, password change, Google link / unlink, 2FA, sessions, theme, notification preferences, delete account.
- Workspace settings: name, slug, logo, default project, data retention for logs, transfer and delete.

---

## 7. Admin platform

A separate admin area for the people who run the DockWell install (platform admins), apart from workspace roles. The first admin comes from the install configuration; admins can promote other users.

### 7.1 Overview
- Users, workspaces, active users, revenue, credits sold vs used, requests, tokens, errors, latency, top models, top workspaces.

### 7.2 Users and workspaces
- List, search and filter users; view a user's workspaces, balance, usage, payments and activity.
- Suspend / unsuspend, delete, force sign out, reset 2FA, mark email verified, promote / demote admin.
- Create users manually.
- Workspaces: view, suspend, **grant or deduct credits** with a reason (recorded in the ledger and audit log), set custom limits.

### 7.3 Models (deploy and manage)
- **Self-hosted:** add a model by Hugging Face id with its settings (GPU count, context length, quantization, precision, memory share). The platform downloads the weights and starts a vLLM engine for it. Shows status (downloading, starting, ready, failed, stopped), start / stop / restart, engine logs and health.
- **Local CPU:** the same, with llama.cpp and GGUF files.
- **Demo:** pick which Groq models are offered.
- **External providers:** attach any OpenAI-compatible endpoint (URL + key, key stored encrypted) and expose its models.
- Per model: display name, public id, description, context length, capabilities (chat, tools, vision, embeddings), enable / disable, visible to all or selected workspaces, mark as deprecated with a retirement date.
- Optional Hugging Face token for gated models (stored encrypted).

### 7.4 Pricing
- Per model: **input price and output price per 1M tokens** (USD), optional cached input price, minimum charge per request, or free.
- Price changes take effect from a date and never change past charges.
- Optional per-workspace discounts or custom prices.

### 7.5 Platform settings
- Sign up on / off, Google sign in on / off, require email verification.
- Free starter credit amount and on / off.
- Credit purchase presets, minimum and maximum top-up, auto recharge on / off.
- Default rate limits and spend limits for new workspaces and keys.
- Prompt / response logging on / off and log retention days.
- Blocked email domains and IPs.
- Maintenance mode and a site-wide announcement banner.
- Branding: platform name and logo.
- Status of email (SMTP test), Stripe (mode, webhook health) and Google sign in.

### 7.6 Billing (admin)
- All payments, failed payments, refunds (issued through Stripe, credits removed accordingly), ledger across workspaces, revenue reports, CSV export.

### 7.7 Usage, logs and system health
- Platform-wide usage and request logs with the same filters as users, plus by workspace.
- System health: each engine's status, GPU utilisation and memory, requests in flight, queue, tokens per second, error rate; database and email status.

### 7.8 Admin audit log
- Every admin action recorded, append-only, with who, what, when and IP.

---

## 8. Metering and pricing engine (our own gateway before inference)

**Every request (API and playground) goes through our own gateway before it reaches vLLM, llama.cpp, Groq or any provider.** The engines only generate text; DockWell does all accounting. This logic is ours, fully customizable, and the same for every provider.

For each request the gateway:
1. Authenticates the API key (or the signed-in user for the playground) and checks key, project, workspace and user are active.
2. Checks the model exists, is enabled, is ready and is allowed for this key and workspace.
3. Applies rate limits (key, project, workspace, platform) and spend limits.
4. Checks the workspace balance and **reserves** the most the request could cost (input estimate + max tokens) so parallel requests can never overspend.
5. Forwards the request to the right engine and streams the reply back.
6. Reads the real token usage when it finishes (including streamed and cancelled requests) and **charges the exact cost**, releasing the rest of the reservation.
7. Writes the request log and usage record, and triggers alerts (low balance, spend threshold, auto recharge).

Rules:
- Money is stored as exact integers (for example micro-dollars), never floating point.
- A failed request is not charged; a request cancelled mid-stream is charged for what was generated.
- Prices, limits and the free credit are all admin settings, not code.
- Must work in serverless (demo) and long-running (self-hosted) mode.

---

## 9. Security

- Passwords hashed with argon2; API keys and session tokens stored hashed; provider keys and the Hugging Face token stored encrypted.
- No secret, key or token in logs, URLs or error responses.
- Stripe webhooks verified by signature and processed idempotently.
- Every workspace resource checks membership and permission on the server.
- CSRF protection on the web app, rate limits on auth and email actions, strict Content Security Policy and security headers (like vault).
- Admin area only reachable by platform admins.

---

## 10. Deployment and developer experience

- `./scripts/dev.sh` (Linux / macOS) and `scripts\dev.cmd` (Windows): checks prerequisites, starts Postgres and Mailpit in Docker, creates `.env` with random secrets, installs packages, runs migrations, starts llama.cpp with a tiny model, the API and the web app.
- `docker-compose.prod.yml` for the GPU server: Postgres, API, web (nginx), vLLM engine(s) with NVIDIA GPU access, Prometheus and Grafana. Profiles for `gpu` and `cpu`.
- Vercel demo exactly like vault: `api/index.py`, `vercel.json`, `requirements.txt` generated from `uv.lock`, Neon pooled database, Vercel Cron for housekeeping (log rollups, expired sessions, email retries), Groq as the provider, Stripe test mode.
- Every env variable documented in `.env.example` and the configuration docs page.
- `Makefile` with `dev`, `test`, `check`, `gen-api`, `vercel-requirements`.
- README like vault's: what it is, live demo, run locally, self-host on a GPU server, ports, docs links.
- Open source licence: MIT.

---

## 11. Quality bar

- Python: strict mypy, ruff clean, typed everything. TypeScript: strict, no `any`.
- Tests for auth, permissions, the metering engine (reservation, charging, limits, concurrency), Stripe webhooks and the OpenAI-compatible API.
- Central logger, no stray prints or console output.
- Comments only where the reason is not obvious.
- Plain hyphens only in text, no em or en dashes.

---

## 12. Suggested build order

1. Repository scaffold (backend, frontend with shadcn via CLI, theme, Docker, dev script), llama.cpp running locally on CPU.
2. Auth, onboarding, workspaces, members, roles and invitations.
3. Models, providers and the metering gateway with pricing and credits ledger.
4. Projects, API keys and the OpenAI-compatible API.
5. Playground.
6. Stripe billing (checkout, webhooks, auto recharge, invoices, limits, alerts).
7. Usage, request logs, activity log, notifications.
8. Admin platform.
9. Public site, pricing and models pages, docs, SEO.
10. vLLM GPU deployment, monitoring, Vercel demo with Groq.
