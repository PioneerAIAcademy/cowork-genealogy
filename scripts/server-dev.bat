@echo off
REM Windows equivalent of: make server-dev
REM REAL agent, dev-login (no FamilySearch), port 8000 — needs ANTHROPIC_API_KEY
REM Pair with: scripts\web-dev.bat
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
if "%ANTHROPIC_API_KEY%"=="" (
    for /f "tokens=1,* delims==" %%a in ('findstr /R "^ANTHROPIC_API_KEY=" eval\.env 2^>nul') do (
        if "%%a"=="ANTHROPIC_API_KEY" set ANTHROPIC_API_KEY=%%b
    )
)
cd apps\server
set AGENT_MODE=real
set SANDBOX_PROVIDER=local
set FAMILYSEARCH_WEB_ENABLED=false
uv run uvicorn app.main:app --reload --port 8000
