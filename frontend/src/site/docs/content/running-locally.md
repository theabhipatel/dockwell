This page shows you how to run DockWell on your own computer with one command, on Linux, macOS or Windows. No GPU is needed: a tiny model runs on your CPU with llama.cpp, so you can build and test against the real OpenAI-compatible API. When you're ready for a server, continue with [Self-hosting on a GPU server](/docs/self-hosting).

## Requirements

Install these first. The start scripts check for each one and tell you exactly what's missing.

| Tool | Version | Notes |
|---|---|---|
| **Docker** | Docker Compose v2 (`docker compose`) | Docker Desktop on macOS and Windows, Docker Engine on Linux. It must be running. |
| **[uv](https://docs.astral.sh/uv/getting-started/installation/)** | Any recent version | The Python package manager. It installs Python 3.12 for you if needed. |
| **Node.js** | 22.12 or newer | Node 22 LTS is recommended. |

You also need Git, about 2 GB of free disk space and a few GB of free memory.

## Start it

### Linux, macOS and WSL

```bash
git clone https://github.com/theabhipatel/dockwell.git
cd dockwell
./scripts/dev.sh
```

If you have `make`, `make dev` does the same.

### Windows

In PowerShell or Command Prompt, with Docker Desktop, uv and Node.js installed for Windows:

```powershell
git clone https://github.com/theabhipatel/dockwell.git
cd dockwell
scripts\dev.cmd
```

> [!TIP]
> With WSL, install uv and Node.js inside your Linux distribution, turn on Docker Desktop's WSL integration for it, and clone into your Linux home directory (`~`), not `/mnt/c`, which is much slower.

## What the script does

`dev.sh` and `dev.cmd` do the same steps:

1. **Checks prerequisites**: Docker is installed and running, Docker Compose v2, uv and Node.js 22.12 or newer.
2. **Starts PostgreSQL, Mailpit and llama.cpp** in Docker from `docker-compose.yml`, and waits until PostgreSQL is healthy.
3. **Creates `backend/.env`** from `backend/.env.example` on the first run, with freshly generated random secrets (`SECRET_KEY`, `ENCRYPTION_KEY`) and a password for the development admin. An existing `backend/.env` is never overwritten.
4. **Installs packages**: `uv sync` for the backend and `npm install` for the frontend.
5. **Runs database migrations** with `uv run alembic upgrade head`.
6. **Starts the API** on port 31100 (with auto-reload) and **the web app** on port 31180.

On the first run, the llama.cpp container **downloads Qwen2.5 0.5B Instruct** (a GGUF file of a few hundred MB) from Hugging Face into a Docker volume. Later runs reuse it. The API registers the local llama.cpp server and the `qwen2.5-0.5b-instruct` model on start-up. The model shows **starting** until the download finishes and the server answers, then **ready**.

Press `Ctrl` + `C` to stop the API and web app. PostgreSQL, Mailpit and llama.cpp keep running in Docker. Stop them with `docker compose down`. Your data lives in Docker volumes and survives restarts.

## URLs and ports

Every port is in the uncommon 31xxx range, so DockWell doesn't clash with a local PostgreSQL (5432) or other dev servers (3000, 5173, 8000, 8080).

| Service | Address | Notes |
|---|---|---|
| Web app | `http://localhost:31180` | The app and public site. Also serves the API at `/v1` and `/api`. |
| API | `http://localhost:31100` | Interactive API docs at `http://localhost:31100/api/docs` (development only). |
| PostgreSQL | `127.0.0.1:31432` | User, password and database are all `dockwell`. |
| Mailpit SMTP | `127.0.0.1:31025` | Catches every email the app sends. |
| Mailpit web UI | `http://localhost:31825` | Read the caught emails here. |
| llama.cpp | `http://127.0.0.1:31800/v1` | The CPU engine with the tiny model. |
| Deployed engines | From `127.0.0.1:31810` up | Engines you deploy from the admin area. |

Docker publishes these ports on `127.0.0.1` only, so they aren't reachable from other machines.

## Sign in

You have two options:

- **Use the development admin account.** Sign in as `admin@dockwell.dev` with the password `dev.sh` printed at the end of its first run. It's also stored as `SEED_ADMIN_PASSWORD` in `backend/.env`. This account is already verified and is a platform admin.
- **Sign up as a new user.** Open the verification email in Mailpit at `http://localhost:31825`. Every email lands there, whatever the address.

Then follow the [Quick start](/docs/quick-start) to create a workspace and an API key, and call the API:

```bash
curl http://localhost:31180/v1/chat/completions \
  -H "Authorization: Bearer $DOCKWELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen2.5-0.5b-instruct", "messages": [{"role": "user", "content": "Hello!"}]}'
```

> [!NOTE]
> Qwen2.5 0.5B is tiny, so its answers are simple, and generation speed depends on your CPU. It's meant for building and testing, not for quality. Its context is set to 4096 tokens with up to 2048 output tokens.

## Deploying other models locally

The local `backend/.env` turns on the engine manager (`ENGINE_MANAGER=docker`), so you can try **Admin > Models > Deploy model** on your machine too. Choose **llama.cpp**, enter a Hugging Face repository with GGUF files and the file name, and set **GPU count** to `0` if you don't have an NVIDIA GPU. The engine's port is published on `127.0.0.1`, starting at 31810.

## Payments in Stripe test mode

Payments are optional locally. To try them:

1. Create a free Stripe account and copy your **test** secret key (`sk_test_...`).
2. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and log in with `stripe login`.
3. Forward webhooks to your local API:

   ```bash
   stripe listen --forward-to localhost:31100/api/stripe/webhook
   ```

4. Copy the signing secret it prints (`whsec_...`).
5. Set both in `backend/.env`:

   ```env
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

6. Restart `dev.sh`, then buy credits on the **Billing** page with the test card `4242 4242 4242 4242`, any future expiry and any CVC.

Keep `stripe listen` running: credits are only added when the webhook arrives.

## Running the pieces by hand

To start each part yourself, for example to see each log in its own terminal:

```bash
docker compose up -d        # PostgreSQL, Mailpit and llama.cpp

cd backend
cp .env.example .env        # then set SECRET_KEY, ENCRYPTION_KEY and SEED_ADMIN_PASSWORD
uv sync
uv run alembic upgrade head
uv run uvicorn dockwell_api.main:app --reload --port 31100
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev                 # http://localhost:31180
```

The Vite dev server proxies `/api` and `/v1` to the API (`API_PROXY_TARGET`, default `http://127.0.0.1:31100`), so the app and API share one origin, just as in production.

## Tests and checks

The `Makefile` has shortcuts for the common tasks:

| Command | What it does |
|---|---|
| `make dev` | Runs `./scripts/dev.sh`. |
| `make test` | Runs the backend test suite with pytest. It uses the PostgreSQL from `docker-compose.yml`, so start Docker first. |
| `make check` | Lints and type-checks everything: ruff and strict mypy for the backend, TypeScript, oxlint and a production build for the frontend. |
| `make gen-api` | Regenerates the typed frontend API client from the backend's OpenAPI schema. Run it after changing an API endpoint or schema. |
| `make vercel-requirements` | Regenerates `requirements.txt` for the Vercel demo from `backend/uv.lock`. |

## Changing ports

| Service | Port | Change it in |
|---|---|---|
| Web app | 31180 | `frontend/vite.config.ts`, `APP_URL` in `backend/.env`, both dev scripts |
| API | 31100 | Both dev scripts, `API_PROXY_TARGET` for the frontend |
| PostgreSQL | 31432 | `docker-compose.yml`, `DATABASE_URL` in `backend/.env` |
| Mailpit | 31025 / 31825 | `docker-compose.yml`, `SMTP_PORT` in `backend/.env` |
| llama.cpp | 31800 | `docker-compose.yml`, `BOOTSTRAP_LLAMACPP_URL` in `backend/.env` |
| Deployed engines | 31810 and up | `ENGINE_PORT_RANGE_START` in `backend/.env` |

If the script says a port is in use, another program is using it. Stop that program, or change the port as above. See the [FAQ](/docs/faq#port-already-in-use).
