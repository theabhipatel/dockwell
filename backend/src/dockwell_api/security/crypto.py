"""Symmetric encryption for secrets stored in the database (provider keys, HF token, 2FA).

Fernet (AES-128-CBC + HMAC-SHA256) with a key from ENCRYPTION_KEY, or derived from SECRET_KEY.
"""

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from dockwell_api.config import get_settings


@lru_cache
def _fernet() -> Fernet:
    settings = get_settings()
    material = (settings.encryption_key or settings.secret_key).get_secret_value()
    key = base64.urlsafe_b64encode(
        hashlib.sha256(b"dockwell-encryption:" + material.encode()).digest()
    )
    return Fernet(key)


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def mask(value: str | None, keep: int = 4) -> str | None:
    """A display hint for a stored secret, never the secret itself."""
    if not value:
        return None
    return f"{'•' * 8}{value[-keep:]}" if len(value) > keep * 2 else "•" * 8
