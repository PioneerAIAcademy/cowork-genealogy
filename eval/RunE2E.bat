@echo off
cd %~dp0

echo === Cowork Genealogy E2E Benchmark — Run a test ===
echo.
echo This runs ONE e2e fixture against LIVE FamilySearch. It is expensive:
echo typically 20-60 minutes and $3-10 in API cost. Run one at a time.
echo.
set /p SLUG="Which fixture (slug) do you want to run? (e.g. kenneth-quass-death): "

if "%SLUG%"=="" (
  echo.
  echo No fixture entered. Aborting.
  pause
  exit /b 1
)

if not exist ..\packages\engine\mcp-server\node_modules\ (
  echo.
  echo ERROR: mcp-server dependencies are not installed.
  echo Please run Setup.bat once to install everything, then retry.
  pause
  exit /b 1
)

echo.
echo Building MCP server (picks up any code changes from the last git pull)...
cd ..\packages\engine\mcp-server
call npm run build
if errorlevel 1 (
  echo.
  echo ERROR: MCP server build failed. Aborting run.
  cd ..\..\..\eval
  pause
  exit /b 1
)
cd ..\..\..\eval

echo.
echo Make sure you are logged in to FamilySearch (the `login` MCP tool)
echo before running — the agent's tool calls hit live FS and need a token.
echo.
echo Running e2e fixture %SLUG%...
echo.

cd harness
rem Optional P2 flags, set in the shell before launching (the Makefile's
rem DENY_SHELL=1 / DENY_PROJECT_READS=1): deny the shell, and/or deny direct
rem reads of the project folder so the agent must use the MCP tools.
set E2E_FLAGS=
if "%DENY_SHELL%"=="1" set E2E_FLAGS=%E2E_FLAGS% --deny-shell
if "%DENY_PROJECT_READS%"=="1" set E2E_FLAGS=%E2E_FLAGS% --deny-project-reads
call uv run python -m e2e.run_e2e --test %SLUG%%E2E_FLAGS%

echo.
echo Done. Four result files were written under eval\runlogs\e2e\%SLUG%\.
echo Use InterpretE2E (the /interpret-e2e-result skill) to read the verdict,
echo then commit the fixture and its passing run log via GitHub Desktop.
pause
