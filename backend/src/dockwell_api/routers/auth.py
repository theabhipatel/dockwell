"""Sign up, email verification, sign in (password, Google, 2FA), password reset, sign out."""

import base64
import hashlib
import secrets
import uuid
from contextlib import suppress
from datetime import timedelta
from typing import Annotated
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select

from dockwell_api.config import get_settings
from dockwell_api.db import utcnow
from dockwell_api.deps import DB, CurrentAuth, Meta, load_session
from dockwell_api.logs import get_logger
from dockwell_api.models import EmailToken, User, UserSession, Workspace
from dockwell_api.schemas.auth import (
    Me,
    ResetPasswordIn,
    SessionStatus,
    SigninIn,
    SigninResult,
    SignupIn,
    TokenIn,
    TwoFactorSigninIn,
)
from dockwell_api.schemas.common import EmailIn, Message
from dockwell_api.security import ratelimit
from dockwell_api.security.passwords import hash_password, needs_rehash, verify_password
from dockwell_api.security.tokens import hash_token, sign_payload, verify_payload
from dockwell_api.services import audit, credits, email, platform
from dockwell_api.services.sessions import (
    clear_session_cookie,
    consume_email_token,
    issue_email_token,
    me,
    revoke_all_sessions,
    start_session,
)
from dockwell_api.services.two_factor import verify_second_factor

router = APIRouter(prefix="/auth", tags=["auth"])
log = get_logger("auth")

GENERIC_EMAIL_SENT = "If that address can receive email from us, a message is on its way."
TWO_FACTOR_TTL = 300


def _window(minutes: int) -> timedelta:
    return timedelta(minutes=minutes)


async def _limit_email_action(ip: str | None, address: str, action: str) -> None:
    s = get_settings()
    window = _window(s.email_action_window_minutes)
    await ratelimit.hit(f"{action}:ip:{ip}", s.email_action_limit * 4, window)
    await ratelimit.hit(f"{action}:email:{hash_token(address)}", s.email_action_limit, window)


def _domain_blocked(address: str, blocked: list[str]) -> bool:
    domain = address.rsplit("@", 1)[-1].lower()
    return any(
        domain == b.lower().lstrip("@") or domain.endswith("." + b.lower().lstrip("@"))
        for b in blocked
        if b.strip()
    )


async def grant_pending_free_credit(db: DB, user: User) -> None:
    """After verification, give the starter credit to a workspace the user already owns."""
    if user.free_credit_granted_at is not None:
        return
    workspace = await db.scalar(
        select(Workspace)
        .where(Workspace.owner_id == user.id)
        .order_by(Workspace.created_at)
        .limit(1)
    )
    if workspace is not None:
        await credits.grant_free_credit(db, user, workspace)


@router.get("/me")
async def get_me(auth: CurrentAuth) -> Me:
    return me(auth.user)


@router.get("/session")
async def session_status(request: Request, db: DB) -> SessionStatus:
    """Whether the browser is signed in, without a 401 (used by the public pages)."""
    auth = await load_session(db, request.cookies.get(get_settings().session_cookie_name))
    return SessionStatus(signed_in=auth is not None)


@router.post("/signup", status_code=status.HTTP_202_ACCEPTED)
async def signup(body: SignupIn, db: DB, meta: Meta) -> Message:
    config = await platform.get_config(db)
    if not config.signup_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sign up is currently closed.")
    if _domain_blocked(body.email, config.blocked_email_domains):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Sign up with this email domain is not allowed."
        )
    await _limit_email_action(meta.ip, body.email, "signup")
    if body.password.strip().lower() == body.email:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Your password must not be your email address."
        )
    existing = await db.scalar(select(User).where(User.email == body.email))
    if existing is not None:
        # Same response either way so sign-up cannot be used to discover accounts.
        if existing.email_verified_at is None and existing.google_sub is None:
            token = await issue_email_token(
                db,
                existing,
                "verify_email",
                timedelta(hours=get_settings().email_verification_ttl_hours),
                password_hash=hash_password(body.password),
            )
            email.send_verification(db, existing.email, body.name, token)
        else:
            email.send_account_exists(db, existing.email)
        await db.commit()
        return Message(message=GENERIC_EMAIL_SENT)

    password_hash = hash_password(body.password)
    user = User(
        email=body.email, name=body.name, password_hash=password_hash, password_changed_at=utcnow()
    )
    db.add(user)
    await db.flush()
    token = await issue_email_token(
        db,
        user,
        "verify_email",
        timedelta(hours=get_settings().email_verification_ttl_hours),
        password_hash=password_hash,
    )
    email.send_verification(db, user.email, user.name, token)
    audit.record(db, action="auth.sign_up", actor=user, meta=meta, details={"method": "password"})
    await db.commit()
    return Message(message=GENERIC_EMAIL_SENT)


