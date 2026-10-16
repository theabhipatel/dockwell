This guide shows you how to run DockWell on your own Linux server with one or more NVIDIA GPUs. Everything runs on that one server with Docker Compose: PostgreSQL, the API, the web app, your inference engines and monitoring. When you're done, your team or customers can sign up, buy credits and call your models at `https://dockwell.example.com/v1`.

No GPU? The same compose file has a `cpu` profile that serves models with llama.cpp. To try DockWell on your laptop first, see [Running locally on CPU](/docs/running-locally).

## Requirements

| Requirement | Notes |
|---|---|
| **Linux server** | Ubuntu 22.04 or 24.04 is a safe choice. Any distribution supported by Docker and NVIDIA works. |
| **NVIDIA GPU and driver** | Enough GPU memory for the models you plan to serve. A 7B model in 16-bit needs roughly 16 GB, plus room for the KV cache. `nvidia-smi` must work on the host. |
| **NVIDIA Container Toolkit** | Lets containers use the GPU. Install it from NVIDIA's documentation and run `sudo nvidia-ctk runtime configure --runtime=docker`, then restart Docker. |
| **Docker Engine** | With Docker Compose v2 (`docker compose`). |
| **Disk space** | Model weights are large: plan for 20 GB or more per model, plus the database. |
| **A domain name** | Pointing at the server, for HTTPS, for example `dockwell.example.com`. |
| **An SMTP account** | For verification, invitation and billing emails. |
| **A Stripe account** | Optional, to sell credits. |

Check that Docker can see your GPUs:

```bash
docker run --rm --gpus all ubuntu nvidia-smi
```

If this prints your GPUs, you're ready. If it fails, fix the NVIDIA Container Toolkit setup first. See the [FAQ](/docs/faq#gpu-not-visible-in-containers).

## 1. Get the code

```bash
git clone https://github.com/theabhipatel/dockwell.git
cd dockwell
```

## 2. Configure

Copy the example settings into `.env.prod` at the repository root:

```bash
cp backend/.env.example .env.prod
```

Edit `.env.prod`. At minimum, set these:

```env
ENVIRONMENT=production
APP_URL=https://dockwell.example.com
COOKIE_SECURE=true

# Long random strings: python3 -c "import secrets;print(secrets.token_urlsafe(48))"
SECRET_KEY=replace-with-a-long-random-string
ENCRYPTION_KEY=replace-with-another-long-random-string

# Database password for the bundled PostgreSQL (letters and digits only)
POSTGRES_PASSWORD=replace-with-a-strong-password

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_STARTTLS=true
SMTP_USERNAME=dockwell@example.com
SMTP_PASSWORD=your-smtp-password
MAIL_FROM="DockWell <dockwell@example.com>"

# The first platform admin (comma separated for several)
ADMIN_EMAILS=you@example.com

# Payments (live keys from the Stripe dashboard)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# GPU metrics on the admin System health page
PROMETHEUS_URL=http://prometheus:9090

# Monitoring and the bundled engine
GRAFANA_PASSWORD=replace-with-a-grafana-password
VLLM_MODEL=Qwen/Qwen2.5-7B-Instruct
```

Remove the development lines you don't need, in particular `BOOTSTRAP_LLAMACPP_URL=http://127.0.0.1:31800/v1` `SEED_ADMIN_PASSWORD` and the `SEED_USER_*` lines. Every setting is described in the [Configuration reference](/docs/configuration).

> [!WARNING]
> Back up `.env.prod`, especially `ENCRYPTION_KEY`. It encrypts provider API keys, the Hugging Face token and two-factor secrets in the database. If you lose or change it, those values can't be decrypted.

## 3. Start everything

On a GPU server:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile gpu up -d --build
```

On a CPU-only server, use the `cpu` profile instead. It runs llama.cpp in place of vLLM and skips the GPU exporter:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile cpu up -d --build
```

