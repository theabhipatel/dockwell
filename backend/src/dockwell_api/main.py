"""FastAPI application: middleware, error handling, background workers and routes.

- /api/*  the web app's API (session cookie + CSRF double-submit token)
- /v1/*   the OpenAI-compatible API (Bearer API key, no cookies, no CSRF)
"""

import asyncio
import ipaddress
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from dockwell_api.config import get_settings
from dockwell_api.deps import client_ip
from dockwell_api.logs import get_logger, setup_logging
from dockwell_api.metrics import IN_FLIGHT, render
from dockwell_api.permissions import PermissionDenied
from dockwell_api.routers import (
    account,
    activity,
    admin_models,
    admin_platform,
    admin_users,
    auth,
    billing,
    invitations,
    openai,
    playground,
    projects,
    public,
    roles,
    usage,
    workspaces,
)
from dockwell_api.security import ratelimit
from dockwell_api.services import bootstrap, email, gateway, housekeeping, platform
from dockwell_api.services.gateway import GatewayError

setup_logging()
log = get_logger("app")
settings = get_settings()

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_HEADER = "x-csrf-token"
MAX_BODY_BYTES = 8 * 1024 * 1024
MAX_INFERENCE_BODY_BYTES = 32 * 1024 * 1024
# Server-to-server endpoints that authenticate in their own way (signature, bearer secret).
CSRF_EXEMPT = {"/api/stripe/webhook"}


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if settings.environment != "test":
        try:
            await bootstrap.run()
        except Exception:
            log.exception("Start-up bootstrap failed (the API still starts)")
    stop = asyncio.Event()
    tasks: list[asyncio.Task[None]] = []
    # Background loops need a process that keeps running between requests. On serverless
    # hosting (SERVERLESS=true) they are replaced by inline delivery and the cron endpoint.
    if settings.environment != "test" and not settings.serverless:
        if settings.email_worker_enabled:
            tasks.append(asyncio.create_task(email.run_worker(stop)))
        tasks.append(asyncio.create_task(housekeeping.run_loop(stop)))
        tasks.append(asyncio.create_task(housekeeping.engine_loop(stop)))
    yield
    stop.set()
    for task in tasks:
        with suppress(asyncio.CancelledError):
            await task
    await gateway.close_http_client()


app = FastAPI(
    title="DockWell API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs" if settings.environment != "production" else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.environment != "production" else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_url.rstrip("/")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Authorization"],
)

_app_origin = "{0.scheme}://{0.netloc}".format(urlsplit(settings.app_url))


def _forbidden(message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status.HTTP_403_FORBIDDEN)


async def _ip_blocked(ip: str | None) -> bool:
    if ip is None:
        return False
    config = await platform.get_config()
    if not config.blocked_ips:
        return False
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for entry in config.blocked_ips:
        try:
            if address in ipaddress.ip_network(entry, strict=False):
                return True
        except ValueError:
            continue
    return False


