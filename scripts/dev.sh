#!/usr/bin/env bash
# Start everything for local development on Linux, macOS or Windows WSL, CPU only:
# Postgres + Mailpit + llama.cpp (Docker), the API and the web app. Windows: scripts\dev.cmd
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

WEB_PORT=31180
API_PORT=31100
MAIL_UI_PORT=31825
LLAMA_PORT=31800

fail() { printf '\n  \033[31m%s\033[0m\n\n' "$*" >&2; exit 1; }
info() { printf '  %s\n' "$*"; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
random_secret() { uv run --no-project python -c 'import secrets;print(secrets.token_urlsafe(48))'; }

# ---- Prerequisites ---------------------------------------------------------------------
command -v docker >/dev/null || fail "Docker is not installed. Install Docker Desktop (macOS) or Docker Engine (Linux)."
docker info >/dev/null 2>&1 || fail "Docker is installed but not running (or needs sudo). Start Docker and retry."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is missing ('docker compose'). Update Docker."
command -v uv >/dev/null || fail "uv is not installed: curl -LsSf https://astral.sh/uv/install.sh | sh   (then open a new terminal)"
command -v node >/dev/null || fail "Node.js is not installed. Install Node 22 LTS from https://nodejs.org."
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)' \
  || fail "Node $(node --version) is too old. Vite needs Node 20.19+ or 22.12+."

case "$ROOT" in /mnt/[a-z]/*)
  info "Note: the repo is on the Windows drive ($ROOT). It works but is slow; clone it inside WSL for best results."
esac

for port in "$API_PORT" "$WEB_PORT"; do
  port_busy "$port" && fail "Port $port is already in use. Stop whatever is using it (maybe an earlier run of this script)."
done

# ---- Database, mail catcher and the CPU inference engine ------------------------------
info "Starting Postgres and Mailpit..."
docker compose -f "$ROOT/docker-compose.yml" up -d --wait postgres mailpit
info "Starting llama.cpp (the first run downloads Qwen2.5 0.5B Instruct, about 400 MB)..."
docker compose -f "$ROOT/docker-compose.yml" up -d llamacpp

# ---- Backend ---------------------------------------------------------------------------
cd "$ROOT/backend"
if [ ! -f .env ]; then
  admin_password="$(uv run --no-project python -c 'import secrets;print(secrets.token_urlsafe(12))')"
  sed -e "s|^SECRET_KEY=.*|SECRET_KEY=$(random_secret)|" \
      -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(random_secret)|" \
      -e "s|^SEED_ADMIN_PASSWORD=.*|SEED_ADMIN_PASSWORD=$admin_password|" \
      .env.example > .env
  info "Created backend/.env with random secrets and a development admin password."
fi
info "Installing backend packages..."
uv sync --quiet
info "Running database migrations..."
uv run alembic upgrade head

ADMIN_EMAIL="$(grep -E '^ADMIN_EMAILS=' .env | head -1 | cut -d= -f2 | cut -d, -f1)"
ADMIN_PASSWORD="$(grep -E '^SEED_ADMIN_PASSWORD=' .env | head -1 | cut -d= -f2-)"
USER_EMAIL="$(grep -E '^SEED_USER_EMAIL=' .env | head -1 | cut -d= -f2-)"
USER_PASSWORD="$(grep -E '^SEED_USER_PASSWORD=' .env | head -1 | cut -d= -f2-)"

# ---- Frontend --------------------------------------------------------------------------
cd "$ROOT/frontend"
[ -d node_modules ] || { info "Installing frontend packages..."; npm install; }

# ---- Run both; Ctrl+C stops both -------------------------------------------------------
trap 'kill 0' EXIT INT TERM
(cd "$ROOT/backend" && uv run uvicorn dockwell_api.main:app --reload --host 127.0.0.1 --port "$API_PORT" --proxy-headers) &
(cd "$ROOT/frontend" && npx vite --host localhost) &

if curl -fsS "http://127.0.0.1:$LLAMA_PORT/health" >/dev/null 2>&1; then
  llama_state="ready"
else
  llama_state="starting (downloading the model on first run: docker compose logs -f llamacpp)"
fi

echo ""
echo "  DockWell is running"
echo "  Web app:     http://localhost:$WEB_PORT"
echo "  API:         http://localhost:$WEB_PORT/v1   (OpenAI-compatible base URL)"
echo "  API docs:    http://localhost:$API_PORT/api/docs"
echo "  Mailpit:     http://localhost:$MAIL_UI_PORT   (every email the app sends lands here)"
echo "  llama.cpp:   http://localhost:$LLAMA_PORT   $llama_state"
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  echo "  Admin login: $ADMIN_EMAIL / $ADMIN_PASSWORD"
fi
if [ -n "$USER_EMAIL" ] && [ -n "$USER_PASSWORD" ]; then
  echo "  User login:  $USER_EMAIL / $USER_PASSWORD"
fi
echo "  Press Ctrl+C to stop."
echo ""
wait
