This guide takes you from a new account to your first API request in about five minutes. It works the same on the public demo, on a local copy and on your own server. Only the address changes.

## Before you start

You need one of these:

- **The public demo**, for a quick look. Payments there are Stripe test mode, and the data may be reset at any time.
- **A local copy.** Follow [Running locally on CPU](/docs/running-locally) first. The web app then runs at `http://localhost:31180`, and every email it sends lands in Mailpit at `http://localhost:31825` instead of a real inbox.
- **Your own server.** See [Self-hosting on a GPU server](/docs/self-hosting).

The examples below use the local address `http://localhost:31180`. On a server, replace it with your own, for example `https://dockwell.example.com`.

## 1. Create your account

1. Open the home page and select **Get started**.
2. Enter your name, email address and a password of at least 8 characters.
3. Select **Create account**.

If the server has Google sign-in turned on, you can select **Continue with Google** instead. Google has already verified your address, so you skip the next step.

## 2. Verify your email address

1. Open the email with the subject **Verify your email address**. On a local copy, open Mailpit at `http://localhost:31825`.
2. Select the link in the message.

The link expires after 48 hours by default. If it doesn't arrive, request a new one from the **Check your email** page.

> [!NOTE]
> Verification matters for credit: the free starter credit is only granted to verified accounts, to limit abuse.

## 3. Create your workspace

A workspace is your team or organisation. It holds your projects, API keys, credits and billing settings, and you become its **Owner**.

1. Confirm your name.
2. Enter a **Workspace name**, for example your company name. You can rename it later.
3. Select **Create workspace**.

DockWell creates a **Default project** inside it for you, so you can create a key right away.

### Your starter credit

The first time your account creates a workspace after verifying its email, that workspace receives **$3.00 of free credit** by default. The amount, and whether it's offered at all, are set by the platform admin.

- It's granted **once per account, ever**. Creating more workspaces never grants more.
- It's also limited to once per email address, so deleting your account and signing up again doesn't grant it twice.
- It appears in the workspace's credit ledger as **Starter credit**.

## 4. Create an API key

1. In the sidebar, select **API keys**.
2. Select **Create key**.
3. Pick the **Project** (the **Default project** is fine), and enter a **Name**, for example `local-test`.
4. Optionally set an expiry date, allowed models, a spend limit or rate limits. You can leave all of these empty.
5. Select **Create**.
6. Copy the key. It starts with `dw-`.

> [!WARNING]
> The full key is shown **only once**. DockWell stores a hash, never the key itself, so nobody can show it to you again. If you lose it, revoke it and create a new one.

Store the key in an environment variable so it doesn't end up in your code:

```bash
export DOCKWELL_API_KEY="dw-your-key-here"
```

## 5. Make your first request

List the models your key can use:

```bash
curl http://localhost:31180/v1/models \
  -H "Authorization: Bearer $DOCKWELL_API_KEY"
```

Then send a chat completion. On a local copy, the model is `qwen2.5-0.5b-instruct`:

```bash
curl http://localhost:31180/v1/chat/completions \
  -H "Authorization: Bearer $DOCKWELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-0.5b-instruct",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Say hello in three languages."}
    ]
  }'
```

The answer follows OpenAI's format, including a `usage` object with the tokens used. Two extra response headers tell you what happened:

| Header | Example | Meaning |
|---|---|---|
| `x-request-id` | `5f0c2a9e-...` | The id of this request. Search for it in **Logs**. |
| `x-dockwell-cost-usd` | `0.000042` | What this request cost, in US dollars. |

> [!TIP]
> If the model shows as **starting** on a fresh local install, llama.cpp is still downloading the model. Wait a minute and try again. See the [FAQ](/docs/faq).

## 6. Try the playground

1. In the sidebar, select **Playground**.
2. Pick a model in the model picker inside the chat input. Each model shows its price and context length.
3. Type a message and press `Enter`.

Replies stream in, and each one shows the tokens it used and what it cost. Playground usage is **charged to the workspace** at the model's price, the same as API requests. Select **View code** to get the same request as curl, Python or JavaScript.

## 7. Use it from your code

Any OpenAI SDK works. Change only the base URL and the key:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:31180/v1",
    api_key="dw-your-key-here",
)

reply = client.chat.completions.create(
    model="qwen2.5-0.5b-instruct",
    messages=[{"role": "user", "content": "Write a haiku about containers."}],
)
print(reply.choices[0].message.content)
```

## What's next

- Add credits when the starter credit runs low: [Billing and credits](/docs/billing-and-credits).
- Stream replies token by token: [Streaming](/docs/streaming).
- Invite your team: [Workspaces and roles](/docs/workspaces-and-roles).
- Understand how it all fits together: [Core concepts](/docs/core-concepts).
