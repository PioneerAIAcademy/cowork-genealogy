@echo off
REM Windows equivalent of: make e2e-run TEST=<slug>
REM Runs ONE e2e benchmark fixture against live FamilySearch (expensive: ~20-60 min, $3-10)
REM Usage: scripts\e2e-run.bat <test-slug>
REM   or:  set TEST=<test-slug>  then  scripts\e2e-run.bat
setlocal

if not "%~1"=="" set TEST=%~1

if "%TEST%"=="" (
    echo ERROR: provide a test slug, e.g.:
    echo   scripts\e2e-run.bat mary-mcandrew-son
    echo   set TEST=mary-mcandrew-son  then  scripts\e2e-run.bat
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
uv run python -m e2e.run_e2e --test %TEST%
