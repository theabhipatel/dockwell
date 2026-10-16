With streaming, the reply arrives token by token as it's generated, instead of all at once at the end. DockWell streams exactly like OpenAI, using server-sent events (SSE), so the OpenAI SDKs and any SSE client work unchanged.

Streaming works on `POST /v1/chat/completions` and `POST /v1/completions`. Embeddings never stream.

## Turning it on

Add `"stream": true` to the request:

```bash
curl -N https://dockwell.example.com/v1/chat/completions \
  -H "Authorization: Bearer $DOCKWELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-0.5b-instruct",
    "messages": [{"role": "user", "content": "Count from 1 to 5."}],
    "stream": true
  }'
```

`-N` turns off curl's buffering so you see each event as it arrives.

## What the stream looks like

The response has the content type `text/event-stream`. Each event is a line starting with `data: ` followed by a JSON chunk, and the stream ends with `data: [DONE]`:

```text
data: {"id":"chatcmpl-1a2b","object":"chat.completion.chunk","model":"qwen2.5-0.5b-instruct","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}

data: {"id":"chatcmpl-1a2b","object":"chat.completion.chunk","model":"qwen2.5-0.5b-instruct","choices":[{"index":0,"delta":{"content":"1, 2"}}]}

data: {"id":"chatcmpl-1a2b","object":"chat.completion.chunk","model":"qwen2.5-0.5b-instruct","choices":[{"index":0,"delta":{"content":", 3, 4, 5."},"finish_reason":"stop"}]}

data: {"id":"chatcmpl-1a2b","object":"chat.completion.chunk","model":"qwen2.5-0.5b-instruct","choices":[],"usage":{"prompt_tokens":14,"completion_tokens":12,"total_tokens":26}}

data: [DONE]
```

The `model` field in every chunk is the DockWell model id you requested.

## Usage is always included

DockWell always sets `stream_options.include_usage` to `true` when it forwards a streamed request, whatever you send. So the **last chunk before `[DONE]` always carries a `usage` object**, and its `choices` array is empty.

That's how DockWell charges the exact cost of a streamed request, and it means you can read the token counts yourself without a second call.

> [!WARNING]
> Because the usage chunk has an empty `choices` array, code that reads `chunk.choices[0]` on every chunk will fail on it. Check that `choices` isn't empty first, as the examples below do.

## Response headers

A streamed response carries `x-request-id`, so you can find the request under **Logs**. It doesn't carry `x-dockwell-cost-usd`, because the cost isn't known until the stream ends. Compute it from the final `usage` and the model's pricing, or look it up in the request log.

## Cancelling a stream

You can stop reading at any time, for example when a user presses a stop button. DockWell notices the closed connection and stops the request.

- **You're charged for what was generated** up to that point, not for the full `max_tokens`.
- If the engine didn't report usage before the cut, DockWell estimates the output tokens from the text it relayed.
- The rest of the reservation is released immediately.
- The request appears in the logs with the status **cancelled**.

## Errors during a stream

Errors found before the stream starts (bad key, unknown model, no credit, rate limits) are returned as a normal JSON error with the right HTTP status. See [Errors](/docs/errors).

If the engine fails **after** the stream has started, the HTTP status is already `200`, so DockWell sends the error as a final event instead:

```text
data: {"error":{"message":"The model stopped responding.","type":"server_error","param":null,"code":"upstream_stream_error"}}
```

If nothing had been generated yet, the request isn't charged. If some output had been generated, you're charged for that output.

## Python

```python
from openai import OpenAI

client = OpenAI(base_url="https://dockwell.example.com/v1", api_key="dw-your-key-here")

stream = client.chat.completions.create(
    model="qwen2.5-0.5b-instruct",
    messages=[{"role": "user", "content": "Write a short poem about the sea."}],
    stream=True,
)

for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
    if chunk.usage:
        print(f"\n\n{chunk.usage.prompt_tokens} in / {chunk.usage.completion_tokens} out")
```

To cancel, stop iterating and close the stream:

```python
for i, chunk in enumerate(stream):
    if i > 20:
        stream.close()
        break
```

## JavaScript and TypeScript

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://dockwell.example.com/v1",
  apiKey: process.env.DOCKWELL_API_KEY,
});

const stream = await client.chat.completions.create({
  model: "qwen2.5-0.5b-instruct",
  messages: [{ role: "user", content: "Write a short poem about the sea." }],
  stream: true,
});

for await (const chunk of stream) {
  const text = chunk.choices[0]?.delta?.content;
  if (text) process.stdout.write(text);
  if (chunk.usage) {
    console.log(`\n\n${chunk.usage.prompt_tokens} in / ${chunk.usage.completion_tokens} out`);
  }
}
```

To cancel, call `stream.controller.abort()`, or `break` out of the loop.

## Without an SDK

If you read the stream yourself, split it on blank lines, strip the `data: ` prefix, stop at `[DONE]`, and parse everything else as JSON:

```python
import json
import os

import httpx

body = {
    "model": "qwen2.5-0.5b-instruct",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": True,
}
headers = {"Authorization": f"Bearer {os.environ['DOCKWELL_API_KEY']}"}

with httpx.stream("POST", "https://dockwell.example.com/v1/chat/completions",
                  json=body, headers=headers, timeout=None) as response:
    for line in response.iter_lines():
        if not line.startswith("data: "):
            continue
        data = line[len("data: "):]
        if data == "[DONE]":
            break
        chunk = json.loads(data)
        if "error" in chunk:
            raise RuntimeError(chunk["error"]["message"])
        for choice in chunk.get("choices", []):
            print(choice.get("delta", {}).get("content") or "", end="", flush=True)
```

## Behind a proxy

DockWell sends `Cache-Control: no-cache` and `X-Accel-Buffering: no` on streams, so nginx (including the bundled `web` container) doesn't buffer them. If you put another proxy in front, make sure it doesn't buffer `text/event-stream` responses and that its read timeout is long enough for slow replies. See [Self-hosting](/docs/self-hosting).

On the Vercel demo, a function has a maximum run time set by the Vercel plan. A very long streamed reply is cut off when it's reached, and you're charged only for what was generated.
