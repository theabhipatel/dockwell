"""Application settings, loaded from environment variables (and `.env` in development).

Everything the server reads from its environment lives here. Settings an admin can change at
runtime (prices, free credit, limits, sign-up on/off...) are stored in the database instead,
see `services/platform.py`.
"""

from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, SecretStr, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    # Public origin of the web app. Used for email links, the Origin check, CORS and the
    # OpenAI-compatible base URL shown to users (<APP_URL>/v1).
    app_url: str = "http://localhost:31180"
    app_name: str = "DockWell"

    database_url: str = "postgresql+asyncpg://dockwell:dockwell@localhost:31432/dockwell"
    database_echo: bool = False

    # Signs short-lived state cookies. Must be long and random in production.
    secret_key: SecretStr = SecretStr("dev-only-insecure-secret-change-me-0123456789")
    # Encrypts provider API keys, the Hugging Face token and 2FA secrets at rest. Any long
    # random string. Unset = derived from SECRET_KEY (rotating SECRET_KEY then breaks them).
    encryption_key: SecretStr | None = None

    # Sessions
    cookie_secure: bool = False
    session_ttl_days: int = 30
    session_idle_days: int = 7

    # Email (SMTP). In development Mailpit catches everything on port 31025.
    smtp_host: str = "localhost"
    smtp_port: int = 31025
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_starttls: bool = False
    smtp_tls: bool = False
    mail_from: str = "DockWell <no-reply@dockwell.local>"
    email_worker_enabled: bool = True

    # Google sign-in (optional; the button is hidden when unset)
    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None

    # Token lifetimes
    email_verification_ttl_hours: int = 48
    password_reset_ttl_minutes: int = 60
    invitation_ttl_days: int = 7

    # Rate limits on auth and email actions (attempts per window)
    signin_ip_limit: int = 30
    signin_email_failure_limit: int = 5
    signin_window_minutes: int = 15
    email_action_limit: int = 5
    email_action_window_minutes: int = 30
    token_submit_ip_limit: int = 30

    max_avatar_bytes: int = Field(default=1_000_000)

    # Platform admins: users signing in with one of these addresses are made admins.
    admin_emails: str = ""
    # Development only: creates (or resets) the first admin account with this password, so a
    # fresh local install can be used right away. Ignored in production.
    seed_admin_password: SecretStr | None = None
    # Development only: creates (or resets) a regular, verified user account with this email
    # and password. Not checked against the password rules, so keep it out of production.
    seed_user_email: str = ""
    seed_user_password: SecretStr | None = None
    seed_user_name: str = "DockWell User"

    # Public demo: the web app shows the demo banner and the API refuses a few destructive
    # platform-wide actions. Payments are always Stripe test mode on the demo.
    demo_mode: bool = False

    # ---- Payments (Stripe) ----------------------------------------------------------------
    # Test keys (sk_test_...) or live keys (sk_live_...): switching is configuration only.
    stripe_secret_key: SecretStr | None = None
    stripe_webhook_secret: SecretStr | None = None

    # ---- Inference --------------------------------------------------------------------------
    upstream_timeout_seconds: float = 600
    upstream_connect_timeout_seconds: float = 10
    # Output cap used when a request does not set max_tokens (also bounds the reservation).
    default_max_tokens: int = 4096
    # Reservations older than this are considered abandoned and released by housekeeping.
    reservation_ttl_minutes: int = 30

    # Bootstrap providers from the environment on start-up (idempotent).
    # Local dev: the llama.cpp server started by ./scripts/dev.sh.
    bootstrap_llamacpp_url: str | None = None
    bootstrap_llamacpp_model: str = "qwen2.5-0.5b-instruct"
    # Self-hosted: the vLLM engine from docker-compose.prod.yml (gpu profile) and the model it
    # serves (its --served-model-name, which becomes the public model id).
    bootstrap_vllm_url: str | None = None
    bootstrap_vllm_model: str | None = None
    bootstrap_vllm_context: int = 8192
    # Demo: Groq's OpenAI-compatible API with these models offered by default.
    groq_api_key: SecretStr | None = None
    groq_models: str = "llama-3.1-8b-instant,llama-3.3-70b-versatile"

    # ---- Engine manager (self-hosted model deployments) -----------------------------------
    # "docker": the API starts vLLM / llama.cpp containers through the Docker socket.
    # "none": deployments are disabled (serverless demo, or engines managed by hand).
    engine_manager: Literal["docker", "none"] = "none"
    docker_socket: str = "/var/run/docker.sock"
    # Docker network shared by the API and engine containers (docker compose). Unset = the
    # engine's port is published on 127.0.0.1 instead (local development).
    engine_network: str | None = None
    engine_port_range_start: int = 31810
    engine_hf_cache_volume: str = "dockwell_hf_cache"
    vllm_image: str = "vllm/vllm-openai:latest"
    llamacpp_image: str = "ghcr.io/ggml-org/llama.cpp:server"

    # ---- Monitoring ------------------------------------------------------------------------
    # Prometheus server the admin health page reads GPU metrics from (self-hosted).
    prometheus_url: str | None = None
    # Bearer token for GET /api/metrics. Unset = only reachable from private addresses.
    metrics_token: SecretStr | None = None

    # ---- Serverless hosting (the public Vercel demo) --------------------------------------
    # SERVERLESS=true: no background loops (email and housekeeping run inline / from cron),
    # and database connections are opened per request for a transaction-mode pooler.
    serverless: bool = False
    # Enables GET /api/internal/cron (Authorization: Bearer <CRON_SECRET>).
    cron_secret: SecretStr | None = None
    # Request header holding the client IP, set by a proxy you trust (x-real-ip on Vercel).
    client_ip_header: str | None = None

    @field_validator("database_url")
    @classmethod
    def _asyncpg_url(cls, value: str) -> str:
        """Accept plain `postgresql://...?sslmode=require` URLs (Neon, Supabase...) and turn
        them into what asyncpg expects."""
        parts = urlsplit(value)
        scheme = parts.scheme
        if scheme in ("postgres", "postgresql"):
            scheme = "postgresql+asyncpg"
        query = parse_qsl(parts.query, keep_blank_values=True)
        if scheme != parts.scheme or any(key == "sslmode" for key, _ in query):
            query = [
                ("ssl" if key == "sslmode" else key, val)
                for key, val in query
                if key != "channel_binding"
            ]
            return urlunsplit(parts._replace(scheme=scheme, query=urlencode(query)))
        return value

    @computed_field  # type: ignore[prop-decorator]
    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def stripe_configured(self) -> bool:
        return self.stripe_secret_key is not None and bool(
            self.stripe_secret_key.get_secret_value()
        )

    @property
    def stripe_mode(self) -> Literal["live", "test", "off"]:
        if not self.stripe_configured or self.stripe_secret_key is None:
            return "off"
        return (
            "live"
            if self.stripe_secret_key.get_secret_value().startswith(("sk_live", "rk_live"))
            else "test"
        )

    @property
    def admin_email_set(self) -> frozenset[str]:
        return frozenset(e.strip().lower() for e in self.admin_emails.split(",") if e.strip())

    @property
    def api_base_url(self) -> str:
        return self.app_url.rstrip("/") + "/v1"

    @property
    def session_cookie_name(self) -> str:
        # The __Host- prefix pins the cookie to this exact origin, but requires Secure.
        return "__Host-dockwell_session" if self.cookie_secure else "dockwell_session"

    @property
    def csrf_cookie_name(self) -> str:
        return "__Host-dockwell_csrf" if self.cookie_secure else "dockwell_csrf"

    @property
    def oauth_cookie_name(self) -> str:
        return "__Host-dockwell_oauth" if self.cookie_secure else "dockwell_oauth"


@lru_cache
def get_settings() -> Settings:
    return Settings()
