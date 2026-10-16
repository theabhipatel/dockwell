"""Second-factor checks shared by sign-in and sensitive account actions."""

from dockwell_api.models import User
from dockwell_api.security import totp
from dockwell_api.security.crypto import decrypt


def verify_second_factor(user: User, code: str) -> str | None:
    """Accept a current authenticator code or an unused backup code.

    Returns "totp" or "backup_code" on success (and records it on `user`), None otherwise.
    """
    if user.totp_enabled_at is None:
        return None
    secret = decrypt(user.totp_secret_enc)
    cleaned = code.strip().replace(" ", "")
    if secret and cleaned.isdigit():
        counter = totp.verify(secret, cleaned, last_counter=user.totp_last_counter)
        if counter is not None:
            user.totp_last_counter = counter
            return "totp"
        return None
    hashed = totp.hash_backup_code(cleaned)
    remaining = list(user.backup_code_hashes or [])
    if hashed in remaining:
        remaining.remove(hashed)
        user.backup_code_hashes = remaining
        return "backup_code"
    return None
