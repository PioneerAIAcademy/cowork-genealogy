@echo off
REM Windows equivalent of: make install
REM Installs pnpm workspace, server venv, engine (build + deps), eval-ui deps
setlocal
cd /d "%~dp0..\.."

echo [install] Installing pnpm workspace...
call pnpm install
if errorlevel 1 ( echo ERROR: pnpm install failed & exit /b 1 )

echo [install] Installing server Python venv...
call "%~dp0server-install.bat"
if errorlevel 1 exit /b %errorlevel%

echo [install] Building genealogy engine...
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1

echo [install] Installing eval-ui node_modules...
pushd eval\app
call npm install
if errorlevel 1 ( popd & echo ERROR: eval-ui npm install failed & exit /b 1 )
popd

REM NOTE: git hooks are NOT installed here, because eval\InstallHooks.bat
REM prompts and pauses -- wrong for a non-interactive install. Run it once
REM per clone yourself (double-click it, or call it from here).
REM Without the post-checkout hook, eval\.env is NOT auto-populated after
REM a branch switch, so every harness run fails on a judge error unless you
REM set ANTHROPIC_API_KEY in your shell first.

echo.
echo All done -- install complete.
echo NOTICE: git hooks were NOT installed. Run eval\InstallHooks.bat once per clone.
