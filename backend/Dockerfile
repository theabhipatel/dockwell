# DockWell API (production image)
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY migrations ./migrations
COPY alembic.ini ./
RUN uv sync --frozen --no-dev

# The engine manager talks to the Docker socket, which is group-owned on the host; the compose
# file adds this user to that group with `group_add`.
RUN useradd --system --uid 10001 dockwell
USER dockwell
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
# Apply migrations, then serve. Behind the nginx proxy, trust its forwarded client IP.
CMD ["sh", "-c", "alembic upgrade head && uvicorn dockwell_api.main:app --host 0.0.0.0 --port 8000 --workers ${API_WORKERS:-2} --proxy-headers --forwarded-allow-ips='*'"]