@app.middleware("http")
async def security_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    path = request.url.path
    is_api = path.startswith("/api/")
    is_inference = path.startswith("/v1/")
    if (is_api or is_inference) and await _ip_blocked(client_ip(request)):
        if is_inference:
            return GatewayError(
                403, "Access denied.", type="permission_error", code="ip_blocked"
            ).response()
        return _forbidden("Access from your network is blocked.")

    if request.method not in SAFE_METHODS and (is_api or is_inference):
        length = request.headers.get("content-length")
        limit = MAX_INFERENCE_BODY_BYTES if is_inference else MAX_BODY_BYTES
        if length and length.isdigit() and int(length) > limit:
            if is_inference:
                return GatewayError(413, "Request too large.").response()
            return JSONResponse({"detail": "Request too large."}, status_code=413)

    if is_api and request.method not in SAFE_METHODS and path not in CSRF_EXEMPT:
        # 1) The request must come from our own origin.
        origin = request.headers.get("origin")
        if origin is not None and origin != _app_origin:
            return _forbidden("Cross-origin request blocked.")
        # 2) Double-submit token: only same-origin JavaScript can read the cookie to echo it.
        cookie = request.cookies.get(settings.csrf_cookie_name)
        header = request.headers.get(CSRF_HEADER)
        if not cookie or not header or not secrets.compare_digest(cookie, header):
            return _forbidden(
                "Your session security token is missing. Reload the page and try again."
            )

    outbox = email.track_request() if settings.serverless and is_api else None

    if is_inference:
        IN_FLIGHT.inc()
    try:
        response = await call_next(request)
    finally:
        if is_inference:
            IN_FLIGHT.dec()

    if outbox is not None and outbox.messages:
        # Serverless: send before returning, the platform may freeze the process afterwards.
        await email.deliver_queued(outbox)

    if is_api and settings.csrf_cookie_name not in request.cookies:
        response.set_cookie(
            settings.csrf_cookie_name,
            secrets.token_urlsafe(32),
            httponly=False,
            secure=settings.cookie_secure,
            samesite="strict",
            path="/",
        )
    headers = response.headers
    headers.setdefault("X-Content-Type-Options", "nosniff")
    headers.setdefault("X-Frame-Options", "DENY")
    headers.setdefault("Referrer-Policy", "no-referrer")
    if not is_inference:
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    if is_api or is_inference:
        headers.setdefault("Cache-Control", "no-store")
        if not path.startswith("/api/docs"):
            headers.setdefault(
                "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
            )
    if settings.cookie_secure:
        headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
    return response


@app.exception_handler(PermissionDenied)
async def permission_denied(_: Request, exc: PermissionDenied) -> JSONResponse:
    return JSONResponse({"detail": exc.message}, status_code=status.HTTP_403_FORBIDDEN)


@app.exception_handler(GatewayError)
async def gateway_error(_: Request, exc: GatewayError) -> JSONResponse:
    return exc.response()


@app.exception_handler(ratelimit.RateLimited)
async def rate_limited(_: Request, exc: ratelimit.RateLimited) -> JSONResponse:
    minutes = max(1, round(exc.retry_after / 60))
    return JSONResponse(
        {
            "detail": f"Too many attempts. Please try again in about {minutes} minute"
            f"{'s' if minutes != 1 else ''}."
        },
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        headers={"Retry-After": str(exc.retry_after)},
    )


@app.get("/api/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/internal/cron", include_in_schema=False)
async def cron(request: Request) -> JSONResponse:
    """Retry unsent emails and run housekeeping, for hosts without background workers.

    Off unless CRON_SECRET is set. Vercel Cron calls it and sends "Authorization: Bearer
    <CRON_SECRET>". Self-hosted installs don't need it: their background loops do this.
    """
    secret = settings.cron_secret
    supplied = request.headers.get("authorization", "")
    if secret is None or not secrets.compare_digest(
        supplied.encode(), f"Bearer {secret.get_secret_value()}".encode()
    ):
        return JSONResponse({"detail": "Not Found"}, status_code=status.HTTP_404_NOT_FOUND)
    sent = await email.deliver_pending(batch=100)
    await housekeeping.run_once()
    try:
        await bootstrap.run()
    except Exception:
        log.exception("Bootstrap from cron failed")
    return JSONResponse({"emails_sent": sent})


def _private(ip: str | None) -> bool:
    try:
        return ip is not None and ipaddress.ip_address(ip).is_private
    except ValueError:
        return False


@app.get("/api/metrics", include_in_schema=False)
async def metrics(request: Request) -> Response:
    """Prometheus metrics. Needs METRICS_TOKEN as a Bearer token, or a private address."""
    token = settings.metrics_token
    if token is not None:
        supplied = request.headers.get("authorization", "")
        if not secrets.compare_digest(
            supplied.encode(), f"Bearer {token.get_secret_value()}".encode()
        ):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
    elif not _private(request.client.host if request.client else None) or request.headers.get(
        "x-forwarded-for"
    ):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    body, content_type = render()
    return Response(body, media_type=content_type)


for module in (
    auth,
    account,
    public,
    workspaces,
    roles,
    invitations,
    projects,
    playground,
    billing,
    usage,
    activity,
    admin_users,
    admin_models,
    admin_platform,
):
    app.include_router(module.router, prefix="/api")
app.include_router(account.users_router, prefix="/api")
app.include_router(billing.webhook_router, prefix="/api")
app.include_router(openai.router)
