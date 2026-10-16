import { useEffect, useState } from "react"

export interface PublicModel {
  id: string
  name: string
  description: string
  owned_by: string
  context_length: number
  max_output_tokens: number | null
  capabilities: string[]
  status: string
  deprecated: boolean
  retirement_date: string | null
  price: {
    input_micros_per_m: number
    output_micros_per_m: number
    cached_input_micros_per_m: number | null
    min_charge_micros: number
    is_free: boolean
  }
}

export interface PublicConfig {
  platform_name: string
  free_credit_micros: number
  topup_presets_cents: number[]
  topup_min_cents: number
  topup_max_cents: number
  auto_recharge_allowed: boolean
  stripe_mode: "live" | "test" | "off"
  api_base_url: string
}

function useFetch<T>(url: string): { data: T | null; error: boolean } {
  const [state, setState] = useState<{ data: T | null; error: boolean }>({ data: null, error: false })
  useEffect(() => {
    let cancelled = false
    fetch(url, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        return (await res.json()) as T
      })
      .then((data) => !cancelled && setState({ data, error: false }))
      .catch(() => !cancelled && setState({ data: null, error: true }))
    return () => {
      cancelled = true
    }
  }, [url])
  return state
}

/** The live catalogue and prices, loaded in the browser (the page itself is pre-rendered). */
export function usePublicModels() {
  return useFetch<PublicModel[]>("/api/public/models")
}

export function usePublicConfig() {
  return useFetch<PublicConfig>("/api/public/config")
}

export function money(micros: number): string {
  const value = micros / 1_000_000
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2 })
}

export function ctx(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1024)}K` : String(n)
}
