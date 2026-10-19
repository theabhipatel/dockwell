# Deploy DockWell on Vercel (step by step)

This guide deploys the full app (website, web app, API and the OpenAI-compatible `/v1`) to **any
Vercel account**, with **Neon** as the database and **Groq** for the models. Copy and paste each
block in order from the project root. It takes about 15 minutes.

---

## What you need

- **Vercel CLI**, installed with `npm i -g vercel`.
- **uv**, installed with `curl -LsSf https://astral.sh/uv/install.sh | sh`.
- A **Neon** database (free): https://neon.com
- A **Groq** API key (free): https://console.groq.com/keys

---

## Step 1. Switch to the new Vercel account

```bash
vercel logout
vercel login            # sign in with the NEW account
rm -rf .vercel          # forget the link to the old account's project
```

## Step 2. Fill in your values

Open a terminal in the project root and set these. Only change the first three lines.

```bash
export NEON_POOLED='postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
export GROQ_API_KEY='gsk_...'
export PROJECT='dockwell'            # Vercel project name

# Neon's direct URL (for migrations) is the pooled one without "-pooler"
export NEON_DIRECT="${NEON_POOLED/-pooler/}"
```

Where to find them:

- **`NEON_POOLED`:** Neon dashboard > **Connect**, with **Connection pooling ON**. Copy the URL as it is.
- **`GROQ_API_KEY`:** https://console.groq.com/keys

## Step 3. Pick the Groq models

List the models your key can use:

```bash
curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY" \
  | python3 -c "import json,sys; print('\n'.join(sorted(m['id'] for m in json.load(sys.stdin)['data'])))"
```

Choose chat models from that list, comma separated. These two have built-in prices:

```bash
export GROQ_MODELS='openai/gpt-oss-20b,openai/gpt-oss-120b'
```

Models with built-in prices are `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`,
`openai/gpt-oss-20b`, `openai/gpt-oss-120b` and `qwen/qwen3-32b`. Any other model is added
without a price, so set one later in **Admin > Models**.

## Step 4. Generate secrets (saved locally)

```bash
umask 077
cat > .vercel-secrets.env <<EOF
SECRET_KEY=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))")
ENCRYPTION_KEY=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))")
CRON_SECRET=$(python3 -c "import secrets;print(secrets.token_urlsafe(32))")
ADMIN_PASSWORD=$(python3 -c "import secrets;print(secrets.token_urlsafe(12))")
EOF
set -a; . ./.vercel-secrets.env; set +a
```

`.vercel-secrets.env` is ignored by git and never uploaded to Vercel. Keep a copy somewhere safe:
`ENCRYPTION_KEY` can't be recovered if you lose it.

## Step 5. Create the database tables

```bash
(cd backend && DATABASE_URL="$NEON_DIRECT" uv run alembic upgrade head)
```

The output should end with `Running upgrade -> ..., initial schema`.

## Step 6. Create the admin account

This creates `admin@dockwell.dev` with the password from step 4. It also turns off email
verification, because this setup has no email account, so new users can sign in right after
signing up.

```bash
(cd backend && DATABASE_URL="$NEON_DIRECT" uv run python - <<'EOF'
import asyncio, os
from sqlalchemy import select
from dockwell_api.db import SessionLocal, utcnow
from dockwell_api.models import User
from dockwell_api.security.passwords import hash_password
from dockwell_api.services import platform

async def main():
    async with SessionLocal() as db:
        email = "admin@dockwell.dev"
        if await db.scalar(select(User).where(User.email == email)) is None:
            db.add(User(email=email, name="Admin", is_admin=True,
                        password_hash=hash_password(os.environ["ADMIN_PASSWORD"]),
                        password_changed_at=utcnow(), email_verified_at=utcnow()))
        await platform.update_config(db, {"require_email_verification": False}, None)
        await db.commit()
        print("Admin ready:", email)
asyncio.run(main())
EOF
)
```

