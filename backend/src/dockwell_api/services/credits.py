"""Credit balance changes outside the gateway: grants, purchases, refunds, admin adjustments.

Every change runs as one atomic UPDATE on the workspace row plus a ledger entry carrying the
balance after it. A unique `reference` makes external credits (Stripe payments, the starter
credit) idempotent: applying the same reference twice is a no-op.
"""

import hashlib
import uuid
from dataclasses import dataclass

from sqlalchemy import exists, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.db import utcnow
from dockwell_api.models import FreeCreditClaim, LedgerEntry, User, Workspace
from dockwell_api.money import dollars
from dockwell_api.services import platform


@dataclass(frozen=True)
class Applied:
    entry: LedgerEntry
    balance_after: int


async def apply(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    amount_micros: int,
    *,
    kind: str,
    description: str,
    reference: str | None = None,
    actor_id: uuid.UUID | None = None,
    payment_id: uuid.UUID | None = None,
) -> Applied | None:
    """Add (or with a negative amount, remove) credit. Returns None if `reference` was already
    applied. Runs inside the caller's transaction; the caller commits."""
    if reference is not None:
        seen = await db.scalar(select(exists().where(LedgerEntry.reference == reference)))
        if seen:
            return None
    balance_after = await db.scalar(
        update(Workspace)
        .where(Workspace.id == workspace_id)
        .values(balance_micros=Workspace.balance_micros + amount_micros)
        .returning(Workspace.balance_micros)
    )
    if balance_after is None:
        raise LookupError("Workspace not found")
    entry = LedgerEntry(
        workspace_id=workspace_id,
        kind=kind,
        amount_micros=amount_micros,
        balance_after_micros=balance_after,
        description=description[:500],
        reference=reference,
        actor_id=actor_id,
        payment_id=payment_id,
    )
    db.add(entry)
    await db.flush()
    if amount_micros > 0:
        # Topped up: alerts may fire again the next time the balance runs low.
        await db.execute(
            update(Workspace)
            .where(
                Workspace.id == workspace_id,
                Workspace.balance_micros >= Workspace.low_balance_threshold_micros,
            )
            .values(low_balance_notified_at=None, zero_balance_notified_at=None)
        )
    return Applied(entry=entry, balance_after=balance_after)


def _email_hash(email: str) -> str:
    return hashlib.sha256(f"free-credit:{email.strip().lower()}".encode()).hexdigest()


async def grant_free_credit(db: AsyncSession, user: User, workspace: Workspace) -> int:
    """Give the account's one-time starter credit to `workspace`. Returns the amount granted.

    Only for verified accounts, once per account and once per email address ever, controlled by
    the admin's free credit settings.
    """
    if user.free_credit_granted_at is not None or user.email_verified_at is None:
        return 0
    config = await platform.get_config(db)
    if not config.free_credit_enabled or config.free_credit_micros <= 0:
        return 0
    email_hash = _email_hash(user.email)
    if await db.get(FreeCreditClaim, email_hash) is not None:
        user.free_credit_granted_at = utcnow()
        return 0
    db.add(FreeCreditClaim(email_hash=email_hash))
    user.free_credit_granted_at = utcnow()
    applied = await apply(
        db,
        workspace.id,
        config.free_credit_micros,
        kind="grant",
        description=f"Starter credit ({dollars(config.free_credit_micros)})",
        reference=f"free_credit:{email_hash}",
        actor_id=user.id,
    )
    return config.free_credit_micros if applied else 0
