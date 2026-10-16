"""Platform admin: users and workspaces. Every action is recorded in the admin audit log."""

import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select

from dockwell_api.db import utcnow
from dockwell_api.deps import DB, AdminAuth, Meta
from dockwell_api.models import (
    AIModel,
    ApiKey,
    AuditLog,
    Membership,
    Payment,
    Project,
    Role,
    UsageDaily,
    User,
    UserSession,
    Workspace,
    WorkspacePrice,
)
from dockwell_api.money import current_period, dollars
from dockwell_api.permissions import Perm
from dockwell_api.routers.account import delete_user_account
from dockwell_api.routers.activity import activity_rows
from dockwell_api.routers.billing import payment_out
from dockwell_api.schemas.admin import (
    AdminMember,
    AdminUserCreate,
    AdminUserDetail,
    AdminUserOut,
    AdminUserPage,
    AdminUserWorkspace,
    AdminWorkspaceDetail,
    AdminWorkspaceOut,
    AdminWorkspacePage,
    CreditAdjustIn,
    SetAdminIn,
    SuspendIn,
    WorkspaceLimitsIn,
)
from dockwell_api.schemas.catalog import WorkspacePriceIn, WorkspacePriceOut
from dockwell_api.schemas.common import Message, avatar_url, user_ref
from dockwell_api.schemas.usage import UsageTotals
from dockwell_api.security.passwords import hash_password
from dockwell_api.services import audit, credits, email, notifications
from dockwell_api.services.sessions import issue_email_token, revoke_all_sessions
from dockwell_api.services.users import escape_like

router = APIRouter(prefix="/admin", tags=["admin"])


def _user_out(u: User, workspace_count: int) -> AdminUserOut:
    return AdminUserOut(
        id=u.id,
        email=u.email,
        name=u.name,
        avatar_url=avatar_url(u),
        is_admin=u.is_admin,
        email_verified=u.email_verified_at is not None,
        suspended=u.suspended_at is not None,
        suspended_reason=u.suspended_reason,
        two_factor_enabled=u.totp_enabled_at is not None,
        google_linked=u.google_sub is not None,
        created_at=u.created_at,
        last_sign_in_at=u.last_sign_in_at,
        workspace_count=workspace_count,
    )


async def _usage_totals(db: DB, *conditions: object) -> UsageTotals:
    row = (
        await db.execute(
            select(
                func.coalesce(func.sum(UsageDaily.requests), 0),
                func.coalesce(func.sum(UsageDaily.errors), 0),
                func.coalesce(func.sum(UsageDaily.input_tokens), 0),
                func.coalesce(func.sum(UsageDaily.output_tokens), 0),
                func.coalesce(func.sum(UsageDaily.cost_micros), 0),
            ).where(*conditions)  # type: ignore[arg-type]
        )
    ).one()
    return UsageTotals(
        requests=int(row[0]),
        errors=int(row[1]),
        input_tokens=int(row[2]),
        output_tokens=int(row[3]),
        cost_micros=int(row[4]),
    )


def _record(db: DB, admin: User, meta: Meta, action: str, **kwargs: object) -> None:
    audit.record(db, action=f"admin.{action}", actor=admin, meta=meta, admin=True, **kwargs)


# ---- Users -------------------------------------------------------------------------------------


