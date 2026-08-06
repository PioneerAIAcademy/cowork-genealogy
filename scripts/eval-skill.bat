@echo off
REM Windows equivalent of: make eval-skill SKILL=<name> [CONCURRENCY=8]
REM Runs the skill eval harness. SKILL may name several skills (space-separated).
REM Usage: scripts\eval-skill.bat <skill-name>
REM   or:  set SKILL=tree-edit  then  scripts\eval-skill.bat
REM   or:  set SKILL="tree-edit timeline"  then  scripts\eval-skill.bat
setlocal

if not "%~1"=="" set SKILL=%~1

if "%SKILL%"=="" (
    echo ERROR: provide a skill name, e.g.:
    echo   scripts\eval-skill.bat tree-edit
    echo   set SKILL=tree-edit  then  scripts\eval-skill.bat
    exit /b 1
)

set CONCURRENCY_FLAG=
if not "%CONCURRENCY%"=="" set CONCURRENCY_FLAG=--concurrency %CONCURRENCY%

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
uv run python run_tests.py --skill %SKILL% %CONCURRENCY_FLAG%
