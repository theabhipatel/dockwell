/** Code samples for calling DockWell with curl or the official OpenAI SDKs. */

export interface SnippetMessage {
  role: string
  content: string
}

export interface SnippetOptions {
  baseUrl: string
  model: string
  apiKey?: string
  messages?: SnippetMessage[]
  temperature?: number
  maxTokens?: number
  topP?: number
  stream?: boolean
}

const DEFAULT_MESSAGES: SnippetMessage[] = [{ role: "user", content: "Write a haiku about the sea." }]

function params(o: SnippetOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (o.temperature !== undefined) out.temperature = o.temperature
  if (o.topP !== undefined) out.top_p = o.topP
  if (o.maxTokens !== undefined) out.max_tokens = o.maxTokens
  if (o.stream) out.stream = true
  return out
}

export function curlSnippet(o: SnippetOptions): string {
  const body = { model: o.model, messages: o.messages ?? DEFAULT_MESSAGES, ...params(o) }
  const json = JSON.stringify(body, null, 2).replace(/'/g, "'\\''")
  return [
    `curl ${o.baseUrl}/chat/completions \\`,
    `  -H "Authorization: Bearer ${o.apiKey ?? "$DOCKWELL_API_KEY"}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${json}'`,
  ].join("\n")
}

function pyValue(value: unknown, indent: number): string {
  const pad = " ".repeat(indent)
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => `${pad}    ${pyValue(v, indent + 4)}`).join(",\n")},\n${pad}]`
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${pyValue(v, indent)}`)
    return `{${entries.join(", ")}}`
  }
  if (typeof value === "boolean") return value ? "True" : "False"
  return JSON.stringify(value)
}

export function pythonSnippet(o: SnippetOptions): string {
  const extra = Object.entries(params(o)).map(([k, v]) => `    ${k}=${pyValue(v, 4)},`)
  const lines = [
    "from openai import OpenAI",
    "",
    "client = OpenAI(",
    `    base_url="${o.baseUrl}",`,
    o.apiKey ? `    api_key="${o.apiKey}",` : `    api_key=os.environ["DOCKWELL_API_KEY"],`,
    ")",
    "",
    "response = client.chat.completions.create(",
    `    model="${o.model}",`,
    `    messages=${pyValue(o.messages ?? DEFAULT_MESSAGES, 4)},`,
    ...extra,
    ")",
  ]
  if (o.stream) {
    lines.push("", "for chunk in response:", "    if chunk.choices and chunk.choices[0].delta.content:", '        print(chunk.choices[0].delta.content, end="")')
  } else {
    lines.push("", "print(response.choices[0].message.content)", "print(response.usage)")
  }
  if (!o.apiKey) lines.unshift("import os")
  return lines.join("\n")
}

export function javascriptSnippet(o: SnippetOptions): string {
  const body = { model: o.model, messages: o.messages ?? DEFAULT_MESSAGES, ...params(o) }
  const json = JSON.stringify(body, null, 2).replace(/\n/g, "\n")
  const lines = [
    'import OpenAI from "openai"',
    "",
    "const client = new OpenAI({",
    `  baseURL: "${o.baseUrl}",`,
    o.apiKey ? `  apiKey: "${o.apiKey}",` : "  apiKey: process.env.DOCKWELL_API_KEY,",
    "})",
    "",
    `const response = await client.chat.completions.create(${json})`,
  ]
  if (o.stream) {
    lines.push("", "for await (const chunk of response) {", '  process.stdout.write(chunk.choices[0]?.delta?.content ?? "")', "}")
  } else {
    lines.push("", "console.log(response.choices[0].message.content)", "console.log(response.usage)")
  }
  return lines.join("\n")
}