@router.post("/verify-email")
async def verify_email(body: TokenIn, db: DB, meta: Meta, response: Response) -> Me:
    await ratelimit.hit(f"verify:ip:{meta.ip}", get_settings().token_submit_ip_limit, _window(15))
    consumed = await consume_email_token(db, body.token, "verify_email")
    if consumed is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This verification link is invalid or has expired."
        )
    user, record = consumed
    if user.suspended_at is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is suspended.")
    if user.email_verified_at is None:
        user.email_verified_at = utcnow()
        if record.password_hash is not None:
            user.password_hash = record.password_hash
            user.password_changed_at = utcnow()
    await grant_pending_free_credit(db, user)
    audit.record(db, action="auth.email_verified", actor=user, meta=meta)
    await start_session(db, response, user, meta, "email_verification")
    return me(user)


@router.post("/resend-verification", status_code=status.HTTP_202_ACCEPTED)
async def resend_verification(body: EmailIn, db: DB, meta: Meta) -> Message:
    await _limit_email_action(meta.ip, body.email, "verify_resend")
    user = await db.scalar(select(User).where(User.email == body.email))
    if user is not None and user.email_verified_at is None:
        latest = await db.scalar(
            select(EmailToken.password_hash)
            .where(EmailToken.user_id == user.id, EmailToken.purpose == "verify_email")
            .order_by(EmailToken.created_at.desc())
            .limit(1)
        )
        token = await issue_email_token(
            db,
            user,
            "verify_email",
            timedelta(hours=get_settings().email_verification_ttl_hours),
            password_hash=latest,
        )
        email.send_verification(db, user.email, user.name, token)
        await db.commit()
    return Message(message=GENERIC_EMAIL_SENT)


def _two_factor_challenge(user: User, method: str, next_path: str = "/app") -> str:
    return sign_payload(
        {"purpose": "2fa", "uid": str(user.id), "method": method, "next": next_path},
        TWO_FACTOR_TTL,
    )


@router.post("/signin")
async def signin(body: SigninIn, db: DB, meta: Meta, response: Response) -> SigninResult:
    s = get_settings()
    window = _window(s.signin_window_minutes)
    await ratelimit.hit(f"signin:ip:{meta.ip}", s.signin_ip_limit, window)
    # Lockout is keyed on the submitted address, not the account, so it behaves identically
    # for addresses that do not exist.
    email_key = f"signin:email:{hash_token(body.email)}"
    retry = await ratelimit.is_limited(email_key, s.signin_email_failure_limit, window)
    if retry is not None:
        raise ratelimit.RateLimited(retry)

    user = await db.scalar(select(User).where(User.email == body.email))
    if not verify_password(user.password_hash if user else None, body.password) or user is None:
        with suppress(ratelimit.RateLimited):
            await ratelimit.hit(email_key, s.signin_email_failure_limit, window)
        await audit.record_now(
            action="auth.sign_in",
            actor=user,
            actor_email=body.email,
            meta=meta,
            result="failure",
            details={"method": "password"},
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password.")

    if user.suspended_at is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is suspended.")
    config = await platform.get_config(db)
    if user.email_verified_at is None and config.require_email_verification:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Please verify your email address before signing in."
        )
    await ratelimit.reset(email_key)
    if user.password_hash and needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
        await db.commit()
    if user.totp_enabled_at is not None:
        return SigninResult(
            two_factor_required=True, challenge=_two_factor_challenge(user, "password")
        )
    await start_session(db, response, user, meta, "password")
    return SigninResult(me=me(user))


