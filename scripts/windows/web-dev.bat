@echo off
REM Windows equivalent of: make web-dev
REM Web client (dev-login path) — pair with: scripts\windows\server-mock.bat or scripts\windows\server-dev.bat
setlocal
cd /d "%~dp0..\.."
call pnpm --filter web dev
