@echo off
REM Windows equivalent of: make web-dev
REM Web client (dev-login path) — pair with: scripts\server-mock.bat or scripts\server-dev.bat
setlocal
cd /d "%~dp0..\.."
pnpm --filter web dev
