@echo off
REM Windows equivalent of: make e2e-preflight
REM Check a machine is ready to run e2e tests (FS login, built server, API key, deps)
setlocal
cd /d "%~dp0.."
cd eval\harness
uv run python -m e2e.preflight
