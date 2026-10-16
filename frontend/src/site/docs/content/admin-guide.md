The admin area is for **platform admins**: the people who run a DockWell install. It's separate from workspace roles. A workspace Owner isn't a platform admin, and a platform admin doesn't automatically belong to any workspace. This page walks through every section of the admin area.

## Getting access

- The **first admin** comes from the `ADMIN_EMAILS` setting. Anyone who signs in with one of those addresses is made a platform admin. See [Self-hosting](/docs/self-hosting#5-create-the-first-admin).
- Existing admins can **promote** other users from **Admin > Users**, and demote them again. You can't remove your own admin access.
- Open the admin area from the user menu. Only platform admins can reach it, and every admin page checks this on the server.

Every admin action is recorded in the [Admin audit log](#admin-audit-log).

## Overview

The **Overview** page shows the health of the business at a glance:

| Figure | Meaning |
|---|---|
| Users | Total, active in the last 30 days, new in the last 7 days. |
| Workspaces | Total number. |
| Revenue | Last 30 days and all time, from Stripe payments. |
| Credits | Sold, granted for free, used, and the outstanding balance across all workspaces. |
| Requests and tokens | Today and over 30 days, with errors and average latency. |
| Top models and top workspaces | By requests, tokens and cost. |

A daily chart shows requests, errors, tokens, cost and revenue over time.

## Users

**Admin > Users** lists every account. Search and filter, then open a user to see their workspaces and balances, 30-day usage, payments, recent activity and number of active sessions.

| Action | Effect |
|---|---|
| **Create user** | Add an account by hand, with an optional password and admin rights. Useful when sign-up is closed. |
| **Suspend / unsuspend** | A suspended user can't sign in, and their sessions end. You can record a reason. |
| **Force sign out** | Ends all of the user's sessions. |
| **Reset two-factor** | Turns off 2FA for someone who lost their authenticator and backup codes. |
| **Mark email verified** | Verifies the address by hand. The starter credit is granted if it's still due. |
| **Promote / demote admin** | Gives or removes platform admin rights. |
| **Delete** | Deletes the account. Delete your own account from your account settings instead. |

## Workspaces

**Admin > Workspaces** lists every workspace with its owner, members, balance and status. Open one to see its members, balance, saved card and usage.

### Suspending

A suspended workspace can't make requests: the API returns `403 workspace_suspended`. Unsuspend it to restore access.

### Granting or deducting credits

1. Open the workspace and select **Adjust credits**.
2. Enter a positive amount to grant or a negative amount to deduct.
3. Enter a **reason** (at least 3 characters).

The adjustment appears in the workspace's credit ledger as **Admin grant** or **Admin deduction** with your reason, and in the admin audit log. Use it for goodwill credit, promotions or corrections. To return money paid by card, issue a [refund](#billing) instead.

### Custom limits

Set a workspace's own **requests per minute**, **tokens per minute** and **monthly spend limit**. Leave a field empty to use the platform default. This is how you match limits to a customer's plan.

### Custom prices and discounts

Give a workspace special pricing, for all models or for one model:

| Option | Effect |
|---|---|
| **Discount** | A percentage off the list price (input, output, cached input and minimum charge). 100 percent makes it free. |
| **Custom price** | A fixed input and/or output price per 1M tokens, replacing the list price. |

A model-specific entry wins over a workspace-wide one. The workspace sees its own prices in the playground and in `GET /v1/models`.

## Models and providers

**Admin > Models** manages what users can call.

### Providers

A provider is where models run. Add one with **Add provider**:

| Kind | Use |
|---|---|
| vLLM | A vLLM server you run, such as the bundled `vllm` service at `http://vllm:8000/v1`. |
| llama.cpp | A llama.cpp server. |
| Groq | Groq's API (registered automatically when `GROQ_API_KEY` is set). |
| OpenAI-compatible | Any other endpoint that speaks the OpenAI API. |

Enter a base URL ending in `/v1` and, if needed, an API key (stored encrypted and never shown again, only a hint). **Check connection** lists the provider's models, so you can **import** the ones you want with a starting price. DockWell checks unmanaged providers about every 30 seconds and shows the last result. Switching a provider off makes all its models unavailable.

### Model settings

For each model you can set:

| Setting | Notes |
|---|---|
| Public id | What users put in `model`. Letters, digits and `. _ : / @ -`. |
| Upstream id | The name the engine knows the model by. |
| Display name, description, owned by | Shown in the catalogue. |
| Context length, max output tokens | Used for validation and for the default `max_tokens`. |
| Capabilities | `chat`, `completions`, `tools`, `vision`, `embeddings`. Requests needing a missing capability are refused. |
| Enabled | Disabled models disappear from the catalogue. |
| Visibility | **All workspaces**, or only **selected workspaces**. |
| Sort order | Position in lists. |

### Deprecating a model

Select **Deprecate** and pick a retirement date. Workspaces that used the model in the last 30 days are notified. On the retirement date the model stops accepting requests (`model_retired`) and is switched off. You can undo a deprecation before then. See [Models](/docs/models#deprecation-and-retirement).

## Deployments

With the engine manager on (`ENGINE_MANAGER=docker`), **Deploy model** starts a new vLLM or llama.cpp engine from a Hugging Face id. **Admin > Deployments** lists every engine with its status (`downloading`, `starting`, `ready`, `failed`, `stopped`), and lets you **start**, **stop**, **restart**, **delete** and view **logs**. The full walkthrough, including every engine option, is in [Self-hosting](/docs/self-hosting#deploying-models-from-the-browser).

A model created by a deployment is removed by deleting its deployment, not the model.

## Pricing

Every model has a price history. Add a price with:

| Field | Notes |
|---|---|
| Input price per 1M tokens | In US dollars. |
| Output price per 1M tokens | In US dollars. |
| Cached input price per 1M tokens | Optional, for cached prompt tokens reported by the engine. |
| Minimum charge per request | Optional. |
| Free | Makes the model free. |
| Effective from | Now, or a date in the future. |

A price can only take effect **now or later**, never in the past, so **past charges never change**. Scheduling a future price lets you announce changes in advance. A model with no price at all is free until you set one.

## Platform settings

**Admin > Settings** holds every runtime setting. Changes apply within a few seconds without a restart. Defaults are listed in the [Configuration reference](/docs/configuration#platform-settings-in-the-database).

| Group | Settings |
|---|---|
| Accounts | Sign-up on or off, Google sign-in on or off, require email verification. |
| Starter credit | On or off, and the amount (default $3.00). |
| Credit purchases | Top-up presets, minimum and maximum top-up, auto recharge allowed. |
| Default limits | Workspace RPM and TPM, workspace monthly spend limit for new workspaces, key RPM and TPM, platform RPM. |
| Data | Prompt and response logging allowed (off by default), log retention in days (default 30). |
| Abuse controls | Blocked email domains (and their subdomains) for sign-up, blocked IPs and CIDR ranges. |
| Maintenance | Maintenance mode and its message. While on, API and playground requests get `503 maintenance`. |
| Announcement | A site-wide banner with a message, level (info, warning, critical) and optional link. |
| Branding | Platform name and logo. |
| Hugging Face token | For gated models, stored encrypted. |

### Service status

The same page shows the status of each service:

| Service | Shows |
|---|---|
| Database | Whether PostgreSQL is reachable. |
| Email | The SMTP server, and how many emails are pending or failed in the outbox. **Send test email** sends a message to check delivery. |
| Stripe | Test mode, live mode or not configured, and when the last webhook arrived. |
| Google | Whether Google sign-in is configured. |
| Engine manager | Whether Docker is reachable for deployments. |

## Billing

**Admin > Billing** covers payments across every workspace:

- **Payments**: every checkout and auto recharge with its status, filterable, with CSV export. Failed payments show Stripe's reason.
- **Refunds**: open a completed payment and select **Refund**, for the full remaining amount or part of it, with a reason. The refund is issued through Stripe. When Stripe confirms it by webhook, the credits are removed from the workspace and recorded in its ledger. Refunds made in the Stripe dashboard are handled the same way.
- **Ledger**: every credit movement across all workspaces.
- **Revenue**: totals, refunds, number of payments and failures, with a daily chart.

## Usage and logs

**Admin > Usage** and **Admin > Logs** show platform-wide usage and request logs with the same filters users have (date, project, key, model, member, source, status, search), plus filtering and grouping **by workspace**. Usage exports to CSV. Prompt content appears in log details only when it was stored under the logging rules.

## System health

**Admin > System health** is the operator's live view:

| Section | Shows |
|---|---|
| Engines | Each provider's status, its models, requests running and waiting, KV cache usage and tokens per second (from the engine's own metrics). |
| GPUs | Utilisation and memory per GPU, from Prometheus and NVIDIA's DCGM exporter. Requires `PROMETHEUS_URL`. |
| Traffic | Requests in flight, requests and errors in the last 5 minutes, error rate, tokens per second and average latency. |
| Database | Reachability and query latency. |
| Email | Pending and failed messages in the outbox. |

For deeper history, use Grafana on port 31030. See [Self-hosting](/docs/self-hosting#monitoring).

## Admin audit log

**Admin > Audit log** is an append-only record of every admin action: who did it, what they did, to which user, workspace, model or setting, when, and from which IP address. It covers user changes, credit adjustments, limit and price changes, model and provider changes, deployments, settings changes and refunds. It can't be edited or deleted from the app.
