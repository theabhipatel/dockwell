import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

import type { ThemePreference } from "@/lib/types"

/** Mirrors public/theme-init.js, which applies the theme before first paint (no flash). */
const STORAGE_KEY = "dockwell-theme"
const DARK_QUERY = "(prefers-color-scheme: dark)"

interface ThemeContextValue {
  theme: ThemePreference
  resolved: "light" | "dark"
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === "light" || value === "dark" || value === "system") return value
  } catch {
    // Storage can be unavailable (privacy mode); fall back to the system preference.
  }
  return "system"
}

function resolve(theme: ThemePreference): "light" | "dark" {
  if (theme === "system") return window.matchMedia(DARK_QUERY).matches ? "dark" : "light"
  return theme
}

function apply(resolved: "light" | "dark"): void {
  const root = document.documentElement
  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved
  root.style.backgroundColor = ""
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readStored)
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(readStored()))

  useEffect(() => {
    const next = resolve(theme)
    setResolved(next)
    apply(next)
    if (theme !== "system") return
    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      const value = resolve("system")
      setResolved(value)
      apply(value)
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Non-fatal: the preference still applies for this page view.
    }
    setThemeState(next)
  }, [])

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider")
  return ctx
}
