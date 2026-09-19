# Prototype tool server (apps/server/proto/tools): the genealogy engine on Streamable
# HTTP (build/http.js) for the search-agent prototype, D16. Build context is the REPO
# ROOT (the root .dockerignore drops node_modules/.claude/eval/releases; the engine dir
# has no .dockerignore of its own), mirroring apps/server/sandbox/e2b.Dockerfile.
#
# src/ is compiled here, never the host's build/ -- that stays in the context on
# purpose for the E2B image, but a laptop's stale build must not become the service.
FROM node:22-slim AS build

WORKDIR /app
COPY packages/engine/mcp-server/package.json packages/engine/mcp-server/package-lock.json packages/engine/mcp-server/tsconfig.json ./
COPY packages/engine/mcp-server/src ./src
RUN npm ci --ignore-scripts && npx tsc

FROM node:22-slim

WORKDIR /app
COPY packages/engine/mcp-server/package.json packages/engine/mcp-server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/build ./build
# Siblings of build/: both bundled-data readers resolve ../../config/ from build/*/.
COPY packages/engine/mcp-server/config ./config

# Mount point for the ro config.json bind (compose); the rootfs is read-only at run time,
# so the directory has to exist in the image.
RUN mkdir -p /root/.familysearch-mcp

EXPOSE 8787

# Lets `docker compose up --wait` hold until the server answers; -slim has no curl/wget.
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "build/http.js", "--host", "0.0.0.0", "--port", "8787"]
