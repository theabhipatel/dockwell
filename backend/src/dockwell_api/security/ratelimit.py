"""Fixed-window counters backed by PostgreSQL, so limits hold across API instances and in
serverless mode. Used for sign-in throttling and for the gateway's request / token limits."""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import case, delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.db import SessionLocal, utcnow
from dockwell_api.models import RateCounter


class RateLimited(Exception):
    def __init__(self, retry_after: int, scope: str = "") -> None:
        super().__init__("Too many attempts")
        self.retry_after = retry_after
        self.scope = scope


def _upsert(key: str, window: timedelta, count: int, tokens: int):  # type: ignore[no-untyped-def]
    now = utcnow()
    expired = RateCounter.window_start < now - window
    stmt = insert(RateCounter).values(key=key, window_start=now, count=count, tokens=tokens)
    return stmt.on_conflict_do_update(
        index_elements=[RateCounter.key],
        set_={
            # Start a new window when the old one has elapsed, otherwise add.
            "count": case((expired, count), else_=RateCounter.count + count),
            "tokens": case((expired, tokens), else_=RateCounter.tokens + tokens),
            "window_start": case((expired, now), else_=RateCounter.window_start),
        },
    ).returning(RateCounter.count, RateCounter.tokens, RateCounter.window_start)


async def hit(key: str, limit: int, window: timedelta) -> None:
    """Count one attempt against `key`; raise RateLimited if the limit is exceeded.

    Uses its own transaction so the counter persists even if the request fails later.
    """
    async with SessionLocal() as db:
        count, _, window_start = (await db.execute(_upsert(key, window, 1, 0))).one()
        await db.commit()
    if count > limit:
        now = utcnow()
        raise RateLimited(max(int((window_start + window - now).total_seconds()), 1))


async def is_limited(key: str, limit: int, window: timedelta) -> int | None:
    """Return seconds until reset if `key` is at/over its limit, without counting an attempt."""
    now = utcnow()
    async with SessionLocal() as db:
        row = (
            await db.execute(select(RateCounter).where(RateCounter.key == key))
        ).scalar_one_or_none()
    if row is None or row.window_start + window <= now or row.count < limit:
        return None
    return max(int((row.window_start + window - now).total_seconds()), 1)


async def reset(key: str) -> None:
    async with SessionLocal() as db:
        await db.execute(delete(RateCounter).where(RateCounter.key == key))
        await db.commit()


async def purge_expired(db: AsyncSession, older_than: timedelta) -> None:
    await db.execute(delete(RateCounter).where(RateCounter.window_start < utcnow() - older_than))


# ---- Gateway limits (requests and tokens per minute) -----------------------------------------

MINUTE = timedelta(minutes=1)


@dataclass(frozen=True)
class Limit:
    scope: str  # "key" | "project" | "workspace" | "platform"
    key: str
    rpm: int | None
    tpm: int | None


async def check_and_count_request(limits: list[Limit]) -> None:
    """Count one request in every scope and refuse it when any requests-per-minute or
    tokens-per-minute budget is exhausted. Tokens are added later by `add_tokens`."""
    active = [lim for lim in limits if lim.rpm or lim.tpm]
    if not active:
        return
    async with SessionLocal() as db:
        now = utcnow()
        for lim in active:
            count, tokens, window_start = (
                await db.execute(_upsert(f"gw:{lim.key}", MINUTE, 1, 0))
            ).one()
            retry = max(int((window_start + MINUTE - now).total_seconds()), 1)
            if (lim.rpm and count > lim.rpm) or (lim.tpm and tokens >= lim.tpm):
                await db.commit()
                raise RateLimited(retry, lim.scope)
        await db.commit()


async def add_tokens(db: AsyncSession, limits: list[Limit], tokens: int) -> None:
    for lim in limits:
        if lim.tpm and tokens > 0:
            await db.execute(_upsert(f"gw:{lim.key}", MINUTE, 0, tokens))
