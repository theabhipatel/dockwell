The model catalogue is the list of models a DockWell install offers. Platform admins decide which models are in it, where they run and what they cost. This page explains what you see for each model and how deprecation and pricing work.

## Where to find the catalogue

| Place | Shows |
|---|---|
| The public **Models** and **Pricing** pages | Every public model with its context length, capabilities and price. No account needed. |
| The playground's model picker | The models your workspace can use, with price and context length. |
| `GET /v1/models` | The models **your key** can use, with pricing for your workspace. See [Chat completions](/docs/chat-completions#listing-models). |

The lists can differ: an admin can make a model visible only to selected workspaces, a key can be limited to some models, and a workspace can have custom prices.

## What each model has

| Property | Example | Meaning |
|---|---|---|
| **Id** | `qwen2.5-0.5b-instruct` | The value for the `model` field. Stable, chosen by the admin. |
| **Name** | Qwen2.5 0.5B Instruct | A friendly display name. |
| **Owned by** | Alibaba | Who made the model. |
| **Context length** | 4096 | The most tokens the model handles in one request, input and output together. |
| **Max output tokens** | 2048 | The most tokens it may generate in one reply, if the admin set a limit. |
| **Capabilities** | chat, completions, tools | What it can do. See below. |
| **Price** | $0.10 / $0.20 per 1M tokens | Input and output price. |
| **Status** | ready | Whether it accepts requests right now. |

### Capabilities

| Capability | Means | Used by |
|---|---|---|
| `chat` | Chat-style conversations with messages | `POST /v1/chat/completions` |
| `completions` | Plain text completion from a prompt | `POST /v1/completions` |
| `tools` | Function calling with `tools` | Chat completions with `tools` |
| `vision` | Accepts images in messages | Chat completions with `image_url` parts |
| `embeddings` | Turns text into vectors | `POST /v1/embeddings` |

A request that needs a capability the model doesn't have gets a `400` error that names the problem, for example "`my-model` does not support tools."

### Context length

The context length covers your input (all messages, tool definitions and images) **plus** the output. If you don't set `max_tokens`, DockWell fills it in so it fits in the room left after your input. If your input alone is longer than the context, the engine rejects the request with a `400` error.

### Status

| Status | Meaning |
|---|---|
| `ready` | Accepting requests. |
| `downloading` | The engine is downloading the model weights. |
| `starting` | The engine is loading the model, or isn't reachable yet. |
| `failed` | The engine stopped with an error. An admin needs to check the engine logs. |
| `stopped` | An admin stopped the engine. |

Only `ready` models appear in `GET /v1/models`. Calling a model that isn't ready returns `503 model_unavailable`. See [Errors](/docs/errors).

## Pricing

Prices are set per model, in US dollars **per 1 million tokens**, separately for input and output:

| Price part | Meaning |
|---|---|
| **Input price** | Per 1M prompt tokens (your messages, tools and images). |
| **Output price** | Per 1M generated tokens. |
| **Cached input price** | Optional. Used for input tokens the engine reports as served from its cache. |
| **Minimum charge** | Optional. The least a successful request with any tokens costs. |
| **Free** | The model costs nothing. A model without any price is also free until an admin sets one. |

### Working out a cost

DockWell computes costs with exact integer arithmetic in micro-dollars and rounds each part **up** to the next micro-dollar.

For 1,000 input tokens and 500 output tokens on a model priced at $0.10 input and $0.20 output per 1M:

| Part | Calculation | Cost |
|---|---|---|
| Input | 1,000 x $0.10 / 1,000,000 | $0.000100 |
| Output | 500 x $0.20 / 1,000,000 | $0.000100 |
| **Total** | | **$0.000200** |

The exact charge for every request is in the `x-dockwell-cost-usd` header (non-streamed requests), in the request log and in the credit ledger.

### Price changes

When an admin changes a price, the new price takes effect **now or at a future date** they choose. A price can never be backdated, and past charges never change. The public pricing page always shows the price in force right now.

### Custom prices for a workspace

A platform admin can give a workspace a discount (a percentage off every price) or a custom input and output price, for all models or for one model. `GET /v1/models` and the playground show your workspace's own prices.

## Deprecation and retirement

Models change over time. When an admin plans to remove one, they **deprecate** it, usually with a **retirement date**:

1. **Deprecated.** The model keeps working. It's marked `deprecated: true` in `GET /v1/models`, with its `retirement_date`.
2. **Notified.** Workspaces that used the model in the last 30 days get a notification (in-app and by email) for members who manage API keys, saying when it will be retired.
3. **Retired.** From the retirement date, requests get `404` with the code `model_retired`, and the model disappears from the catalogue. Shortly after, housekeeping switches the model off, and requests then get `404 model_not_found`. Treat both codes the same way.

> [!TIP]
> Check `deprecated` and `retirement_date` in `GET /v1/models` from a scheduled job or your CI, so a retirement never surprises you.

An admin can also undo a deprecation before the retirement date.

## Default models in each mode

What you see depends on how the install is set up:

| Mode | Models out of the box |
|---|---|
| Local development | `qwen2.5-0.5b-instruct` on llama.cpp (context 4096, max output 2048, $0.10 / $0.20 per 1M) |
| Public demo | Groq models from `GROQ_MODELS`, by default `llama-3.1-8b-instant` ($0.05 / $0.08 per 1M) and `llama-3.3-70b-versatile` ($0.59 / $0.79 per 1M), both with a 131,072 token context |
| Self-hosted | Whatever the admin deploys with vLLM or attaches as a provider |

Admins can change any of these prices, or add and remove models, at any time. See the [Admin guide](/docs/admin-guide).
