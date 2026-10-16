"""Sign up, verification, sign in, lockout, 2FA, sessions, password reset and starter credit."""

import time

from dockwell_api.security import totp
from tests.conftest import PASSWORD, Client, latest_email, new_http, signup_and_verify, unique_email


async def test_signup_requires_verification_then_grants_credit_once(client: Client) -> None:
    address = unique_email("signup")
    res = await client.post(
        "/api/auth/signup", json={"name": "Ada", "email": address, "password": PASSWORD}
    )
    assert res.status_code == 202
    # Unverified accounts cannot sign in.
    res = await client.post("/api/auth/signin", json={"email": address, "password": PASSWORD})
    assert res.status_code == 403
    token = await latest_email(address, r"verify-email\?token=([\w-]+)")
    res = await client.post("/api/auth/verify-email", json={"token": token})
    assert res.status_code == 200
    assert res.json()["email_verified"] is True
    res = await client.post("/api/workspaces", json={"name": "First"})
    assert res.status_code == 201
    assert res.json()["free_credit_micros"] == 3_000_000
    # A second workspace never grants more free credit.
    res = await client.post("/api/workspaces", json={"name": "Second"})
    assert res.json()["free_credit_micros"] == 0
    first = (await client.get("/api/workspaces")).json()
    balances = []
    for ws in first:
        billing = (await client.get(f"/api/workspaces/{ws['id']}/billing")).json()
        balances.append(billing["balance_micros"])
    assert sorted(balances) == [0, 3_000_000]


async def test_signup_does_not_reveal_existing_accounts(client: Client) -> None:
    me = await signup_and_verify(client, workspace=None)
    async with new_http() as http:
        other = Client(http)
        res = await other.post(
            "/api/auth/signup", json={"name": "X", "email": me["email"], "password": PASSWORD}
        )
        assert res.status_code == 202
    body = await latest_email(me["email"], r"(already have an account)")
    assert body


async def test_wrong_password_and_lockout(client: Client) -> None:
    me = await signup_and_verify(client, workspace=None)
    async with new_http() as http:
        c = Client(http)
        for _ in range(5):
            res = await c.post(
                "/api/auth/signin", json={"email": me["email"], "password": "wrong password"}
            )
            assert res.status_code == 401
        # Locked out now, even with the right password.
        res = await c.post("/api/auth/signin", json={"email": me["email"], "password": PASSWORD})
        assert res.status_code == 429


async def test_two_factor_sign_in_and_backup_codes(client: Client) -> None:
    me = await signup_and_verify(client, workspace=None)
    setup = (await client.post("/api/account/2fa/setup")).json()
    secret = setup["secret"]
    assert setup["otpauth_url"].startswith("otpauth://totp/")
    res = await client.post("/api/account/2fa/enable", json={"code": "000000"})
    assert res.status_code == 400
    res = await client.post("/api/account/2fa/enable", json={"code": totp.current_code(secret)})
    assert res.status_code == 200
    codes = res.json()["codes"]
    assert len(codes) == 10

    async with new_http() as http:
        c = Client(http)
        res = await c.post("/api/auth/signin", json={"email": me["email"], "password": PASSWORD})
        body = res.json()
        assert body["two_factor_required"] is True and body["me"] is None
        assert (await c.get("/api/auth/me")).status_code == 401
        res = await c.post(
            "/api/auth/signin/2fa", json={"challenge": body["challenge"], "code": "123456"}
        )
        assert res.status_code == 401
        # A backup code works once.
        res = await c.post(
            "/api/auth/signin/2fa", json={"challenge": body["challenge"], "code": codes[0]}
        )
        assert res.status_code == 200
        assert (await c.get("/api/auth/me")).json()["backup_codes_remaining"] == 9

    async with new_http() as http:
        c = Client(http)
        body = (
            await c.post("/api/auth/signin", json={"email": me["email"], "password": PASSWORD})
        ).json()
        res = await c.post(
            "/api/auth/signin/2fa", json={"challenge": body["challenge"], "code": codes[0]}
        )
        assert res.status_code == 401
        # The next time step, so the code is not a replay of the one used to enable 2FA.
        code = totp.current_code(secret, time.time() + totp.STEP)
        res = await c.post(
            "/api/auth/signin/2fa", json={"challenge": body["challenge"], "code": code}
        )
        assert res.status_code == 200


async def test_sessions_list_and_revoke_others(client: Client) -> None:
    me = await signup_and_verify(client, workspace=None)
    async with new_http() as http:
        other = Client(http)
        await other.post("/api/auth/signin", json={"email": me["email"], "password": PASSWORD})
        assert (await other.get("/api/auth/me")).status_code == 200
        sessions = (await client.get("/api/account/sessions")).json()
        assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1
        res = await client.post("/api/account/sessions/revoke-others")
        assert res.status_code == 200
        assert (await other.get("/api/auth/me")).status_code == 401


async def test_password_reset_signs_out_everywhere(client: Client) -> None:
    me = await signup_and_verify(client, workspace=None)
    async with new_http() as http:
        c = Client(http)
        assert (
            await c.post("/api/auth/forgot-password", json={"email": me["email"]})
        ).status_code == 202
        token = await latest_email(me["email"], r"reset-password\?token=([\w-]+)")
        res = await c.post(
            "/api/auth/reset-password", json={"token": token, "password": "a brand new password"}
        )
        assert res.status_code == 200
        # Token is single-use.
        res = await c.post(
            "/api/auth/reset-password", json={"token": token, "password": "another password!"}
        )
        assert res.status_code == 400
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_csrf_is_required_for_api_mutations(client: Client) -> None:
    await signup_and_verify(client, workspace=None)
    res = await client.http.post("/api/workspaces", json={"name": "No token"})
    assert res.status_code == 403


async def test_admin_area_is_hidden_from_non_admins(client: Client) -> None:
    await signup_and_verify(client, workspace=None)
    assert (await client.get("/api/admin/overview")).status_code == 404
