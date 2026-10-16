This page shows you how to run a public **demo** of DockWell on Vercel, with a Neon PostgreSQL database, Groq as the model provider and Stripe in test mode, using free plans. The demo runs exactly the same code as a self-hosted install. A few settings adapt it to serverless hosting, and nothing else changes.

> [!WARNING]
> A Vercel demo is for letting people try DockWell. It can't run your own models and serverless functions have time limits. For real use, [self-host it](/docs/self-hosting) on a GPU server. Set `DEMO_MODE=true` and `VITE_DEMO_MODE=true` so every visitor sees the demo banner, which says payments are test mode.

## How it fits together

| Part | Self-hosted (Docker) | Vercel demo |
|---|---|---|
| Web app and public site | nginx serves `frontend/dist` | Vercel's CDN serves `frontend/dist` |
| API (`/api` and `/v1`) | uvicorn runs `dockwell_api.main:app` | One Vercel Function, `api/index.py`, runs the same app |
| Database | PostgreSQL container | Neon, through its pooled connection |
| Inference | vLLM or llama.cpp engines | Groq's OpenAI-compatible API |
| Payments | Stripe live mode | Stripe test mode |
| Sending email | Background worker | Sent during the request that queued it, retried by cron |
| Housekeeping | Background loop every 10 minutes | Vercel Cron calls `/api/internal/cron` |
| Model deployments | Engine manager through Docker | Off (`ENGINE_MANAGER=none`) |

The Vercel-only files are at the repository root:

- `api/index.py` exposes the FastAPI app as one serverless function.
- `vercel.json` builds the frontend, rewrites `/api/*` and `/v1/*` to that function, sets security headers and defines the cron job.
- `requirements.txt` lists the Python packages for the function. It's generated from `backend/uv.lock` with `make vercel-requirements`, so the demo runs exactly the versions the Docker image uses. Re-run it after changing backend dependencies.

Docker and the dev scripts never read these files.

## What you need

