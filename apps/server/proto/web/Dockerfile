# Prototype web tier (apps/server/proto/web). Build context is apps/server/proto so the
# image carries enqueue.py (the SQS client app.py imports) and sql/ (applied at start).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /app

# [binary] bundles libpq, so no apt step on -slim.
RUN pip install "fastapi>=0.115,<1" "uvicorn[standard]>=0.30,<1" "psycopg[binary]>=3.2,<4"

COPY enqueue.py ./
COPY sql ./sql
COPY web ./web

EXPOSE 8085

# Lets `docker compose up --wait` hold until the tier answers; stdlib only, no curl.
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8085/api/health', timeout=2)"

CMD ["uvicorn", "web.app:app", "--host", "0.0.0.0", "--port", "8085"]
