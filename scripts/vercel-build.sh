#!/bin/bash
set -e

# --- Auto-run Alembic migrations (Neon direct URL = pooled URL without "-pooler") ---
if [ -n "$DATABASE_URL" ]; then
    export MIGRATION_URL="${DATABASE_URL//-pooler/}"
    echo "▶ Running database migrations..."
    PYTHONPATH="$PWD/backend/src:$PYTHONPATH" DATABASE_URL="$MIGRATION_URL" \
        python3 -m alembic -c backend/alembic.ini upgrade head
    echo "✓ Migrations complete"
fi

# --- Build the frontend ---
echo "▶ Building frontend..."
cd frontend && npm run build
echo "✓ Frontend build complete"
