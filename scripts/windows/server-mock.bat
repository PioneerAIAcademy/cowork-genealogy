@echo off
REM Windows equivalent of: make server-mock
REM MOCK agent, dev-login, local sandboxes, port 8000 (no keys needed)
REM Pair with: scripts\windows\web-dev.bat
setlocal
cd /d "%~dp0..\.."
cd apps\server
set AGENT_MODE=mock
set SANDBOX_PROVIDER=local
set FAMILYSEARCH_WEB_ENABLED=false
uv run uvicorn app.main:app --reload --port 8000
