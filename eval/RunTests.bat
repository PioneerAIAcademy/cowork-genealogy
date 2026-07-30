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

REM Check that the deps are actually THERE, not merely that the folder exists.
REM `npm ci` deletes node_modules before repopulating it, so an install that was
REM interrupted (Ctrl-C, closed window, dropped network) leaves an EMPTY folder
REM behind. `if not exist ...\node_modules\` passes on that folder, so the run
REM used to continue and die in the build step with five cryptic
REM "TS2307: Cannot find module" errors instead of this message.
REM `dir /b` prints nothing when there is no visible entry, so errorlevel 1 from
REM findstr means "no packages". Note there is NO /a switch: npm writes a hidden
REM .package-lock.json into node_modules early in the install, so a half-done
REM install leaves that one hidden file and no packages. `dir /b /a` would list
REM it and the folder would look populated; plain `dir /b` skips hidden entries
REM and sees the folder for what it is.
if not exist ..\packages\engine\mcp-server\node_modules\ goto :nodeps
dir /b ..\packages\engine\mcp-server\node_modules 2>nul | findstr "." >nul
if errorlevel 1 goto :nodeps
goto :depsok

:nodeps
echo.
echo ERROR: mcp-server dependencies are not installed.
echo The build step needs ..\packages\engine\mcp-server\node_modules to contain
echo the installed packages. The folder is missing or empty — an interrupted
echo install leaves it empty.
echo Please run Setup.bat once to install everything, then retry.
pause
exit /b 1

:depsok

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
