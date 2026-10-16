DockWell's API follows OpenAI's API, so requests and responses look exactly like OpenAI's. This page covers the endpoints DockWell offers, the fields it checks, and the few things it adds. Every endpoint lives under `<your DockWell URL>/v1` and needs an [API key](/docs/authentication).

| Endpoint | Purpose |
|---|---|
| `POST /v1/chat/completions` | Chat with a model. Streaming, tools and images where the model supports them. |
| `POST /v1/completions` | Plain text completion from a prompt. |
| `POST /v1/embeddings` | Turn text into vectors, for embedding models. |
| `GET /v1/models` | List the models your key can use. |
| `GET /v1/models/{id}` | Get one model. |

## Chat completions

```bash
curl https://dockwell.example.com/v1/chat/completions \
  -H "Authorization: Bearer $DOCKWELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-0.5b-instruct",
    "messages": [
      {"role": "system", "content": "You answer in one sentence."},
      {"role": "user", "content": "What is a context window?"}
    ],
    "temperature": 0.7,
    "max_tokens": 200
  }'
```

### Request fields

DockWell checks the fields below itself. Every other field (`temperature`, `top_p`, `stop`, `seed`, `presence_penalty`, `frequency_penalty`, `response_format`, `tool_choice` and so on) is passed to the engine unchanged. Whether the engine honours it depends on the engine and model.

| Field | Required | Notes |
|---|---|---|
| `model` | Yes | A model id from `GET /v1/models`, for example `qwen2.5-0.5b-instruct`. |
| `messages` | Yes | A non-empty array of messages with `role` and `content`. |
| `max_tokens` or `max_completion_tokens` | No | Most output tokens to generate. Must be at least 1 and no more than the model's maximum output. See [Output length](#output-length). |
| `n` | No | Number of choices, from 1 to 16. Default 1. Each choice is charged. |
| `stream` | No | `true` to receive server-sent events. See [Streaming](/docs/streaming). |
| `tools` | No | Function definitions. Only for models with the `tools` capability. |

### Response

```json
{
  "id": "chatcmpl-8c1f...",
  "object": "chat.completion",
  "created": 1792310400,
  "model": "qwen2.5-0.5b-instruct",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "A context window is the most text a model can read and write in one request."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 31,
    "completion_tokens": 18,
    "total_tokens": 49
  }
}
```

- `model` is always the DockWell model id you asked for, even if the engine uses a different internal name.
- `usage` is always present. If an engine doesn't report usage, DockWell estimates it from the text and adds it, and charges that estimate.

### Response headers

| Header | Example | Meaning |
|---|---|---|
| `x-request-id` | `5f0c2a9e-3d41-4c1b-9a77-0e5d2c8b1f60` | The id of this request. Find it under **Logs** in the web app. |
| `x-dockwell-cost-usd` | `0.000042` | The exact amount charged for this request, in US dollars. Only on non-streamed responses. |

## Output length

The `max_tokens` value matters for billing, because DockWell **reserves** the most a request could cost before it runs. See [Billing and credits](/docs/billing-and-credits).

- If you send `max_tokens` (or `max_completion_tokens`, which takes precedence), DockWell uses it. A value above the model's maximum output is rejected with `400`.
- If you **omit** it, DockWell sets it for you to the server's `DEFAULT_MAX_TOKENS` (4096 by default), lowered to whatever room is left in the model's context window after your input, and to the model's maximum output if it has one.

> [!TIP]
> Set `max_tokens` close to what you really need. A smaller value means a smaller reservation, so more requests can run in parallel on the same balance. You're always charged only for the tokens actually generated.

## Tools and function calling

Models with the `tools` capability accept OpenAI-style tools. Check a model's capabilities in `GET /v1/models`. Sending `tools` to a model without the capability returns `400`.

```python
from openai import OpenAI

client = OpenAI(base_url="https://dockwell.example.com/v1", api_key="dw-your-key-here")

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

reply = client.chat.completions.create(
    model="qwen2.5-0.5b-instruct",
    messages=[{"role": "user", "content": "What's the weather in Pune?"}],
    tools=tools,
)
call = reply.choices[0].message.tool_calls[0]
print(call.function.name, call.function.arguments)
```

Send the tool's result back in a message with `"role": "tool"` and the matching `tool_call_id`, exactly as with OpenAI. Tool definitions count towards input tokens.

> [!NOTE]
> Tool calling quality depends on the model. Small models such as Qwen2.5 0.5B can call tools, but larger instruct models are far more reliable.

## Vision

Models with the `vision` capability accept images in the OpenAI format:

```json
{
  "model": "your-vision-model",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "What is in this picture?"},
      {"type": "image_url", "image_url": {"url": "https://example.com/photo.jpg"}}
    ]
  }]
}
```

Sending images to a model without `vision` returns `400`. For the reservation, each image is counted as 1,500 input tokens. The actual charge uses the token count the engine reports.

## Text completions

`POST /v1/completions` takes a `prompt` instead of `messages`. The model needs the `chat` or `completions` capability. `prompt` is required.

```bash
curl https://dockwell.example.com/v1/completions \
  -H "Authorization: Bearer $DOCKWELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen2.5-0.5b-instruct", "prompt": "The three primary colours are", "max_tokens": 30}'
```

`max_tokens`, `n` and `stream` work the same way as for chat.

## Embeddings

`POST /v1/embeddings` only works with models that have the `embeddings` capability. `input` is required and can be a string or an array of strings.

```python
emb = client.embeddings.create(
    model="your-embedding-model",
    input=["DockWell serves open models.", "It speaks the OpenAI API."],
)
print(len(emb.data), len(emb.data[0].embedding))
```

Embeddings are charged for input tokens only. `stream` is ignored.

## Listing models

`GET /v1/models` returns the models your key can use: enabled, ready, visible to your workspace, not retired, and in the key's allowed list if it has one. Besides OpenAI's standard fields, each model includes extra fields:

```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen2.5-0.5b-instruct",
      "object": "model",
      "created": 1792310400,
      "owned_by": "Alibaba",
      "name": "Qwen2.5 0.5B Instruct",
      "context_length": 4096,
      "capabilities": ["chat", "completions", "tools"],
      "deprecated": false,
      "retirement_date": null,
      "pricing": {
        "currency": "usd",
        "input_per_million": 0.1,
        "output_per_million": 0.2,
        "free": false
      }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `name` | Display name. |
| `context_length` | Maximum tokens of input plus output. |
| `capabilities` | Any of `chat`, `completions`, `tools`, `vision`, `embeddings`. |
| `deprecated`, `retirement_date` | Whether the model is being phased out, and when it stops working. |
| `pricing` | Your workspace's price per 1M tokens, including any custom price or discount. |

`GET /v1/models/{id}` returns one model in the same format, or `404 model_not_found`.

## Request size

A single request body can be up to 32 MB on a self-hosted install. Larger bodies get `413`. On the Vercel demo, the platform caps bodies at 4.5 MB.

## Related

- [Streaming](/docs/streaming) for token-by-token replies.
- [Errors](/docs/errors) for every error code.
- [Rate limits](/docs/rate-limits) for request and token limits.
