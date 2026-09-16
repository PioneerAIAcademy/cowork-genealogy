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
rem The Makefile also has CONTEXT_1M=1 (--context-1m, the 1M-window SDK beta).
rem It is DELIBERATELY not mirrored here, and this gap is a decision, not an
rem oversight. A 1M-window run compacts differently, so it is not comparable to
rem the corpus and must not be committed under eval/runlogs/e2e/. The panel runs
rem the corpus is built from come from this entry point, so a flag that could be
rem set by accident here would silently contaminate repo-wide figures. Run the
rem 1M arm from the Makefile on a machine where that is the deliberate intent.
rem CI rejects such a run if it is committed under eval/runlogs/e2e/.
call uv run python -m e2e.run_e2e --test %SLUG%%E2E_FLAGS%

echo.
echo Done. Four result files were written under eval\runlogs\e2e\%SLUG%\.
echo Use InterpretE2E (the /interpret-e2e-result skill) to read the verdict,
echo then commit the fixture and its passing run log via GitHub Desktop.
pause
