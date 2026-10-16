"""API key format and lookup helpers. Keys are `dw-` + 43 random URL-safe characters; only their
SHA-256 is stored (they are high-entropy, so no salt or slow hash is needed)."""

import secrets

from dockwell_api.security.tokens import hash_token

PREFIX = "dw-"
DISPLAY_PREFIX_LEN = 10


def generate() -> tuple[str, str, str, str]:
    """Return (secret, hash, display prefix, last four)."""
    secret = PREFIX + secrets.token_urlsafe(32)
    return secret, hash_token(secret), secret[:DISPLAY_PREFIX_LEN], secret[-4:]


def display(prefix: str, last_four: str) -> str:
    return f"{prefix}...{last_four}"


def looks_like_key(value: str) -> bool:
    return value.startswith(PREFIX) and 20 <= len(value) <= 200
