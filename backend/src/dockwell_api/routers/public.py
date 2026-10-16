"""Unauthenticated endpoints used by the public site and the sign-in screens."""

import base64
import binascii

from fastapi import APIRouter, HTTPException, Response, status

from dockwell_api.config import get_settings
from dockwell_api.deps import DB
from dockwell_api.routers.playground import catalog_model
from dockwell_api.schemas.auth import AnnouncementOut, PublicConfig
from dockwell_api.schemas.catalog import CatalogModel
from dockwell_api.services import catalog, platform

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/config")
async def public_config(db: DB) -> PublicConfig:
    s = get_settings()
    config = await platform.get_config(db)
    announcement = config.announcement
    return PublicConfig(
        app_name=s.app_name,
        platform_name=config.platform_name,
        has_logo=await platform.get_logo(db) is not None,
        google_enabled=s.google_configured and config.google_signin_enabled,
        signup_enabled=config.signup_enabled,
        email_verification_required=config.require_email_verification,
        demo_mode=s.demo_mode,
        stripe_mode=s.stripe_mode,
        api_base_url=s.api_base_url,
        free_credit_micros=config.free_credit_micros if config.free_credit_enabled else 0,
        topup_presets_cents=config.topup_presets_cents,
        topup_min_cents=config.topup_min_cents,
        topup_max_cents=config.topup_max_cents,
        auto_recharge_allowed=config.auto_recharge_allowed,
        maintenance_mode=config.maintenance_mode,
        maintenance_message=config.maintenance_message,
        announcement=(
            AnnouncementOut(
                message=announcement.message, level=announcement.level, link=announcement.link
            )
            if announcement.message.strip()
            else None
        ),
    )


@router.get("/models")
async def public_models(db: DB) -> list[CatalogModel]:
    """The live model catalogue and list prices (pricing and models pages)."""
    models = await catalog.models_for_workspace(db, None, include_unavailable=True)
    prices = await catalog.current_prices(db)
    return [catalog_model(m, catalog.price_for(m.id, prices, {})) for m, _ in models]


@router.get("/logo", include_in_schema=False)
async def platform_logo(db: DB) -> Response:
    logo = await platform.get_logo(db)
    if logo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    try:
        data = base64.b64decode(logo["data"])
    except (binascii.Error, KeyError) as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.") from exc
    return Response(
        data,
        media_type=logo.get("content_type", "image/png"),
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cross-Origin-Resource-Policy": "same-origin",
        },
    )
