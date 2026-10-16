.PHONY: dev test check gen-api vercel-requirements

dev:        ## Run Postgres, Mailpit, llama.cpp, the API and the web app
	./scripts/dev.sh

test:       ## Backend and frontend test suites (needs `docker compose up -d postgres`)
	cd backend && uv run pytest -q
	cd frontend && npm test

check:      ## Lint, type-check and build everything
	cd backend && uv run ruff check src tests && uv run ruff format --check src tests && uv run mypy src
	cd frontend && npx tsc -b && npx oxlint src && npm run build

gen-api:    ## Regenerate the typed frontend API client from the backend OpenAPI schema
	cd frontend && npm run gen:api

# Vercel installs the API's Python packages from requirements.txt at the repo root. It is
# generated from backend/uv.lock so the demo runs exactly the versions the Docker image uses.
# Self-hosted installs don't use it. Re-run after changing backend dependencies (a test checks).
vercel-requirements:  ## Regenerate requirements.txt (Vercel demo) from backend/uv.lock
	{ printf '%s\n' \
	  '# Python packages for the Vercel demo deployment only (see api/index.py).' \
	  '# Generated from backend/uv.lock by `make vercel-requirements`. Do not edit by hand.' \
	  '# Self-hosted installs use backend/pyproject.toml + uv.lock and ignore this file.'; \
	  cd backend && uv export --frozen --no-dev --no-hashes --no-emit-project --no-header --no-annotate; \
	} > requirements.txt
