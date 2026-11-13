# Prototype tool server (apps/server/proto/tools): the genealogy engine on Streamable
# HTTP (build/http.js) for the search-agent prototype, D16. Build context is the REPO
# ROOT (the root .dockerignore drops node_modules/.claude/eval/releases; the engine dir
# has no .dockerignore of its own), mirroring apps/server/sandbox/e2b.Dockerfile.
#
# src/ is compiled here, never the host's build/ -- that stays in the context on
# purpose for the E2B image, but a laptop's stale build must not become the service.
FROM node:24-slim AS build

WORKDIR /app
COPY packages/engine/mcp-server/package.json packages/engine/mcp-server/package-lock.json packages/engine/mcp-server/tsconfig.json ./
COPY packages/engine/mcp-server/src ./src
RUN npm ci --ignore-scripts && npx tsc

# The MCP App page, built to one HTML file. --ignore-scripts keeps electron's postinstall
# out, and with it the root preinstall, so scripts/ need not be here. No CI job builds this
# image, so a workspace package the page gains needs its own COPY here.
FROM node:24-slim AS page
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/schema packages/schema
COPY packages/viewer-ui packages/viewer-ui
COPY apps/mcp-viewer/package.json apps/mcp-viewer/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter mcp-viewer...
COPY apps/mcp-viewer apps/mcp-viewer
COPY tsconfig.base.json ./
RUN pnpm --filter mcp-viewer build

FROM node:24-slim

WORKDIR /app
COPY packages/engine/mcp-server/package.json packages/engine/mcp-server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/build ./build
# Siblings of build/: both bundled-data readers resolve ../../config/ from build/*/.
COPY packages/engine/mcp-server/config ./config
# Where viewerPagePath() looks: it resolves ../../viewer/page/ from build/utils/.
COPY --from=page /repo/apps/mcp-viewer/dist/index.html ./viewer/page/viewer.html

# Mount point for the ro config.json bind (compose); the rootfs is read-only at run time,
# so the directory has to exist in the image.
RUN mkdir -p /root/.familysearch-mcp

EXPOSE 8787

# Lets `docker compose up --wait` hold until the server answers; -slim has no curl/wget.
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "build/http.js", "--host", "0.0.0.0", "--port", "8787"]
