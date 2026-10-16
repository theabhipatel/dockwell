"""The engine manager: starts, stops and watches vLLM (GPU) and llama.cpp (CPU) containers
through the Docker Engine API on the local socket (ENGINE_MANAGER=docker).

The engines download model weights themselves on first start (into a shared cache volume), so a
deployment moves through downloading -> starting -> ready, or failed.
"""

import asyncio
import json
import re
import uuid
from contextlib import suppress
from typing import Any
from urllib.parse import quote

import httpx
from sqlalchemy import func, select

from dockwell_api.config import get_settings
from dockwell_api.db import SessionLocal, utcnow
from dockwell_api.logs import get_logger
from dockwell_api.models import AIModel, Deployment, Provider
from dockwell_api.security.crypto import decrypt
from dockwell_api.services import platform

log = get_logger("engines")

INTERNAL_PORT = {"vllm": 8000, "llamacpp": 8080}
DOWNLOAD_HINTS = re.compile(r"download|fetching|pulling|\d+%\|", re.IGNORECASE)
_tasks: set[asyncio.Task[None]] = set()


class EngineError(Exception):
    pass


def enabled() -> bool:
    return get_settings().engine_manager == "docker"


def _docker() -> httpx.AsyncClient:
    transport = httpx.AsyncHTTPTransport(uds=get_settings().docker_socket)
    return httpx.AsyncClient(transport=transport, base_url="http://docker", timeout=30)


async def docker_status() -> tuple[bool, str]:
    if not enabled():
        return False, "Engine manager is off (ENGINE_MANAGER=none)."
    try:
        async with _docker() as client:
            res = await client.get("/version")
            res.raise_for_status()
            return True, f"Docker {res.json().get('Version', '')}"
    except (httpx.HTTPError, OSError, ValueError) as exc:
        return False, f"Docker is not reachable: {type(exc).__name__}"


