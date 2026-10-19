"""Idempotent start-up setup from the environment:

- local development: the llama.cpp provider and its tiny model (started by ./scripts/dev.sh);
- the public demo: Groq as the provider, with the models listed in GROQ_MODELS;
- development only: the first admin account (ADMIN_EMAILS + SEED_ADMIN_PASSWORD) and a default
  user account (SEED_USER_EMAIL + SEED_USER_PASSWORD).

Safe to run on every start and from several processes at once (a database advisory lock).
"""

from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.config import get_settings
from dockwell_api.db import SessionLocal, utcnow
from dockwell_api.logs import get_logger
from dockwell_api.models import AIModel, ModelPrice, Provider, User
from dockwell_api.security.crypto import decrypt, encrypt
from dockwell_api.security.passwords import hash_password, verify_password

log = get_logger("bootstrap")

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
LOCK_ID = 7_310_442


@dataclass(frozen=True)
class KnownModel:
    name: str
    owned_by: str
    context: int
    input_micros: int
    output_micros: int
    capabilities: tuple[str, ...] = ("chat", "completions", "tools")
    description: str = ""


GROQ_KNOWN: dict[str, KnownModel] = {
    "llama-3.1-8b-instant": KnownModel(
        "Llama 3.1 8B Instant",
        "Meta",
        131_072,
        50_000,
        80_000,
        description="Fast, inexpensive general-purpose model.",
    ),
    "llama-3.3-70b-versatile": KnownModel(
        "Llama 3.3 70B Versatile",
        "Meta",
        131_072,
        590_000,
        790_000,
        description="Strong general model for reasoning, coding and writing.",
    ),
    "openai/gpt-oss-20b": KnownModel(
        "GPT-OSS 20B",
        "OpenAI",
        131_072,
        100_000,
        500_000,
        description="Open-weight reasoning model.",
    ),
    "openai/gpt-oss-120b": KnownModel(
        "GPT-OSS 120B",
        "OpenAI",
        131_072,
        150_000,
        750_000,
        description="Large open-weight reasoning model.",
    ),
    "qwen/qwen3-32b": KnownModel(
        "Qwen3 32B",
        "Alibaba",
        131_072,
        290_000,
        590_000,
        description="Multilingual model with strong reasoning.",
    ),
    "qwen/qwen3.8-27b": KnownModel(
        "Qwen3.8 27B",
        "Alibaba",
        131_072,
        290_000,
        590_000,
        description="Multilingual model with strong reasoning and coding.",
    ),
    "openai/gpt-oss-safeguard-20b": KnownModel(
        "GPT-OSS Safeguard 20B",
        "OpenAI",
        131_072,
        100_000,
        500_000,
        description="Open-weight reasoning model tuned to follow safety policies.",
    ),
    "allam-2-7b": KnownModel(
        "ALLaM 2 7B",
        "SDAIA",
        4_096,
        50_000,
        80_000,
        capabilities=("chat", "completions"),
        description="Compact bilingual Arabic and English model.",
    ),
}


async def run() -> None:
    settings = get_settings()
    async with SessionLocal() as db:
        await db.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": LOCK_ID})
        if settings.bootstrap_llamacpp_url:
            await _ensure_llamacpp(
                db, settings.bootstrap_llamacpp_url, settings.bootstrap_llamacpp_model
            )
        if settings.bootstrap_vllm_url and settings.bootstrap_vllm_model:
            await _ensure_vllm(
                db,
                settings.bootstrap_vllm_url,
                settings.bootstrap_vllm_model,
                settings.bootstrap_vllm_context,
            )
        if settings.groq_api_key and settings.groq_api_key.get_secret_value():
            await _ensure_groq(db, settings.groq_api_key.get_secret_value(), settings.groq_models)
        if settings.environment == "development" and settings.seed_admin_password:
            await _ensure_dev_admin(db, settings.seed_admin_password.get_secret_value())
        if (
            settings.environment == "development"
            and settings.seed_user_email
            and settings.seed_user_password
        ):
            await _ensure_dev_user(
                db,
                settings.seed_user_email.strip().lower(),
                settings.seed_user_password.get_secret_value(),
                settings.seed_user_name,
            )
        await db.commit()


async def _price(db: AsyncSession, model: AIModel, input_micros: int, output_micros: int) -> None:
    db.add(
        ModelPrice(
            model_id=model.id,
            input_micros_per_m=input_micros,
            output_micros_per_m=output_micros,
            effective_from=utcnow(),
        )
    )


