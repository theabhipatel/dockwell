When a request to `/v1` fails, DockWell answers with OpenAI's error format and a matching HTTP status code, so the OpenAI SDKs raise their usual exceptions. This page lists every error code DockWell returns, what it means and what to do about it.

## Error format

Every error has the same JSON shape:

```json
{
  "error": {
    "message": "You've run out of credits. Add credits to your workspace to continue.",
    "type": "insufficient_quota",
    "param": null,
    "code": "insufficient_quota"
  }
}
```

| Field | Meaning |
|---|---|
| `message` | A human-readable explanation. Safe to show to a developer. It never contains keys or secrets. |
| `type` | The broad category: `invalid_request_error`, `permission_error`, `insufficient_quota`, `requests` or `server_error`. |
| `param` | The request field at fault, such as `model`, `messages` or `max_tokens`, when there is one. |
| `code` | A stable, machine-readable code. Match on this in your code, not on `message`. |

## Status codes and error codes

### 400 Bad request

The request itself is wrong. Fix it before retrying. `code` is `null` and `param` usually names the field.

| Example message | Cause |
|---|---|
| You must provide a model parameter. | `model` is missing. |
| messages must be a non-empty array. | `messages` is missing or empty. |
| `my-model` does not support tools. | `tools` sent to a model without the `tools` capability. |
| `my-model` does not accept images. | Images sent to a model without `vision`. |
| `my-model` is not an embedding model. | `/v1/embeddings` with a chat model. |
| `my-model` does not support text generation. | Chat or completions with an embedding model. |
| max_tokens is too large: this model allows at most 2048. | `max_tokens` above the model's maximum output. |
| n must be between 1 and 16. | `n` out of range. |
| We could not parse the JSON body of your request. | The body isn't valid JSON. |

Errors the engine itself rejects (for example an input longer than the context window) are also returned as `400`, with the engine's message.

### 401 Unauthorized

| Code | Cause | Fix |
|---|---|---|
| `invalid_api_key` | No `Authorization: Bearer` header, an unknown or revoked key, or an expired key ("This API key has expired."). | Check the key, or create a new one. See [Authentication](/docs/authentication). |

### 403 Forbidden

| Code | Cause | Fix |
|---|---|---|
| `model_not_allowed` | The key's **allowed models** list doesn't include this model. | Use an allowed model, or edit the key. |
| `workspace_suspended` | A platform admin suspended the workspace. | Contact the platform admin. |
| `project_archived` | The key's project is archived. | Unarchive the project, or use a key from another project. |
| `ip_blocked` | Your IP address is on the platform's block list. | Contact the platform admin. |

### 404 Not found

| Code | Cause | Fix |
|---|---|---|
| `model_not_found` | The model doesn't exist, is switched off, or isn't visible to your workspace. | Check the id with `GET /v1/models`. |
| `model_retired` | The model passed its retirement date. | Move to another model. See [Models](/docs/models#deprecation-and-retirement). |

### 413 Request too large

The body is larger than 32 MB (4.5 MB on the Vercel demo). Send less data, for example smaller images.

### 429 Too many requests

Two different situations share this status. Look at `code` to tell them apart.

| Code | Type | Cause | Fix |
|---|---|---|---|
| `rate_limit_exceeded` | `requests` | A requests or tokens per minute limit was hit at the key, project, workspace or platform level. | Wait for the `Retry-After` header's seconds, then retry. |
| `insufficient_quota` | `insufficient_quota` | The workspace's available balance can't cover the request. | Add credits on the **Billing** page. Retrying won't help until then. |
| `spend_limit_reached` | `insufficient_quota` | The workspace's monthly spend limit is reached. | Raise the limit on the **Billing** page, or wait for next month. |
| `key_spend_limit_reached` | `insufficient_quota` | The key's lifetime spend limit is reached. | Raise the key's limit, or use another key. |
| `project_spend_limit_reached` | `insufficient_quota` | The project's monthly spend limit is reached. | Raise the project's limit, or wait for next month. |

> [!NOTE]
> Credit and spend checks use the **most** a request could cost, not its final cost. A request with a large `max_tokens` can be refused even when the balance would cover what it actually generates. Lower `max_tokens` to make the reservation smaller. See [Billing and credits](/docs/billing-and-credits#reservations).

### 503 Service unavailable

The request was fine, but the model couldn't serve it right now. These are safe to retry.

| Code | Cause | Fix |
|---|---|---|
| `model_unavailable` | The model isn't ready (downloading, starting, stopped or failed), its provider is switched off, or the engine couldn't be reached or returned an error. | Retry with backoff. If it persists, tell the platform admin. |
| `model_overloaded` | The engine or upstream provider is rate limiting DockWell (it answered `429`). | Retry after a short wait. |
| `maintenance` | The platform is in maintenance mode. The message is the admin's maintenance message. | Retry later. |

### Errors inside a stream

If the engine fails after a streamed response has started, the HTTP status is already `200`. DockWell then sends the error as a final SSE event with the code `upstream_stream_error`:

```text
data: {"error":{"message":"The model stopped responding.","type":"server_error","param":null,"code":"upstream_stream_error"}}
```

Treat it like a `503`. See [Streaming](/docs/streaming#errors-during-a-stream).

## What you're charged for errors

**Failed requests aren't charged.** Every error on this page that happens before the model produces output costs nothing, and the reservation is released in full. The only exception is a stream that fails or is cancelled after it started generating: you pay for the output produced up to that point.

## Retrying

| Errors | Retry? |
|---|---|
| `400`, `401`, `403`, `404`, `413` | No. Fix the request, key or model first. |
| `429 rate_limit_exceeded` | Yes, after `Retry-After` seconds. |
| `429` with type `insufficient_quota` | No. A person needs to add credits or raise a limit. |
| `503` and `upstream_stream_error` | Yes, with exponential backoff. |

The OpenAI SDKs retry `429` and `5xx` responses twice by default. You can raise that with `max_retries`:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://dockwell.example.com/v1",
    api_key="dw-your-key-here",
    max_retries=5,
)
```

For your own retry loop, honour `Retry-After` and stop on quota errors:

```python
import time

import openai

def create_with_retry(client, **kwargs):
    for attempt in range(6):
        try:
            return client.chat.completions.create(**kwargs)
        except openai.RateLimitError as exc:
            if exc.type == "insufficient_quota":
                raise
            time.sleep(float(exc.response.headers.get("retry-after", 2 ** attempt)))
        except openai.InternalServerError:
            time.sleep(2 ** attempt)
    raise RuntimeError("Gave up after several retries")
```

## Finding a failed request

Successful responses carry an `x-request-id` header. Search for it under **Logs** in the web app to see the model, tokens, cost, latency and status.

Requests that reached the engine and failed there (`model_unavailable`, `model_overloaded`, engine `400` errors, stream errors) are logged too, with the status **error** and the error message, so you can filter the logs by status to find them. Requests refused before they reach the engine (bad key, unknown model, no credit, rate and spend limits) don't create a log entry.

## Errors in the web app

The web app's own API under `/api` uses a simpler format, `{"detail": "..."}`, and isn't meant to be called directly. If you see "Your session security token is missing. Reload the page and try again.", reload the page. See the [FAQ](/docs/faq).
