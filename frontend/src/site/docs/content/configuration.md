This page lists every DockWell setting, its default and what it does. There are two kinds:

- **Environment settings**, read by the API when it starts. They live in `backend/.env` in development, in `.env.prod` with the production compose file, and in the project settings on Vercel.
- **Platform settings**, which platform admins change at runtime in **Admin > Settings**. They're stored in the database. See [Platform settings](#platform-settings-in-the-database) at the end of this page.

## How environment settings are loaded

The API reads its settings from environment variables and, if present, from a `.env` file in the directory it runs from (`backend/`). Start from the documented example:

```bash
cp backend/.env.example backend/.env
```

`./scripts/dev.sh` does this for you the first time, with random secrets.

Every setting also works as a plain environment variable with the same name, for example `SMTP_HOST=mail.example.com`. Environment variables take precedence over the `.env` file. Names aren't case-sensitive, but the docs use upper case. Boolean settings accept `true` or `false`. Settings without a default are empty unless you set them.

The **Default** column shows the built-in default. Where `backend/.env.example` sets a different value for local development, the table says so.

## General

| Setting | Default | What it does |
|---|---|---|
| `ENVIRONMENT` | `development` | `development`, `test` or `production`. `production` turns off the interactive API docs (`/api/docs`) and the OpenAPI schema, and ignores `SEED_ADMIN_PASSWORD`. `test` is for the test suite and doesn't start background workers. |
| `LOG_LEVEL` | `INFO` | Log level for the API: `DEBUG`, `INFO`, `WARNING` or `ERROR`. Keys, tokens and secrets are never logged. |
| `APP_URL` | `http://localhost:31180` | The public origin of the web app, exactly as in the browser's address bar, without a trailing slash. Used for links in emails, the CSRF Origin check, CORS, the Google redirect URI, Stripe return URLs and the API base URL shown to users (`<APP_URL>/v1`). |
| `APP_NAME` | `DockWell` | The name used in emails and as the issuer name in authenticator apps. The name shown in the web app is the platform setting **Platform name**. |
| `DEMO_MODE` | `false` | Marks a public demo: the web app shows demo notices and a few platform-wide admin actions (such as maintenance mode) are refused. |

## Database

| Setting | Default | What it does |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://dockwell:dockwell@localhost:31432/dockwell` | PostgreSQL connection URL. The default matches the development `docker-compose.yml`. Plain `postgresql://...?sslmode=require` URLs from hosted providers such as Neon also work: they're converted automatically. The production compose file builds this for you from `POSTGRES_PASSWORD`. |
| `DATABASE_ECHO` | `false` | Logs every SQL statement. Useful for debugging, too noisy otherwise. |

## Security and sessions

| Setting | Default | What it does |
|---|---|---|
| `SECRET_KEY` | An insecure development value | Signs short-lived state cookies, for example during Google sign-in. Must be long and random in production. Generate one with `python3 -c "import secrets;print(secrets.token_urlsafe(48))"`. |
| `ENCRYPTION_KEY` | Derived from `SECRET_KEY` | Encrypts provider API keys, the Hugging Face token and two-factor secrets in the database. Any long random string. If unset, it's derived from `SECRET_KEY`, so rotating `SECRET_KEY` would make those values unreadable. Always set it in production, and never change it afterwards. |
| `COOKIE_SECURE` | `false` | Set to `true` whenever the app is served over HTTPS, which production always should be. Cookies become `Secure` with the `__Host-` prefix, and the API sends HSTS. |
| `SESSION_TTL_DAYS` | `30` | Absolute session lifetime, in days. |
| `SESSION_IDLE_DAYS` | `7` | A session unused for this many days expires. |

## Email

| Setting | Default | What it does |
|---|---|---|
| `SMTP_HOST` | `localhost` | SMTP server host name. |
| `SMTP_PORT` | `31025` | SMTP server port. The default is Mailpit from the development `docker-compose.yml`. |
| `SMTP_USERNAME` | | SMTP user name. Leave empty if your server doesn't need authentication. |
| `SMTP_PASSWORD` | | SMTP password. |
| `SMTP_STARTTLS` | `false` | Connect in plain text, then upgrade with STARTTLS. Usually port 587. |
| `SMTP_TLS` | `false` | Use TLS from the first byte (implicit TLS). Usually port 465. Turn on at most one of `SMTP_STARTTLS` and `SMTP_TLS`. |
| `MAIL_FROM` | `DockWell <no-reply@dockwell.local>` | The sender of every email, as `Name <address>`. Quote it in `.env` files. |
| `EMAIL_WORKER_ENABLED` | `true` | Runs the background worker that delivers queued emails. If it's off on a long-running server, emails stay queued. |

