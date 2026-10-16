import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from dockwell_api.schemas.common import APIModel, EmailIn, Name, Password

Theme = Literal["light", "dark", "system"]


class SessionStatus(APIModel):
    signed_in: bool


class AnnouncementOut(APIModel):
    message: str
    level: Literal["info", "warning", "critical"]
    link: str | None


class PublicConfig(APIModel):
    app_name: str
    platform_name: str
    has_logo: bool
    google_enabled: bool
    signup_enabled: bool
    # False: new accounts can sign in straight away, without the verification email.
    email_verification_required: bool
    demo_mode: bool
    stripe_mode: Literal["live", "test", "off"]
    api_base_url: str
    free_credit_micros: int
    topup_presets_cents: list[int]
    topup_min_cents: int
    topup_max_cents: int
    auto_recharge_allowed: bool
    maintenance_mode: bool
    maintenance_message: str
    announcement: AnnouncementOut | None


class SignupIn(EmailIn):
    name: Name
    password: Password


class SigninIn(EmailIn):
    password: str = Field(min_length=1, max_length=256)


class TwoFactorSigninIn(APIModel):
    challenge: str = Field(min_length=10, max_length=2000)
    code: str = Field(min_length=6, max_length=20)


class TokenIn(APIModel):
    token: str = Field(min_length=10, max_length=200)


class ResetPasswordIn(TokenIn):
    password: Password


class ChangePasswordIn(APIModel):
    current_password: str | None = Field(default=None, max_length=256)
    new_password: Password


class ChangeEmailIn(EmailIn):
    password: str | None = Field(default=None, max_length=256)


class Me(APIModel):
    id: uuid.UUID
    email: str
    name: str
    avatar_url: str | None
    theme: Theme
    email_verified: bool
    has_password: bool
    google_linked: bool
    two_factor_enabled: bool
    backup_codes_remaining: int
    is_admin: bool
    default_workspace_id: uuid.UUID | None
    needs_onboarding: bool
    notification_prefs: dict[str, bool]
    created_at: datetime


class SigninResult(APIModel):
    """Either the signed-in user, or a 2FA challenge to complete with /auth/signin/2fa."""

    me: Me | None = None
    two_factor_required: bool = False
    challenge: str | None = None


class ProfileUpdate(APIModel):
    name: Name | None = None
    theme: Theme | None = None


class NotificationPrefsIn(APIModel):
    prefs: dict[str, bool]


class NotificationCategory(APIModel):
    key: str
    label: str
    description: str


class SessionOut(APIModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    ip: str | None
    user_agent: str | None
    current: bool


class DeleteAccountIn(APIModel):
    confirm_email: str = Field(max_length=320)
    password: str | None = Field(default=None, max_length=256)


class AccountActivity(APIModel):
    id: int
    created_at: datetime
    action: str
    result: str
    ip: str | None
    user_agent: str | None


class TwoFactorSetup(APIModel):
    secret: str
    otpauth_url: str


class TwoFactorEnableIn(APIModel):
    code: str = Field(min_length=6, max_length=10)


class TwoFactorDisableIn(APIModel):
    code: str = Field(min_length=6, max_length=20)
    password: str | None = Field(default=None, max_length=256)


class BackupCodes(APIModel):
    codes: list[str]


class PasswordConfirmIn(APIModel):
    password: str | None = Field(default=None, max_length=256)
    code: str | None = Field(default=None, max_length=20)
