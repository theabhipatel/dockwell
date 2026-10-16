import { describe, expect, it } from "vitest"

import { contextLength, dollarsToMicros, microsToDollars, usd } from "@/lib/format"
import { curlSnippet, javascriptSnippet, pythonSnippet } from "@/lib/snippets"

describe("money formatting", () => {
  it("formats micro-dollars", () => {
    expect(usd(3_000_000)).toBe("$3.00")
    expect(usd(1_234_567)).toBe("$1.23")
    expect(usd(125)).toBe("$0.000125")
    expect(usd(0)).toBe("$0.00")
  })

  it("round-trips dollars and micro-dollars", () => {
    expect(dollarsToMicros(0.15)).toBe(150_000)
    expect(microsToDollars(150_000)).toBe("0.15")
    expect(microsToDollars(null)).toBe("")
  })

  it("shortens context lengths", () => {
    expect(contextLength(131_072)).toBe("128K")
    expect(contextLength(512)).toBe("512")
  })
})

describe("code snippets", () => {
  const options = { baseUrl: "https://dockwell.example.com/v1", model: "qwen2.5-7b-instruct" }

  it("uses only the base URL and key", () => {
    expect(curlSnippet(options)).toContain("https://dockwell.example.com/v1/chat/completions")
    expect(pythonSnippet(options)).toContain('base_url="https://dockwell.example.com/v1"')
    expect(javascriptSnippet(options)).toContain('baseURL: "https://dockwell.example.com/v1"')
  })

  it("streams when asked", () => {
    expect(pythonSnippet({ ...options, stream: true })).toContain("for chunk in response")
    expect(javascriptSnippet({ ...options, stream: true })).toContain("for await")
  })
})