Emails are written to an outbox in the database first, then delivered. Failed deliveries are retried with increasing delays, up to 8 attempts.

## Google sign-in

| Setting | Default | What it does |
|---|---|---|
| `GOOGLE_CLIENT_ID` | | OAuth client ID from Google Cloud (type **Web application**). |
| `GOOGLE_CLIENT_SECRET` | | OAuth client secret. |

Google sign-in is available only when both are set; otherwise the Google buttons are hidden. Register `<APP_URL>/api/auth/google/callback` as the authorised redirect URI. Admins can still turn it off with the platform setting **Google sign-in**.

## Link lifetimes

| Setting | Default | What it does |
|---|---|---|
| `EMAIL_VERIFICATION_TTL_HOURS` | `48` | How long an email verification link works. |
| `PASSWORD_RESET_TTL_MINUTES` | `60` | How long a password reset link works. Each link works once. |
| `INVITATION_TTL_DAYS` | `7` | How long a workspace invitation stays open. Resending it starts the period again. |

## Sign-in and email rate limits

These protect the web app's sign-in and email actions. They're stored in PostgreSQL, so they hold across restarts and API processes. API request limits are separate: see [Rate limits](/docs/rate-limits).

| Setting | Default | What it does |
|---|---|---|
| `SIGNIN_IP_LIMIT` | `30` | Sign-in attempts allowed from one IP address per sign-in window. |
| `SIGNIN_EMAIL_FAILURE_LIMIT` | `5` | Failed sign-ins allowed for one email address per window. After that, the address is locked out until the window passes. |
| `SIGNIN_WINDOW_MINUTES` | `15` | Length of the sign-in window. |
| `EMAIL_ACTION_LIMIT` | `5` | Sign-ups, verification resends and password reset requests allowed for one address per email-action window. One IP address may make four times as many. |
| `EMAIL_ACTION_WINDOW_MINUTES` | `30` | Length of the email-action window. |
| `TOKEN_SUBMIT_IP_LIMIT` | `30` | Verification, password reset and email change links one IP address may submit per 15 minutes. |

## Uploads

| Setting | Default | What it does |
|---|---|---|
| `MAX_AVATAR_BYTES` | `1000000` | Largest profile picture, in bytes (about 1 MB). |

## Platform admins

| Setting | Default | What it does |
|---|---|---|
| `ADMIN_EMAILS` | (empty; `admin@dockwell.dev` in `.env.example`) | Comma-separated addresses that become platform admins when they sign in. This is how the first admin is created. Admins can promote others in the admin area. |
| `SEED_ADMIN_PASSWORD` | | Development only. Creates (or resets) the first `ADMIN_EMAILS` account, verified and an admin, with this password, so a fresh local install can be used right away. `dev.sh` generates it. Ignored when `ENVIRONMENT` isn't `development`. |

## Payments (Stripe)

| Setting | Default | What it does |
|---|---|---|
| `STRIPE_SECRET_KEY` | | Stripe secret key. `sk_test_...` for test mode, `sk_live_...` for live mode (restricted `rk_` keys also work). Switching is configuration only. When empty, payments are off. |
| `STRIPE_WEBHOOK_SECRET` | | The signing secret (`whsec_...`) of your webhook endpoint `<APP_URL>/api/stripe/webhook`. Required: credits are only added from verified webhooks. |

