import { Activity as ActivityIcon } from "lucide-react"
import { Link } from "react-router"

import { EmptyState } from "@/components/states"
import { actionLabel, relativeTime } from "@/lib/format"
import type { Activity } from "@/lib/types"

function targetLink(item: Activity, workspaceId: string): string | null {
  if (item.target_type === "document" && item.project_id && item.target_id && !item.action.endsWith(".deleted")) {
    return `/w/${workspaceId}/projects/${item.project_id}/docs/${item.target_id}`
  }
  if (item.target_type === "project" && item.project_id && item.action !== "project.deleted") {
    return `/w/${workspaceId}/projects/${item.project_id}`
  }
  return null
}

export function ActivityFeed({ items, workspaceId }: { items: Activity[]; workspaceId: string }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="No activity yet"
        description="Changes to projects and documents you can access will show up here."
        className="border-0 bg-transparent py-8"
      />
    )
  }
  return (
    <ol className="relative space-y-0.5">
      {items.map((item, i) => {
        const to = targetLink(item, workspaceId)
        return (
          <li key={item.id} className="relative flex gap-3 py-2.5 pl-1">
            {i < items.length - 1 ? (
              <span className="absolute top-8 bottom-0 left-[0.95rem] w-px bg-border" aria-hidden="true" />
            ) : null}
            <span className="relative mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-border">
              <span className="size-1.5 rounded-full bg-brand" />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="leading-snug">
                <span className="font-medium">{item.actor_name ?? item.actor_email ?? "Someone"}</span>{" "}
                <span className="text-muted-foreground lowercase">{actionLabel(item.action)}</span>{" "}
                {item.target_label ? (
                  to ? (
                    <Link to={to} className="font-medium underline-offset-2 hover:underline">
                      {item.target_label}
                    </Link>
                  ) : (
                    <span className="font-medium">{item.target_label}</span>
                  )
                ) : null}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {relativeTime(item.created_at)}
                {item.project_name && item.target_type !== "project" ? ` · ${item.project_name}` : ""}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