def container_name(public_id: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", public_id.lower()).strip("-")[:40] or "model"
    return f"dockwell-engine-{slug}-{uuid.uuid4().hex[:6]}"


def base_url(dep: Deployment) -> str:
    network = get_settings().engine_network
    port = INTERNAL_PORT[dep.engine]
    if network:
        return f"http://{dep.container_name}:{port}/v1"
    return f"http://127.0.0.1:{dep.host_port}/v1"


async def next_host_port() -> int:
    async with SessionLocal() as db:
        highest = await db.scalar(select(func.max(Deployment.host_port)))
    return max(highest or 0, get_settings().engine_port_range_start - 1) + 1


def _split_image(image: str) -> tuple[str, str]:
    name, _, tag = image.rpartition(":")
    if not name or "/" in tag:
        return image, "latest"
    return name, tag


def container_spec(dep: Deployment, model: AIModel, hf_token: str | None) -> dict[str, Any]:
    s = get_settings()
    port = INTERNAL_PORT[dep.engine]
    env: list[str] = []
    if hf_token:
        env += [f"HF_TOKEN={hf_token}", f"HUGGING_FACE_HUB_TOKEN={hf_token}"]
    host: dict[str, Any] = {"RestartPolicy": {"Name": "unless-stopped"}}
    if dep.engine == "vllm":
        image = s.vllm_image
        cmd = [
            "--model",
            dep.hf_repo,
            "--served-model-name",
            model.upstream_id,
            "--host",
            "0.0.0.0",  # noqa: S104 - inside the container
            "--port",
            str(port),
            "--max-model-len",
            str(dep.max_model_len or model.context_length),
            "--gpu-memory-utilization",
            str(dep.gpu_memory_utilization),
            "--dtype",
            dep.dtype or "auto",
            "--tensor-parallel-size",
            str(max(dep.gpu_count, 1)),
        ]
        if dep.quantization:
            cmd += ["--quantization", dep.quantization]
        if "tools" in (model.capabilities or []):
            cmd += ["--enable-auto-tool-choice", "--tool-call-parser", "hermes"]
        host["Binds"] = [f"{s.engine_hf_cache_volume}:/root/.cache/huggingface"]
        host["IpcMode"] = "host"
    else:
        image = s.llamacpp_image
        if dep.hf_file and dep.hf_file.endswith(".gguf"):
            source = ["--hf-repo", dep.hf_repo, "--hf-file", dep.hf_file]
        elif dep.hf_file:
            source = ["-hf", f"{dep.hf_repo}:{dep.hf_file}"]
        else:
            source = ["-hf", dep.hf_repo]
        cmd = [
            *source,
            "--host",
            "0.0.0.0",  # noqa: S104 - inside the container
            "--port",
            str(port),
            "-c",
            str(dep.max_model_len or model.context_length),
            "--alias",
            model.upstream_id,
            "--metrics",
            "--jinja",
        ]
        env.append("LLAMA_CACHE=/models")
        host["Binds"] = [f"{s.engine_hf_cache_volume}:/models"]
    cmd += list(dep.extra_args or [])
    if dep.gpu_count > 0:
        host["DeviceRequests"] = [
            {"Driver": "nvidia", "Count": dep.gpu_count, "Capabilities": [["gpu"]]}
        ]
    spec: dict[str, Any] = {
        "Image": image,
        "Cmd": cmd,
        "Env": env,
        "Labels": {"dockwell.deployment": str(dep.id), "dockwell.managed": "true"},
        "ExposedPorts": {f"{port}/tcp": {}},
        "HostConfig": host,
    }
    if s.engine_network:
        host["NetworkMode"] = s.engine_network
    else:
        host["PortBindings"] = {
            f"{port}/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(dep.host_port)}]
        }
    return spec


async def _set_status(dep_id: uuid.UUID, status: str, message: str | None) -> None:
    async with SessionLocal() as db:
        dep = await db.get(Deployment, dep_id)
        if dep is None:
            return
        model = await db.get(AIModel, dep.model_id)
        if model is not None:
            model.status = status
            model.status_message = (message or "")[:1000] or None
        await db.commit()


async def _pull(client: httpx.AsyncClient, image: str) -> None:
    name, tag = _split_image(image)
    async with client.stream(
        "POST", f"/images/create?fromImage={quote(name)}&tag={quote(tag)}", timeout=None
    ) as res:
        if res.status_code >= 400:
            raise EngineError(f"Could not pull {image} (HTTP {res.status_code})")
        async for line in res.aiter_lines():
            with suppress(ValueError):
                if "error" in json.loads(line):
                    raise EngineError(json.loads(line)["error"])


async def _launch(dep_id: uuid.UUID) -> None:
    """Pull the engine image, create and start the container (runs in the background)."""
    try:
        async with SessionLocal() as db:
            dep = await db.get(Deployment, dep_id)
            if dep is None:
                return
            model = await db.get(AIModel, dep.model_id)
            assert model is not None
            config = await platform.get_config(db)
            spec = container_spec(dep, model, decrypt(config.hf_token_enc))
            image, name = spec["Image"], dep.container_name
        await _set_status(dep_id, "downloading", f"Pulling engine image {image}")
        async with _docker() as client:
            await _pull(client, image)
            res = await client.post(f"/containers/create?name={quote(name)}", json=spec)
            if res.status_code == 409:
                pass  # already exists
            elif res.status_code >= 400:
                raise EngineError(f"Docker refused the container: {res.text[:300]}")
            res = await client.post(f"/containers/{quote(name)}/start")
            if res.status_code not in (204, 304):
                raise EngineError(f"Could not start the container: {res.text[:300]}")
            info = (await client.get(f"/containers/{quote(name)}/json")).json()
        async with SessionLocal() as db:
            dep = await db.get(Deployment, dep_id)
            if dep is not None:
                dep.container_id = info.get("Id")
                dep.started_at = utcnow()
                await db.commit()
        await _set_status(dep_id, "downloading", "Engine started; downloading model weights")
    except (EngineError, httpx.HTTPError, OSError) as exc:
        log.warning("Deployment %s failed to launch: %s", dep_id, exc)
        await _set_status(dep_id, "failed", str(exc) or type(exc).__name__)


def launch_in_background(dep_id: uuid.UUID) -> None:
    task = asyncio.create_task(_launch(dep_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def container_action(dep: Deployment, action: str) -> None:
    """start | stop | restart | remove"""
    async with _docker() as client:
        name = quote(dep.container_name)
        if action == "remove":
            res = await client.delete(f"/containers/{name}?force=true")
            if res.status_code not in (204, 404):
                raise EngineError(f"Could not remove the container: {res.text[:300]}")
            return
        res = await client.post(f"/containers/{name}/{action}", timeout=120)
        if res.status_code == 404:
            if action in ("start", "restart"):
                launch_in_background(dep.id)
                return
            return
        if res.status_code not in (204, 304):
            raise EngineError(f"Docker could not {action} the engine: {res.text[:300]}")


def _demux(raw: bytes) -> list[str]:
    """Docker multiplexes stdout/stderr with 8-byte frame headers when there is no TTY."""
    out: list[str] = []
    i = 0
    if len(raw) >= 8 and raw[0] in (0, 1, 2) and raw[1:4] == b"\x00\x00\x00":
        while i + 8 <= len(raw):
            size = int.from_bytes(raw[i + 4 : i + 8], "big")
            out.append(raw[i + 8 : i + 8 + size].decode(errors="replace"))
            i += 8 + size
        text = "".join(out)
    else:
        text = raw.decode(errors="replace")
    return [line.rstrip("\r") for line in text.splitlines()]


async def container_logs(dep: Deployment, tail: int = 300) -> list[str]:
    async with _docker() as client:
        res = await client.get(
            f"/containers/{quote(dep.container_name)}/logs",
            params={"stdout": 1, "stderr": 1, "tail": tail},
        )
        if res.status_code == 404:
            return ["The engine container does not exist (yet)."]
        res.raise_for_status()
        return _demux(res.content)[-tail:]


async def _health(url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(url.removesuffix("/v1") + "/health")
            return res.status_code == 200
    except httpx.HTTPError:
        return False


async def reconcile_deployment(dep_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        dep = await db.get(Deployment, dep_id)
        if dep is None:
            return
        model = await db.get(AIModel, dep.model_id)
        if model is None:
            return
        async with _docker() as client:
            res = await client.get(f"/containers/{quote(dep.container_name)}/json")
        if res.status_code == 404:
            if dep.desired_state == "stopped":
                model.status, model.status_message = "stopped", "Stopped by an admin."
            elif model.status not in ("downloading", "failed"):
                model.status, model.status_message = "failed", "The engine container is missing."
            await db.commit()
            return
        state = res.json().get("State", {})
        if state.get("Running"):
            if await _health(base_url(dep)):
                model.status, model.status_message = "ready", None
                dep.last_health_at = utcnow()
            else:
                lines = await container_logs(dep, 20)
                recent = "\n".join(lines[-5:])
                if DOWNLOAD_HINTS.search(recent):
                    model.status, model.status_message = (
                        "downloading",
                        lines[-1][:500] if lines else None,
                    )
                else:
                    model.status = "starting"
                    model.status_message = lines[-1][:500] if lines else "Loading the model"
        elif dep.desired_state == "stopped":
            model.status, model.status_message = "stopped", "Stopped by an admin."
        else:
            lines = await container_logs(dep, 20)
            exit_code = state.get("ExitCode")
            model.status = "failed"
            model.status_message = (
                f"Engine exited (code {exit_code}): "
                + (lines[-1] if lines else state.get("Error", ""))
            )[:1000]
        await db.commit()


async def reconcile_all() -> None:
    if not enabled():
        return
    async with SessionLocal() as db:
        ids = list((await db.execute(select(Deployment.id))).scalars())
    for dep_id in ids:
        try:
            await reconcile_deployment(dep_id)
        except (httpx.HTTPError, OSError, ValueError) as exc:
            log.warning("Could not check deployment %s: %s", dep_id, type(exc).__name__)


async def check_providers() -> None:
    """Ping unmanaged providers. Self-run engines (vLLM / llama.cpp) mark their models ready
    or starting depending on health, so a model still loading isn't offered as ready."""
    async with SessionLocal() as db:
        providers = list(
            (await db.execute(select(Provider).where(Provider.managed.is_(False)))).scalars()
        )
        for provider in providers:
            ok, message = await probe_provider(provider)
            provider.last_check_at = utcnow()
            provider.last_check_ok = ok
            provider.last_error = None if ok else message[:500]
            if provider.kind in ("vllm", "llamacpp"):
                models = (
                    await db.execute(select(AIModel).where(AIModel.provider_id == provider.id))
                ).scalars()
                for model in models:
                    if ok and model.status in ("starting", "failed"):
                        model.status, model.status_message = "ready", None
                    elif not ok and model.status == "ready":
                        model.status, model.status_message = "starting", "Engine not reachable yet."
        await db.commit()


async def probe_provider(provider: Provider) -> tuple[bool, str]:
    headers = {}
    key = decrypt(provider.api_key_enc)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(provider.base_url.rstrip("/") + "/models", headers=headers)
        if res.status_code == 200:
            return True, "Connected."
        return False, f"HTTP {res.status_code}"
    except httpx.HTTPError as exc:
        return False, f"Unreachable ({type(exc).__name__})"


async def list_remote_models(provider: Provider) -> list[dict[str, Any]]:
    headers = {}
    key = decrypt(provider.api_key_enc)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(provider.base_url.rstrip("/") + "/models", headers=headers)
        res.raise_for_status()
        payload = res.json()
    data = payload.get("data") if isinstance(payload, dict) else payload
    return [m for m in (data or []) if isinstance(m, dict) and m.get("id")]


async def engine_metrics(provider: Provider) -> dict[str, float]:
    """A few numbers from an engine's Prometheus /metrics (vLLM and llama.cpp both expose it)."""
    wanted = {
        "vllm:num_requests_running": "running",
        "vllm:num_requests_waiting": "waiting",
        "vllm:gpu_cache_usage_perc": "kv_cache_usage",
        "vllm:kv_cache_usage_perc": "kv_cache_usage",
        "llamacpp:requests_processing": "running",
        "llamacpp:requests_deferred": "waiting",
        "llamacpp:predicted_tokens_seconds": "tokens_per_second",
        "llamacpp:kv_cache_usage_ratio": "kv_cache_usage",
    }
    out: dict[str, float] = {}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(
                provider.base_url.removesuffix("/").removesuffix("/v1") + "/metrics"
            )
        if res.status_code != 200:
            return out
    except httpx.HTTPError:
        return out
    for line in res.text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        name = line.split("{", 1)[0].split(" ", 1)[0]
        if name in wanted:
            with suppress(ValueError, IndexError):
                out[wanted[name]] = out.get(wanted[name], 0) + float(line.rsplit(" ", 1)[1])
    return out
