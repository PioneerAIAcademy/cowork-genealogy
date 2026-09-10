# D3 stub worker (apps/server/proto/worker): the HTTP handler the sqsd shim POSTs to.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /app

# [binary] bundles libpq, so no apt step on -slim.
RUN pip install "psycopg[binary]>=3.2,<4"

COPY worker.py .

EXPOSE 8080

# Lets `docker compose up --wait` hold until the handler answers; stdlib only, the
# image has no curl.
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"

CMD ["python", "worker.py"]
