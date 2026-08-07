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

echo.
echo All done -- install complete.
