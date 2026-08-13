@echo off
REM Windows equivalent of: make server-install
REM Creates the FastAPI server venv and installs deps (uv)
setlocal
cd /d "%~dp0.."
cd apps\server
uv sync
