@echo off
REM Windows equivalent of: make server
REM REAL agent + FamilySearch login, local sandboxes, port 1837
REM Pair with: scripts\web.bat
setlocal
cd /d "%~dp0..\.."
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1
cd apps\server
set PUBLIC_URL=http://127.0.0.1:1837
set WEB_ORIGIN=http://127.0.0.1:5173
set SANDBOX_PROVIDER=local
set REALTIME=local_ws
set FAMILYSEARCH_WEB_ENABLED=true
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 1837
