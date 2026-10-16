"""Unit tests for the pure hierarchy rules in dockwell_api.permissions."""

import pytest

from dockwell_api.permissions import (
    ALL_PERMS,
    DEFAULT_ROLES,
    OWNER_RANK,
    Actor,
    Perm,
    PermissionDenied,
    check_assignable_role,
    check_manage_member,
    check_role_edit,
    check_role_rank_target,
    parse_permissions,
)

ROLES = {r.system_key: r for r in DEFAULT_ROLES}


def actor(key: str) -> Actor:
    role = ROLES[key]
    return Actor(
        rank=role.rank,
        permissions=frozenset(p.value for p in role.permissions),
        is_owner=key == "owner",
    )


def perms(*ps: Perm) -> frozenset[str]:
    return frozenset(p.value for p in ps)


def test_defaults_match_the_spec_table() -> None:
    admin, manager, member = (ROLES[k].permissions for k in ("admin", "manager", "member"))
    assert admin == ALL_PERMS
    assert Perm.MEMBERS_INVITE in manager and Perm.MEMBERS_INVITE not in member
    assert Perm.AUDIT_VIEW not in manager
    assert Perm.PROJECTS_ACCESS_ALL not in manager
    assert Perm.KEYS_MANAGE_ALL in manager and Perm.KEYS_MANAGE_ALL not in member
    assert Perm.KEYS_MANAGE_OWN in member and Perm.BILLING_MANAGE not in member
    assert ROLES["owner"].rank == OWNER_RANK
    assert ROLES["owner"].rank > ROLES["admin"].rank > ROLES["manager"].rank > ROLES["member"].rank


def test_owner_has_everything() -> None:
    owner = Actor(rank=OWNER_RANK, permissions=frozenset(), is_owner=True)
    assert all(owner.has(p) for p in Perm)


def test_can_only_manage_lower_ranks() -> None:
    admin = actor("admin")
    check_manage_member(admin, ROLES["manager"].rank, False)
    with pytest.raises(PermissionDenied):
        check_manage_member(admin, ROLES["admin"].rank, False)  # peer admin
    with pytest.raises(PermissionDenied):
        check_manage_member(admin, OWNER_RANK, True)
    owner = actor("owner")
    check_manage_member(owner, ROLES["admin"].rank, False)
    with pytest.raises(PermissionDenied):
        check_manage_member(owner, OWNER_RANK, True)


def test_cannot_assign_owner_or_peer_roles() -> None:
    admin = actor("admin")
    with pytest.raises(PermissionDenied):
        check_assignable_role(admin, OWNER_RANK, ALL_PERMS_STR, True)
    with pytest.raises(PermissionDenied):
        check_assignable_role(admin, ROLES["admin"].rank, ALL_PERMS_STR, False)
    check_assignable_role(admin, ROLES["member"].rank, perms(Perm.USAGE_VIEW), False)


ALL_PERMS_STR = frozenset(p.value for p in Perm)


def test_cannot_assign_role_with_permissions_you_lack() -> None:
    manager = actor("manager")
    with pytest.raises(PermissionDenied):
        check_assignable_role(manager, 50, perms(Perm.AUDIT_VIEW), False)
    check_assignable_role(manager, 50, perms(Perm.USAGE_VIEW), False)


def test_role_edit_only_toggles_held_permissions() -> None:
    limited_admin = Actor(
        rank=900, permissions=ALL_PERMS_STR - perms(Perm.AUDIT_VIEW), is_owner=False
    )
    base = perms(Perm.USAGE_VIEW)
    check_role_edit(limited_admin, 500, False, base, base | perms(Perm.PLAYGROUND_USE))
    with pytest.raises(PermissionDenied):
        check_role_edit(limited_admin, 500, False, base, base | perms(Perm.AUDIT_VIEW))
    # Removing a permission you do not hold is also "managing" it.
    with pytest.raises(PermissionDenied):
        check_role_edit(limited_admin, 500, False, base | perms(Perm.AUDIT_VIEW), base)


def test_only_owner_edits_admin_role_and_nobody_edits_owner_role() -> None:
    with pytest.raises(PermissionDenied):
        check_role_edit(actor("admin"), ROLES["admin"].rank, False, frozenset(), frozenset())
    check_role_edit(actor("owner"), ROLES["admin"].rank, False, frozenset(), frozenset())
    with pytest.raises(PermissionDenied):
        check_role_edit(actor("owner"), OWNER_RANK, True, frozenset(), frozenset())


def test_role_edit_requires_manage_roles() -> None:
    with pytest.raises(PermissionDenied):
        check_role_edit(actor("manager"), 100, False, frozenset(), frozenset())


def test_role_placement() -> None:
    check_role_rank_target(actor("admin"), 899)
    with pytest.raises(PermissionDenied):
        check_role_rank_target(actor("admin"), 950)
    check_role_rank_target(actor("owner"), 950)
    with pytest.raises(PermissionDenied):
        check_role_rank_target(actor("owner"), OWNER_RANK)


def test_unknown_permissions_rejected() -> None:
    with pytest.raises(PermissionDenied):
        parse_permissions(["docs.view", "root.everything"])
