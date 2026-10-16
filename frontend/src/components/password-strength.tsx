import { useEffect, useState } from "react"
import type { ZxcvbnFactory } from "@zxcvbn-ts/core"

import { cn } from "@/lib/utils"

let factoryPromise: Promise<ZxcvbnFactory> | null = null

/** The strength estimator ships ~1 MB of dictionaries, so it is loaded only when needed. */
function loadFactory(): Promise<ZxcvbnFactory> {
  factoryPromise ??= Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
    import("@zxcvbn-ts/language-en"),
  ]).then(
    ([core, common, en]) =>
      new core.ZxcvbnFactory({
        dictionary: { ...common.dictionary, ...en.dictionary },
        graphs: common.adjacencyGraphs,
        translations: en.translations,
      }),
  )
  return factoryPromise
}

const LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const
const COLORS = ["bg-destructive", "bg-destructive", "bg-warning", "bg-success", "bg-success"] as const

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4
  label: string
  warning: string | null
}

export async function estimateStrength(password: string, userInputs: string[] = []): Promise<Strength> {
  const result = (await loadFactory()).check(password, userInputs)
  return { score: result.score, label: LABELS[result.score], warning: result.feedback.warning || null }
}

export function PasswordStrength({ password, userInputs = [], className }: { password: string; userInputs?: string[]; className?: string }) {
  const [strength, setStrength] = useState<Strength | null>(null)
  const inputsKey = userInputs.join("\u0000")

  useEffect(() => {
    let cancelled = false
    if (!password) {
      queueMicrotask(() => !cancelled && setStrength(null))
    } else {
      void estimateStrength(password, inputsKey ? inputsKey.split("\u0000") : []).then((s) => {
        if (!cancelled) setStrength(s)
      })
    }
    return () => {
      cancelled = true
    }
  }, [password, inputsKey])

  if (!password || !strength) return null
  return (
    <div className={cn("space-y-1.5", className)} aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn("h-1.5 flex-1 rounded-full bg-muted transition-colors", strength.score > i && COLORS[strength.score])} />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        <span className="text-foreground font-medium">{strength.label}</span>
        {strength.warning ? ` · ${strength.warning}` : null}
      </p>
    </div>
  )
}
