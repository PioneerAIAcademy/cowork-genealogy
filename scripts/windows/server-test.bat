@echo off
REM Windows equivalent of: make server-test
REM Control-plane tests -- apps/server (pytest)
setlocal
cd /d "%~dp0..\.."
cd apps\server
uv run pytest -q
