import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"

interface UserAvatarProps {
  name: string
  src?: string | null
  className?: string
  size?: "sm" | "default" | "lg"
}

export function UserAvatar({ name, src, className, size = "default" }: UserAvatarProps) {
  return (
    <Avatar size={size} className={cn("ring-1 ring-border", className)}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className="bg-brand-soft font-semibold text-brand">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