- The repository on your GitHub account.
- A free [Vercel](https://vercel.com) account.
- A free [Neon](https://neon.com) account.
- A free [Groq](https://console.groq.com) API key.
- A [Stripe](https://stripe.com) account in test mode.
- An SMTP account that can send to any address, for example Brevo's free plan or a Gmail account with an app password.
- On your computer: the repository and [uv](https://docs.astral.sh/uv/), to run the database migrations.

## 1. Create the database

1. In Neon, create a project in the region closest to Vercel's default function region, for example AWS US East 1 (N. Virginia).
2. Open **Connect** and copy two connection strings:
   - the **pooled** one, with `-pooler` in the host name, for the app;
   - the **direct** one, without `-pooler`, for migrations.

Paste them exactly as Neon shows them (`postgresql://...?sslmode=require`). The API converts them to the format its driver needs.

## 2. Create the tables

From the repository on your computer, run the migrations against the **direct** URL:

```bash
cd backend
DATABASE_URL='postgresql://user:password@ep-example-123456.us-east-1.aws.neon.tech/neondb?sslmode=require' \
  uv run alembic upgrade head
```

Run this again before deploying any version that adds migrations. The Docker image migrates on every start, but a serverless function shouldn't change the schema while requests are running.

## 3. Set up Stripe test mode

1. In the Stripe dashboard, in **test mode**, copy the secret key (`sk_test_...`).
2. Under **Developers > Webhooks**, add an endpoint `https://your-project.vercel.app/api/stripe/webhook` with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed` and `charge.refunded`.
3. Copy the endpoint's signing secret (`whsec_...`).

## 4. Import the project into Vercel

1. In Vercel, select **Add New > Project** and import the repository.
2. Leave **Root Directory** at the repository root. `vercel.json` already sets the build command and output directory.
3. Before deploying, add the environment variables from the next step.

## 5. Set the environment variables

Add these under **Settings > Environment Variables** for the **Production** environment:

```env
# Serverless mode: no background loops, inline email, per-request database connections
SERVERLESS=true
ENVIRONMENT=production
COOKIE_SECURE=true
CLIENT_IP_HEADER=x-real-ip

# Your production address, exactly as in the browser (no trailing slash)
APP_URL=https://your-project.vercel.app

# Long random strings: python3 -c "import secrets;print(secrets.token_urlsafe(48))"
SECRET_KEY=a-long-random-string
ENCRYPTION_KEY=another-long-random-string
CRON_SECRET=a-third-long-random-string

# Neon's POOLED connection string
DATABASE_URL=postgresql://user:password@ep-example-123456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require

# Your SMTP account
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_STARTTLS=true
SMTP_USERNAME=you@example.com
SMTP_PASSWORD=your-smtp-key
MAIL_FROM="DockWell Demo <you@example.com>"

# Demo behaviour
DEMO_MODE=true
ENGINE_MANAGER=none
ADMIN_EMAILS=you@example.com

# Groq as the provider
GROQ_API_KEY=gsk_...
GROQ_MODELS=llama-3.1-8b-instant,llama-3.3-70b-versatile

# Stripe TEST keys
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Read by the frontend build
VITE_DEMO_MODE=true
VITE_SITE_URL=https://your-project.vercel.app
```

If you don't know the final address yet, deploy once, copy the address, update `APP_URL`, `VITE_SITE_URL` and the Stripe webhook URL, and redeploy.

Optional: for Google sign-in, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and register `<APP_URL>/api/auth/google/callback` as the redirect URI.

## 6. Deploy and check

Select **Deploy**. When the build finishes:

1. Open `https://your-project.vercel.app/api/health`. It should show `{"status":"ok"}`.
2. Sign up with your `ADMIN_EMAILS` address and check that the verification email arrives. You become a platform admin when you sign in.
3. Open **Admin > Models** and check that the Groq models are listed and ready. The API registers Groq and the models in `GROQ_MODELS` on start-up (and again on every cron run), with default prices you can change.
4. Under **Settings > Cron Jobs** in Vercel, check that `/api/internal/cron` is listed.

Every push to your main branch then deploys automatically. Run step 2 first when a release adds migrations.

## How Groq models are named

Each entry in `GROQ_MODELS` is a Groq model id. DockWell uses the part after the last `/` as the public id: `openai/gpt-oss-20b` becomes `gpt-oss-20b`. Known Groq models get a display name, context length and price automatically. Unknown ones are added with a 32,768 token context and no price, so set their price in **Admin > Pricing**.

## What the serverless settings change

| Setting | Effect |
|---|---|
| `SERVERLESS=true` | No background loops, because Vercel pauses the function between requests. Each email is sent before the request that queued it returns, alerts and auto recharge run before the response finishes, and database connections are opened per request so they work through Neon's pooler. |
| `CRON_SECRET` | Turns on `GET /api/internal/cron`. Vercel Cron calls it with `Authorization: Bearer <CRON_SECRET>`. It retries unsent emails, removes expired sessions, links and rate-limit records, releases abandoned reservations, prunes request logs to the retention period, announces expiring keys, retires models past their date and re-registers Groq. Without the secret, the endpoint returns 404. |
| `CLIENT_IP_HEADER=x-real-ip` | Takes the visitor's IP from Vercel's header, for rate limits, the activity log and the sessions list. Set it only behind a proxy that always overwrites that header, as Vercel does. |
| `ENGINE_MANAGER=none` | Turns off model deployments, which need Docker. Admins can still attach OpenAI-compatible providers. |
| `DEMO_MODE=true` | Shows the demo notices and refuses a few platform-wide actions, such as turning on maintenance mode. |

## Limits of the free demo

| Limit | What it means |
|---|---|
| Function duration | Vercel stops a function after the maximum duration of your plan. A very long streamed reply is cut off at that point. DockWell charges only for what was generated. |
| 4.5 MB per request | Vercel rejects larger request bodies, for example very large images. Self-hosted allows 32 MB. |
| Cron frequency | On the Hobby plan cron jobs run at most once a day, so failed emails are retried and abandoned reservations released daily. |
| Neon pauses when idle | The first request after a quiet period can take a second or two. |
| Groq free tier | Groq's own rate limits apply. When Groq refuses a request, users get `503 model_overloaded`. |
| Preview deployments | Preview URLs differ from `APP_URL`, so the API's same-origin check blocks sign-in there. Use the production address. |

## Troubleshooting

| Problem | Fix |
|---|---|
| Every action fails with "Cross-origin request blocked" | `APP_URL` doesn't exactly match the address in the browser. Fix it (with `https://`, no trailing slash) and redeploy. |
| Errors like "relation ... does not exist" | The migrations haven't run. Do step 2. |
| No models in the playground | Check `GROQ_API_KEY`, then look in **Admin > Models**. Open `/api/health` once to wake the function, or wait for the next cron run. |
| Paid in test mode but no credits | Check the Stripe webhook URL and `STRIPE_WEBHOOK_SECRET`. **Admin > Settings** shows when the last webhook arrived. |
| No emails arrive | Check the SMTP settings and the function logs in Vercel. With Gmail you need an app password. |
