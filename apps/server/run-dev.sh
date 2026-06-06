#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec uv run uvicorn app.main:app --reload --port "${PORT:-8000}"
