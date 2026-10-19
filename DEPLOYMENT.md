# Deploying DockWell

DockWell runs the same code in three ways. Pick the one that fits:

| Option | Where | Inference | Best for |
|---|---|---|---|
| [1. Local](#1-run-locally-cpu) | Your laptop | llama.cpp, CPU | Trying it and development |
| [2. Self-host](#2-self-host-docker-compose) | Your own Linux server | vLLM on NVIDIA GPUs, or llama.cpp on CPU | Real use: your models, your servers |
| [3. Vercel demo](#3-vercel-demo-serverless) | Vercel and Neon | Groq | A public demo on free plans |

The full guides are in the docs, served by the app at `/docs` (source in
`frontend/src/site/docs/content/`). This file is the short version.

---

## 1. Run locally (CPU)

**Needs:** Docker, [uv](https://docs.astral.sh/uv/) and Node 22.12 or newer.

```bash
git clone https://github.com/theabhipatel/dockwell.git
cd dockwell
./scripts/dev.sh          # Windows: scripts\dev.cmd
```

The script creates `backend/.env` with random secrets and starts:

- PostgreSQL;
- Mailpit, which catches every email the app sends;
- llama.cpp with Qwen2.5 0.5B, downloaded on the first run;
- the API and the web app.

When it's done, it prints the addresses and the logins.

| What | Address |
|---|---|
| Web app and public site | http://localhost:31180 |
| OpenAI-compatible API | http://localhost:31180/v1 |
| API docs | http://localhost:31100/api/docs |
| Mailpit | http://localhost:31825 |

- **Admin login:** `admin@dockwell.dev` with the password stored as `SEED_ADMIN_PASSWORD` in `backend/.env`.
- **Default user:** set by `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` in the same file.
- **Payments (optional, Stripe test mode):** set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in
  `backend/.env`, then run:

  ```bash
  stripe listen --forward-to localhost:31100/api/stripe/webhook
  ```

---

## 2. Self-host (Docker Compose)

One server runs everything: PostgreSQL, the API, the web app (nginx), your inference engine,
Prometheus and Grafana.

### Requirements

- A Linux server with Docker Engine and Docker Compose v2.
- **For GPUs:** an NVIDIA driver and the NVIDIA Container Toolkit. This command must list your GPUs:

  ```bash
  docker run --rm --gpus all ubuntu nvidia-smi
  ```

- About 20 GB of disk per model.
- A domain name pointing at the server, for HTTPS.
- An SMTP account for emails.
- Optional: a Stripe account to sell credits.

### Steps

**1. Get the code and create the settings file**

```bash
git clone https://github.com/theabhipatel/dockwell.git
cd dockwell
cp backend/.env.example .env.prod
```

**2. Edit `.env.prod`.** At minimum, set these:

```env
ENVIRONMENT=production
APP_URL=https://dockwell.example.com     # exact public address, no trailing slash
COOKIE_SECURE=true

# Long random strings: python3 -c "import secrets;print(secrets.token_urlsafe(48))"
SECRET_KEY=...
ENCRYPTION_KEY=...
POSTGRES_PASSWORD=...                    # letters and digits only
GRAFANA_PASSWORD=...

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_STARTTLS=true
SMTP_USERNAME=...
SMTP_PASSWORD=...
MAIL_FROM="DockWell <dockwell@example.com>"

ADMIN_EMAILS=you@example.com             # becomes platform admin on first sign-in

# Register the bundled engine on start-up. Keep only the block for your profile.
# GPU server (vLLM):
VLLM_MODEL=Qwen/Qwen2.5-7B-Instruct      # model the vLLM engine serves
BOOTSTRAP_VLLM_URL=http://vllm:8000/v1
BOOTSTRAP_VLLM_MODEL=Qwen/Qwen2.5-7B-Instruct
# CPU server (llama.cpp):
# BOOTSTRAP_LLAMACPP_URL=http://llamacpp:8080/v1
# BOOTSTRAP_LLAMACPP_MODEL=qwen2.5-1.5b-instruct

# Lets admins deploy models from the browser: run `stat -c %g /var/run/docker.sock`
DOCKER_GID=999

# Optional: Stripe live keys
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Delete these development-only lines:

- `SEED_ADMIN_PASSWORD`
- `SEED_USER_EMAIL`, `SEED_USER_PASSWORD` and `SEED_USER_NAME`
- `BOOTSTRAP_LLAMACPP_URL=http://127.0.0.1:31800/v1` (on a CPU server, replace it with the value above)

Back up `.env.prod`. You can't recover encrypted data without `ENCRYPTION_KEY`.

**3. Start everything**

```bash
# GPU server (vLLM)
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile gpu up -d --build

# CPU-only server (llama.cpp)
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile cpu up -d --build
```

The API runs the database migrations each time it starts. The first start takes a while because
Docker builds the images and the engine downloads the model weights. To follow progress:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api vllm
```

**4. Put HTTPS in front.** The `web` container listens on port `31080` over plain HTTP.

- **Simplest:** use [Caddy](https://caddyserver.com). It gets and renews certificates by itself:

  ```text
  dockwell.example.com {
      reverse_proxy 127.0.0.1:31080 {
          flush_interval -1
      }
  }
  ```

- **Any other proxy:** turn off response buffering so streamed replies pass through, allow request
  bodies up to 32 MB, and set read timeouts to 600 seconds or more.
- **Firewall:** keep ports `31080`, `31090` (Prometheus) and `31030` (Grafana) closed to the internet.

**5. Create the first admin**

1. Sign up at your address with the email you put in `ADMIN_EMAILS`.
2. Verify it, then sign in. You're made an admin automatically.
3. In **Admin > Settings**, use **Send test email** to check SMTP.

**6. Add your model**

- **Bundled engine:** nothing to do. With the `BOOTSTRAP_*` lines above it registers itself on
  start-up with a default price, and turns **ready** in **Admin > Models** once the weights are
  loaded. You can change the price there.
- **More models from the browser:** go to **Admin > Models > Deploy model** and enter a Hugging Face
  id. Gated models, such as Llama and Gemma, need a Hugging Face token, which you set in
  **Admin > Settings**.
- **External providers:** you can attach any OpenAI-compatible provider the same way.

**7. Stripe (optional)**

1. Add a webhook endpoint at `https://dockwell.example.com/api/stripe/webhook` with these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `payment_intent.succeeded`, `payment_intent.payment_failed` and `charge.refunded`.
2. Put the endpoint's signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Restart the API:

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api
   ```

### Backups and upgrades

```bash
# Back up the database (also keep a copy of .env.prod)
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U dockwell -d dockwell --format=custom > dockwell-$(date +%F).dump

# Upgrade: the API migrates the database when it starts
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile gpu up -d --build
```

For monitoring, open Grafana at `http://<server>:31030` (user `admin`, password
`GRAFANA_PASSWORD`). The admin **System health** page shows engines, GPUs, traffic and error rates.

Full guide: `frontend/src/site/docs/content/self-hosting.md` (or `/docs/self-hosting` in the app).

---

## 3. Vercel demo (serverless)

This option runs the same app on Vercel, with Neon as the database and Groq as the model provider.
It can't run your own models, and serverless time limits apply, so use it for a public demo only.

**Needs:** a Vercel account with the CLI logged in (`vercel login`), a Neon database, a Groq API
key, and uv installed locally. SMTP and Stripe test keys are optional.

**1. Create the tables.** Use Neon's **direct** connection string, the one without `-pooler` in the
host name:

```bash
cd backend
DATABASE_URL='postgresql://USER:PASSWORD@ep-xxx.REGION.aws.neon.tech/neondb?sslmode=require' \
  uv run alembic upgrade head
cd ..
```

Run this again before deploying any version that adds migrations.

**2. Link the project**

```bash
vercel link --yes --project dockwell
```

**3. Add the environment variables.** Add each one to Production with
`printf '%s' 'VALUE' | vercel env add NAME production`, or in the Vercel dashboard:

| Variable | Value |
|---|---|
| `SERVERLESS` | `true` |
| `ENVIRONMENT` | `production` |
| `COOKIE_SECURE` | `true` |
| `CLIENT_IP_HEADER` | `x-real-ip` |
| `DEMO_MODE` / `VITE_DEMO_MODE` | `true` |
| `ENGINE_MANAGER` | `none` |
| `DATABASE_URL` | Neon's **pooled** connection string (with `-pooler`), pasted as-is |
| `SECRET_KEY`, `ENCRYPTION_KEY`, `CRON_SECRET` | long random strings |
| `GROQ_API_KEY` | your Groq key |
| `GROQ_MODELS` | comma-separated Groq model ids your key can use, for example `openai/gpt-oss-20b,openai/gpt-oss-120b` (list them with `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"`) |
| `APP_URL` / `VITE_SITE_URL` | the production address, for example `https://dockwell.vercel.app` |
| Optional | `SMTP_*` and `MAIL_FROM` for email, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (test keys), `ADMIN_EMAILS` |

**4. Deploy**

```bash
vercel deploy --prod --yes
```

If you didn't know the production address before the first deploy, set `APP_URL` and
`VITE_SITE_URL` to it now and deploy again. Sign-in only works when `APP_URL` exactly matches the
address in the browser.

**5. Check it.** Open `https://<your-app>/api/health`. It should return `{"status":"ok"}`. Groq
models register themselves on start-up, and **Admin > Models** lists them.

**No SMTP account?** Users can't receive verification emails. Make it work in this order:

1. Create the admin account directly in the database (a verified user with `is_admin` set), so
   nobody else can claim an admin address.
2. Leave `ADMIN_EMAILS` empty.
3. Turn off **Require email verification** in **Admin > Settings**.

New users can then sign in right after signing up and still get the starter credit.

Full guide: `frontend/src/site/docs/content/vercel-demo.md` (or `/docs/vercel-demo` in the app).

---

## Production checklist

- `APP_URL` is the exact public address, with `https://` and no trailing slash.
- HTTPS is in front of the app, and `COOKIE_SECURE=true` is set.
- `SECRET_KEY`, `ENCRYPTION_KEY` and `POSTGRES_PASSWORD` are long, random and backed up.
- The development seed lines (`SEED_*`, the local `BOOTSTRAP_LLAMACPP_URL` on `127.0.0.1:31800`) are removed.
- `DOCKER_GID` matches `stat -c %g /var/run/docker.sock`, if admins deploy models from the browser.
- Email works: **Admin > Settings > Send test email**.
- The Stripe webhook is set up, if you sell credits.
- Internal ports (`31080`, `31090`, `31030`) aren't reachable from the internet.
- Database backups run on a schedule, and you've tested a restore.
