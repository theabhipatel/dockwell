"""Permission catalogue, default roles and the pure hierarchy rules.

Everything in this module is side-effect free so the rules can be unit tested directly.
"""

from dataclasses import dataclass
from enum import StrEnum


class Perm(StrEnum):
    WORKSPACE_SETTINGS = "workspace.manage_settings"
    BILLING_MANAGE = "billing.manage"
    BILLING_VIEW = "billing.view"
    MEMBERS_INVITE = "members.invite"
    MEMBERS_REMOVE = "members.remove"
    MEMBERS_CHANGE_ROLE = "members.change_role"
    ROLES_MANAGE = "roles.manage"
    PROJECTS_ACCESS_ALL = "projects.access_all"
    PROJECTS_CREATE = "projects.create"
    PROJECTS_MANAGE = "projects.manage"
    PROJECTS_MANAGE_MEMBERS = "projects.manage_members"
    KEYS_MANAGE_ALL = "keys.manage_all"
    KEYS_MANAGE_OWN = "keys.manage_own"
    USAGE_VIEW = "usage.view"
    LOGS_VIEW = "logs.view"
    AUDIT_VIEW = "audit.view"
    PLAYGROUND_USE = "playground.use"


ALL_PERMS: frozenset[Perm] = frozenset(Perm)


@dataclass(frozen=True)
class PermInfo:
    key: Perm
    group: str
    label: str
    description: str


PERMISSION_CATALOG: tuple[PermInfo, ...] = (
    PermInfo(
        Perm.WORKSPACE_SETTINGS,
        "Workspace",
        "Manage workspace settings",
        "Rename the workspace, change its slug, logo, default project and data retention.",
    ),
    PermInfo(
        Perm.MEMBERS_INVITE,
        "Members",
        "Invite members",
        "Invite people by email with a role ranked below their own, and manage invitations.",
    ),
    PermInfo(Perm.MEMBERS_REMOVE, "Members", "Remove members", "Remove members ranked below them."),
    PermInfo(
        Perm.MEMBERS_CHANGE_ROLE,
        "Members",
        "Change member roles",
        "Change the role of members ranked below them.",
    ),
    PermInfo(
        Perm.ROLES_MANAGE,
        "Members",
        "Manage roles",
        "Create, edit and delete roles ranked below their own.",
    ),
    PermInfo(
        Perm.BILLING_MANAGE,
        "Billing",
        "Manage billing and add credits",
        "Buy credits, set spend limits, alerts, auto recharge and billing details.",
    ),
    PermInfo(
        Perm.BILLING_VIEW,
        "Billing",
        "View billing",
        "See the balance, credit ledger, payments and invoices.",
    ),
    PermInfo(
        Perm.PROJECTS_ACCESS_ALL,
        "Projects",
        "Access all projects",
        "See every project, not only the ones they are assigned to.",
    ),
    PermInfo(Perm.PROJECTS_CREATE, "Projects", "Create projects", "Create new projects."),
    PermInfo(
        Perm.PROJECTS_MANAGE,
        "Projects",
        "Edit and delete projects",
        "Rename, archive, delete and set limits on projects they can access.",
    ),
    PermInfo(
        Perm.PROJECTS_MANAGE_MEMBERS,
        "Projects",
        "Manage project access",
        "Choose which members can see the projects they can access.",
    ),
    PermInfo(
        Perm.KEYS_MANAGE_ALL,
        "API keys",
        "Manage all API keys",
        "Create, revoke and delete any key in projects they can access.",
    ),
    PermInfo(
        Perm.KEYS_MANAGE_OWN,
        "API keys",
        "Manage own API keys",
        "Create keys in projects they can access, and revoke or delete their own keys.",
    ),
    PermInfo(Perm.USAGE_VIEW, "Usage", "View usage", "See usage charts and export usage as CSV."),
    PermInfo(Perm.LOGS_VIEW, "Usage", "View request logs", "See request logs and their details."),
    PermInfo(
        Perm.AUDIT_VIEW,
        "Usage",
        "View activity log",
        "See and export the workspace activity log.",
    ),
    PermInfo(
        Perm.PLAYGROUND_USE,
        "Playground",
        "Use the playground",
        "Chat with models in the playground, charged to the workspace.",
    ),
)