The webhook endpoint needs these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed` and `charge.refunded`. Locally, use `stripe listen --forward-to localhost:31100/api/stripe/webhook`.

## Inference

| Setting | Default | What it does |
|---|---|---|
| `UPSTREAM_TIMEOUT_SECONDS` | `600` | How long the gateway waits for an engine's reply, including streamed replies. |
| `UPSTREAM_CONNECT_TIMEOUT_SECONDS` | `10` | How long the gateway waits to connect to an engine. |
| `DEFAULT_MAX_TOKENS` | `4096` | Output cap applied when a request doesn't set `max_tokens`. Also bounds the reservation. It's lowered automatically to fit the model's context and maximum output. |
| `RESERVATION_TTL_MINUTES` | `30` | Reservations older than this are treated as abandoned (for example after a crash) and released by housekeeping. Keep it longer than your longest request. |
| `BOOTSTRAP_LLAMACPP_URL` | (unset; `http://127.0.0.1:31800/v1` in `.env.example`) | Registers a llama.cpp server as a provider on start-up, with one model. Used for local development. Remove it in production unless you point it at your own llama.cpp server. |
| `BOOTSTRAP_LLAMACPP_MODEL` | `qwen2.5-0.5b-instruct` | The model id registered with `BOOTSTRAP_LLAMACPP_URL`. |
| `GROQ_API_KEY` | | Registers Groq as a provider on start-up (the public demo). Free keys at console.groq.com. |
| `GROQ_MODELS` | `llama-3.1-8b-instant,llama-3.3-70b-versatile` | Comma-separated Groq model ids offered when `GROQ_API_KEY` is set. |

Bootstrapping is idempotent: it adds what's missing and never removes models or changes prices you set later.

## Engine manager

