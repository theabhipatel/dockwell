import { csrfToken } from "@/lib/api"

export interface ChatTurn {
  role: "system" | "user" | "assistant"
  content: string
}

export interface StreamResult {
  content: string
  inputTokens: number | null
  outputTokens: number | null
  costMicros: number | null
  requestId: string | null
  finishReason: string | null
}

export class ChatError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(status: number, message: string, code: string | null) {
    super(message)
    this.status = status
    this.code = code
  }
}

interface Chunk {
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
  dockwell?: { request_id?: string; cost_micros?: number }
  error?: { message?: string; code?: string }
}

/** Stream a playground chat completion (server-sent events), calling `onDelta` per token. */
export async function streamChat(
  workspaceId: string,
  body: Record<string, unknown>,
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<StreamResult> {
  const token = await csrfToken()
  const response = await fetch(`/api/workspaces/${workspaceId}/playground/chat`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok || !response.body) {
    let message = "The request failed. Please try again."
    let code: string | null = null
    try {
      const payload = (await response.json()) as { error?: { message?: string; code?: string }; detail?: unknown }
      if (payload.error?.message) message = payload.error.message
      code = payload.error?.code ?? null
      if (typeof payload.detail === "string") message = payload.detail
    } catch {
      // Keep the generic message.
    }
    throw new ChatError(response.status, message, code)
  }

  const result: StreamResult = {
    content: "",
    inputTokens: null,
    outputTokens: null,
    costMicros: null,
    requestId: response.headers.get("x-request-id"),
    finishReason: null,
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index: number
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (data === "[DONE]") continue
      let chunk: Chunk
      try {
        chunk = JSON.parse(data) as Chunk
      } catch {
        continue
      }
      if (chunk.error) throw new ChatError(502, chunk.error.message ?? "The model stopped responding.", chunk.error.code ?? null)
      if (chunk.dockwell) {
        result.costMicros = chunk.dockwell.cost_micros ?? null
        result.requestId = chunk.dockwell.request_id ?? result.requestId
      }
      if (chunk.usage) {
        result.inputTokens = chunk.usage.prompt_tokens ?? null
        result.outputTokens = chunk.usage.completion_tokens ?? null
      }
      for (const choice of chunk.choices ?? []) {
        const piece = choice.delta?.content ?? ""
        if (piece) {
          result.content += piece
          onDelta(piece)
        }
        if (choice.finish_reason) result.finishReason = choice.finish_reason
      }
    }
  }
  return result
}
