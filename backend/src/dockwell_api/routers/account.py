"""The signed-in user's own account: profile, avatar, password, email, Google, 2FA, sessions,
notification preferences and deletion."""

import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import aliased, undefer

from dockwell_api.config import get_settings
from dockwell_api.db import utcnow
from dockwell_api.deps import DB, CurrentAuth, Meta
from dockwell_api.models import AuditLog, Membership, ProjectMember, User, UserSession, Workspace
from dockwell_api.schemas.auth import (
    AccountActivity,
    BackupCodes,
    ChangeEmailIn,
    ChangePasswordIn,
    DeleteAccountIn,
    Me,
    NotificationCategory,
    NotificationPrefsIn,
    PasswordConfirmIn,
    ProfileUpdate,
    SessionOut,
    TwoFactorDisableIn,
    TwoFactorEnableIn,
    TwoFactorSetup,
)
from dockwell_api.schemas.common import Message
from dockwell_api.security import ratelimit, totp
from dockwell_api.security.crypto import decrypt, encrypt
from dockwell_api.security.passwords import hash_password, verify_password
from dockwell_api.services import audit, email, notifications
from dockwell_api.services.sessions import (
    clear_session_cookie,
    issue_email_token,
    me,
    revoke_all_sessions,
)
from dockwell_api.services.two_factor import verify_second_factor

router = APIRouter(prefix="/account", tags=["account"])
users_router = APIRouter(prefix="/users", tags=["account"])

# Magic bytes of the image formats we accept; the declared content type is not trusted.
IMAGE_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),
}


def sniff_image(data: bytes) -> str | None:
    for content_type, signatures in IMAGE_SIGNATURES.items():
        if any(data.startswith(sig) for sig in signatures):
            if content_type == "image/webp" and data[8:12] != b"WEBP":
                continue
            return content_type
    return None


async def read_image(file: UploadFile, limit: int) -> tuple[bytes, str]:
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, f"Images must be under {limit // 1_000_000 or 1} MB."
        )
    content_type = sniff_image(data)
    if content_type is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Use a PNG, JPEG, GIF or WebP image."
        )
    return data, content_type


def _check_password(user: User, password: str | None) -> None:
    if user.password_hash is not None and not verify_password(user.password_hash, password or ""):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your password is incorrect.")


@router.patch("")
async def update_profile(body: ProfileUpdate, auth: CurrentAuth, db: DB, meta: Meta) -> Me:
    user = auth.user
    changed: list[str] = []
    if body.name is not None and body.name != user.name:
        user.name = body.name
        changed.append("name")
    if body.theme is not None:
        user.theme = body.theme
    if changed:
        audit.record(
            db, action="account.profile_updated", actor=user, meta=meta, details={"fields": changed}
        )
    await db.commit()
    return me(user)


@router.put("/avatar")
async def upload_avatar(file: Annotated[UploadFile, File()], auth: CurrentAuth, db: DB) -> Me:
    data, content_type = await read_image(file, get_settings().max_avatar_bytes)
    user = auth.user
    user.avatar = data
    user.avatar_content_type = content_type
    user.avatar_updated_at = utcnow()
    await db.commit()
    return me(user)


@router.delete("/avatar")
async def delete_avatar(auth: CurrentAuth, db: DB) -> Me:
    user = auth.user
    user.avatar = None
    user.avatar_content_type = None
    user.avatar_updated_at = None
    await db.commit()
    return me(user)


