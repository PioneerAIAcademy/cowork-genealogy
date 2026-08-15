@echo off
REM Windows equivalent of: make web
REM Web client (FamilySearch path) — pair with: scripts\windows\server.bat
setlocal
cd /d "%~dp0..\.."
set VITE_API_TARGET=http://127.0.0.1:1837
call pnpm --filter web dev
