DockWell is updated by pulling the new code and rebuilding. Database migrations are part of the code and run automatically on a self-hosted install, so most upgrades take a couple of minutes. This page covers each way of running DockWell.

## Before every upgrade

1. **Read the release notes** on GitHub for every version between yours and the new one. They call out breaking changes, new settings and anything you need to do by hand.
2. **Back up the database.** Migrations change the schema, and a backup is the only way back if something goes wrong.
3. **Check `.env.example` for new settings.** Compare it with your `.env.prod` (or `backend/.env`) and add anything new you want to change. New settings always have safe defaults, so missing ones don't break anything.

> [!WARNING]
> Never change `ENCRYPTION_KEY` during an upgrade. Provider API keys, the Hugging Face token and two-factor secrets stored in the database can only be decrypted with the key they were encrypted with.

## Self-hosted (Docker Compose)

### 1. Back up

```bash
cd dockwell
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U dockwell -d dockwell --format=custom > dockwell-before-upgrade-$(date +%F).dump
```

### 2. Get the new code

```bash
git fetch --tags
git pull
```

To upgrade to a specific release instead of the latest commit, check out its tag, for example `git checkout v1.2.0`.

### 3. Rebuild and restart

Use the same profile you started with (`gpu` or `cpu`):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile gpu up -d --build
```

The `api` container **runs database migrations on every start**, before it begins serving requests. Watch them in the logs:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api
```

When the API is up, `https://dockwell.example.com/api/health` returns `{"status":"ok"}`.

### What happens to running requests

Restarting the `api` container ends requests that are in flight. Streamed replies stop, and those requests are charged for what was generated, like any cancelled request. Reservations of requests that couldn't settle are released automatically after `RESERVATION_TTL_MINUTES` (30 by default). For the least disruption, upgrade at a quiet time, or turn on **maintenance mode** in **Admin > Settings** first and off again afterwards.

### Engines and model weights

Upgrading DockWell doesn't touch your inference engines. Deployed vLLM and llama.cpp containers keep running, and downloaded weights stay in the `dockwell_hf_cache` volume.

To update the engine software itself:

- **Bundled services** (`vllm`, `llamacpp`): pull the new images with `docker compose -f docker-compose.prod.yml --env-file .env.prod pull`, then run the `up -d` command again.
- **Deployed engines**: change `VLLM_IMAGE` or `LLAMACPP_IMAGE` if you pinned a version, restart the API, then delete and redeploy the engine, or restart it from **Admin > Deployments** after pulling the image on the host with `docker pull`.

> [!TIP]
> Pin engine images to a version (for example `vllm/vllm-openai:v0.11.0`) instead of `latest`, so engine updates happen only when you choose.

### Rolling back

If an upgrade goes wrong:

1. Check out the previous version: `git checkout <previous tag>`.
2. Restore the backup you took (see [Self-hosting](/docs/self-hosting#backups)), because the newer migrations may have changed the schema.
3. Rebuild with the same `up -d --build` command.

## Local development

Pull the new code and start the script again:

```bash
git pull
./scripts/dev.sh
```

On Windows, run `scripts\dev.cmd`. The script installs any new packages and **runs migrations** before starting the API and web app. Your `backend/.env` is never overwritten, so compare it with `backend/.env.example` for new settings.

If you changed backend API endpoints yourself, regenerate the frontend client with `make gen-api`.

## Vercel demo

A serverless function shouldn't change the schema while requests are running, so the demo **doesn't migrate on start**. Run migrations yourself, against Neon's **direct** connection string (without `-pooler`), **before** the new version deploys:

```bash
git pull
cd backend
DATABASE_URL='postgresql://user:password@ep-example-123456.us-east-1.aws.neon.tech/neondb?sslmode=require' \
  uv run alembic upgrade head
```

Then push to your main branch, or redeploy in Vercel.

Also check:

- **`requirements.txt`** is regenerated when backend dependencies change. If you changed them yourself, run `make vercel-requirements` and commit the result.
- **New environment variables** from the release notes are added in Vercel's project settings.

> [!NOTE]
> Neon offers point-in-time restore on its plans, but take a manual backup with `pg_dump` against the direct URL before a large upgrade anyway.

## Checking the result

After any upgrade:

1. Open `/api/health`.
2. Sign in and open **Admin > Settings** to check the status of the database, email, Stripe and the engine manager.
3. Send a test request with your API key, or a message in the playground.
4. Check **Admin > System health** for engine status and error rate.