@router.post("/signin/2fa")
async def signin_two_factor(
    body: TwoFactorSigninIn, db: DB, meta: Meta, response: Response
) -> SigninResult:
    data = verify_payload(body.challenge)
    if not data or data.get("purpose") != "2fa":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This sign-in attempt has expired. Please sign in again."
        )
    user = await db.get(User, uuid.UUID(str(data["uid"])), with_for_update=True)
    if user is None or user.suspended_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please sign in again.")
    await ratelimit.hit(f"2fa:user:{user.id}", 10, _window(15))
    method = verify_second_factor(user, body.code)
    if method is None:
        await audit.record_now(
            action="auth.two_factor_failed", actor=user, meta=meta, result="failure"
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That code is not valid.")
    await start_session(db, response, user, meta, f"{data.get('method', 'password')}+{method}")
    return SigninResult(me=me(user))


@router.post("/signout")
async def signout(auth: CurrentAuth, db: DB, meta: Meta, response: Response) -> Message:
    await db.execute(delete(UserSession).where(UserSession.id == auth.session.id))
    audit.record(db, action="auth.sign_out", actor=auth.user, meta=meta)
    await db.commit()
    clear_session_cookie(response)
    return Message(message="Signed out.")


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(body: EmailIn, db: DB, meta: Meta) -> Message:
    await _limit_email_action(meta.ip, body.email, "reset")
    user = await db.scalar(select(User).where(User.email == body.email))
    if user is not None and user.suspended_at is None:
        token = await issue_email_token(
            db, user, "reset_password", timedelta(minutes=get_settings().password_reset_ttl_minutes)
        )
        email.send_password_reset(db, user.email, token)
        audit.record(db, action="auth.password_reset_requested", actor=user, meta=meta)
        await db.commit()
    return Message(message=GENERIC_EMAIL_SENT)


@router.post("/reset-password")
async def reset_password(body: ResetPasswordIn, db: DB, meta: Meta) -> Message:
    await ratelimit.hit(
        f"reset_submit:ip:{meta.ip}", get_settings().token_submit_ip_limit, _window(15)
    )
    consumed = await consume_email_token(db, body.token, "reset_password")
    if consumed is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This reset link is invalid or has expired."
        )
    user = consumed[0]
    user.password_hash = hash_password(body.password)
    user.password_changed_at = utcnow()
    # Following the link proves control of the mailbox.
    if user.email_verified_at is None:
        user.email_verified_at = utcnow()
        await grant_pending_free_credit(db, user)
    await revoke_all_sessions(db, user)
    email.send_password_changed(db, user.email)
    audit.record(db, action="auth.password_reset", actor=user, meta=meta)
    await db.commit()
    await ratelimit.reset(f"signin:email:{hash_token(user.email)}")
    return Message(message="Your password has been reset. You can sign in now.")


@router.post("/confirm-email")
async def confirm_email_change(body: TokenIn, db: DB, meta: Meta) -> Message:
    """Second half of an email change: the link sent to the new address."""
    await ratelimit.hit(
        f"confirm_email:ip:{meta.ip}", get_settings().token_submit_ip_limit, _window(15)
    )
    consumed = await consume_email_token(db, body.token, "change_email")
    if consumed is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This link is invalid or has expired.")
    user, record = consumed
    new_email = str(record.data.get("new_email", "")).lower()
    if not new_email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This link is invalid or has expired.")
    taken = await db.scalar(select(User.id).where(User.email == new_email, User.id != user.id))
    if taken is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "That email address is already in use.")
    old_email = user.email
    user.email = new_email
    user.email_verified_at = utcnow()
    email.send_email_changed_notice(db, old_email, new_email)
    audit.record(
        db, action="account.email_changed", actor=user, meta=meta, details={"from": old_email}
    )
    await db.commit()
    return Message(message="Your email address has been updated.")


# ---- Google sign-in (OAuth 2.0 authorization code flow with PKCE) -----------------------------

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 - URL, not a secret
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def _redirect_uri() -> str:
    return get_settings().app_url.rstrip("/") + "/api/auth/google/callback"


def _safe_next(value: str | None) -> str:
    """Only allow same-site relative paths, preventing open redirects."""
    if value and value.startswith("/") and not value.startswith("//") and "\\" not in value:
        return value
    return "/app"


def _fail(message: str, path: str = "/login") -> RedirectResponse:
    target = get_settings().app_url.rstrip("/") + path + "?" + urlencode({"error": message})
    return RedirectResponse(target, status_code=status.HTTP_303_SEE_OTHER)