The first start takes a while: Docker builds the API and web images, pulls the engine image and the engine downloads the model weights. Follow progress with:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api vllm
```

## What's running

| Service | Profile | What it does | Port |
|---|---|---|---|
| `postgres` | always | PostgreSQL. Data lives in a Docker volume. | Internal only |
| `api` | always | The DockWell API. Runs database migrations on every start, then serves `/api` and `/v1`. | Internal only |
| `web` | always | nginx. Serves the web app and public site, and proxies `/api` and `/v1` to the API. | `WEB_PORT`, default `31080` |
| `vllm` | `gpu` | A vLLM engine serving `VLLM_MODEL` (default `Qwen/Qwen2.5-7B-Instruct`) on `VLLM_GPU_COUNT` GPUs. | Internal only |
| `llamacpp` | `cpu` | A llama.cpp server for CPU-only installs. | Internal only |
| `prometheus` | always | Collects metrics from the API, the engines and the GPU exporter. | `31090` |
| `grafana` | always | Dashboards for the operator. Sign in as `admin` with `GRAFANA_PASSWORD`. | `31030` |
| `dcgm-exporter` | `gpu` | NVIDIA's GPU metrics exporter (utilisation, memory). | Internal only |

All containers share a Docker network called `dockwell`. The `api` container also mounts `/var/run/docker.sock` and runs with `ENGINE_MANAGER=docker` and `ENGINE_NETWORK=dockwell`, so platform admins can deploy more models from the browser. Each deployed engine joins the same network.

> [!WARNING]
> Access to the Docker socket is equivalent to root access on the host. Only give platform admin rights to people you'd trust with the server. If you don't want browser deployments, set `ENGINE_MANAGER=none` and remove the socket mount.

## 4. Put HTTPS in front

The `web` container speaks plain HTTP on `WEB_PORT`. Put a TLS reverse proxy in front of it, and don't expose `WEB_PORT`, `31090` or `31030` to the internet directly (use a firewall, or bind them to `127.0.0.1`).

### Caddy

Caddy gets and renews certificates automatically. `/etc/caddy/Caddyfile`:

```text
dockwell.example.com {
    reverse_proxy 127.0.0.1:31080 {
        flush_interval -1
    }
}
```

`flush_interval -1` passes streamed replies through immediately.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name dockwell.example.com;

    ssl_certificate     /etc/letsencrypt/live/dockwell.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dockwell.example.com/privkey.pem;

    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:31080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}
```

### Traefik

With Traefik, add a router with the rule ``Host(`dockwell.example.com`)`` and a certificate resolver, pointing at `127.0.0.1:31080` (or at the `web` container, if Traefik joins the `dockwell` network). Raise the read timeout so long generations aren't cut off.

Whatever proxy you use: turn off response buffering for streams, allow bodies up to 32 MB, and keep read timeouts at least as long as `UPSTREAM_TIMEOUT_SECONDS` (600 seconds by default).

## 5. Create the first admin

1. Open `https://dockwell.example.com` and sign up with an address from `ADMIN_EMAILS`.
2. Verify your email and sign in. You're made a platform admin automatically on sign-in.
3. Open the **Admin** area from the user menu.

You can promote other users to admin from **Admin > Users** later. Check **Admin > Settings** for the service status of email, Stripe, Google and the engine manager, and use **Send test email** to confirm SMTP works.

## 6. Make your model available

### The bundled vLLM engine (gpu profile)

The `vllm` service serves `VLLM_MODEL` inside the Docker network at `http://vllm:8000/v1`. Register it once:

1. Go to **Admin > Models > Providers** and select **Add provider**.
2. Choose the kind **vLLM**, name it (for example `vLLM`), and enter the base URL `http://vllm:8000/v1`. No API key is needed.
3. Select **Check connection**. When the engine has finished loading, it lists the served model.
4. Import the model, and set its display name, context length, capabilities and price.

Until vLLM finishes loading, the check fails and the model shows **starting**. DockWell checks unmanaged engines about every 30 seconds and marks the model **ready** once it answers.

### The bundled llama.cpp engine (cpu profile)

Set `BOOTSTRAP_LLAMACPP_URL=http://llamacpp:8080/v1` and `BOOTSTRAP_LLAMACPP_MODEL` to the model alias in `.env.prod` to have the API register it on start, or add it as a provider of kind **llama.cpp** as above.

### Deploying models from the browser

With the engine manager on, admins can start new engines without touching the server:

1. Go to **Admin > Models** and select **Deploy model**.
2. Choose the engine and enter the **Hugging Face id**, for example `meta-llama/Llama-3.1-8B-Instruct`.
3. Set the public model id, display name, capabilities and price.
4. Set the engine options:

| Engine | Option | Notes |
|---|---|---|
| vLLM | **GPU count** | GPUs for tensor parallelism. |
| vLLM | **Context length** | Passed as `--max-model-len`. Lower it to fit a model in less memory. |
| vLLM | **Quantization** | For example `awq`, `gptq` or `fp8`, matching the weights. |
| vLLM | **Precision** (dtype) | `auto`, `float16` or `bfloat16`. |
| vLLM | **GPU memory share** | Fraction of each GPU's memory vLLM may use, default `0.9`. Lower it to run two models on one GPU. |
| llama.cpp | **GGUF file** | The file in the repository, for example `qwen2.5-7b-instruct-q4_k_m.gguf`. |
| Both | **Extra arguments** | Additional engine flags, for advanced use. |

