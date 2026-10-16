DockWell speaks the OpenAI API, so the official OpenAI SDKs work with it out of the box. You change **two things**: the base URL and the API key. Your existing code, prompts and tooling stay the same.

## The two settings

| Setting | Value |
|---|---|
| Base URL | `<your DockWell URL>/v1`, for example `https://dockwell.example.com/v1`, or `http://localhost:31180/v1` locally |
| API key | A DockWell key that starts with `dw-`. See [Authentication and API keys](/docs/authentication). |

The dashboard's quick start card shows your install's exact base URL. Then use a DockWell model id, such as `qwen2.5-0.5b-instruct`, in the `model` field. `GET /v1/models` lists the ids your key can use.

> [!TIP]
> The OpenAI SDKs also read the `OPENAI_BASE_URL` and `OPENAI_API_KEY` environment variables. Setting those is often enough to point an existing app at DockWell without touching its code.

```bash
export OPENAI_BASE_URL="https://dockwell.example.com/v1"
export OPENAI_API_KEY="dw-your-key-here"
```

## Python

Install the SDK:

```bash
pip install openai
```

```python
import os

from openai import OpenAI

client = OpenAI(
    base_url="https://dockwell.example.com/v1",
    api_key=os.environ["DOCKWELL_API_KEY"],
)

reply = client.chat.completions.create(
    model="qwen2.5-0.5b-instruct",
    messages=[
        {"role": "system", "content": "You are a concise assistant."},
        {"role": "user", "content": "Give me three names for a cat."},
    ],
    max_tokens=100,
)

print(reply.choices[0].message.content)
print(reply.usage)
```

The async client works the same way:

```python
from openai import AsyncOpenAI

client = AsyncOpenAI(base_url="https://dockwell.example.com/v1", api_key="dw-your-key-here")
reply = await client.chat.completions.create(
    model="qwen2.5-0.5b-instruct",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

### Reading DockWell's headers

To see the request id and the exact cost, use `with_raw_response`:

```python
raw = client.chat.completions.with_raw_response.create(
    model="qwen2.5-0.5b-instruct",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(raw.headers.get("x-request-id"), raw.headers.get("x-dockwell-cost-usd"))
reply = raw.parse()
```

## JavaScript and TypeScript

Install the SDK:

```bash
npm install openai
```

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://dockwell.example.com/v1",
  apiKey: process.env.DOCKWELL_API_KEY,
});

const reply = await client.chat.completions.create({
  model: "qwen2.5-0.5b-instruct",
  messages: [{ role: "user", content: "Give me three names for a cat." }],
  max_tokens: 100,
});

console.log(reply.choices[0].message.content);
console.log(reply.usage);
```

Run it on a server (Node.js, Deno, Bun, a serverless function), never in a public web page, so your key stays secret.

To read the headers:

```ts
const { data, response } = await client.chat.completions
  .create({ model: "qwen2.5-0.5b-instruct", messages: [{ role: "user", content: "Hi" }] })
  .withResponse();
console.log(response.headers.get("x-dockwell-cost-usd"));
```

## curl

```bash
curl https://dockwell.example.com/v1/chat/completions \
  -H "Authorization: Bearer $DOCKWELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-0.5b-instruct",
    "messages": [{"role": "user", "content": "Give me three names for a cat."}],
    "max_tokens": 100
  }'
```

Add `-i` to see the response headers, including `x-request-id` and `x-dockwell-cost-usd`.

## Frameworks and other tools

Most frameworks and tools that support OpenAI let you set a custom base URL. Point it at DockWell and use a DockWell key and model id.

LangChain, for example, uses the `ChatOpenAI` class with `base_url`:

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="https://dockwell.example.com/v1",
    api_key="dw-your-key-here",
    model="qwen2.5-0.5b-instruct",
)
print(llm.invoke("Explain vector databases in one sentence.").content)
```

The same idea works for LlamaIndex, the Vercel AI SDK's OpenAI-compatible provider, editor plugins, chat UIs and command-line tools: look for a setting called base URL, API base, endpoint or `OPENAI_BASE_URL`.

## What's the same and what differs

| Topic | Behaviour on DockWell |
|---|---|
| Request and response format | Same as OpenAI. |
| Streaming | Same SSE format. The final chunk always includes `usage`. See [Streaming](/docs/streaming). |
| Errors | Same JSON shape and status codes, with DockWell-specific codes. See [Errors](/docs/errors). |
| Models | Open source models chosen by your platform admin, with DockWell ids. |
| Endpoints | Chat completions, completions, embeddings and models. Other OpenAI endpoints (images, audio, files, assistants and so on) aren't available. |
| Optional parameters | Passed through to the engine. Support for parameters such as `response_format` or `logprobs` depends on the engine and model. |
| `max_tokens` | Filled in with the server default when you leave it out. See [Chat completions](/docs/chat-completions#output-length). |

## Retries in the SDKs

The OpenAI SDKs retry some failures automatically, including `429` and `5xx` responses, with exponential backoff. That works well with DockWell's `Retry-After` header on rate limits. Keep in mind that retrying an `insufficient_quota` error doesn't help until credits are added. See [Errors](/docs/errors#retrying).
