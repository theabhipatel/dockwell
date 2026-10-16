"""The OpenAI-compatible surface: auth errors, error format, models, completions, embeddings."""

from typing import Any

import httpx

from tests.conftest import Client, create_model, workspace_with_key


def auth(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


async def test_missing_and_invalid_keys_use_openai_errors(client: Client) -> None:
    res = await client.http.post("/v1/chat/completions", json={})
    assert res.status_code == 401
    error = res.json()["error"]
    assert set(error) == {"message", "type", "param", "code"} and error["code"] == "invalid_api_key"
    res = await client.http.get("/v1/models", headers=auth("dw-" + "x" * 43))
    assert res.status_code == 401


async def test_revoked_key_stops_working(client: Client, fake_upstream: Any) -> None:
    ws, key, _ = await workspace_with_key(client)
    assert (await client.http.get("/v1/models", headers=auth(key))).status_code == 200
    key_id = (await client.get(f"/api/workspaces/{ws}/api-keys")).json()[0]["id"]
    await client.post(f"/api/workspaces/{ws}/api-keys/{key_id}/revoke")
    assert (await client.http.get("/v1/models", headers=auth(key))).status_code == 401


async def test_model_not_found_and_unavailable(client: Client, fake_upstream: Any) -> None:
    _, key, _ = await workspace_with_key(client)
    body = {"messages": [{"role": "user", "content": "hi"}]}
    res = await client.http.post(
        "/v1/chat/completions", headers=auth(key), json={**body, "model": "nope"}
    )
    assert res.status_code == 404 and res.json()["error"]["code"] == "model_not_found"
    starting = await create_model(status="starting")
    res = await client.http.post(
        "/v1/chat/completions", headers=auth(key), json={**body, "model": starting}
    )
    assert res.status_code == 503 and res.json()["error"]["code"] == "model_unavailable"
    res = await client.http.post("/v1/chat/completions", headers=auth(key), content=b"not json")
    assert res.status_code == 400


async def test_models_endpoint_lists_prices(client: Client, fake_upstream: Any) -> None:
    model = await create_model(input_price=150_000, output_price=600_000)
    _, key, _ = await workspace_with_key(client)
    data = (await client.http.get("/v1/models", headers=auth(key))).json()
    assert data["object"] == "list"
    entry = next(m for m in data["data"] if m["id"] == model)
    assert entry["object"] == "model" and entry["pricing"]["input_per_million"] == 0.15
    single = await client.http.get(f"/v1/models/{model}", headers=auth(key))
    assert single.status_code == 200 and single.json()["id"] == model


async def test_completions_and_embeddings(client: Client, fake_upstream: Any) -> None:
    chat_model = await create_model()
    embed_model = await create_model(capabilities=["embeddings"])
    _, key, _ = await workspace_with_key(client)
    fake_upstream["handler"] = lambda r: httpx.Response(
        200,
        json={
            "object": "list",
            "data": [{"object": "embedding", "index": 0, "embedding": [0.1, 0.2]}],
            "model": "upstream-model",
            "usage": {"prompt_tokens": 4, "total_tokens": 4},
        },
    )
    res = await client.http.post(
        "/v1/embeddings", headers=auth(key), json={"model": embed_model, "input": "hello"}
    )
    assert res.status_code == 200 and res.json()["usage"]["prompt_tokens"] == 4
    res = await client.http.post(
        "/v1/embeddings", headers=auth(key), json={"model": chat_model, "input": "hello"}
    )
    assert res.status_code == 400
    fake_upstream["handler"] = lambda r: httpx.Response(
        200,
        json={
            "object": "text_completion",
            "choices": [{"text": "world", "index": 0}],
            "model": "upstream-model",
        },
    )
    res = await client.http.post(
        "/v1/completions", headers=auth(key), json={"model": chat_model, "prompt": "hello"}
    )
    assert res.status_code == 200
    # No usage from the engine: DockWell estimates it and still returns usage.
    assert res.json()["usage"]["completion_tokens"] >= 1


async def test_tools_require_capability(client: Client, fake_upstream: Any) -> None:
    plain = await create_model(capabilities=["chat"])
    _, key, _ = await workspace_with_key(client)
    res = await client.http.post(
        "/v1/chat/completions",
        headers=auth(key),
        json={
            "model": plain,
            "messages": [{"role": "user", "content": "hi"}],
            "tools": [{"type": "function", "function": {"name": "f", "parameters": {}}}],
        },
    )
    assert res.status_code == 400 and res.json()["error"]["param"] == "tools"
