import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns"

export function relativeTime(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  if (diff < 45_000 && diff > -45_000) return "just now"
  return formatDistanceToNowStrict(date, { addSuffix: true })
}

export function shortDate(iso: string): string {
  const date = new Date(iso)
  if (isToday(date)) return `Today, ${format(date, "HH:mm")}`
  if (isYesterday(date)) return `Yesterday, ${format(date, "HH:mm")}`
  return format(date, "d MMM yyyy")
}

export function fullDate(iso: string): string {
  return format(new Date(iso), "d MMM yyyy, HH:mm:ss")
}

export function dayLabel(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), "d MMM")
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return letters.map((p) => p.charAt(0).toUpperCase()).join("").slice(0, 2) || "?"
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`
}

// ---- Money: the API speaks integer micro-dollars (1 USD = 1_000_000) -----------------------

export const MICROS = 1_000_000

/** "$12.34" for balances; small amounts keep enough digits to be meaningful ("$0.000125"). */
export function usd(micros: number, { precise = false }: { precise?: boolean } = {}): string {
  const value = micros / MICROS
  const abs = Math.abs(value)
  let digits = 2
  if (precise || (abs > 0 && abs < 0.01)) {
    digits = abs === 0 ? 2 : Math.min(6, Math.max(2, Math.ceil(-Math.log10(abs)) + 2))
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  })
}

export function cents(amount: number): string {
  return (amount / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

/** Price per 1M tokens, e.g. "$0.15". */
export function perMillion(micros: number): string {
  return usd(micros, { precise: true })
}

export function dollarsToMicros(dollars: number): number {
  return Math.round(dollars * MICROS)
}

export function microsToDollars(micros: number | null | undefined): string {
  if (micros === null || micros === undefined) return ""
  return String(micros / MICROS)
}

export function compact(n: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)
}

export function tokens(n: number): string {
  return n < 10_000 ? n.toLocaleString() : compact(n)
}

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-"
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`
}

