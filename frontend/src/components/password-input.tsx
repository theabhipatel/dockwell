import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"

/** Password field with a show/hide toggle. Accepts plain input props, including react-hook-form's register(). */
export function PasswordInput(props: Omit<React.ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false)
  return (
    <InputGroup className="h-9">
      <InputGroupInput type={shown ? "text" : "password"} spellCheck={false} {...props} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label={shown ? "Hide password" : "Show password"} onClick={() => setShown((v) => !v)}>
          {shown ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