@users_router.get("/{user_id}/avatar", include_in_schema=False)
async def get_avatar(user_id: uuid.UUID, auth: CurrentAuth, db: DB) -> Response:
    if user_id != auth.user.id and not auth.user.is_admin:
        mine = aliased(Membership)
        theirs = aliased(Membership)
        shares_workspace = await db.scalar(
            select(func.count())
            .select_from(mine)
            .join(theirs, theirs.workspace_id == mine.workspace_id)
            .where(mine.user_id == auth.user.id, theirs.user_id == user_id)
        )
        if not shares_workspace:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    user = await db.scalar(select(User).options(undefer(User.avatar)).where(User.id == user_id))
    if user is None or user.avatar is None or user.avatar_content_type is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    return Response(
        user.avatar,
        media_type=user.avatar_content_type,
        headers={
            "Cache-Control": "private, max-age=86400, immutable",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.post("/password")
async def change_password(body: ChangePasswordIn, auth: CurrentAuth, db: DB, meta: Meta) -> Message:
    user = auth.user
    await ratelimit.hit(f"change_password:user:{user.id}", 10, timedelta(minutes=15))
    if user.password_hash is not None and not verify_password(
        user.password_hash, body.current_password or ""
    ):
        await audit.record_now(
            action="account.password_changed", actor=user, meta=meta, result="failure"
        )
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your current password is incorrect.")
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = utcnow()
    await revoke_all_sessions(db, user, except_id=auth.session.id)
    email.send_password_changed(db, user.email)
    audit.record(db, action="account.password_changed", actor=user, meta=meta)
    await db.commit()
    return Message(message="Password updated. Your other sessions were signed out.")


@router.post("/email", status_code=status.HTTP_202_ACCEPTED)
async def request_email_change(
    body: ChangeEmailIn, auth: CurrentAuth, db: DB, meta: Meta
) -> Message:
    user = auth.user
    await ratelimit.hit(f"change_email:user:{user.id}", 5, timedelta(minutes=30))
    _check_password(user, body.password)
    if body.email == user.email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is already your email address.")
    taken = await db.scalar(select(User.id).where(User.email == body.email))
    if taken is None:
        token = await issue_email_token(
            db, user, "change_email", timedelta(hours=24), data={"new_email": body.email}
        )
        email.send_email_change(db, body.email, user.name, token)
    audit.record(db, action="account.email_change_requested", actor=user, meta=meta)
    await db.commit()
    return Message(message=f"We sent a confirmation link to {body.email}.")


@router.post("/google/unlink")
async def unlink_google(auth: CurrentAuth, db: DB, meta: Meta) -> Me:
    user = auth.user
    if user.google_sub is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google is not linked.")
    if user.password_hash is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Set a password first, so you can still sign in."
        )
    user.google_sub = None
    audit.record(db, action="auth.google_unlinked", actor=user, meta=meta)
    await db.commit()
    return me(user)


# ---- Two-factor authentication -----------------------------------------------------------------


@router.post("/2fa/setup")
async def two_factor_setup(auth: CurrentAuth, db: DB) -> TwoFactorSetup:
    user = auth.user
    if user.totp_enabled_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor authentication is already on.")
    secret = totp.new_secret()
    user.totp_secret_enc = encrypt(secret)
    await db.commit()
    return TwoFactorSetup(
        secret=secret,
        otpauth_url=totp.provisioning_uri(secret, user.email, get_settings().app_name),
    )


@router.post("/2fa/enable")
async def two_factor_enable(
    body: TwoFactorEnableIn, auth: CurrentAuth, db: DB, meta: Meta
) -> BackupCodes:
    user = auth.user
    await ratelimit.hit(f"2fa_enable:user:{user.id}", 10, timedelta(minutes=15))
    secret = decrypt(user.totp_secret_enc)
    if user.totp_enabled_at is not None or secret is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start the setup again.")
    counter = totp.verify(secret, body.code)
    if counter is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is not valid. Try again.")
    codes = totp.new_backup_codes()
    user.totp_enabled_at = utcnow()
    user.totp_last_counter = counter
    user.backup_code_hashes = [totp.hash_backup_code(c) for c in codes]
    email.send_two_factor_changed(db, user.email, enabled=True)
    audit.record(db, action="account.two_factor_enabled", actor=user, meta=meta)
    await db.commit()
    return BackupCodes(codes=codes)


@router.post("/2fa/disable")
async def two_factor_disable(body: TwoFactorDisableIn, auth: CurrentAuth, db: DB, meta: Meta) -> Me:
    user = auth.user
    await ratelimit.hit(f"2fa_disable:user:{user.id}", 10, timedelta(minutes=15))
    _check_password(user, body.password)
    if verify_second_factor(user, body.code) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is not valid.")
    user.totp_enabled_at = None
    user.totp_secret_enc = None
    user.totp_last_counter = None
    user.backup_code_hashes = []
    email.send_two_factor_changed(db, user.email, enabled=False)
    audit.record(db, action="account.two_factor_disabled", actor=user, meta=meta)
    await db.commit()
    return me(user)


@router.post("/2fa/backup-codes")
async def regenerate_backup_codes(
    body: PasswordConfirmIn, auth: CurrentAuth, db: DB, meta: Meta
) -> BackupCodes:
    user = auth.user
    await ratelimit.hit(f"2fa_codes:user:{user.id}", 10, timedelta(minutes=15))
    if user.totp_enabled_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor authentication is off.")
    if verify_second_factor(user, body.code or "") is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is not valid.")
    codes = totp.new_backup_codes()
    user.backup_code_hashes = [totp.hash_backup_code(c) for c in codes]
    audit.record(db, action="account.backup_codes_regenerated", actor=user, meta=meta)
    await db.commit()
    return BackupCodes(codes=codes)


# ---- Notification preferences ------------------------------------------------------------------


@router.get("/notification-categories")
async def notification_categories() -> list[NotificationCategory]:
    return [
        NotificationCategory(key=k, label=label, description=desc)
        for k, (label, desc) in notifications.EMAIL_CATEGORIES.items()
    ]


@router.put("/notification-prefs")
async def update_notification_prefs(body: NotificationPrefsIn, auth: CurrentAuth, db: DB) -> Me:
    known = notifications.EMAIL_CATEGORIES
    prefs = dict(auth.user.notification_prefs or {})
    for key, value in body.prefs.items():
        if key in known:
            prefs[key] = bool(value)
    auth.user.notification_prefs = prefs
    await db.commit()
    return me(auth.user)


# ---- Sessions and activity ---------------------------------------------------------------------


@router.get("/sessions")
async def list_sessions(auth: CurrentAuth, db: DB) -> list[SessionOut]:
    rows = (
        await db.execute(
            select(UserSession)
            .where(UserSession.user_id == auth.user.id)
            .order_by(UserSession.last_seen_at.desc())
        )
    ).scalars()
    return [
        SessionOut(
            id=s.id,
            created_at=s.created_at,
            last_seen_at=s.last_seen_at,
            ip=str(s.ip) if s.ip else None,
            user_agent=s.user_agent,
            current=s.id == auth.session.id,
        )
        for s in rows
    ]


@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: uuid.UUID, auth: CurrentAuth, db: DB, meta: Meta, response: Response
) -> Message:
    result = await db.execute(
        delete(UserSession).where(UserSession.id == session_id, UserSession.user_id == auth.user.id)
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")
    audit.record(db, action="auth.session_revoked", actor=auth.user, meta=meta)
    await db.commit()
    if session_id == auth.session.id:
        clear_session_cookie(response)
    return Message(message="Signed out that device.")


@router.post("/sessions/revoke-others")
async def revoke_other_sessions(auth: CurrentAuth, db: DB, meta: Meta) -> Message:
    await revoke_all_sessions(db, auth.user, except_id=auth.session.id)
    audit.record(db, action="auth.sessions_revoked_others", actor=auth.user, meta=meta)
    await db.commit()
    return Message(message="Signed out all other devices.")


@router.get("/activity")
async def account_activity(auth: CurrentAuth, db: DB) -> list[AccountActivity]:
    rows = (
        await db.execute(
            select(AuditLog)
            .where(
                AuditLog.actor_id == auth.user.id,
                AuditLog.action.like("auth.%") | AuditLog.action.like("account.%"),
            )
            .order_by(AuditLog.id.desc())
            .limit(50)
        )
    ).scalars()
    return [
        AccountActivity(
            id=r.id,
            created_at=r.created_at,
            action=r.action,
            result=r.result,
            ip=str(r.ip) if r.ip else None,
            user_agent=r.user_agent,
        )
        for r in rows
    ]


@router.post("/delete")
async def delete_account(
    body: DeleteAccountIn, auth: CurrentAuth, db: DB, meta: Meta, response: Response
) -> Message:
    user = auth.user
    if body.confirm_email.strip().lower() != user.email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Type your email address to confirm.")
    _check_password(user, body.password)
    await delete_user_account(db, user, actor=user, meta=meta)
    await db.commit()
    clear_session_cookie(response)
    return Message(message="Your account has been deleted.")


async def delete_user_account(db: DB, user: User, *, actor: User, meta: Meta) -> None:
    """Delete a user, their solo workspaces and their memberships (shared by the admin area)."""
    owned = (
        (await db.execute(select(Workspace).where(Workspace.owner_id == user.id))).scalars().all()
    )
    blocking: list[str] = []
    for ws in owned:
        others = await db.scalar(
            select(func.count())
            .select_from(Membership)
            .where(Membership.workspace_id == ws.id, Membership.user_id != user.id)
        )
        if others:
            blocking.append(ws.name)
    if blocking:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Transfer ownership or remove the other members first: " + ", ".join(blocking),
        )
    for ws in owned:
        audit.record(
            db,
            action="workspace.deleted",
            actor=actor,
            meta=meta,
            workspace_id=ws.id,
            target_type="workspace",
            target_id=ws.id,
            target_label=ws.name,
            details={"reason": "account_deleted"},
        )
        await db.delete(ws)
    await db.flush()
    memberships = (
        (await db.execute(select(Membership).where(Membership.user_id == user.id))).scalars().all()
    )
    for m in memberships:
        audit.record(
            db,
            action="member.left",
            actor=actor,
            meta=meta,
            workspace_id=m.workspace_id,
            target_type="user",
            target_id=user.id,
            target_label=user.email,
            details={"reason": "account_deleted"},
        )
    await db.execute(delete(ProjectMember).where(ProjectMember.user_id == user.id))
    await db.execute(delete(Membership).where(Membership.user_id == user.id))
    audit.record(
        db,
        action="account.deleted",
        actor=actor,
        meta=meta,
        target_type="user",
        target_id=user.id,
        target_label=user.email,
        admin=actor.id != user.id,
    )
    await db.delete(user)