@router.get("/users")
async def list_users(
    auth: AdminAuth,
    db: DB,
    q: Annotated[str | None, Query(max_length=200)] = None,
    filter: Annotated[
        str | None, Query(pattern="^(admins|suspended|unverified|two_factor)$")
    ] = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> AdminUserPage:
    cond = []
    if q:
        like = f"%{escape_like(q.strip().lower())}%"
        cond.append(
            or_(User.email.like(like, escape="\\"), func.lower(User.name).like(like, escape="\\"))
        )
    if filter == "admins":
        cond.append(User.is_admin.is_(True))
    elif filter == "suspended":
        cond.append(User.suspended_at.is_not(None))
    elif filter == "unverified":
        cond.append(User.email_verified_at.is_(None))
    elif filter == "two_factor":
        cond.append(User.totp_enabled_at.is_not(None))
    total = await db.scalar(select(func.count()).select_from(User).where(*cond))
    counts = (
        select(Membership.user_id, func.count().label("n")).group_by(Membership.user_id).subquery()
    )
    rows = await db.execute(
        select(User, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.user_id == User.id)
        .where(*cond)
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return AdminUserPage(items=[_user_out(u, n) for u, n in rows], total=total or 0)


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(body: AdminUserCreate, auth: AdminAuth, db: DB, meta: Meta) -> AdminUserOut:
    address = str(body.email).strip().lower()
    if await db.scalar(select(User.id).where(User.email == address)):
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with that email already exists.")
    user = User(
        email=address,
        name=body.name,
        password_hash=hash_password(body.password) if body.password else None,
        password_changed_at=utcnow() if body.password else None,
        email_verified_at=utcnow(),
        is_admin=body.is_admin,
    )
    db.add(user)
    await db.flush()
    if not body.password:
        token = await issue_email_token(db, user, "reset_password", timedelta(days=3))
        email.send_password_reset(db, user.email, token)
    _record(
        db,
        auth.user,
        meta,
        "user_created",
        target_type="user",
        target_id=user.id,
        target_label=user.email,
        details={"is_admin": body.is_admin},
    )
    await db.commit()
    return _user_out(user, 0)


async def _target_user(db: DB, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    return user


@router.get("/users/{user_id}")
async def get_user(user_id: uuid.UUID, auth: AdminAuth, db: DB) -> AdminUserDetail:
    user = await _target_user(db, user_id)
    ws_rows = await db.execute(
        select(Workspace, Role.name, Membership.is_owner)
        .join(Membership, Membership.workspace_id == Workspace.id)
        .join(Role, Role.id == Membership.role_id)
        .where(Membership.user_id == user.id)
        .order_by(Workspace.name)
    )
    workspaces = [
        AdminUserWorkspace(
            id=ws.id, name=ws.name, role_name=role, is_owner=owner, balance_micros=ws.balance_micros
        )
        for ws, role, owner in ws_rows.all()
    ]
    activity = list(
        (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.actor_id == user.id)
                .order_by(AuditLog.id.desc())
                .limit(30)
            )
        ).scalars()
    )
    payments = await db.execute(
        select(Payment)
        .where(Payment.user_id == user.id)
        .order_by(Payment.created_at.desc())
        .limit(30)
    )
    sessions = await db.scalar(
        select(func.count()).select_from(UserSession).where(UserSession.user_id == user.id)
    )
    since = utcnow().date() - timedelta(days=30)
    base = _user_out(user, len(workspaces))
    return AdminUserDetail(
        **base.model_dump(),
        workspaces=workspaces,
        activity=await activity_rows(db, activity),
        usage_30d=await _usage_totals(db, UsageDaily.user_id == user.id, UsageDaily.day >= since),
        payments=[payment_out(p, user.name) for p in payments.scalars()],
        session_count=sessions or 0,
    )


@router.post("/users/{user_id}/suspend")
async def suspend_user(
    user_id: uuid.UUID, body: SuspendIn, auth: AdminAuth, db: DB, meta: Meta
) -> Message:
    user = await _target_user(db, user_id)
    if user.id == auth.user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot suspend yourself.")
    user.suspended_at = utcnow()
    user.suspended_reason = body.reason or None
    await revoke_all_sessions(db, user)
    _record(
        db,
        auth.user,
        meta,
        "user_suspended",
        target_type="user",
        target_id=user.id,
        target_label=user.email,
        details={"reason": body.reason},
    )
    await db.commit()
    return Message(message=f"{user.email} is suspended and was signed out.")


@router.post("/users/{user_id}/unsuspend")
async def unsuspend_user(user_id: uuid.UUID, auth: AdminAuth, db: DB, meta: Meta) -> Message:
    user = await _target_user(db, user_id)
    user.suspended_at = None
    user.suspended_reason = None
    _record(
        db,
        auth.user,
        meta,
        "user_unsuspended",
        target_type="user",
        target_id=user.id,
        target_label=user.email,
    )
    await db.commit()
    return Message(message=f"{user.email} can sign in again.")


@router.post("/users/{user_id}/signout")
async def force_signout(user_id: uuid.UUID, auth: AdminAuth, db: DB, meta: Meta) -> Message:
    user = await _target_user(db, user_id)
    await revoke_all_sessions(db, user)
    _record(
        db,
        auth.user,
        meta,
        "user_signed_out",
        target_type="user",
        target_id=user.id,
        target_label=user.email,
    )
    await db.commit()
    return Message(message=f"All sessions of {user.email} were signed out.")


@router.post("/users/{user_id}/reset-2fa")
async def reset_two_factor(user_id: uuid.UUID, auth: AdminAuth, db: DB, meta: Meta) -> Message:
    user = await _target_user(db, user_id)
    user.totp_enabled_at = None
    user.totp_secret_enc = None
    user.totp_last_counter = None
    user.backup_code_hashes = []
    email.send_two_factor_changed(db, user.email, enabled=False)
    _record(
        db,
        auth.user,
        meta,
        "user_2fa_reset",
        target_type="user",
        target_id=user.id,
        target_label=user.email,
    )
    await db.commit()
    return Message(message="Two-factor authentication was turned off for this user.")


@router.post("/users/{user_id}/verify-email")
async def mark_verified(user_id: uuid.UUID, auth: AdminAuth, db: DB, meta: Meta) -> Message:
    from dockwell_api.routers.auth import grant_pending_free_credit

    user = await _target_user(db, user_id)
    if user.email_verified_at is None:
        user.email_verified_at = utcnow()
        await grant_pending_free_credit(db, user)
    _record(
        db,
        auth.user,
        meta,
        "user_verified",
        target_type="user",
        target_id=user.id,
        target_label=user.email,
    )
    await db.commit()
    return Message(message="Email marked as verified.")


@router.post("/users/{user_id}/admin")
async def set_admin(
    user_id: uuid.UUID, body: SetAdminIn, auth: AdminAuth, db: DB, meta: Meta
) -> Message:
    user = await _target_user(db, user_id)
    if user.id == auth.user.id and not body.is_admin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot remove your own admin access.")
    user.is_admin = body.is_admin
    _record(
        db,
        auth.user,
        meta,
        "user_promoted" if body.is_admin else "user_demoted",
        target_type="user",
        target_id=user.id,
        target_label=user.email,
    )
    await db.commit()
    return Message(
        message=f"{user.email} is {'now' if body.is_admin else 'no longer'} a platform admin."
    )


@router.delete("/users/{user_id}")
async def delete_user(user_id: uuid.UUID, auth: AdminAuth, db: DB, meta: Meta) -> Message:
    user = await _target_user(db, user_id)
    if user.id == auth.user.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Delete your own account from your settings."
        )
    label = user.email
    await delete_user_account(db, user, actor=auth.user, meta=meta)
    _record(
        db,
        auth.user,
        meta,
        "user_deleted",
        target_type="user",
        target_id=user_id,
        target_label=label,
    )
    await db.commit()
    return Message(message=f"{label} was deleted.")


