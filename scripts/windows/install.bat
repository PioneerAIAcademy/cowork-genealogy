@echo off
REM Windows equivalent of: make install
REM Installs pnpm workspace (incl. eval-ui), server venv, engine (build + deps)
setlocal
cd /d "%~dp0..\.."

echo [install] Installing pnpm workspace...
REM Before pnpm, not as its preinstall hook -- pnpm plans its linking first,
REM so a tree removed during preinstall leaves eval\app unlinked on that run.
call node scripts\drop-npm-managed-trees.mjs
call pnpm install
if errorlevel 1 ( echo ERROR: pnpm install failed & exit /b 1 )

echo [install] Installing server Python venv...
call "%~dp0server-install.bat"
if errorlevel 1 exit /b %errorlevel%

echo [install] Building genealogy engine...
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1

REM No separate eval-ui install: eval\app is a pnpm workspace member (#1488),
REM so "pnpm install" above covers it. npm cannot parse its "workspace:*"
REM dependency and would fail with EUNSUPPORTEDPROTOCOL.

REM NOTE: git hooks are NOT installed here, because eval\InstallHooks.bat
REM prompts and pauses -- wrong for a non-interactive install. Run it once
REM per clone yourself (double-click it, or call it from here).
REM Without the post-checkout hook, eval\.env is NOT auto-populated after
REM a branch switch, so every harness run fails on a judge error unless you
REM set ANTHROPIC_API_KEY in your shell first.

echo.
echo All done -- install complete.
echo NOTICE: git hooks were NOT installed. Run eval\InstallHooks.bat once per clone.
