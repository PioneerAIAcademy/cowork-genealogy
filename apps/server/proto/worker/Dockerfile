# Prototype worker image (apps/server/proto/worker): the container the sqsd shim POSTs
# turns to, running one patron turn per message through the Claude Agent SDK. The tools
# are the shared HTTP `tools` service, so the image carries no Node and no engine: the
# SDK wheel bundles the CLI as a native binary. ubuntu:24.04 for Python 3.12 with no
# PPAs. Build context is the REPO ROOT (docker-compose.yml sets it) because the image
# carries packages/engine/plugin and apps/server.
#
# Layout (the plan's "Container layout"): /project is the empty cwd anchor;
# /opt/genealogy/plugin the skills; /opt/genealogy/server the import root holding app/
# (map_message) and proto/{worker,sql}. No tokens.json is ever baked -- the patron's
# FamilySearch bearer travels per turn as the tool server's Authorization header.
# CLAUDE_CONFIG_DIR and TMPDIR live on a tmpfs that compose mounts.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 --version

# The SDK pin is the flush-mode pin (session_store_flush="eager" is SDK-side) and the
# CLI pin (the wheel bundles Claude Code 2.1.220). [binary] bundles libpq.
RUN python3 -m pip install --break-system-packages \
        "claude-agent-sdk==0.2.128" "psycopg[binary]>=3.2,<4"

# Plugin: 28 skills + 6 agents + the shipped PreToolUse hook (python3 runs it).
COPY packages/engine/plugin /opt/genealogy/plugin

# The worker and what it imports: app.agent.real_agent (map_message) and proto/sql,
# which the worker applies at start.
COPY apps/server/app               /opt/genealogy/server/app
COPY apps/server/proto/sql         /opt/genealogy/server/proto/sql
# 1b: the worker releases a held message when the turn holding it ends, and it is the
# only component that knows a turn finished. enqueue.py is the repo's one SQS client
# (stdlib urllib, no boto3), so the handover reuses it rather than growing a second.
COPY apps/server/proto/enqueue.py  /opt/genealogy/server/proto/enqueue.py
COPY apps/server/proto/worker      /opt/genealogy/server/proto/worker

ENV PYTHONPATH=/opt/genealogy/server
ENV ENGINE_PLUGIN_DIR=/opt/genealogy/plugin
ENV WORKER_CWD=/project
ENV TMPDIR=/tmp

# The worker runs unprivileged: the CLI refuses bypassPermissions as root
# ("--dangerously-skip-permissions cannot be used with root/sudo privileges"), and the
# E2B sandbox runs its agent as `user` for the same reason. Everything under
# /opt/genealogy stays root-owned and read-only to it.
RUN useradd --create-home --shell /usr/sbin/nologin worker
ENV HOME=/home/worker

# The cwd anchor: must exist or the CLI will not spawn; root-owned and read-only to the
# worker, so nothing can be written into it.
RUN mkdir -p /project && chmod 555 /project

USER worker
WORKDIR /opt/genealogy/server
EXPOSE 8080

# Lets `docker compose up --wait` hold until the handler answers; stdlib only.
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=6 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"

CMD ["python3", "proto/worker/worker.py"]
