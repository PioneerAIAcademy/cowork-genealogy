@echo off
REM Windows equivalent of: make e2e-scratch TEST=<slug>
REM Sets up a throwaway dir to run /research by hand against a fixture
REM Usage: scripts\e2e-scratch.bat <test-slug>
setlocal

if not "%~1"=="" set TEST=%~1
if "%TEST%"=="" (
    echo ERROR: provide a test slug, e.g.: scripts\e2e-scratch.bat mary-mcandrew-son
    exit /b 1
)

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
uv run python -m e2e.scratch --test %TEST% --launch
