@echo off
cd %~dp0

echo === Cowork Genealogy Reinstall (clean node_modules + install everything) ===
echo.
echo Use this after a Node.js upgrade: pnpm/npm will not rebuild native modules
echo (vitest/rolldown/esbuild) compiled for the old Node against an unchanged
echo lockfile, so they fail at TEST time. A clean reinstall fixes it.
echo.

echo Checking Node.js version (>=22 required)...
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if "%NODEMAJOR%"=="" (
  echo.
  echo ERROR: Node.js not found on PATH. Install Node 22+ and retry.
  echo The .nvmrc in this repo pins 22 for nvm-windows / fnm users.
  pause
  exit /b 1
)
if %NODEMAJOR% LSS 22 (
  echo.
  echo ERROR: Node %NODEMAJOR% is too old. This workspace requires Node 22+.
  echo Switch with nvm-windows ^(nvm use 22^) or fnm, then rerun Reinstall.bat.
  pause
  exit /b 1
)

echo.
echo Removing all node_modules folders...
if exist node_modules rmdir /s /q node_modules
if exist packages\schema\node_modules rmdir /s /q packages\schema\node_modules
if exist packages\viewer-ui\node_modules rmdir /s /q packages\viewer-ui\node_modules
if exist apps\web\node_modules rmdir /s /q apps\web\node_modules
if exist apps\electron\node_modules rmdir /s /q apps\electron\node_modules
if exist apps\server\node_modules rmdir /s /q apps\server\node_modules
if exist packages\engine\mcp-server\node_modules rmdir /s /q packages\engine\mcp-server\node_modules
if exist eval\app\node_modules rmdir /s /q eval\app\node_modules

echo.
echo Installing the pnpm workspace ^(web, electron, viewer-ui, schema^)...
call pnpm install
if errorlevel 1 (
  echo.
  echo ERROR: pnpm install failed. Reinstall aborted.
  echo If pnpm is missing: npm install -g pnpm
  pause
  exit /b 1
)

echo.
echo Installing and building the genealogy engine (mcp-server)...
cd packages\engine\mcp-server
call npm install
if errorlevel 1 (
  echo.
  echo ERROR: npm install in mcp-server failed. Reinstall aborted.
  cd ..\..\..
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo.
  echo ERROR: mcp-server build failed. Reinstall aborted.
  cd ..\..\..
  pause
  exit /b 1
)
cd ..\..\..

echo.
echo Installing the eval CRUD UI deps...
cd eval\app
call npm install
if errorlevel 1 (
  echo.
  echo ERROR: npm install in eval\app failed. Reinstall aborted.
  cd ..\..
  pause
  exit /b 1
)
cd ..\..

echo.
echo === Reinstall complete ===
echo Python venvs (apps\server, eval\harness) self-heal on the next 'uv run'.
echo.
pause
