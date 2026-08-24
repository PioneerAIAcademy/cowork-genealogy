@echo off
REM Windows equivalent of: make test-all
REM The pre-PR gate the PR template names. Runs EVERY suite and reports all
REM failures together rather than stopping at the first. Offline and free --
REM nothing here calls a model. Keep it that way.
setlocal enabledelayedexpansion
cd /d "%~dp0..\.."

REM Name the missing piece up front. Each of these otherwise fails deep inside
REM a suite with an error that never mentions which tool or install is absent
REM -- an empty engine node_modules surfaces as five cryptic TS2307 errors.
set "MISSING="
for %%t in (npm pnpm uv) do (
    where %%t >nul 2>nul
    if errorlevel 1 set "MISSING=!MISSING! %%t"
)
if defined MISSING (
    echo ERROR: required tool^(s^) not on PATH:!MISSING!
    echo   npm / pnpm - see DEVELOPMENT.md "Build commands"
    echo   uv         - https://docs.astral.sh/uv/getting-started/installation/
    exit /b 1
)

set "NOTINSTALLED="
if not exist "node_modules" set "NOTINSTALLED=!NOTINSTALLED! node_modules"
if not exist "packages\engine\mcp-server\node_modules" set "NOTINSTALLED=!NOTINSTALLED! packages\engine\mcp-server\node_modules"
if not exist "eval\app\node_modules" set "NOTINSTALLED=!NOTINSTALLED! eval\app\node_modules"
if defined NOTINSTALLED (
    echo ERROR: dependencies are not installed:!NOTINSTALLED!
    echo Run scripts\windows\install.bat first.
    exit /b 1
)

set "FAILED="

REM Typecheck first: turbo.json defines `test` and `typecheck` as separate
REM tasks, so no test suite ever runs tsc. It costs seconds.
call :suite "ESLint"                       "%~dp0lint.bat"
call :suite "Typecheck (turbo)"            "%~dp0typecheck.bat"
call :suite "JS workspace tests (turbo)"   "%~dp0test-js.bat"
call :suite "Control-plane tests (pytest)" "%~dp0server-test.bat"
call :suite "MCP server tests (vitest)"    "%~dp0engine-test.bat"
call :suite "Eval app tests (vitest)"      "%~dp0eval-ui-test.bat"

REM harness-test.bat builds the engine first, and that build is a real
REM dependency: the harness's mock MCP server shells out to the COMPILED
REM packages/engine/mcp-server/build/ for its live tool handlers.
call :suite "Eval harness tests (pytest)"  "%~dp0harness-test.bat"

echo.
if defined FAILED (
    echo FAIL: one or more suites failed:!FAILED!
    exit /b 1
)
echo All checks passed
exit /b 0

:suite
echo.
echo === %~1 ===
call %2
if errorlevel 1 set "FAILED=!FAILED! [%~1]"
exit /b 0