## Step 7. Create the Vercel project and add the settings

```bash
vercel link --yes --project "$PROJECT"
```

If it says it couldn't connect a GitHub repository, ignore it. You deploy from this folder.

Now add all the settings to Production:

```bash
add() { vercel env rm "$1" production --yes >/dev/null 2>&1; printf '%s' "$2" | vercel env add "$1" production >/dev/null && echo "added $1"; }

add SERVERLESS       true
add ENVIRONMENT      production
add COOKIE_SECURE    true
add CLIENT_IP_HEADER x-real-ip
add DEMO_MODE        true
add VITE_DEMO_MODE   true
add ENGINE_MANAGER   none
add DATABASE_URL     "$NEON_POOLED"
add GROQ_API_KEY     "$GROQ_API_KEY"
add GROQ_MODELS      "$GROQ_MODELS"
add SECRET_KEY       "$SECRET_KEY"
add ENCRYPTION_KEY   "$ENCRYPTION_KEY"
add CRON_SECRET      "$CRON_SECRET"
```

## Step 8. First deploy

```bash
vercel deploy --prod --yes
```

At the end it prints **`Production URL: https://....vercel.app`**. Copy it:

```bash
export APP_URL='https://your-project.vercel.app'     # paste yours, no trailing slash
```

## Step 9. Set the address and deploy again

Sign-in only works when `APP_URL` matches the address in the browser exactly.

```bash
add APP_URL       "$APP_URL"
add VITE_SITE_URL "$APP_URL"
vercel deploy --prod --yes
```

## Step 10. Check it

```bash
curl -s "$APP_URL/api/health"          # should print {"status":"ok"}
curl -s "$APP_URL/api/public/models"   # should list your Groq models
```

Then open your URL in the browser:

- **Admin:** sign in as `admin@dockwell.dev` with the `ADMIN_PASSWORD` from `.vercel-secrets.env`.
- **New users:** sign up, sign in straight away, create a workspace (with $3 starter credit), and
  use the **Playground** or create an **API key** for `$APP_URL/v1`.

You're done.

---

## Later: deploy an update

```bash
set -a; . ./.vercel-secrets.env; set +a
export NEON_DIRECT='...direct URL from step 2...'
(cd backend && DATABASE_URL="$NEON_DIRECT" uv run alembic upgrade head)   # only does work when there are new migrations
vercel deploy --prod --yes
```

## Optional extras

Add these with the `add` function from step 7, then run `vercel deploy --prod --yes`.

| Feature | Settings |
|---|---|
| **Email** (verification, invitations) | `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_STARTTLS=true`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `MAIL_FROM="DockWell <you@example.com>"`. Then turn **Require email verification** back on in **Admin > Settings** if you want it. |
| **Payments** (Stripe test mode) | `STRIPE_SECRET_KEY=sk_test_...` and `STRIPE_WEBHOOK_SECRET=whsec_...`. Create the webhook in Stripe at `$APP_URL/api/stripe/webhook` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed` and `charge.refunded`. |
| **Google sign-in** | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, with the redirect URI `$APP_URL/api/auth/google/callback`. |
| **Custom domain** | Add it in Vercel > Project > Domains, then set `APP_URL` and `VITE_SITE_URL` to it and redeploy. |

## If something goes wrong

| Problem | Fix |
|---|---|
| "Cross-origin request blocked" when signing in | `APP_URL` isn't exactly the browser address. Fix it (step 9) and redeploy. |
| "relation ... does not exist" | Step 5 wasn't run against this database. |
| No models in the playground | A model in `GROQ_MODELS` isn't available to your key (step 3). Fix it, then redeploy. |
| Sign-in doesn't work on a `...-git-...` or preview URL | That's expected. Use the production URL. |
| The first request is slow | Neon wakes up after being idle. It takes a second or two. |

More detail: `/docs/vercel-demo` in the app, or [DEPLOYMENT.md](DEPLOYMENT.md).