OWNER_RANK = 1000
MAX_ASSIGNABLE_RANK = OWNER_RANK - 1
MIN_RANK = 1


@dataclass(frozen=True)
class DefaultRole:
    system_key: str
    name: str
    description: str
    rank: int
    permissions: frozenset[Perm]


DEFAULT_ROLES: tuple[DefaultRole, ...] = (
    DefaultRole(
        "owner",
        "Owner",
        "Full control of the workspace. Exactly one per workspace.",
        OWNER_RANK,
        ALL_PERMS,
    ),
    DefaultRole(
        "admin",
        "Admin",
        "Manages everything and everyone except the owner and other admins.",
        900,
        ALL_PERMS,
    ),
    DefaultRole(
        "manager",
        "Manager",
        "Runs the projects they are assigned to, their keys and usage.",
        500,
        frozenset(
            {
                Perm.MEMBERS_INVITE,
                Perm.BILLING_VIEW,
                Perm.PROJECTS_CREATE,
                Perm.PROJECTS_MANAGE,
                Perm.PROJECTS_MANAGE_MEMBERS,
                Perm.KEYS_MANAGE_ALL,
                Perm.USAGE_VIEW,
                Perm.LOGS_VIEW,
                Perm.PLAYGROUND_USE,
            }
        ),
    ),
    DefaultRole(
        "member",
        "Member",
        "Creates their own keys in assigned projects and uses the playground.",
        100,
        frozenset({Perm.KEYS_MANAGE_OWN, Perm.USAGE_VIEW, Perm.PLAYGROUND_USE}),
    ),
)


class PermissionDenied(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class Actor:
    """The acting member's standing within one workspace."""

    rank: int
    permissions: frozenset[str]
    is_owner: bool

    def has(self, perm: Perm) -> bool:
        return self.is_owner or perm.value in self.permissions


def parse_permissions(values: list[str] | set[str] | frozenset[str]) -> frozenset[str]:
    valid = {p.value for p in Perm}
    unknown = set(values) - valid
    if unknown:
        raise PermissionDenied(f"Unknown permissions: {', '.join(sorted(unknown))}")
    return frozenset(values)


def require(actor: Actor, perm: Perm) -> None:
    if not actor.has(perm):
        raise PermissionDenied("You do not have permission to do that.")


def can_manage_rank(actor: Actor, target_rank: int) -> bool:
    """A user can only manage users (and roles) ranked strictly below their own."""
    return actor.is_owner or target_rank < actor.rank


def check_manage_member(actor: Actor, target_rank: int, target_is_owner: bool) -> None:
    if target_is_owner:
        raise PermissionDenied("The workspace owner cannot be managed.")
    if not can_manage_rank(actor, target_rank):
        raise PermissionDenied("You can only manage members whose role ranks below yours.")


def check_assignable_role(
    actor: Actor, role_rank: int, role_permissions: frozenset[str], role_is_owner: bool
) -> None:
    """Whether `actor` may give someone (existing member or invitee) this role."""
    if role_is_owner:
        raise PermissionDenied("Ownership can only be transferred, not assigned.")
    if not can_manage_rank(actor, role_rank):
        raise PermissionDenied("You can only assign roles ranked below your own.")
    if not actor.is_owner and not role_permissions <= actor.permissions:
        raise PermissionDenied("You can only assign roles whose permissions you hold yourself.")


def check_role_edit(
    actor: Actor,
    role_rank: int,
    role_is_owner: bool,
    old_permissions: frozenset[str],
    new_permissions: frozenset[str],
) -> None:
    require(actor, Perm.ROLES_MANAGE)
    if role_is_owner:
        raise PermissionDenied("The Owner role cannot be edited.")
    if not can_manage_rank(actor, role_rank):
        raise PermissionDenied("You can only edit roles ranked below your own.")
    changed = old_permissions ^ new_permissions
    if not actor.is_owner and not changed <= actor.permissions:
        raise PermissionDenied("You can only grant or remove permissions you hold yourself.")


def check_role_rank_target(actor: Actor, new_rank: int) -> None:
    if not MIN_RANK <= new_rank <= MAX_ASSIGNABLE_RANK:
        raise PermissionDenied("That position is not available.")
    if not can_manage_rank(actor, new_rank):
        raise PermissionDenied("You can only place roles below your own.")
