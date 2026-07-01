@echo off
cd %~dp0

echo === Cowork Genealogy Test Harness ===
echo.
set /p SKILL="Which skill do you want to test? (e.g. search-wikipedia): "

if "%SKILL%"=="" (
  echo.
  echo No skill entered. Aborting.
  pause
  exit /b 1
)

if not exist ..\packages\engine\mcp-server\node_modules\ (
  echo.
  echo ERROR: mcp-server dependencies are not installed.
  echo The build step needs ..\packages\engine\mcp-server\node_modules to exist.
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
  echo ERROR: MCP server build failed. Aborting test run.
  cd ..\..\..\eval
  pause
  exit /b 1
)
cd ..\..\..\eval

echo.
echo Running tests for %SKILL%...
echo.

cd harness
call uv run python run_tests.py --skill %SKILL%

echo.
echo Done. Result files have been written.
echo Review them in the test-creation app, then commit via GitHub Desktop.
pause
