import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from dockwell_api.config import get_settings


def generate_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    """Tokens are stored as SHA-256 digests; they are high-entropy so no salt/KDF is needed."""
    return hashlib.sha256(token.encode()).hexdigest()


def _sign(payload: bytes) -> str:
    key = get_settings().secret_key.get_secret_value().encode()
    return base64.urlsafe_b64encode(hmac.new(key, payload, hashlib.sha256).digest()).decode()


def sign_payload(data: dict[str, Any], ttl_seconds: int) -> str:
    body = dict(data, exp=int(time.time()) + ttl_seconds)
    raw = base64.urlsafe_b64encode(json.dumps(body, separators=(",", ":")).encode())
    return f"{raw.decode()}.{_sign(raw)}"


def verify_payload(value: str) -> dict[str, Any] | None:
    try:
        raw, sig = value.rsplit(".", 1)
    except ValueError:
        return None
    if not hmac.compare_digest(_sign(raw.encode()), sig):
        return None
    try:
        data: dict[str, Any] = json.loads(base64.urlsafe_b64decode(raw.encode()))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(data.get("exp", 0)) < int(time.time()):
        return None
    return data
