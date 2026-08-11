@echo off
REM Windows equivalent of: make install
REM Installs pnpm workspace, server venv, engine (build + deps), eval-ui deps
setlocal
cd /d "%~dp0.."

echo [install] Installing pnpm workspace...
pnpm install
if errorlevel 1 ( echo ERROR: pnpm install failed & exit /b 1 )

echo [install] Installing server Python venv...
call scripts\server-install.bat
if errorlevel 1 exit /b %errorlevel%

echo [install] Building genealogy engine...
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1

echo [install] Installing eval-ui node_modules...
pushd eval\app
npm install
popd
if errorlevel 1 ( echo ERROR: eval-ui npm install failed & exit /b 1 )

REM NOTE: git hooks (post-checkout, commit-msg) are NOT installed here.
REM The Makefile install-hooks target uses bash syntax with no native
REM cmd.exe equivalent.  To install hooks on Windows, run from Git Bash:
REM   make install-hooks
REM Without the post-checkout hook, eval\.env is NOT auto-populated after
REM a branch switch, so every harness run will fail on a judge error unless
REM you export ANTHROPIC_API_KEY in your shell before running e2e-run.bat.

echo.
echo All done -- install complete.
echo NOTICE: git hooks were NOT installed. See scripts\install.bat for details.
