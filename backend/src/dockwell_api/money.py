"""Exact money arithmetic. Amounts are integers in micro-dollars (1 USD = 1_000_000).

Floating point is never used for money: prices are micro-dollars per 1M tokens, and a cost is
rounded *up* to the next micro-dollar, so a request is never undercharged by rounding.
"""

from datetime import UTC, datetime

MICROS_PER_DOLLAR = 1_000_000
MICROS_PER_CENT = 10_000
TOKENS_PER_PRICE_UNIT = 1_000_000


def ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def token_cost(tokens: int, micros_per_m: int) -> int:
    if tokens <= 0 or micros_per_m <= 0:
        return 0
    return ceil_div(tokens * micros_per_m, TOKENS_PER_PRICE_UNIT)


def cents_to_micros(cents: int) -> int:
    return cents * MICROS_PER_CENT


def dollars(micros: int) -> str:
    """Human text for emails and descriptions, e.g. "$3.00" or "$0.000125"."""
    sign = "-" if micros < 0 else ""
    value = abs(micros)
    whole, frac = divmod(value, MICROS_PER_DOLLAR)
    frac_text = f"{frac:06d}".rstrip("0")
    frac_text = frac_text.ljust(2, "0")
    return f"{sign}${whole:,}.{frac_text}"


def current_period(now: datetime | None = None) -> str:
    """The billing period key for monthly limits: the calendar month in UTC, e.g. "2026-10"."""
    return (now or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m")