Lets platform admins deploy models from the browser by starting vLLM or llama.cpp containers. See [Self-hosting](/docs/self-hosting#deploying-models-from-the-browser).

| Setting | Default | What it does |
|---|---|---|
| `ENGINE_MANAGER` | `none` (`docker` in `.env.example`) | `docker` starts engines through the Docker socket. `none` turns deployments off (serverless, or engines you manage yourself). |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Path to the Docker Engine socket. |
| `ENGINE_NETWORK` | | Docker network shared by the API and engine containers, `dockwell` with the production compose file. When empty, each engine's port is published on `127.0.0.1` instead (local development). |
| `ENGINE_PORT_RANGE_START` | `31810` | First host port for engines when `ENGINE_NETWORK` is empty. Each new deployment takes the next port. |
| `ENGINE_HF_CACHE_VOLUME` | `dockwell_hf_cache` | Docker volume where engines cache downloaded model weights. |
| `VLLM_IMAGE` | `vllm/vllm-openai:latest` | Image used for vLLM deployments. Pin a version for reproducible installs. |
| `LLAMACPP_IMAGE` | `ghcr.io/ggml-org/llama.cpp:server` | Image used for llama.cpp deployments. Use a CUDA build of the image to run llama.cpp on a GPU. |

## Monitoring

| Setting | Default | What it does |
|---|---|---|
| `PROMETHEUS_URL` | | Prometheus server the admin **System health** page reads GPU metrics from. Set it to `http://prometheus:9090` with the production compose file. |
| `METRICS_TOKEN` | | Bearer token required for `GET /api/metrics`. When unset, the endpoint answers only requests from private addresses that didn't pass through a proxy. |

## Serverless hosting

For platforms that pause the API between requests, such as the [Vercel demo](/docs/vercel-demo). Leave them unset when you self-host.

| Setting | Default | What it does |
|---|---|---|
| `SERVERLESS` | `false` | No background loops. Emails are sent before the request that queued them returns, follow-up work (alerts, auto recharge) runs before the response finishes, and database connections are opened per request so they work through a transaction-mode pooler such as Neon's. |
| `CRON_SECRET` | | Turns on `GET /api/internal/cron`, which retries unsent emails and runs housekeeping once. Callers must send `Authorization: Bearer <CRON_SECRET>`. Without it, the endpoint returns 404. |
| `CLIENT_IP_HEADER` | | A request header holding the visitor's IP, set by a proxy you trust, for example `x-real-ip` on Vercel. Used for rate limits, the activity log, the sessions list and IP blocking. Set it only if every request passes through that proxy, otherwise clients could fake their IP. |

## Production compose settings

The production compose file reads these from `.env.prod`. They configure the containers, not the API.

| Setting | Default | What it does |
|---|---|---|
| `POSTGRES_PASSWORD` | None, required | Password for the `dockwell` database user. Compose builds `DATABASE_URL` from it. Use letters and digits only, because it's placed inside a URL. |
| `WEB_PORT` | `31080` | Host port where the `web` container (nginx) is published. Put your TLS reverse proxy in front of it. |
| `VLLM_MODEL` | `Qwen/Qwen2.5-7B-Instruct` | Hugging Face id of the model the bundled `vllm` service serves (`gpu` profile). |
| `VLLM_GPU_COUNT` | `1` | Number of GPUs the bundled `vllm` service uses. |
| `GRAFANA_PASSWORD` | | Password for Grafana's `admin` user (port 31030). |

## Frontend settings

The browser app has no runtime settings or secrets: it always talks to the API on its own origin. These are read by the Vite dev server and by the build.

| Setting | Default | What it does |
|---|---|---|
| `API_PROXY_TARGET` | `http://127.0.0.1:31100` | Where the Vite dev and preview servers forward `/api` and `/v1`. Change it if your API runs elsewhere. |
| `VITE_SITE_URL` | | The absolute public origin of the site, for example `https://dockwell.example.com`. Used for canonical and Open Graph URLs and the sitemap. |
| `VITE_DEMO_MODE` | | `true` shows the public-demo banner and notices. Leave it unset on your own install. |
| `VITE_GOOGLE_SITE_VERIFICATION` | | Optional Google Search Console verification token, added as a meta tag on public pages. |

`VITE_` settings are **build-time**: they're baked into the files by `npm run build`, so changing them requires a rebuild. Set them in the build environment or in `frontend/.env.production`.

> [!NOTE]
> Never put secrets in a `VITE_` setting. Anything with that prefix ends up in the JavaScript every visitor downloads.

## Platform settings in the database

Platform admins change these in **Admin > Settings** without restarting anything. Only changed values are stored; everything else uses the defaults below. Changes take effect within about 5 seconds on every API process.

### Accounts

| Setting | Default | What it does |
|---|---|---|
| Sign-up enabled | On | Lets new people create accounts. When off, nobody can sign up (invited people included), and admins create accounts in **Admin > Users** instead. Existing users can still sign in. |
| Google sign-in | On | Shows Google sign-in, if `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. |
| Require email verification | On | Users must verify their email before signing in. |
| Free starter credit | On, $3.00 | Credit given once per account (and once per email address) after the email is verified. |

### Credit purchases

| Setting | Default | What it does |
|---|---|---|
| Top-up presets | $5, $10, $25, $50, $100 | Amounts offered on the Add credits screen (up to 8). |
| Minimum top-up | $5 | Smallest payment allowed (at least $0.50). |
| Maximum top-up | $1,000 | Largest payment allowed. |
| Auto recharge allowed | On | Lets workspaces turn on auto recharge. |

### Default limits

| Setting | Default | What it does |
|---|---|---|
| Workspace requests per minute | 600 | For workspaces without a custom limit. |
| Workspace tokens per minute | 1,000,000 | For workspaces without a custom limit. |
| Workspace monthly spend limit | None | Given to new workspaces when they're created. |
| Key requests per minute | None | For keys without their own limit. |
| Key tokens per minute | None | For keys without their own limit. |
| Platform requests per minute | None | A ceiling across the whole install. |

### Data and logs

| Setting | Default | What it does |
|---|---|---|
| Prompt logging allowed | Off | Allows storing prompt and response content in request logs. Workspaces can still opt out. |
| Log retention | 30 days | Request logs older than this are deleted (1 to 3650 days). Workspaces can choose fewer days. |

### Abuse controls and operations

| Setting | Default | What it does |
|---|---|---|
| Blocked email domains | None | Sign-ups from these domains and their subdomains are refused. |
| Blocked IPs | None | Single addresses or CIDR ranges refused on `/api` and `/v1` (`403 ip_blocked`). |
| Maintenance mode | Off | API and playground requests get `503 maintenance` with the maintenance message. |
| Maintenance message | "DockWell is down for maintenance. Please try again shortly." | Shown to users and returned in API errors. |
| Announcement banner | Empty | A site-wide banner with a message, a level (info, warning or critical) and an optional link. |

### Branding and models

| Setting | Default | What it does |
|---|---|---|
| Platform name | DockWell | Shown in the web app, on Checkout and in payment descriptions. |
| Logo | None | Replaces the DockWell logo in the web app. |
| Hugging Face token | None | Stored encrypted, passed to new engine deployments for gated models. |
