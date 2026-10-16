Every request to the OpenAI-compatible API under `/v1` is authenticated with an **API key**. This page explains how to send it, how keys are created and stored, and the options you can set on each key.

## Sending your key

Send the key in the `Authorization` header with the Bearer scheme, exactly as with OpenAI:

```bash
curl https://dockwell.example.com/v1/models \
  -H "Authorization: Bearer dw-your-key-here"
```

The OpenAI SDKs do this for you when you pass `api_key`:

```python
from openai import OpenAI

client = OpenAI(base_url="https://dockwell.example.com/v1", api_key="dw-your-key-here")
```

The `/v1` API doesn't use cookies or CSRF tokens, so you can call it from any server, script or tool. Don't call it from a public web page: anyone could read the key from the browser.

If the header is missing, malformed or the key is wrong, you get `401` with the code `invalid_api_key`:

```json
{
  "error": {
    "message": "Incorrect API key provided. You can find your API keys in your workspace settings.",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}
```

## Key format and storage

| Property | Value |
|---|---|
| Format | `dw-` followed by 43 random URL-safe characters |
| Shown | **Once**, right after you create the key |
| Stored | Only a SHA-256 hash. The key itself is never stored or logged. |
| Displayed afterwards | The first 10 characters and the last four, for example `dw-Xk3pQ9a...7fZq` |

> [!WARNING]
> Nobody can show you a key again, not even a platform admin. If you lose a key, revoke it and create a new one.

Keep keys out of source control. Load them from an environment variable or a secret manager:

```bash
export DOCKWELL_API_KEY="dw-your-key-here"
```

## Creating a key

1. In the sidebar, select **API keys**.
2. Select **Create key**.
3. Choose the **Project**. You can only pick projects you have access to.
4. Enter a **Name** that tells you where the key is used, for example `billing-service-prod`.
5. Optionally set any of the per-key options below.
6. Select **Create**, then copy the key.

A project can have up to 200 active keys.

## Per-key options

Every option is optional. Leave it empty for no restriction. You can change them later, except the project.

| Option | What it does | Error when it applies |
|---|---|---|
| **Expiry date** | The key stops working at this date and time. It must be in the future. The key's creator gets a notification 3 days before. | `401 invalid_api_key` ("This API key has expired.") |
| **Allowed models** | The key can only call these model ids. `GET /v1/models` lists only them. | `403 model_not_allowed` |
| **Spend limit** | A lifetime cap, in US dollars, on what this key can spend. | `429 key_spend_limit_reached` |
| **Requests per minute** | Most requests this key can start in a minute. | `429 rate_limit_exceeded` |
| **Tokens per minute** | Most tokens (input plus output) this key can use in a minute. | `429 rate_limit_exceeded` |

When you don't set a rate limit on a key, the platform's default key limits apply, if the admin has set any. Project and workspace limits always apply on top. See [Rate limits](/docs/rate-limits).

> [!TIP]
> Give each application its own key with a spend limit and only the models it needs. If a key leaks, the damage is capped, and you can revoke it without touching anything else.

## What you can see about a key

The **API keys** page lists, for each key:

- its name, project and displayed prefix;
- who created it and when;
- when it was last used;
- its expiry, allowed models, spend limit (with the amount spent so far) and rate limits;
- its status: **active**, **revoked** or **expired**.

Usage made with a key is attributed to the member who created it, so the usage page can group by member as well as by key.

## Revoking and deleting

| Action | Effect |
|---|---|
| **Revoke** | The key stops working immediately. It stays in the list as **revoked**, so you can still see its history. |
| **Delete** | The key is removed from the list. It stops working immediately. Past usage and request logs keep their records. |

Both actions are recorded in the workspace's activity log. Deleting or archiving a project also stops all of its keys.

## Permissions: own keys and all keys

Two permissions control who can manage keys. See [Workspaces and roles](/docs/workspaces-and-roles) for the full permission table.

| Permission | Allows |
|---|---|
| **Manage own API keys** (`keys.manage_own`) | Create keys in projects you can access, and revoke, edit or delete keys **you** created. |
| **Manage all API keys** (`keys.manage_all`) | Create, edit, revoke and delete **any** key in projects you can access. |

With the default roles, **Members** manage their own keys, while **Managers**, **Admins** and the **Owner** manage all keys in the projects they can access.

## Authentication in the web app

The web app itself doesn't use API keys. It uses a session cookie after you sign in, with CSRF protection on every change. The playground runs requests on your behalf as the signed-in user, charged to the workspace. Sessions, two-factor authentication and Google sign-in are covered in [Workspaces and roles](/docs/workspaces-and-roles#account-security).
