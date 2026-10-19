"""Workspaces, roles, invitations, project access and API key permissions."""

from dockwell_api.db import SessionLocal
from dockwell_api.services import platform
from tests.conftest import Client, add_member, closing, role_id, signup_and_verify


async def test_member_cannot_manage_billing_or_invite(client: Client) -> None:
    owner = await signup_and_verify(client)
    ws = owner["workspace_id"]
    member, _ = await add_member(client, ws, "Member")
    async with closing(member):
        assert (await member.get(f"/api/workspaces/{ws}/billing")).status_code == 403
        res = await member.post(
            f"/api/workspaces/{ws}/billing/checkout", json={"amount_cents": 1000}
        )
        assert res.status_code == 403
        res = await member.post(
            f"/api/workspaces/{ws}/invitations",
            json={"email": "x@example.com", "role_id": await role_id(client, ws, "Member")},
        )
        assert res.status_code == 403
        # Members see only projects they are assigned to.
        assert (await member.get(f"/api/workspaces/{ws}/projects")).json() == []


async def test_project_access_and_own_keys(client: Client) -> None:
    owner = await signup_and_verify(client)
    ws = owner["workspace_id"]
    project = (await client.post(f"/api/workspaces/{ws}/projects", json={"name": "Bot"})).json()
    member, _ = await add_member(client, ws, "Member", project_ids=[project["id"]])
    async with closing(member):
        projects = (await member.get(f"/api/workspaces/{ws}/projects")).json()
        assert [p["id"] for p in projects] == [project["id"]]
        res = await member.post(
            f"/api/workspaces/{ws}/api-keys", json={"project_id": project["id"], "name": "mine"}
        )
        assert res.status_code == 201
        mine = res.json()["key"]
        assert res.json()["secret"].startswith("dw-")
        # The owner's key in the same project is visible but not manageable by a member.
        owner_key = (
            await client.post(
                f"/api/workspaces/{ws}/api-keys",
                json={"project_id": project["id"], "name": "owner"},
            )
        ).json()["key"]
        keys = {k["id"]: k for k in (await member.get(f"/api/workspaces/{ws}/api-keys")).json()}
        assert keys[mine["id"]]["can_manage"] is True
        assert keys[owner_key["id"]]["can_manage"] is False
        res = await member.post(f"/api/workspaces/{ws}/api-keys/{owner_key['id']}/revoke")
        assert res.status_code == 403
        res = await member.post(f"/api/workspaces/{ws}/api-keys/{mine['id']}/revoke")
        assert res.status_code == 200 and res.json()["status"] == "revoked"


async def test_key_is_shown_once_and_stored_hashed(client: Client) -> None:
    owner = await signup_and_verify(client)
    ws = owner["workspace_id"]
    detail = (await client.get(f"/api/workspaces/{ws}")).json()
    created = (
        await client.post(
            f"/api/workspaces/{ws}/api-keys",
            json={"project_id": detail["default_project_id"], "name": "k"},
        )
    ).json()
    listed = (await client.get(f"/api/workspaces/{ws}/api-keys")).json()
    assert created["secret"] not in str(listed)
    assert listed[0]["display"].endswith(created["secret"][-4:])


async def test_custom_role_and_hierarchy(client: Client) -> None:
    owner = await signup_and_verify(client)
    ws = owner["workspace_id"]
    member_role = await role_id(client, ws, "Member")
    res = await client.post(
        f"/api/workspaces/{ws}/roles",
        json={
            "name": "Analyst",
            "permissions": ["usage.view", "logs.view"],
            "place_below_role_id": member_role,
        },
    )
    assert res.status_code == 201
    manager, _ = await add_member(client, ws, "Manager")
    async with closing(manager):
        admin_role = await role_id(client, ws, "Admin")
        res = await manager.post(
            f"/api/workspaces/{ws}/invitations",
            json={"email": "z@example.com", "role_id": admin_role},
        )
        assert res.status_code == 403


async def test_transfer_ownership_and_activity_log(client: Client) -> None:
    owner = await signup_and_verify(client)
    ws = owner["workspace_id"]
    admin, admin_me = await add_member(client, ws, "Admin")
    async with closing(admin):
        name = (await client.get(f"/api/workspaces/{ws}")).json()["name"]
        res = await client.post(
            f"/api/workspaces/{ws}/transfer", json={"user_id": admin_me["id"], "confirm_name": name}
        )
        assert res.status_code == 200
        assert (await admin.get(f"/api/workspaces/{ws}")).json()["is_owner"] is True
        log = (await admin.get(f"/api/workspaces/{ws}/audit")).json()
        assert any(e["action"] == "workspace.ownership_transferred" for e in log)


async def test_new_keys_get_the_default_spend_limit(client: Client) -> None:
    async with SessionLocal() as db:
        await platform.update_config(db, {"default_key_spend_limit_micros": 5_000_000}, None)
        await db.commit()
    try:
        me = await signup_and_verify(client)
        ws = me["workspace_id"]
        project = (await client.get(f"/api/workspaces/{ws}")).json()["default_project_id"]
        res = await client.post(
            f"/api/workspaces/{ws}/api-keys", json={"project_id": project, "name": "default"}
        )
        assert res.status_code == 201, res.text
        assert res.json()["key"]["spend_limit_micros"] == 5_000_000
        res = await client.post(
            f"/api/workspaces/{ws}/api-keys",
            json={"project_id": project, "name": "own", "spend_limit_micros": 1_000_000},
        )
        assert res.json()["key"]["spend_limit_micros"] == 1_000_000
    finally:
        async with SessionLocal() as db:
            await platform.update_config(db, {"default_key_spend_limit_micros": None}, None)
            await db.commit()
