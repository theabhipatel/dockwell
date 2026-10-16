"""Vercel entry point for the DockWell API. Used only by the public demo deployment.

Self-hosted installs never load this file (or vercel.json / requirements.txt at the repo root):
Docker and ./scripts/dev.sh run `uvicorn dockwell_api.main:app` straight from backend/. The demo
runs the very same application object, configured with environment variables.

How the Vercel deployment fits together (vercel.json can't hold comments, so they live here):

- Frontend: `npm run build` in frontend/ produces the pre-rendered public site plus the app
  shell (app.html). Vercel serves frontend/dist from its CDN.
- API: this file becomes one Python function. vercel.json rewrites every /api/* and /v1/*
  request to it; FastAPI still sees the original path, so the routes are the self-hosted ones,
  including the OpenAI-compatible /v1 API.
- Inference: Groq (GROQ_API_KEY), registered on start-up with the models in GROQ_MODELS.
- Payments: Stripe test keys. Switching to live keys is configuration only.
- Packages: installed from requirements.txt at the repo root, generated from backend/uv.lock
  by `make vercel-requirements` (same versions as the Docker image).
- Cron: once a day Vercel calls GET /api/internal/cron with "Authorization: Bearer
  <CRON_SECRET>": email retries, abandoned reservations, log retention, expired sessions.

Required environment variables (Project -> Settings -> Environment Variables):
  SERVERLESS=true, ENVIRONMENT=production, COOKIE_SECURE=true, CLIENT_IP_HEADER=x-real-ip
  DATABASE_URL             Neon's *pooled* connection string, pasted as-is
  APP_URL                  https://<your-project>.vercel.app (or your custom domain)
  SECRET_KEY, ENCRYPTION_KEY, CRON_SECRET   long random strings
  DEMO_MODE=true, ENGINE_MANAGER=none
  GROQ_API_KEY, GROQ_MODELS
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET   (test mode keys)
  SMTP_HOST / SMTP_PORT / SMTP_USERNAME / SMTP_PASSWORD / SMTP_STARTTLS / MAIL_FROM
  ADMIN_EMAILS             your address, to get the admin area
  VITE_DEMO_MODE=true, VITE_SITE_URL=<same as APP_URL>   (read by the frontend build)
See the docs page "Deploying the demo on Vercel" (frontend/src/site/docs/content/vercel-demo.md).
"""

import sys
from pathlib import Path

# The API is a src-layout package in backend/ that isn't pip-installed on Vercel; its files are
# part of the function bundle, so make them importable directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend" / "src"))

from dockwell_api.main import app  # (importable thanks to the path above)

__all__ = ["app"]
