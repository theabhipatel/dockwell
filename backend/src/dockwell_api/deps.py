"""FastAPI dependencies: database session, authenticated user, workspace context, admin guard.

The acting identity always comes from the session cookie, never from request data.
"""

import ipaddress
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Path, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.config import get_settings
from dockwell_api.db import get_db, utcnow
from dockwell_api.models import Membership, Role, User, UserSession, Workspace
from dockwell_api.permissions import Actor, Perm, PermissionDenied
from dockwell_api.security.tokens import hash_token
from dockwell_api.services.audit import RequestMeta

DB = Annotated[AsyncSession, Depends(get_db)]

LAST_SEEN_RESOLUTION = timedelta(minutes=1)


def client_ip(request: Request) -> str | None:
    """The visitor's IP address, as used for rate limits, audit logs and the session list."""
    header = get_settings().client_ip_header
    if header:
        value = (request.headers.get(header) or "").split(",")[0].strip()
        try:
            return str(ipaddress.ip_address(value))
        except ValueError:
            pass
    return request.client.host if request.client else None


def get_meta(request: Request) -> RequestMeta:
    return RequestMeta(ip=client_ip(request), user_agent=request.headers.get("user-agent"))


Meta = Annotated[RequestMeta, Depends(get_meta)]


@dataclass
class Auth:
    user: User
    session: UserSession


async def load_session(db: AsyncSession, raw_token: str | None) -> Auth | None:
    if not raw_token:
        return None
    settings = get_settings()
    now = utcnow()
    row = (
        await db.execute(
            select(UserSession, User)
            .join(User, User.id == UserSession.user_id)
            .where(UserSession.token_hash == hash_token(raw_token))
        )
    ).one_or_none()
    if row is None:
        return None
    session, user = row
    idle_limit = session.last_seen_at + timedelta(days=settings.session_idle_days)
    if session.expires_at <= now or idle_limit <= now or user.suspended_at is not None:
        await db.delete(session)
        await db.commit()
        return None
    if now - session.last_seen_at > LAST_SEEN_RESOLUTION:
        session.last_seen_at = now
        await db.commit()
    return Auth(user=user, session=session)


async def get_auth(request: Request, db: DB) -> Auth:
    auth = await load_session(db, request.cookies.get(get_settings().session_cookie_name))
    if auth is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    return auth


CurrentAuth = Annotated[Auth, Depends(get_auth)]


async def get_admin(auth: CurrentAuth) -> Auth:
    if not auth.user.is_admin:
        # 404 so the admin area is invisible to everyone else.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    return auth


AdminAuth = Annotated[Auth, Depends(get_admin)]


@dataclass
class WorkspaceContext:
    workspace: Workspace
    membership: Membership
    role: Role
    user: User
    actor: Actor

    def require(self, perm: Perm) -> None:
        if not self.actor.has(perm):
            raise PermissionDenied("You do not have permission to do that.")

    def require_any(self, *perms: Perm) -> None:
        if not any(self.actor.has(p) for p in perms):
            raise PermissionDenied("You do not have permission to do that.")

    @property
    def is_owner(self) -> bool:
        return self.membership.is_owner


async def load_workspace_context(
    db: AsyncSession, workspace_id: uuid.UUID, user: User, *, lock: bool = False
) -> WorkspaceContext:
    stmt = (
        select(Workspace, Membership, Role)
        .join(Membership, Membership.workspace_id == Workspace.id)
        .join(Role, Role.id == Membership.role_id)
        .where(Workspace.id == workspace_id, Membership.user_id == user.id)
    )
    if lock:
        stmt = stmt.with_for_update(of=Workspace)
    row = (await db.execute(stmt)).one_or_none()
    if row is None:
        # 404 rather than 403 so workspace ids cannot be probed.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found.")
    workspace, membership, role = row
    actor = Actor(
        rank=role.rank,
        permissions=frozenset(role.permissions or []),
        is_owner=membership.is_owner,
    )
    return WorkspaceContext(workspace, membership, role, user, actor)


async def get_workspace_ctx(
    auth: CurrentAuth, db: DB, workspace_id: Annotated[uuid.UUID, Path()]
) -> WorkspaceContext:
    return await load_workspace_context(db, workspace_id, auth.user)


WsCtx = Annotated[WorkspaceContext, Depends(get_workspace_ctx)]