# ---- Workspaces --------------------------------------------------------------------------------


async def _workspace_rows(db: DB, workspaces: list[Workspace]) -> list[AdminWorkspaceOut]:
    if not workspaces:
        return []
    ids = [w.id for w in workspaces]
    counts = dict(
        (
            await db.execute(
                select(Membership.workspace_id, func.count())
                .where(Membership.workspace_id.in_(ids))
                .group_by(Membership.workspace_id)
            )
        ).all()
    )
    owners = {
        u.id: u
        for u in (
            await db.execute(select(User).where(User.id.in_({w.owner_id for w in workspaces})))
        ).scalars()
    }
    period = current_period()
    return [
        AdminWorkspaceOut(
            id=w.id,
            name=w.name,
            slug=w.slug,
            owner=user_ref(owners[w.owner_id]) if w.owner_id in owners else None,
            member_count=counts.get(w.id, 0),
            balance_micros=w.balance_micros,
            reserved_micros=w.reserved_micros,
            period_spend_micros=w.period_spend_micros if w.period == period else 0,
            monthly_spend_limit_micros=w.monthly_spend_limit_micros,
            rpm_limit=w.rpm_limit,
            tpm_limit=w.tpm_limit,
            suspended=w.suspended_at is not None,
            suspended_reason=w.suspended_reason,
            created_at=w.created_at,
        )
        for w in workspaces
    ]


