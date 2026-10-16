"""Transactional email: templates, the outbox and the delivery worker.

Every email is first written to the `email_outbox` table in the same transaction as the change
that caused it, then delivered:
- on a long-running server (self-hosted), by `run_worker`, a background loop;
- on serverless hosting (SERVERLESS=true), right after the request that queued it, see
  `track_request` / `deliver_queued`, with GET /api/internal/cron retrying failures.
"""

import asyncio
import html
import logging
import uuid
from collections.abc import Collection
from contextlib import suppress
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import timedelta
from email.message import EmailMessage
from urllib.parse import quote

import aiosmtplib
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.config import get_settings
from dockwell_api.db import SessionLocal, utcnow
from dockwell_api.models import EmailOutbox

log = logging.getLogger("dockwell.email")
MAX_ATTEMPTS = 8


def _render(
    title: str,
    paragraphs: list[str],
    action: tuple[str, str] | None = None,
    footer: str | None = None,
) -> tuple[str, str]:
    """Return (text, html) bodies. All dynamic values must already be plain text."""
    settings = get_settings()
    text_parts = [title, "", *paragraphs]
    if action:
        text_parts += ["", f"{action[0]}: {action[1]}"]
    if footer:
        text_parts += ["", footer]
    text_parts += ["", settings.app_name]

    esc = html.escape
    button = ""
    if action:
        button = (
            f'<p style="margin:28px 0"><a href="{esc(action[1], quote=True)}" '
            'style="background:#4f46e5;color:#ffffff;padding:12px 20px;border-radius:10px;'
            f'text-decoration:none;font-weight:600;display:inline-block">{esc(action[0])}</a></p>'
            f'<p style="color:#6b7280;font-size:13px">Or paste this link into your browser:<br>'
            f'<span style="word-break:break-all">{esc(action[1])}</span></p>'
        )
    body = "".join(f'<p style="margin:0 0 14px">{esc(p)}</p>' for p in paragraphs)
    foot = (
        f'<p style="color:#6b7280;font-size:13px;margin-top:24px">{esc(footer)}</p>'
        if footer
        else ""
    )
    html_body = (
        '<!doctype html><html><body style="margin:0;background:#f4f5f4;padding:32px 12px;'
        'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1f1e">'
        '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;'
        'padding:32px;border:1px solid #e5e7e6">'
        '<div style="font-weight:700;font-size:15px;color:#4f46e5;margin-bottom:20px">'
        f'<img src="{esc(settings.app_url.rstrip("/"))}/logo-email.png" width="28" height="28" '
        'alt="" style="vertical-align:middle;border-radius:7px;margin-right:8px">'
        f"{esc(settings.app_name)}</div>"
        f'<h1 style="font-size:20px;margin:0 0 16px">{esc(title)}</h1>{body}{button}{foot}'
        "</div></body></html>"
    )
    return "\n".join(text_parts), html_body


def enqueue(
    db: AsyncSession,
    to: str,
    subject: str,
    title: str,
    paragraphs: list[str],
    action: tuple[str, str] | None = None,
    footer: str | None = None,
) -> None:
    text_body, html_body = _render(title, paragraphs, action, footer)
    message = EmailOutbox(to_address=to, subject=subject, text_body=text_body, html_body=html_body)
    db.add(message)
    tracker = _request_tracker.get()
    if tracker is not None:
        tracker.messages.append(message)


def link(path: str) -> str:
    return get_settings().app_url.rstrip("/") + path


# ---- Templates -------------------------------------------------------------------------------
# Security emails are always sent. Others respect the user's notification preferences, which
# callers check through `services.notifications`.


def send_verification(db: AsyncSession, to: str, name: str, token: str) -> None:
    enqueue(
        db,
        to,
        "Verify your email address",
        f"Welcome, {name}",
        [
            "Confirm your email address to finish creating your account.",
            "Your starter credit is added once your email is verified.",
        ],
        ("Verify email", link(f"/verify-email?token={token}")),
        "If you did not sign up, you can ignore this email.",
    )


def send_account_exists(db: AsyncSession, to: str) -> None:
    enqueue(
        db,
        to,
        "Sign-up attempt for your account",
        "You already have an account",
        [
            "Someone (hopefully you) tried to sign up with this email address, "
            "but an account already exists.",
            "If you forgot your password you can reset it below.",
        ],
        ("Reset password", link("/forgot-password")),
        "If this was not you, no action is needed. Your account is unchanged.",
    )


def send_password_reset(db: AsyncSession, to: str, token: str) -> None:
    minutes = get_settings().password_reset_ttl_minutes
    enqueue(
        db,
        to,
        "Reset your password",
        "Reset your password",
        [
            f"Use the link below to choose a new password. It expires in {minutes} "
            "minutes and can be used once."
        ],
        ("Choose a new password", link(f"/reset-password?token={token}")),
        "If you did not request this, you can ignore this email.",
    )


def send_password_changed(db: AsyncSession, to: str) -> None:
    enqueue(
        db,
        to,
        "Your password was changed",
        "Your password was changed",
        [
            "The password for your account was just changed and your other sessions "
            "were signed out.",
            "If this was not you, reset your password immediately and review your active sessions.",
        ],
        ("Review security settings", link("/settings/security")),
    )


def send_new_sign_in(
    db: AsyncSession, to: str, when: str, ip: str | None, device: str | None
) -> None:
    enqueue(
        db,
        to,
        "New sign-in to your account",
        "New sign-in detected",
        [
            f"Your account was signed in to on {when}.",
            f"Device: {device or 'unknown'}",
            f"IP address: {ip or 'unknown'}",
            "If this was you, no action is needed. If not, change your password and sign "
            "out other sessions.",
        ],
        ("Review active sessions", link("/settings/security")),
    )


