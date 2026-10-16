This page explains the building blocks of DockWell and how they relate to each other. Once you know them, the rest of the docs and the app itself are easy to follow.

## The big picture

```text
Platform (one DockWell install, run by platform admins)
 |-- Models and providers   (what can be called, where it runs, what it costs)
 |-- Users                  (people with an account)
 `-- Workspaces             (credits, billing, members, roles)
      `-- Projects          (API keys, usage, limits)
           `-- API keys     (authenticate requests to /v1)
```

## Workspaces

A **workspace** is your team or organisation, like an organisation on OpenAI's platform. It's the unit that pays.

- **Credits, billing and spend limits belong to the workspace.** Every request made with any of its keys, or in its playground, is charged to its balance.
- It has **members**, each with a **role** (Owner, Admin, Manager, Member or a custom role).
- It has an **activity log** of who did what.
- It has settings for data retention and prompt logging.

A user can belong to many workspaces and switch between them with the workspace switcher. Each user can own up to 20 workspaces. See [Workspaces and roles](/docs/workspaces-and-roles).

## Projects

A **project** groups API keys inside a workspace, for example one per application or environment (`web-app`, `staging`, `batch-jobs`).

- **API keys belong to a project.** Revoking access to a project or deleting it stops all its keys.
- **Usage is tracked per project**, so you can see what each application costs.
- **Limits can be set per project**: requests per minute, tokens per minute and a monthly spend limit.
- **Project access** decides which members can see a project. Members only see projects they're assigned to, unless their role has **Access all projects**.

Every workspace starts with a **Default project**, which can't be deleted. A project can be **archived**: its keys stop working (requests get `project_archived`) until it's unarchived.

## API keys

An **API key** is a secret that starts with `dw-`. It authenticates requests to the OpenAI-compatible API under `/v1`.

- It's shown **once**, when you create it. DockWell stores only a hash.
- It belongs to one project, and usage made with it is attributed to the member who created it.
- It can have its own expiry date, list of allowed models, lifetime spend limit and rate limits.

See [Authentication and API keys](/docs/authentication).

## Models and providers

A **model** is something you can call through the API. Each model has:

| Property | Example | Notes |
|---|---|---|
| Public id | `qwen2.5-0.5b-instruct` | What you put in the `model` field. |
| Context length | `4096` | Maximum tokens of input plus output. |
| Capabilities | `chat`, `completions`, `tools` | Also `vision` and `embeddings`. |
| Price | $0.10 input / $0.20 output per 1M tokens | Set by the platform admin. |
| Status | `ready` | Or `downloading`, `starting`, `failed`, `stopped`. Only `ready` models accept requests. |

A **provider** is where a model actually runs:

| Provider kind | Typical use |
|---|---|
| **vLLM** | Self-hosted on NVIDIA GPUs. Admins can deploy models from the browser. |
| **llama.cpp** | CPU inference: local development and small CPU-only servers. |
| **Groq** | The public demo. |
| **OpenAI-compatible** | Any other endpoint that speaks the OpenAI API, attached by an admin with a URL and key. |

The gateway treats every provider the same way, because they all speak the OpenAI API format. See [Models](/docs/models).

## Credits and money

DockWell is **pay-as-you-go**. A workspace buys credits in US dollars and requests draw them down at each model's price.

All money is stored as **exact integers in micro-dollars**, never as floating point numbers:

| Amount | Micro-dollars |
|---|---|
| $1.00 | `1000000` |
| $0.01 (one cent) | `10000` |
| $0.000001 | `1` |

Prices are set in micro-dollars per 1M tokens. The cost of a request is calculated with integer arithmetic and rounded **up** to the next micro-dollar, so rounding never undercharges and never drifts. For example, 1,234 input tokens at $0.10 per 1M cost exactly `ceil(1234 * 100000 / 1000000)` = 124 micro-dollars, or $0.000124.

See [Billing and credits](/docs/billing-and-credits).

## The gateway

Every request, from your code or from the playground, passes through DockWell's **metering gateway** before it reaches an engine:

1. **Authenticate.** The API key (or the signed-in user, in the playground) is checked, and the key, project and workspace must be active.
2. **Check the model.** It must exist, be enabled, be ready, be visible to your workspace and be allowed for your key.
3. **Apply limits.** Rate limits at the key, project, workspace and platform level, plus spend limits.
4. **Reserve.** The most the request could cost (an input estimate plus the maximum output tokens) is held against the balance in one atomic update. Parallel requests can never overspend.
5. **Forward.** The request goes to the engine and the reply streams back to you.
6. **Charge.** When the reply finishes, the real token usage is read and the **exact** cost is charged. The rest of the reservation is released.
7. **Record.** The request log and usage rollup are written, and alerts or auto recharge are triggered if needed.

Two rules follow from this:

- **A failed request is not charged.** If the engine errors out before producing anything, the reservation is released in full.
- **A request cancelled mid-stream is charged for what was generated.** If you close the connection halfway, you pay for the tokens produced so far, not for the full `max_tokens`.

## Playground

The **playground** is a chat interface for trying models in the browser. It uses the same gateway as the API, so it's charged to the workspace (to the project you pick, or the default project) at the model's price. Conversations are saved per user.

## Platform admins

**Platform admins** run the DockWell install. They manage users, workspaces, models, pricing and platform settings in the admin area. This is separate from workspace roles: a workspace Owner isn't a platform admin, and a platform admin doesn't automatically belong to every workspace. The first admin comes from the `ADMIN_EMAILS` setting. See the [Admin guide](/docs/admin-guide).
