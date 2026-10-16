import createClient, { type Middleware } from "openapi-fetch"

import type { components, paths } from "@/lib/api-schema"

export type Schemas = components["schemas"]

/** Error thrown for any non-2xx API response, carrying a user-presentable message. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

const CSRF_COOKIES = ["__Host-dockwell_csrf", "dockwell_csrf"]

function readCsrfCookie(): string | null {
  for (const part of document.cookie.split(";")) {
    const [rawName, ...rest] = part.trim().split("=")
    if (rawName && CSRF_COOKIES.includes(rawName)) return decodeURIComponent(rest.join("="))
  }
  return null
}

let csrfPrimer: Promise<void> | null = null

/** The server sets the CSRF cookie on the first API response; make sure we have one. */
async function ensureCsrf(): Promise<string | null> {
  const existing = readCsrfCookie()
  if (existing) return existing
  csrfPrimer ??= fetch("/api/health", { credentials: "same-origin" }).then(() => undefined)
  await csrfPrimer
  csrfPrimer = null
  return readCsrfCookie()
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"])

const csrfMiddleware: Middleware = {
  async onRequest({ request }) {
    if (!SAFE.has(request.method)) {
      const token = await ensureCsrf()
      if (token) request.headers.set("X-CSRF-Token", token)
    }
    return request
  },
}

export const client = createClient<paths>({ baseUrl: "", credentials: "same-origin" })
client.use(csrfMiddleware)

interface ValidationIssue {
  msg?: string
  loc?: (string | number)[]
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "object" && error !== null && "detail" in error) {
    const detail = (error as { detail: unknown }).detail
    if (typeof detail === "string") return detail
    if (Array.isArray(detail) && detail.length > 0) {
      const issue = detail[0] as ValidationIssue
      const field = issue.loc?.[issue.loc.length - 1]
      const msg = (issue.msg ?? "Invalid value").replace(/^Value error, /, "")
      return typeof field === "string" && field !== "body" ? `${humanize(field)}: ${msg}` : msg
    }
  }
  return fallback
}

function humanize(field: string): string {
  const text = field.replace(/_/g, " ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Fallback text for a failed response whose body has no usable `detail`. */
function statusMessage(status: number): string | undefined {
  // 413 can come from the hosting platform rather than the API (Vercel caps request bodies at
  // 4.5 MB), in which case the body isn't JSON. Self-hosted, the API's own message is used.
  if (status === 413) return "This is too large for the server to accept. Try sending less at once."
  if (status >= 500) return "The server had a problem. Please try again shortly."
  return undefined
}

interface FetchResult<T> {
  data?: T
  error?: unknown
  response: Response
}

/** Await an openapi-fetch call and return its data, throwing ApiError on failure. */
export async function unwrap<T>(promise: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>
  try {
    result = await promise
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.")
  }
  const { data, error, response } = result
  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(error, statusMessage(response.status)))
  }
  return data as T
}

/** Raw request helper for endpoints outside the typed schema (file uploads, downloads). */
export async function rawRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? "GET").toUpperCase()
  if (!SAFE.has(method)) {
    const token = await ensureCsrf()
    if (token) headers.set("X-CSRF-Token", token)
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" })
  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    throw new ApiError(response.status, errorMessage(body, statusMessage(response.status)))
  }
  return response
}

/** The CSRF token for requests made with plain fetch (streaming responses). */
export async function csrfToken(): Promise<string | null> {
  return ensureCsrf()
}
