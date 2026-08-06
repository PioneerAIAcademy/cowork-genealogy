@echo off
REM Windows equivalent of: make server
REM REAL agent + FamilySearch login, local sandboxes, port 1837
REM Pair with: scripts\web.bat
setlocal
cd /d "%~dp0.."
echo [engine-build] Checking engine build...
if not exist "packages\engine\mcp-server\node_modules" (
    echo [engine-build] Installing engine node_modules (first time)...
    pushd packages\engine\mcp-server
    npm ci
    popd
    if errorlevel 1 ( echo ERROR: engine npm ci failed & exit /b 1 )
)
pushd packages\engine\mcp-server
npm run build
popd
if errorlevel 1 ( echo ERROR: engine build failed & exit /b 1 )
cd apps\server
set PUBLIC_URL=http://127.0.0.1:1837
set WEB_ORIGIN=http://127.0.0.1:5173
set SANDBOX_PROVIDER=local
set REALTIME=local_ws
set FAMILYSEARCH_WEB_ENABLED=true
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 1837