5. Select **Deploy**.

DockWell starts a container for the engine on the `dockwell` network. The weights download into a shared cache volume (`dockwell_hf_cache`), so a restart doesn't download them again. The model moves through these statuses:

| Status | Meaning |
|---|---|
| `downloading` | Pulling the engine image or downloading weights. |
| `starting` | Loading the model into memory. |
| `ready` | Serving requests. |
| `failed` | The engine exited. The message shows the last log line. |
| `stopped` | Stopped by an admin. |

From **Admin > Deployments** you can **start**, **stop**, **restart** or delete an engine, and open its **logs** to see download progress and errors. Models with the `tools` capability are started with vLLM's tool calling turned on.

### Gated models and the Hugging Face token

Some models (Llama, Gemma and others) are gated: you must accept their licence on Hugging Face and download with a token. Accept the licence on the model's page, create a read token on Hugging Face, and save it under **Admin > Settings > Hugging Face token**. It's stored encrypted and passed to new engines.

### External providers

You can also attach any OpenAI-compatible endpoint, for example another vLLM server, a hosted API or Groq:

1. **Admin > Models > Providers > Add provider**, kind **OpenAI-compatible**.
2. Enter the base URL (ending in `/v1`) and the API key. The key is stored encrypted.
3. **Check connection**, then import the models you want and set their prices.

## 7. Set up Stripe in live mode

1. In the Stripe dashboard, switch to live mode and copy your **secret key** (`sk_live_...`) into `STRIPE_SECRET_KEY`.
2. Under **Developers > Webhooks**, add an endpoint with the URL `https://dockwell.example.com/api/stripe/webhook` and these events:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
payment_intent.succeeded
payment_intent.payment_failed
charge.refunded
```

3. Copy the endpoint's **signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
4. Restart the API: `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api`.
5. Make a small payment and check **Admin > Settings**, which shows the Stripe mode and when the last webhook arrived.

Credits are only ever added from verified webhooks, so the webhook must work before you sell credits. See [Billing and credits](/docs/billing-and-credits).

## 8. Optional: Google sign-in

Create an OAuth client of type **Web application** in Google Cloud, add `https://dockwell.example.com/api/auth/google/callback` as an authorised redirect URI, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Admins can still turn Google sign-in off in **Admin > Settings**.

## Monitoring

| Tool | Address | Use |
|---|---|---|
| Admin **System health** | `https://dockwell.example.com/admin` | Engine status, GPU utilisation and memory, requests in flight, tokens per second, error rate, database and email status. |
| Prometheus | `http://<server>:31090` | Raw metrics from the API (`/api/metrics`), engines and the GPU exporter. |
| Grafana | `http://<server>:31030` | Dashboards. User `admin`, password `GRAFANA_PASSWORD`. |

GPU figures on the System health page come from Prometheus, so `PROMETHEUS_URL=http://prometheus:9090` must be set. `GET /api/metrics` answers only private addresses unless you set `METRICS_TOKEN`, in which case it needs that token as a Bearer token.

## Backups

Everything that matters is in PostgreSQL, plus `.env.prod`. Back up the database regularly:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U dockwell -d dockwell --format=custom > dockwell-$(date +%F).dump
```

Restore into a fresh install:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_restore -U dockwell -d dockwell --clean --if-exists < dockwell-2026-10-16.dump
```

Model weights don't need backing up: they're downloaded again if missing.

## Production checklist

- `APP_URL` is the exact public address, with `https://` and no trailing slash.
- `COOKIE_SECURE=true` and HTTPS in front of `web`.
- `SECRET_KEY`, `ENCRYPTION_KEY` and `POSTGRES_PASSWORD` are long and random, and backed up.
- `SEED_ADMIN_PASSWORD`, the `SEED_USER_*` lines and the local `BOOTSTRAP_LLAMACPP_URL` are removed.
- SMTP works (**Send test email** in Admin > Settings).
- The Stripe webhook is set up and the last event shows in Admin > Settings.
- Ports `31080`, `31090` and `31030` aren't reachable from the internet.
- Database backups run on a schedule and you've tested a restore.

Next: learn the admin area in the [Admin guide](/docs/admin-guide), and keep your install current with [Upgrading](/docs/upgrading).