@router.get("/workspaces")
async def list_workspaces(
    auth: AdminAuth,
    db: DB,
    q: Annotated[str | None, Query(max_length=200)] = None,
    suspended: bool | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> AdminWorkspacePage:
    cond = []
    if q:
        like = f"%{escape_like(q.strip().lower())}%"
        owner_ids = select(User.id).where(User.email.like(like, escape="\\"))
        cond.append(
            or_(
                func.lower(Workspace.name).like(like, escape="\\"),
                Workspace.slug.like(like, escape="\\"),
                Workspace.owner_id.in_(owner_ids),
            )
        )
    if suspended is not None:
        cond.append(
            Workspace.suspended_at.is_not(None) if suspended else Workspace.suspended_at.is_(None)
        )
    total = await db.scalar(select(func.count()).select_from(Workspace).where(*cond))
    rows = list(
        (
            await db.execute(
                select(Workspace)
                .where(*cond)
                .order_by(Workspace.created_at.desc())
                .offset(offset)
                .limit(limit)
            )
        ).scalars()
    )
    return AdminWorkspacePage(items=await _workspace_rows(db, rows), total=total or 0)


async def _target_workspace(db: DB, workspace_id: uuid.UUID, *, lock: bool = False) -> Workspace:
    ws = await db.get(Workspace, workspace_id, with_for_update=lock)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found.")
    return ws


@router.get("/workspaces/{workspace_id}")
async def get_workspace(workspace_id: uuid.UUID, auth: AdminAuth, db: DB) -> AdminWorkspaceDetail:
    ws = await _target_workspace(db, workspace_id)
    base = (await _workspace_rows(db, [ws]))[0]
    members = await db.execute(
        select(Membership, User, Role)
        .join(User, User.id == Membership.user_id)
        .join(Role, Role.id == Membership.role_id)
        .where(Membership.workspace_id == ws.id)
        .order_by(Role.rank.desc())
    )
    projects = await db.scalar(
        select(func.count()).select_from(Project).where(Project.workspace_id == ws.id)
    )
    keys = await db.scalar(
        select(func.count())
        .select_from(ApiKey)
        .where(ApiKey.workspace_id == ws.id, ApiKey.revoked_at.is_(None))
    )
    payments = await db.execute(
        select(Payment, User.name)
        .outerjoin(User, User.id == Payment.user_id)
        .where(Payment.workspace_id == ws.id)
        .order_by(Payment.created_at.desc())
        .limit(30)
    )
    since = utcnow().date() - timedelta(days=30)
    return AdminWorkspaceDetail(
        **base.model_dump(),
        members=[
            AdminMember(
                user_id=u.id, name=u.name, email=u.email, role_name=r.name, is_owner=m.is_owner
            )
            for m, u, r in members.all()
        ],
        project_count=projects or 0,
        key_count=keys or 0,
        usage_30d=await _usage_totals(
            db, UsageDaily.workspace_id == ws.id, UsageDaily.day >= since
        ),
        payments=[payment_out(p, n) for p, n in payments],
        auto_recharge_enabled=ws.auto_recharge_enabled,
        card_last4=ws.card_last4,
    )


@router.post("/workspaces/{workspace_id}/suspend")
async def suspend_workspace(
    workspace_id: uuid.UUID, body: SuspendIn, auth: AdminAuth, db: DB, meta: Meta
) -> Message:
    ws = await _target_workspace(db, workspace_id)
    ws.suspended_at = utcnow()
    ws.suspended_reason = body.reason or None
    _record(
        db,
        auth.user,
        meta,
        "workspace_suspended",
        workspace_id=ws.id,
        target_type="workspace",
        target_id=ws.id,
        target_label=ws.name,
        details={"reason": body.reason},
    )
    await db.commit()
    return Message(message=f"{ws.name} is suspended. Its API keys and playground stop working.")


@router.post("/workspaces/{workspace_id}/unsuspend")
async def unsuspend_workspace(
    workspace_id: uuid.UUID, auth: AdminAuth, db: DB, meta: Meta
) -> Message:
    ws = await _target_workspace(db, workspace_id)
    ws.suspended_at = None
    ws.suspended_reason = None
    _record(
        db,
        auth.user,
        meta,
        "workspace_unsuspended",
        workspace_id=ws.id,
        target_type="workspace",
        target_id=ws.id,
        target_label=ws.name,
    )
    await db.commit()
    return Message(message=f"{ws.name} is active again.")


@router.post("/workspaces/{workspace_id}/credits")
async def adjust_credits(
    workspace_id: uuid.UUID, body: CreditAdjustIn, auth: AdminAuth, db: DB, meta: Meta
) -> Message:
    if body.amount_micros == 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Enter an amount other than zero."
        )
    ws = await _target_workspace(db, workspace_id, lock=True)
    applied = await credits.apply(
        db,
        ws.id,
        body.amount_micros,
        kind="adjustment",
        description=f"Admin {'grant' if body.amount_micros > 0 else 'deduction'}: {body.reason}",
        actor_id=auth.user.id,
    )
    assert applied is not None
    _record(
        db,
        auth.user,
        meta,
        "credits_adjusted",
        workspace_id=ws.id,
        target_type="workspace",
        target_id=ws.id,
        target_label=ws.name,
        details={"amount_micros": body.amount_micros, "reason": body.reason},
    )
    if body.amount_micros > 0:
        people = await notifications.workspace_member_ids_with(db, ws.id, Perm.BILLING_VIEW)
        await notifications.notify_users(
            db,
            people,
            category="billing",
            type="billing.credit_granted",
            title=f"{dollars(body.amount_micros)} credit added to {ws.name}",
            body=body.reason,
            link=f"/w/{ws.id}/billing",
            workspace_id=ws.id,
        )
    await db.commit()
    return Message(message=f"Balance is now {dollars(applied.balance_after)}.")