async def _ensure_llamacpp(db: AsyncSession, url: str, public_id: str) -> None:
    provider = await db.scalar(select(Provider).where(Provider.name == "Local llama.cpp"))
    if provider is None:
        provider = Provider(name="Local llama.cpp", kind="llamacpp", base_url=url, managed=False)
        db.add(provider)
        await db.flush()
        log.info("Registered the local llama.cpp provider at %s", url)
    elif provider.base_url != url:
        provider.base_url = url
    model = await db.scalar(select(AIModel).where(AIModel.public_id == public_id))
    if model is None:
        model = AIModel(
            provider_id=provider.id,
            public_id=public_id,
            upstream_id=public_id,
            display_name="Qwen2.5 0.5B Instruct",
            description="Tiny model served by llama.cpp on the CPU for local development.",
            owned_by="Alibaba",
            context_length=4096,
            max_output_tokens=2048,
            capabilities=["chat", "completions", "tools"],
            status="starting",
            status_message="Waiting for the local llama.cpp server.",
            sort_order=10,
        )
        db.add(model)
        await db.flush()
        await _price(db, model, 100_000, 200_000)


async def _ensure_vllm(db: AsyncSession, url: str, served_name: str, context: int) -> None:
    provider = await db.scalar(select(Provider).where(Provider.name == "vLLM engine"))
    if provider is None:
        provider = Provider(name="vLLM engine", kind="vllm", base_url=url, managed=False)
        db.add(provider)
        await db.flush()
        log.info("Registered the vLLM provider at %s", url)
    elif provider.base_url != url:
        provider.base_url = url
    public_id = served_name.split("/")[-1].lower()
    if await db.scalar(select(AIModel.id).where(AIModel.public_id == public_id)):
        return
    model = AIModel(
        provider_id=provider.id,
        public_id=public_id,
        upstream_id=served_name,
        display_name=served_name.split("/")[-1],
        description="Served by the bundled vLLM engine on this server.",
        owned_by=served_name.split("/")[0] if "/" in served_name else "",
        context_length=context,
        capabilities=["chat", "completions", "tools"],
        status="starting",
        status_message="Waiting for the vLLM engine.",
        sort_order=5,
    )
    db.add(model)
    await db.flush()
    await _price(db, model, 150_000, 600_000)


async def _ensure_groq(db: AsyncSession, api_key: str, models_csv: str) -> None:
    provider = await db.scalar(select(Provider).where(Provider.name == "Groq"))
    if provider is None:
        provider = Provider(
            name="Groq", kind="groq", base_url=GROQ_BASE_URL, api_key_enc=encrypt(api_key)
        )
        db.add(provider)
        await db.flush()
        log.info("Registered the Groq provider")
    elif decrypt(provider.api_key_enc) != api_key:
        provider.api_key_enc = encrypt(api_key)
    order = 20
    for upstream in [m.strip() for m in models_csv.split(",") if m.strip()]:
        order += 1
        public_id = upstream.split("/")[-1]
        if await db.scalar(
            select(AIModel.id).where(
                AIModel.upstream_id == upstream, AIModel.provider_id == provider.id
            )
        ):
            continue
        if await db.scalar(select(AIModel.id).where(AIModel.public_id == public_id)):
            continue
        known = GROQ_KNOWN.get(upstream, KnownModel(upstream, "", 32_768, 0, 0))
        model = AIModel(
            provider_id=provider.id,
            public_id=public_id,
            upstream_id=upstream,
            display_name=known.name,
            description=known.description,
            owned_by=known.owned_by,
            context_length=known.context,
            capabilities=list(known.capabilities),
            status="ready",
            sort_order=order,
        )
        db.add(model)
        await db.flush()
        await _price(db, model, known.input_micros, known.output_micros)


async def _ensure_dev_admin(db: AsyncSession, password: str) -> None:
    emails = sorted(get_settings().admin_email_set)
    if not emails:
        return
    address = emails[0]
    user = await db.scalar(select(User).where(User.email == address))
    if user is None:
        db.add(
            User(
                email=address,
                name="Admin",
                password_hash=hash_password(password),
                password_changed_at=utcnow(),
                email_verified_at=utcnow(),
                is_admin=True,
            )
        )
        log.info("Created the development admin account %s", address)
    else:
        user.is_admin = True
        if user.email_verified_at is None:
            user.email_verified_at = utcnow()
        if user.password_hash is None or not verify_password(user.password_hash, password):
            user.password_hash = hash_password(password)


async def _ensure_dev_user(db: AsyncSession, address: str, password: str, name: str) -> None:
    user = await db.scalar(select(User).where(User.email == address))
    if user is None:
        db.add(
            User(
                email=address,
                name=name,
                password_hash=hash_password(password),
                password_changed_at=utcnow(),
                email_verified_at=utcnow(),
            )
        )
        log.info("Created the development user account %s", address)
        return
    if user.email_verified_at is None:
        user.email_verified_at = utcnow()
    if user.password_hash is None or not verify_password(user.password_hash, password):
        user.password_hash = hash_password(password)
