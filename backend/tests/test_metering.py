"""The metering gateway: reservation, exact charging, limits and concurrency."""

import asyncio
import uuid
from typing import Any

import httpx
from sqlalchemy import func, select

from dockwell_api.db import SessionLocal
from dockwell_api.models import LedgerEntry, RequestLog, Reservation
from dockwell_api.money import token_cost
from dockwell_api.services.catalog import EffectivePrice
from tests.conftest import (
    Client,
    chat_response,
    create_model,
    get_workspace,
    new_http,
    sse,
    stream_chunks,
    workspace_with_key,
)


def auth(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


def test_cost_is_exact_integer_and_rounds_up() -> None:
    price = EffectivePrice(150_000, 600_000, None, 0, False)
    # 10 input tokens at $0.15/M = 1.5 micro-dollars -> rounds up to 2.
    assert token_cost(10, 150_000) == 2
    assert price.cost(10, 5) == 2 + 3
    assert price.cost(0, 0) == 0
    assert EffectivePrice(0, 0, None, 0, True).cost(1000, 1000) == 0
    assert EffectivePrice(1_000_000, 1_000_000, None, 50, False).cost(1, 1) == 50


async def test_charges_exact_cost_and_releases_reservation(
    client: Client, fake_upstream: Any
) -> None:
    model = await create_model(input_price=1_000_000, output_price=2_000_000)
    ws, key, _ = await workspace_with_key(client, balance=1_000_000)
    fake_upstream["handler"] = lambda r: httpx.Response(
        200, json=chat_response(prompt=100, completion=50)
    )
    res = await client.http.post(
        "/v1/chat/completions",
        headers=auth(key),
        json={"model": model, "messages": [{"role": "user", "content": "hi"}]},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["model"] == model and body["usage"]["total_tokens"] == 150
    # 100 * $1/M + 50 * $2/M = 100 + 100 micro-dollars
    workspace = await get_workspace(ws)
    assert workspace.balance_micros == 1_000_000 - 200
    assert workspace.reserved_micros == 0
    assert res.headers["x-dockwell-cost-usd"] == "0.0002"
    # max_tokens was bounded for the reservation and forwarded with the upstream model name.
    forwarded = fake_upstream["requests"][-1]
    assert b'"upstream-model"' in forwarded.content and b"max_tokens" in forwarded.content
    async with SessionLocal() as db:
        log = await db.scalar(select(RequestLog).where(RequestLog.workspace_id == uuid.UUID(ws)))
        assert log is not None and log.cost_micros == 200 and log.status == "success"
        assert log.request_body is None  # prompts are not stored by default
        entries = (
            (await db.execute(select(LedgerEntry).where(LedgerEntry.workspace_id == uuid.UUID(ws))))
            .scalars()
            .all()
        )
        assert any(e.kind == "charge" and e.amount_micros == -200 for e in entries)


async def test_failed_requests_are_not_charged(client: Client, fake_upstream: Any) -> None:
    model = await create_model()
    ws, key, _ = await workspace_with_key(client, balance=1_000_000)
    fake_upstream["handler"] = lambda r: httpx.Response(500, json={"error": {"message": "boom"}})
    res = await client.http.post(
        "/v1/chat/completions",
        headers=auth(key),
        json={"model": model, "messages": [{"role": "user", "content": "hi"}]},
    )
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "model_unavailable"
    workspace = await get_workspace(ws)
    assert workspace.balance_micros == 1_000_000 and workspace.reserved_micros == 0


async def test_insufficient_credit_and_reservation_bound(
    client: Client, fake_upstream: Any
) -> None:
    model = await create_model(input_price=1_000_000, output_price=1_000_000)
    _, key, _ = await workspace_with_key(client, balance=500)
    # max_tokens 1000 at $1/M could cost 1000+ micro-dollars: more than the balance.
    res = await client.http.post(
        "/v1/chat/completions",
        headers=auth(key),
        json={"model": model, "max_tokens": 1000, "messages": [{"role": "user", "content": "hi"}]},
    )
    assert res.status_code == 429
    assert res.json()["error"]["type"] == "insufficient_quota"
    assert fake_upstream["requests"] == []


async def test_parallel_requests_never_overspend(client: Client, fake_upstream: Any) -> None:
    model = await create_model(input_price=1_000_000, output_price=1_000_000)
    ws, key, _ = await workspace_with_key(client, balance=5_000)

    async def slow(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.2)
        return httpx.Response(200, json=chat_response(prompt=10, completion=90))

    # MockTransport accepts async handlers too.
    fake_upstream["handler"] = slow
    body = {"model": model, "max_tokens": 1000, "messages": [{"role": "user", "content": "x"}]}
    async with new_http() as http:
        results = await asyncio.gather(
            *(http.post("/v1/chat/completions", headers=auth(key), json=body) for _ in range(12))
        )
    ok = [r for r in results if r.status_code == 200]
    refused = [r for r in results if r.status_code == 429]
    # Each request reserves ~1000+ micro-dollars, so only a few fit in 5000 at the same time:
    # the rest are refused instead of driving the balance below zero.
    assert ok and refused and len(ok) + len(refused) == 12
    workspace = await get_workspace(ws)
    assert workspace.balance_micros == 5_000 - 100 * len(ok)
    assert workspace.balance_micros >= 0 and workspace.reserved_micros == 0
    async with SessionLocal() as db:
        open_reservations = await db.scalar(
            select(func.count())
            .select_from(Reservation)
            .where(Reservation.workspace_id == uuid.UUID(ws))
        )
        assert open_reservations == 0


async def test_streaming_usage_and_charge(client: Client, fake_upstream: Any) -> None:
    model = await create_model(input_price=1_000_000, output_price=1_000_000)
    ws, key, _ = await workspace_with_key(client, balance=1_000_000)
    fake_upstream["handler"] = lambda r: httpx.Response(
        200,
        content=sse(stream_chunks(["Hel", "lo", "!"], prompt=7)),
        headers={"content-type": "text/event-stream"},
    )
    async with client.http.stream(
        "POST",
        "/v1/chat/completions",
        headers=auth(key),
        json={"model": model, "stream": True, "messages": [{"role": "user", "content": "hi"}]},
    ) as res:
        assert res.status_code == 200
        lines = [line async for line in res.aiter_lines() if line.startswith("data:")]
    assert lines[-1] == "data: [DONE]"
    assert any('"usage"' in line and '"total_tokens":10' in line for line in lines)
    assert all(model in line for line in lines[:-1])
    forwarded = fake_upstream["requests"][-1].content
    assert b'"include_usage": true' in forwarded or b'"include_usage":true' in forwarded
    workspace = await get_workspace(ws)
    assert workspace.balance_micros == 1_000_000 - 10 and workspace.reserved_micros == 0


async def test_stream_without_usage_is_estimated(client: Client, fake_upstream: Any) -> None:
    model = await create_model(input_price=0, output_price=1_000_000)
    ws, key, _ = await workspace_with_key(client, balance=1_000_000)
    chunks = stream_chunks(["a", "b", "c", "d"])[:-1]  # no usage chunk, no [DONE]
    fake_upstream["handler"] = lambda r: httpx.Response(200, content=sse(chunks, done=False))
    async with client.http.stream(
        "POST",
        "/v1/chat/completions",
        headers=auth(key),
        json={"model": model, "stream": True, "messages": [{"role": "user", "content": "hi"}]},
    ) as res:
        lines = [line async for line in res.aiter_lines() if line.startswith("data:")]
    assert lines[-1] == "data: [DONE]"
    workspace = await get_workspace(ws)
    assert workspace.balance_micros == 1_000_000 - 4  # one token per streamed piece


async def test_key_restrictions_and_limits(client: Client, fake_upstream: Any) -> None:
    allowed = await create_model()
    other = await create_model()
    ws, _, _ = await workspace_with_key(client)
    detail = (await client.get(f"/api/workspaces/{ws}")).json()
    res = await client.post(
        f"/api/workspaces/{ws}/api-keys",
        json={
            "project_id": detail["default_project_id"],
            "name": "limited",
            "allowed_models": [allowed],
            "rpm_limit": 2,
        },
    )
    key = res.json()["secret"]
    body = {"messages": [{"role": "user", "content": "hi"}]}
    res = await client.http.post(
        "/v1/chat/completions", headers=auth(key), json={**body, "model": other}
    )
    assert res.status_code == 403 and res.json()["error"]["code"] == "model_not_allowed"
    codes = [
        (
            await client.http.post(
                "/v1/chat/completions", headers=auth(key), json={**body, "model": allowed}
            )
        ).status_code
        for _ in range(3)
    ]
    # The refused request above also counted against the per-minute window.
    assert codes.count(429) >= 1
    models = (await client.http.get("/v1/models", headers=auth(key))).json()["data"]
    assert [m["id"] for m in models] == [allowed]


async def test_monthly_spend_limit_is_a_hard_stop(client: Client, fake_upstream: Any) -> None:
    model = await create_model(input_price=1_000_000, output_price=1_000_000)
    ws, key, _ = await workspace_with_key(client, balance=1_000_000)
    res = await client.patch(
        f"/api/workspaces/{ws}/billing/settings", json={"monthly_spend_limit_micros": 100}
    )
    assert res.status_code == 200
    res = await client.http.post(
        "/v1/chat/completions",
        headers=auth(key),
        json={"model": model, "max_tokens": 500, "messages": [{"role": "user", "content": "hi"}]},
    )
    assert res.status_code == 429 and res.json()["error"]["code"] == "spend_limit_reached"


async def test_playground_is_charged_like_the_api(client: Client, fake_upstream: Any) -> None:
    model = await create_model(input_price=1_000_000, output_price=1_000_000)
    ws, _, _ = await workspace_with_key(client, balance=1_000_000)
    fake_upstream["handler"] = lambda r: httpx.Response(
        200, content=sse(stream_chunks(["Hi"], prompt=3))
    )
    res = await client.post(
        f"/api/workspaces/{ws}/playground/chat",
        json={"model": model, "messages": [{"role": "user", "content": "hello"}]},
    )
    assert res.status_code == 200
    assert '"cost_micros": 4' in res.text
    workspace = await get_workspace(ws)
    assert workspace.balance_micros == 1_000_000 - 4
    logs = (await client.get(f"/api/workspaces/{ws}/logs")).json()["items"]
    assert logs[0]["source"] == "playground"
