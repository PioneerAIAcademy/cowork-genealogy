# Prototype web tier (apps/server/proto/web). Build context is the REPO ROOT (as for the
# tools image) so the image carries enqueue.py (the SQS client app.py imports), sql/
# (applied at start) and the engine's bundled FamilySearch client config, which web/auth.py
# reads for sign-in -- that file is the client id's sole source (CLAUDE.md, auth). Nothing
# from apps/server/app is copied: web/auth.py is a vendored port, not an import.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /app

# [binary] bundles libpq, so no apt step on -slim. itsdangerous signs the session and
# OAuth-state cookies, cryptography encrypts the grant at rest, httpx is the FamilySearch
# round-trip.
RUN pip install "fastapi>=0.115,<1" "uvicorn[standard]>=0.30,<1" "psycopg[binary]>=3.2,<4" \
  "itsdangerous>=2.1,<3" "cryptography>=42,<47" "httpx>=0.27,<1"

COPY apps/server/proto/enqueue.py ./
COPY apps/server/proto/sql ./sql
COPY apps/server/proto/web ./web
COPY packages/engine/mcp-server/config/familysearch.json ./config/familysearch.json

EXPOSE 8085

# Lets `docker compose up --wait` hold until the tier answers; stdlib only, no curl.
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8085/api/health', timeout=2)"

CMD ["uvicorn", "web.app:app", "--host", "0.0.0.0", "--port", "8085"]