def send_two_factor_changed(db: AsyncSession, to: str, enabled: bool) -> None:
    state = "turned on" if enabled else "turned off"
    enqueue(
        db,
        to,
        f"Two-factor authentication {state}",
        f"Two-factor authentication was {state}",
        [
            f"Two-factor authentication was just {state} for your account.",
            "If this was not you, reset your password immediately and review your sessions.",
        ],
        ("Review security settings", link("/settings/security")),
    )


def send_email_change(db: AsyncSession, to: str, name: str, token: str) -> None:
    enqueue(
        db,
        to,
        "Confirm your new email address",
        f"Confirm your new email, {name}",
        ["Confirm this address to make it the email for your account."],
        ("Confirm email", link(f"/confirm-email?token={token}")),
        "If you did not ask for this, you can ignore this email.",
    )


def send_email_changed_notice(db: AsyncSession, to: str, new_email: str) -> None:
    enqueue(
        db,
        to,
        "Your email address was changed",
        "Your email address was changed",
        [
            f"The email address for your account is now {new_email}.",
            "If this was not you, contact your administrator immediately.",
        ],
    )


def send_invitation(
    db: AsyncSession, to: str, inviter: str, workspace: str, role: str, is_existing_user: bool
) -> None:
    days = get_settings().invitation_ttl_days
    if is_existing_user:
        action = ("Open invitation", link("/invitations"))
        extra = "Sign in to accept or decline."
    else:
        action = ("Create your account", link(f"/signup?email={quote(to)}"))
        extra = "Create an account with this email address and the invitation will be waiting."
    enqueue(
        db,
        to,
        f"{inviter} invited you to {workspace}",
        f"Join {workspace}",
        [f"{inviter} invited you to the {workspace} workspace as {role}.", extra],
        action,
        f"This invitation expires in {days} days.",
    )


def send_alert(
    db: AsyncSession,
    to: str,
    subject: str,
    paragraphs: list[str],
    action: tuple[str, str] | None = None,
) -> None:
    """Billing, usage, key and model alerts (callers check the user's preferences)."""
    enqueue(db, to, subject, subject, paragraphs, action)


def send_test(db: AsyncSession, to: str) -> None:
    enqueue(
        db,
        to,
        "Test email",
        "Email is working",
        [f"This test email was sent from {get_settings().app_name} by a platform admin."],
    )


# ---- Delivery worker -------------------------------------------------------------------------


async def _send(message: EmailOutbox) -> None:
    settings = get_settings()
    msg = EmailMessage()
    msg["From"] = settings.mail_from
    msg["To"] = message.to_address
    msg["Subject"] = message.subject
    msg.set_content(message.text_body)
    msg.add_alternative(message.html_body, subtype="html")
    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username,
        password=settings.smtp_password.get_secret_value() if settings.smtp_password else None,
        start_tls=settings.smtp_starttls,
        use_tls=settings.smtp_tls,
        timeout=20,
    )


async def deliver_pending(batch: int = 20, only: Collection[uuid.UUID] | None = None) -> int:
    """Send due emails. Safe to run on several instances at once (SKIP LOCKED).

    `only` limits delivery to those outbox rows (inline delivery sends just what the current
    request queued).
    """
    sent = 0
    query = (
        select(EmailOutbox)
        .where(EmailOutbox.status == "pending", EmailOutbox.next_attempt_at <= utcnow())
        .order_by(EmailOutbox.created_at)
        .limit(batch)
        .with_for_update(skip_locked=True)
    )
    if only is not None:
        query = query.where(EmailOutbox.id.in_(only))
    async with SessionLocal() as db:
        rows = (await db.execute(query)).scalars().all()
        for message in rows:
            try:
                await _send(message)
            except (aiosmtplib.SMTPException, OSError, TimeoutError) as exc:
                message.attempts += 1
                message.last_error = type(exc).__name__
                if message.attempts >= MAX_ATTEMPTS:
                    message.status = "failed"
                    log.error("Email %s permanently failed", message.id)
                else:
                    backoff = timedelta(seconds=min(30 * 2**message.attempts, 3600))
                    message.next_attempt_at = utcnow() + backoff
            else:
                message.status = "sent"
                message.sent_at = utcnow()
                message.attempts += 1
                sent += 1
        await db.commit()
    return sent


# ---- Inline delivery (serverless only) -------------------------------------------------------


@dataclass
class RequestTracker:
    """The emails `enqueue` added while handling the current request."""

    messages: list[EmailOutbox] = field(default_factory=list)


# Holds the tracker of the request being handled. The middleware creates it before running the
# endpoint, and the endpoint's task inherits a copy of this context, so both see the same
# object. Outside a tracked request (self-hosted, tests, scripts) it stays None.
_request_tracker: ContextVar[RequestTracker | None] = ContextVar(
    "email_request_tracker", default=None
)


def track_request() -> RequestTracker:
    tracker = RequestTracker()
    _request_tracker.set(tracker)
    return tracker


async def deliver_queued(tracker: RequestTracker) -> None:
    """Send the emails this request queued, now that the endpoint has committed them.

    Rows the endpoint didn't commit (it failed and rolled back) simply aren't found. Never
    raises: a failed send stays in the outbox with a retry time for the cron endpoint, and the
    user's action itself already succeeded.
    """
    ids = [m.id for m in tracker.messages if m.id is not None]
    if not ids:
        return
    try:
        await deliver_pending(batch=len(ids), only=ids)
    except Exception:
        log.exception("Inline email delivery failed")


async def run_worker(stop: asyncio.Event, interval: float = 2.0) -> None:
    while not stop.is_set():
        try:
            await deliver_pending()
        except Exception:
            log.exception("Email worker iteration failed")
        with suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)
