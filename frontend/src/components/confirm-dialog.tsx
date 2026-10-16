import { useState } from "react"
import type { ReactNode } from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  destructive?: boolean
  /** When set, the user must type this exact text to enable the confirm button. */
  confirmText?: string
  children?: ReactNode
  onConfirm: (typed: string) => Promise<unknown> | void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  confirmText,
  children,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const ready = confirmText === undefined || typed.trim() === confirmText

  const handleOpenChange = (next: boolean) => {
    if (busy) return
    if (!next) setTyped("")
    onOpenChange(next)
  }

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm(typed.trim())
      setTyped("")
      onOpenChange(false)
    } catch {
      // The caller reports errors (toast); keep the dialog open so the user can retry.
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {confirmText !== undefined ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-text" className="text-sm font-normal">
              Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">{confirmText}</span> to confirm
            </Label>
            <Input
              id="confirm-text"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready && !busy) void confirm()
              }}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant={destructive ? "destructive" : "default"} disabled={!ready || busy} onClick={() => void confirm()}>
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