@router.get("/google/start", include_in_schema=False)
async def google_start(
    request: Request,
    db: DB,
    meta: Meta,
    next: Annotated[str | None, Query()] = None,
    link: Annotated[bool, Query()] = False,
) -> RedirectResponse:
    s = get_settings()
    config = await platform.get_config(db)
    if not s.google_configured or not s.google_client_id or not config.google_signin_enabled:
        return _fail("Google sign-in is not available.")
    await ratelimit.hit(f"google:ip:{meta.ip}", 30, _window(15))
    link_user: str | None = None
    if link:
        auth = await load_session(db, request.cookies.get(s.session_cookie_name))
        if auth is None:
            return _fail("Sign in first to link your Google account.")
        link_user = str(auth.user.id)
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    params = {
        "client_id": s.google_client_id,
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "code_challenge": challenge.decode(),
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    response = RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}", status_code=303)
    payload = {"state": state, "verifier": verifier, "next": _safe_next(next), "link": link_user}
    response.set_cookie(
        s.oauth_cookie_name,
        sign_payload(payload, 600),
        max_age=600,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/google/callback", include_in_schema=False)
async def google_callback(request: Request, db: DB, meta: Meta) -> RedirectResponse:
    s = get_settings()
    stored = verify_payload(request.cookies.get(s.oauth_cookie_name, ""))
    state = request.query_params.get("state")
    code = request.query_params.get("code")
    if not stored or not state or not code or not secrets.compare_digest(stored["state"], state):
        return _fail("Google sign-in failed. Please try again.")
    if not s.google_client_id or not s.google_client_secret:
        return _fail("Google sign-in is not configured.")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            token_res = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": s.google_client_id,
                    "client_secret": s.google_client_secret.get_secret_value(),
                    "code": code,
                    "code_verifier": stored["verifier"],
                    "grant_type": "authorization_code",
                    "redirect_uri": _redirect_uri(),
                },
            )
            token_res.raise_for_status()
            access_token = token_res.json()["access_token"]
            info_res = await client.get(
                GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
            )
            info_res.raise_for_status()
            info = info_res.json()
    except (httpx.HTTPError, KeyError, ValueError):
        log.warning("Google token exchange failed")
        return _fail("Google sign-in failed. Please try again.")

    sub = str(info.get("sub", ""))
    address = str(info.get("email", "")).strip().lower()
    if not sub or not address or info.get("email_verified") is not True:
        return _fail("Your Google account email address is not verified.")

    # Linking Google to the signed-in account (from security settings).
    if stored.get("link"):
        user = await db.get(User, uuid.UUID(str(stored["link"])))
        if user is None:
            return _fail("Sign in first to link your Google account.")
        other = await db.scalar(select(User).where(User.google_sub == sub, User.id != user.id))
        if other is not None:
            return _fail("That Google account is linked to another user.", "/settings/security")
        user.google_sub = sub
        audit.record(db, action="auth.google_linked", actor=user, meta=meta)
        await db.commit()
        response = RedirectResponse(s.app_url.rstrip("/") + "/settings/security?linked=1", 303)
        response.delete_cookie(s.oauth_cookie_name, path="/")
        return response

    config = await platform.get_config(db)
    user = await db.scalar(select(User).where(User.google_sub == sub))
    if user is None:
        user = await db.scalar(select(User).where(User.email == address))
        if user is not None:
            if user.email_verified_at is None:
                # An unverified account with this address was never proven to belong to anyone.
                # Drop its password so whoever registered it cannot sign in to the linked account.
                user.password_hash = None
                user.email_verified_at = utcnow()
                await revoke_all_sessions(db, user)
                await grant_pending_free_credit(db, user)
            user.google_sub = sub
            audit.record(db, action="auth.google_linked", actor=user, meta=meta)
        else:
            if not config.signup_enabled:
                return _fail("Sign up is currently closed.")
            if _domain_blocked(address, config.blocked_email_domains):
                return _fail("Sign up with this email domain is not allowed.")
            name = str(info.get("name") or address.split("@")[0])[:120]
            user = User(email=address, name=name, google_sub=sub, email_verified_at=utcnow())
            db.add(user)
            await db.flush()
            audit.record(
                db, action="auth.sign_up", actor=user, meta=meta, details={"method": "google"}
            )
    if user.suspended_at is not None:
        await db.commit()
        return _fail("This account is suspended.")

    if user.totp_enabled_at is not None:
        await db.commit()
        challenge = _two_factor_challenge(user, "google", stored["next"])
        response = RedirectResponse(
            s.app_url.rstrip("/") + "/login/2fa?" + urlencode({"challenge": challenge}), 303
        )
        response.delete_cookie(s.oauth_cookie_name, path="/")
        return response

    response = RedirectResponse(s.app_url.rstrip("/") + stored["next"], status_code=303)
    response.delete_cookie(s.oauth_cookie_name, path="/")
    await start_session(db, response, user, meta, "google")
    return response
