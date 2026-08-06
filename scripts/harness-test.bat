@echo off
REM Windows equivalent of: make harness-test
REM Eval harness unit tests (pytest)
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
cd eval\harness
uv run pytest -q
