@echo off
REM Windows equivalent of: make engine-build
REM Builds the genealogy engine (mcp-server/build/index.js)
setlocal
cd /d "%~dp0..\.."
echo [engine-build] Checking engine build...

REM Reinstall when the lockfile CHANGES, not only when node_modules is missing.
REM The Makefile's stamp rebuilds on a package-lock.json edit; checking only for
REM the directory means a pulled lockfile bump builds against stale deps, and
REM the machine then disagrees with CI for no visible reason. The stamp is a
REM copy of the lockfile the last install used, kept inside node_modules so
REM clean-deps.bat wipes it too.
set "ENGINE=packages\engine\mcp-server"
set "STAMP=%ENGINE%\node_modules\.win-installed"

REM Default to installing and only skip when the stamp proves the deps are
REM current, so an unexpected result here costs a slow rebuild rather than a
REM silently stale one.
set "NEED_INSTALL=1"
if not exist "%ENGINE%\node_modules" goto :install
if not exist "%STAMP%" goto :install
fc /b "%ENGINE%\package-lock.json" "%STAMP%" >nul 2>nul
if not errorlevel 1 set "NEED_INSTALL="

:install
if defined NEED_INSTALL (
    echo [engine-build] Installing engine node_modules ^(lockfile changed or first run^)...
    pushd "%ENGINE%"
    npm ci
    popd
    if errorlevel 1 ( echo ERROR: engine npm ci failed & exit /b 1 )
    copy /y "%ENGINE%\package-lock.json" "%STAMP%" >nul
)

pushd "%ENGINE%"
npm run build
popd
if errorlevel 1 ( echo ERROR: engine build failed & exit /b 1 )
echo [engine-build] Done.
