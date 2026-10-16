import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: LucideIcon
  loading?: boolean
  tone?: "default" | "warning" | "danger"
  action?: ReactNode
  className?: string
}

export function StatCard({ label, value, hint, icon: Icon, loading, tone = "default", action, className }: StatCardProps) {
  return (
    <Card className={cn("gap-0 py-0", tone === "warning" && "border-warning/40", tone === "danger" && "border-destructive/40", className)}>
      <CardContent className="space-y-1.5 p-4">
        <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs font-medium">
          <span>{label}</span>
          {Icon ? <Icon className="size-4" /> : null}
        </div>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div className="tabular text-2xl font-semibold tracking-tight">{value}</div>
        )}
        {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </CardContent>
    </Card>
  )
}