@router.patch("/workspaces/{workspace_id}/limits")
async def set_limits(
    workspace_id: uuid.UUID, body: WorkspaceLimitsIn, auth: AdminAuth, db: DB, meta: Meta
) -> Message:
    ws = await _target_workspace(db, workspace_id)
    changed = {}
    for field in body.model_fields_set:
        value = getattr(body, field)
        if getattr(ws, field) != value:
            setattr(ws, field, value)
            changed[field] = value
    _record(
        db,
        auth.user,
        meta,
        "workspace_limits_changed",
        workspace_id=ws.id,
        target_type="workspace",
        target_id=ws.id,
        target_label=ws.name,
        details=changed,
    )
    await db.commit()
    return Message(message="Limits updated.")


# ---- Per-workspace prices ----------------------------------------------------------------------


async def _price_out(db: DB, rows: list[WorkspacePrice]) -> list[WorkspacePriceOut]:
    ids = {r.model_id for r in rows if r.model_id}
    names = (
        dict(
            (
                await db.execute(select(AIModel.id, AIModel.public_id).where(AIModel.id.in_(ids)))
            ).all()
        )
        if ids
        else {}
    )
    return [
        WorkspacePriceOut(
            id=r.id,
            model_id=r.model_id,
            model_public_id=names.get(r.model_id) if r.model_id else None,
            discount_percent=r.discount_percent,
            input_micros_per_m=r.input_micros_per_m,
            output_micros_per_m=r.output_micros_per_m,
            note=r.note,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get("/workspaces/{workspace_id}/prices")
async def list_workspace_prices(
    workspace_id: uuid.UUID, auth: AdminAuth, db: DB
) -> list[WorkspacePriceOut]:
    await _target_workspace(db, workspace_id)
    rows = list(
        (
            await db.execute(
                select(WorkspacePrice).where(WorkspacePrice.workspace_id == workspace_id)
            )
        ).scalars()
    )
    return await _price_out(db, rows)


@router.put("/workspaces/{workspace_id}/prices")
async def set_workspace_price(
    workspace_id: uuid.UUID, body: WorkspacePriceIn, auth: AdminAuth, db: DB, meta: Meta
) -> list[WorkspacePriceOut]:
    ws = await _target_workspace(db, workspace_id)
    row = await db.scalar(
        select(WorkspacePrice).where(
            WorkspacePrice.workspace_id == ws.id,
            WorkspacePrice.model_id.is_(None)
            if body.model_id is None
            else WorkspacePrice.model_id == body.model_id,
        )
    )
    if row is None:
        row = WorkspacePrice(workspace_id=ws.id, model_id=body.model_id)
        db.add(row)
    row.discount_percent = body.discount_percent
    row.input_micros_per_m = body.input_micros_per_m
    row.output_micros_per_m = body.output_micros_per_m
    row.note = body.note
    _record(
        db,
        auth.user,
        meta,
        "workspace_price_set",
        workspace_id=ws.id,
        target_type="workspace",
        target_id=ws.id,
        target_label=ws.name,
        details=body.model_dump(mode="json"),
    )
    await db.commit()
    return await list_workspace_prices(workspace_id, auth, db)


@router.delete("/workspaces/{workspace_id}/prices/{price_id}")
async def delete_workspace_price(
    workspace_id: uuid.UUID, price_id: uuid.UUID, auth: AdminAuth, db: DB, meta: Meta
) -> Message:
    await db.execute(
        delete(WorkspacePrice).where(
            WorkspacePrice.id == price_id, WorkspacePrice.workspace_id == workspace_id
        )
    )
    _record(db, auth.user, meta, "workspace_price_removed", workspace_id=workspace_id)
    await db.commit()
    return Message(message="Custom price removed.")
