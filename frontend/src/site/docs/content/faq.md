Quick answers to the questions people ask most often, and fixes for common problems. If your question isn't here, check [Core concepts](/docs/core-concepts) or open an issue on GitHub.

## General

### Who built DockWell?

DockWell is designed and developed by [TheAbhiPatel](https://www.theabhipatel.com/) (Abhishek Patel). It's open source under the MIT licence.

### Is it really compatible with the OpenAI SDKs?

Yes. Change the base URL to `<your DockWell URL>/v1` and use a DockWell API key. Requests, responses, streaming and errors follow OpenAI's format. DockWell offers chat completions, completions, embeddings and models. Other OpenAI endpoints, such as images or audio, aren't available. See [Using the OpenAI SDKs](/docs/openai-sdks).

### Do I need a GPU?

Not to try it. Local development runs a tiny model on your CPU with llama.cpp, and a small CPU-only server can use the `cpu` profile. For real models and real traffic, a GPU server with vLLM is the way to go. See [Self-hosting](/docs/self-hosting).

### Can I use my own OpenAI-compatible endpoint?

Yes. A platform admin can attach any endpoint that speaks the OpenAI API, such as another vLLM server, a hosted API or Groq, under **Admin > Models > Providers** with its URL and API key. The key is stored encrypted. Its models are then metered, priced and logged like any other. See the [Admin guide](/docs/admin-guide#providers).

### How is money stored?

As exact integers in **micro-dollars** (1 US dollar = 1,000,000 micro-dollars), never as floating point. Costs are rounded up to the next micro-dollar, so nothing is undercharged and balances never drift. See [Billing and credits](/docs/billing-and-credits#exact-accounting).

### Is my prompt content stored?

**Not by default.** Request logs always record tokens, cost, latency and status, but the text of prompts and responses is stored only if the platform admin turned on prompt logging **and** your workspace hasn't opted out in its settings. Logs are deleted after the retention period (30 days by default). See [Workspaces and roles](/docs/workspaces-and-roles#request-logs).

### Am I charged for failed requests?

No. A request that fails is never charged. A streamed request that you cancel is charged only for the tokens generated before you stopped it.

### Why was my request refused when I still have credit?

DockWell reserves the **most** a request could cost before running it, based on `max_tokens`. If you leave `max_tokens` out, it uses the server default (4096). With a low balance, a big reservation may not fit even though the real cost would. Set a smaller `max_tokens`, or add credits.

## Errors

### I get 429 insufficient_quota

The workspace has run out of available credit. Add credits on the **Billing** page. If the balance looks fine, other requests may be holding reservations at the same moment, or the request's `max_tokens` is very large. Other `429` codes mean something different:

| Code | Meaning |
|---|---|
| `rate_limit_exceeded` | Too many requests or tokens per minute. Wait for `Retry-After`. |
| `spend_limit_reached` | The workspace's monthly limit is reached. Raise it on the Billing page. |
| `key_spend_limit_reached` | The key's spend limit is reached. |
| `project_spend_limit_reached` | The project's monthly limit is reached. |

See [Errors](/docs/errors).

### "Your session security token is missing. Reload the page and try again."

This is the web app's CSRF protection. It happens when the security cookie is missing or out of date, for example after clearing cookies, after a long time in another tab, or when the browser blocks cookies for the site. Reload the page. If it keeps happening on a self-hosted install, check that `APP_URL` matches the address in your browser exactly, and that `COOKIE_SECURE=true` is only set when you use HTTPS.

### "Cross-origin request blocked"

`APP_URL` doesn't match the address you're using. Set it to the exact origin in the browser, with `http://` or `https://` and no trailing slash, and restart the API.

### The model returns 503 model_unavailable

The model isn't ready, its provider is off, or the engine couldn't be reached. Check the model's status in **Admin > Models** and the engine logs in **Admin > Deployments**. `model_overloaded` means the engine or upstream provider is rate limiting DockWell: retry shortly.

## Local development

### The local model shows "starting"

On the first run, the llama.cpp container downloads Qwen2.5 0.5B Instruct, which takes a minute or more depending on your connection. Follow it with:

```bash
docker compose logs -f llamacpp
```

When the server prints that it's listening, DockWell marks the model **ready** within about 30 seconds. If the container keeps restarting, check that Docker has enough memory and that Hugging Face is reachable from your network.

### Emails don't arrive

Locally, emails never reach a real inbox: they're caught by **Mailpit** at `http://localhost:31825`. On a server, open **Admin > Settings**, check the email status (pending and failed messages) and select **Send test email**. Check `SMTP_HOST`, `SMTP_PORT`, the username and password, and use either `SMTP_STARTTLS=true` (port 587) or `SMTP_TLS=true` (port 465), not both. Failed emails are retried automatically.

### Port already in use

Another program is using one of DockWell's ports (31180, 31100, 31432, 31025, 31825, 31800). Find it with `lsof -i :31180` (Linux and macOS) or `netstat -ano | findstr 31180` (Windows), and stop it, or change DockWell's port as described in [Running locally](/docs/running-locally#changing-ports). An older DockWell stack still running in Docker is a common cause: `docker compose down` stops it.

### I forgot the development admin password

It's `SEED_ADMIN_PASSWORD` in `backend/.env`. Change it there and restart the API, and the account's password is reset to the new value.

## Payments

### I paid, but no credits were added

Credits are added only when Stripe's **webhook** reaches DockWell, never from the redirect after payment.

- **Locally**: `stripe listen --forward-to localhost:31100/api/stripe/webhook` must be running, and `STRIPE_WEBHOOK_SECRET` must be the `whsec_...` it printed. Restart the API after changing it.
- **On a server**: the webhook endpoint in Stripe must be `<APP_URL>/api/stripe/webhook` with all the required events, and `STRIPE_WEBHOOK_SECRET` must be that endpoint's signing secret. Stripe's dashboard shows failed deliveries.
- Check **Admin > Settings**, which shows when the last webhook arrived.

Stripe retries failed webhooks, and DockWell credits each payment exactly once, so credits appear as soon as the webhook gets through.

### How do I switch from test to live payments?

Replace `STRIPE_SECRET_KEY` with your `sk_live_...` key, create a live-mode webhook endpoint and put its signing secret in `STRIPE_WEBHOOK_SECRET`, then restart the API. No code changes. See [Self-hosting](/docs/self-hosting#7-set-up-stripe-in-live-mode).

## Self-hosting

### GPU not visible in containers

If `docker run --rm --gpus all ubuntu nvidia-smi` fails, or vLLM logs say no CUDA device was found:

1. Check `nvidia-smi` works on the host. If not, install or fix the NVIDIA driver.
2. Install the **NVIDIA Container Toolkit**, then run `sudo nvidia-ctk runtime configure --runtime=docker` and `sudo systemctl restart docker`.
3. Try the test command again.

On a server without an NVIDIA GPU, use the `cpu` profile instead.

### A deployment is stuck on "downloading" or fails

Open its logs in **Admin > Deployments**. Common causes:

- **Gated model**: accept the licence on Hugging Face and save a token under **Admin > Settings > Hugging Face token**, then restart the deployment.
- **Out of GPU memory**: lower the context length or the GPU memory share, use a quantized model, or add GPUs.
- **Disk full**: model weights are large. Free space or grow the disk.

### The System health page shows no GPU metrics

Set `PROMETHEUS_URL=http://prometheus:9090` in `.env.prod`, start with the `gpu` profile (which runs the DCGM exporter) and restart the API.

### How do I back up DockWell?

Back up the PostgreSQL database with `pg_dump` and keep a copy of `.env.prod`, especially `ENCRYPTION_KEY`. See [Self-hosting](/docs/self-hosting#backups).
