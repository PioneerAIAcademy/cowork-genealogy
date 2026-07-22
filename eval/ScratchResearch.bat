@echo off
cd %~dp0

echo === Cowork Genealogy E2E — Scratch /research workspace ===
echo.
echo Sets up a throwaway directory (outside the repo) with a fixture's
echo starting state, the plugin skills, and the genealogy MCP server, so
echo you can run /research BY HAND in an interactive Claude Code session.
echo This is how you debug WHY the agent stops or skips a step.
echo.
set /p SLUG="Which fixture (slug) to seed from? (e.g. kenneth-quass-death): "
if "%SLUG%"=="" (
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
echo Building MCP server (the scratch session runs the compiled server;
echo without it /research has no genealogy tools)...
cd ..\packages\engine\mcp-server
call npm run build
if errorlevel 1 (
  echo.
  echo ERROR: MCP server build failed. Aborting.
  cd ..\..\..\eval
  pause
  exit /b 1
)
cd ..\..\..\eval

cd harness
call uv run python -m e2e.scratch --test %SLUG%
if errorlevel 1 (
  echo.
  echo Setup failed (see above).
  pause
  exit /b 1
)

REM The scratch dir is a sibling of the repo: <repo-parent>\e2e-scratch\<slug>.
REM %~dp0 is eval\, so ..\.. is the repo, and ..\..\.. is its parent.
set "SCRATCH=%~dp0..\..\e2e-scratch\%SLUG%"
echo.
echo Launching `claude` in %SCRATCH% ...
echo (Approve the project MCP server prompt; then type the /research
echo  command printed above.)
echo.
cd /d "%SCRATCH%"
call claude
