import { ConfirmDialog } from "@/components/confirm-dialog"
import { useSignOut } from "@/hooks/session"

export function SignOutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const signOut = useSignOut()
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sign out?"
      description="You will be signed out on this device."
      confirmLabel="Sign out"
      destructive
      onConfirm={() => signOut.mutateAsync()}
    />
  )
}
