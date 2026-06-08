# Multi-stage build for the hosted genealogy workbench (alpha).
#
# ONE always-on container: the FastAPI control plane serves BOTH the
# REST + WebSocket API AND the built static web client (apps/web/dist) from
# the same origin. See docs/plan/fly-deploy-plan.md.
#
# Stage 1 builds the web client (pnpm workspace -> apps/web/dist).
# Stage 2 installs the Python server deps with uv.
# Final stage runs uvicorn and serves the web dist via a StaticFiles mount.
#
# NOTE: the E2B sandbox template image is a SEPARATE artifact
# (apps/server/sandbox/build-image.sh). This container does NOT run the agent;
# it spawns sandboxes on E2B (outbound). So neither the genealogy MCP build nor
# the plugin/skills are baked into this image.

# ── Stage 1: build the web client ────────────────────────────────
FROM node:20-bookworm-slim AS web
RUN corepack enable
WORKDIR /repo

# The web client is a pnpm workspace member that depends on
# packages/schema and packages/viewer-ui. Copy the workspace manifests
# first for a cached install, then the sources those three need.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/schema/package.json packages/schema/
COPY packages/viewer-ui/package.json packages/viewer-ui/
COPY apps/web/package.json apps/web/
# apps/electron is a workspace member but the web build does not need it; a
# frozen install still resolves it from the lockfile without building it.
COPY apps/electron/package.json apps/electron/
RUN pnpm install --frozen-lockfile --filter web...

COPY packages/schema packages/schema
COPY packages/viewer-ui packages/viewer-ui
COPY apps/web apps/web
COPY tsconfig.base.json turbo.json ./
RUN pnpm --filter web build   # -> apps/web/dist

# ── Stage 2: Python deps via uv ──────────────────────────────────
FROM python:3.12-slim-bookworm AS pydeps
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app/server
ENV UV_PROJECT_ENVIRONMENT=/app/server/.venv
# Cache the dependency layer on the lockfile, then sync without dev deps.
COPY apps/server/pyproject.toml apps/server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# ── Final image ──────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app/server
ENV PATH="/app/server/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1

# Python venv from stage 2.
COPY --from=pydeps /app/server/.venv /app/server/.venv
# Server source.
COPY apps/server/app /app/server/app
# Built web client, served by the control plane (StaticFiles mount in main.py).
COPY --from=web /repo/apps/web/dist /app/server/web-dist
# Bundled FamilySearch OAuth client id. config.py reads it from
# REPO_ROOT/packages/engine/mcp-server/config/familysearch.json, and REPO_ROOT
# resolves to "/" in this image (the server lives at /app/server/app, so
# config.py's parents[3] is "/"). The file must therefore land at this absolute
# path. Without it familysearch_configured is False → the FS login route 501s
# AND https disables dev-login, i.e. NO login works. (The rest of the engine is
# NOT baked into this control-plane image — only this one config file is.)
COPY packages/engine/mcp-server/config/familysearch.json /packages/engine/mcp-server/config/familysearch.json

# Where the StaticFiles mount looks for the built client.
ENV WEB_DIST_DIR=/app/server/web-dist
# get_settings() mkdirs its work dir under DATA_DIR. With the DB on Neon
# (DATABASE_URL secret) and feedback + viewer-mirror already off-disk, nothing
# persistent lives here, so there is NO Fly volume — DATA_DIR just needs to be a
# writable path in the ephemeral container fs.
ENV DATA_DIR=/data

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
