# Prototype web tier (apps/server/proto/web). Build context is the REPO ROOT (as for the
# tools image) so the image carries enqueue.py (the SQS client app.py imports), grants.py
# (the grant custody it shares with the worker, U3), migrate.py and sql/ (U9: the start
# reads the ledger against these files and runs no DDL; `python migrate.py` from /app is the
# one applier), the engine's bundled FamilySearch client config, which web/auth.py
# reads for sign-in -- that file is the client id's sole source (CLAUDE.md, auth) -- and
# the SSE build of apps/web, which web/spa.py serves at /. Nothing from apps/server/app is
# copied: web/auth.py and web/spa.py are vendored ports, not imports.

# ── Stage 1: the SSE build of apps/web (U12) ─────────────────────────────────────
FROM node:24-slim AS spa
RUN corepack enable
WORKDIR /repo

# The install shape of deploy/Dockerfile's stage 1, which records why each line is there:
# the root preinstall script and the whole of packages/schema (its postinstall generates
# the gitignored enums) must be in place before the install.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY scripts/drop-npm-managed-trees.mjs scripts/
COPY packages/schema packages/schema
COPY packages/viewer-ui/package.json packages/viewer-ui/
COPY apps/web/package.json apps/web/
COPY apps/electron/package.json apps/electron/
RUN pnpm install --frozen-lockfile --filter web...

COPY packages/viewer-ui packages/viewer-ui
COPY apps/web apps/web
COPY tsconfig.base.json ./
RUN pnpm --filter @genealogy/schema run generate \
  && VITE_SESSION_TRANSPORT=sse pnpm --filter web exec vite build --outDir /out --emptyOutDir

# ── Stage 2: the tier ────────────────────────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /app

# uv.lock's proto-web closure (`make proto-requirements`) in hash mode: the versions the
# suite tested, and a wheel whose hash is not the lock's fails the build.
COPY apps/server/proto/web/requirements.txt ./requirements.txt
RUN pip install --require-hashes -r requirements.txt

COPY apps/server/proto/enqueue.py ./
COPY apps/server/proto/grants.py ./
COPY apps/server/proto/migrate.py ./
COPY apps/server/proto/sql ./sql
COPY apps/server/proto/web ./web
COPY packages/engine/mcp-server/config/familysearch.json ./config/familysearch.json
COPY --from=spa /out ./web-dist
# Relative, so it resolves against /app (web/'s parent): the value the bundle sets too.
ENV WEB_DIST_DIR=web-dist

EXPOSE 8085

# Lets `docker compose up --wait` hold until the tier answers; stdlib only, no curl.
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8085/api/health', timeout=2)"

CMD ["uvicorn", "web.app:app", "--host", "0.0.0.0", "--port", "8085"]