export function contextLength(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1024)}K` : String(n)
}

/** A short, readable description of a browser user agent. */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device"
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /curl|python|httpx|node|openai/i.test(ua) ? "API client"
    : "Browser"
  const os =
    /Windows/.test(ua) ? "Windows"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /Linux/.test(ua) ? "Linux"
    : ""
  return os ? `${browser} on ${os}` : browser
}

const ACTION_LABELS: Record<string, string> = {
  "auth.sign_in": "Signed in",
  "auth.sign_out": "Signed out",
  "auth.sign_up": "Created account",
  "auth.email_verified": "Verified email",
  "auth.google_linked": "Linked Google account",
  "auth.google_unlinked": "Unlinked Google account",
  "auth.two_factor_failed": "Wrong 2FA code",
  "auth.password_reset_requested": "Requested password reset",
  "auth.password_reset": "Reset password",
  "auth.session_revoked": "Signed out a device",
  "auth.sessions_revoked_others": "Signed out other devices",
  "account.password_changed": "Changed password",
  "account.profile_updated": "Updated profile",
  "account.email_change_requested": "Requested email change",
  "account.email_changed": "Changed email",
  "account.two_factor_enabled": "Turned on 2FA",
  "account.two_factor_disabled": "Turned off 2FA",
  "account.backup_codes_regenerated": "New backup codes",
  "account.deleted": "Deleted account",
  "workspace.created": "Created workspace",
  "workspace.settings_changed": "Changed workspace settings",
  "workspace.logo_changed": "Changed workspace logo",
  "workspace.deleted": "Deleted workspace",
  "workspace.ownership_transferred": "Transferred ownership",
  "member.joined": "Joined workspace",
  "member.left": "Left workspace",
  "member.removed": "Removed member",
  "member.role_changed": "Changed role",
  "invitation.created": "Invited",
  "invitation.resent": "Resent invitation",
  "invitation.revoked": "Revoked invitation",
  "invitation.accepted": "Accepted invitation",
  "invitation.declined": "Declined invitation",
  "role.created": "Created role",
  "role.updated": "Updated role",
  "role.deleted": "Deleted role",
  "project.created": "Created project",
  "project.updated": "Updated project",
  "project.archived": "Archived project",
  "project.unarchived": "Restored project",
  "project.deleted": "Deleted project",
  "project.member_added": "Gave project access",
  "project.member_removed": "Removed project access",
  "project.access_changed": "Changed project access",
  "api_key.created": "Created API key",
  "api_key.updated": "Updated API key",
  "api_key.revoked": "Revoked API key",
  "api_key.deleted": "Deleted API key",
  "billing.checkout_started": "Started a credit purchase",
  "billing.credits_added": "Credits added",
  "billing.credit_granted": "Starter credit granted",
  "billing.settings_changed": "Changed billing settings",
  "billing.details_changed": "Changed billing details",
  "billing.card_removed": "Removed saved card",
  "billing.refunded": "Refund",
  "admin.credits_adjusted": "Admin credit adjustment",
  "admin.workspace_suspended": "Workspace suspended by admin",
  "admin.workspace_unsuspended": "Workspace unsuspended by admin",
  "admin.workspace_limits_changed": "Admin changed limits",
  "admin.workspace_price_set": "Admin set custom price",
  "admin.workspace_price_removed": "Admin removed custom price",
  "admin.user_created": "Created user",
  "admin.user_suspended": "Suspended user",
  "admin.user_unsuspended": "Unsuspended user",
  "admin.user_signed_out": "Signed out user",
  "admin.user_2fa_reset": "Reset user 2FA",
  "admin.user_verified": "Verified user email",
  "admin.user_promoted": "Made platform admin",
  "admin.user_demoted": "Removed platform admin",
  "admin.user_deleted": "Deleted user",
  "admin.provider_created": "Added provider",
  "admin.provider_updated": "Updated provider",
  "admin.provider_deleted": "Deleted provider",
  "admin.model_created": "Added model",
  "admin.model_updated": "Updated model",
  "admin.model_deprecated": "Deprecated model",
  "admin.model_undeprecated": "Undid deprecation",
  "admin.model_deleted": "Deleted model",
  "admin.price_set": "Set model price",
  "admin.deployment_created": "Deployed model",
  "admin.deployment_start": "Started engine",
  "admin.deployment_stop": "Stopped engine",
  "admin.deployment_restart": "Restarted engine",
  "admin.deployment_deleted": "Removed deployment",
  "admin.settings_changed": "Changed platform settings",
  "admin.hf_token_changed": "Changed Hugging Face token",
  "admin.logo_changed": "Changed platform logo",
  "admin.test_email": "Sent test email",
  "admin.payment_refunded": "Refunded payment",
}

const DETAIL_LABELS: Record<string, string> = {
  method: "Method",
  reason: "Reason",
  fields: "Changed",
  changed: "Changed",
  from: "From",
  to: "To",
  role: "Role",
  added: "Added",
  removed: "Removed",
  rank: "Rank",
  permissions: "Permissions",
  projects: "Projects",
  amount_micros: "Amount",
  amount_cents: "Amount",
  kind: "Kind",
  source: "Source",
}

export function detailLabel(key: string): string {
  return DETAIL_LABELS[key] ?? key.replace(/_/g, " ")
}

export function detailValue(value: unknown, key?: string): string {
  if (value === null || value === undefined) return "-"
  if (key === "amount_micros" && typeof value === "number") return usd(value)
  if (key === "amount_cents" && typeof value === "number") return cents(value)
  if (Array.isArray(value)) return value.map((v) => detailValue(v)).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ")
}

export const ACTION_GROUPS: { value: string; label: string }[] = [
  { value: "auth.", label: "Sign-in" },
  { value: "member.", label: "Members" },
  { value: "invitation.", label: "Invitations" },
  { value: "role.", label: "Roles" },
  { value: "workspace.", label: "Workspace" },
  { value: "project.", label: "Projects" },
  { value: "api_key.", label: "API keys" },
  { value: "billing.", label: "Billing" },
  { value: "admin.", label: "Admin actions" },
]
