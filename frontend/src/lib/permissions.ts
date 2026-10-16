/** Permission keys, mirroring the server's catalogue. The server enforces every check; the
 * client only uses these to hide actions a user cannot perform. */
export const Perm = {
  workspaceSettings: "workspace.manage_settings",
  manageBilling: "billing.manage",
  viewBilling: "billing.view",
  invite: "members.invite",
  removeMembers: "members.remove",
  changeRoles: "members.change_role",
  manageRoles: "roles.manage",
  accessAllProjects: "projects.access_all",
  createProjects: "projects.create",
  manageProjects: "projects.manage",
  manageProjectMembers: "projects.manage_members",
  manageAllKeys: "keys.manage_all",
  manageOwnKeys: "keys.manage_own",
  viewUsage: "usage.view",
  viewLogs: "logs.view",
  viewAudit: "audit.view",
  usePlayground: "playground.use",
} as const

export type PermKey = (typeof Perm)[keyof typeof Perm]

export function can(permissions: readonly string[] | undefined, perm: PermKey): boolean {
  return permissions?.includes(perm) ?? false
}
