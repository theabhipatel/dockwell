DockWell protects every install and every workspace with two kinds of limits: **rate limits**, which cap how fast you can send requests, and **spend limits**, which cap how much money can be spent. This page explains both, where they're set and what happens when you hit one.

## Rate limits

Rate limits count **requests per minute** (RPM) and **tokens per minute** (TPM). They apply at four levels, and a request must fit within every level that has a limit:

| Scope | Who sets it | Default |
|---|---|---|
| **Key** | Whoever manages the key, on the key's settings | Platform default for keys (none, unless the admin sets one) |
| **Project** | Members who can edit the project | None |
| **Workspace** | Platform admins, per workspace | Platform default for workspaces: 600 RPM and 1,000,000 TPM |
| **Platform** | Platform admins | No limit (RPM only) |

A level without a limit doesn't restrict anything. The platform-wide limit protects the whole install, for example when GPUs are shared by many customers.

> [!NOTE]
> The playground isn't tied to an API key, so key limits don't apply there. Project, workspace and platform limits do.

### How they're counted

- Limits use **one-minute windows**. A window starts with the first request and resets a minute later.
- **Requests** are counted when a request starts.
- **Tokens** (input plus output) are counted when a request finishes, using the real usage. A new request is refused once the tokens already used in the current window reach the TPM limit.
- Counters live in PostgreSQL, so they hold across API restarts, across several API processes and in serverless mode.

Because tokens are counted at the end, a single large request can take you over a TPM limit. The next requests in that window are then refused until it resets.

### When you hit a rate limit

You get HTTP `429` with the code `rate_limit_exceeded`, and a `Retry-After` header that says how many seconds until the window resets:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 23
Content-Type: application/json

{
  "error": {
    "message": "Rate limit reached for this key. Please try again in 23s.",
    "type": "requests",
    "param": null,
    "code": "rate_limit_exceeded"
  }
}
```

The message names the scope that was hit: `key`, `project`, `workspace` or `platform`. Wait for `Retry-After` seconds, then retry. The OpenAI SDKs do this automatically. See [Errors](/docs/errors#retrying).

## Spend limits

Spend limits cap money rather than speed. They're checked **before** a request runs, against the most the request could cost (its reservation), so a limit can't be overshot by requests running in parallel.

| Limit | Scope | Period | Who sets it | Error |
|---|---|---|---|---|
| **Key spend limit** | One API key | Lifetime of the key | Whoever manages the key | `429 key_spend_limit_reached` |
| **Project monthly limit** | One project | Calendar month (UTC) | Members who can edit the project | `429 project_spend_limit_reached` |
| **Workspace monthly limit** | The whole workspace | Calendar month (UTC) | Members with **Manage billing** (and platform admins) | `429 spend_limit_reached` |

All three return `"type": "insufficient_quota"`. Monthly limits reset at the start of each calendar month in UTC.

### Key spend limit

A lifetime cap on what one key can spend. The key's page shows how much it has spent so far. When the next request could push it over the cap, the request is refused. Raise the limit, or create a new key.

### Project monthly limit

Caps what one project can spend in a calendar month, for example to keep a staging environment cheap. It's set on the project's settings, next to the project's RPM and TPM limits.

### Workspace monthly limit and alert

Set on the **Billing** page by members with **Manage billing**:

| Setting | Effect |
|---|---|
| **Monthly spend limit** | A hard stop. When it's reached, every API and playground request in the workspace is refused until next month or until the limit is raised. People with **Manage billing** get a notification the first time it happens in a month. |
| **Alert threshold** | A warning. When spend this month passes it, people with **Manage billing** get an email and an in-app notification, once per month. Requests keep working. |

A platform admin can give new workspaces a default monthly limit, and can set a custom limit on any workspace.

> [!TIP]
> Set the alert threshold to around 80 percent of your monthly limit, so you have time to react before requests stop.

## The balance is a limit too

Apart from these limits, a workspace can only spend the credit it has. When the available balance can't cover a request's reservation, the request gets `429 insufficient_quota`. See [Billing and credits](/docs/billing-and-credits).

## Order of checks

For each request, DockWell checks in this order. The first one that fails decides the error:

1. Maintenance mode, the key, the workspace (suspended?) and the project (archived?).
2. The model: exists, visible, not retired, ready, allowed for the key, has the needed capability.
3. Key spend limit, then project monthly limit.
4. Rate limits at every scope.
5. The balance and the workspace monthly limit, in one atomic reservation.

## Choosing limits

| Situation | Suggested setup |
|---|---|
| A script you're testing | A key with a small spend limit, for example $5. |
| A production service | Its own project with a monthly limit, and a key per environment with a spend limit and only the models it needs. |
| A shared team workspace | A workspace monthly limit with an alert at 80 percent, and project limits for experiments. |
| Selling access to customers | Per-workspace RPM and TPM limits set by an admin to match each customer's plan. |
