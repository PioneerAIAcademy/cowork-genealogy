@echo off
cd /d "%~dp0"

echo === Cowork Genealogy Reinstall (clean node_modules + install everything) ===
echo.
echo Use this after a Node.js upgrade: pnpm/npm will not rebuild native modules
echo (vitest/rolldown/esbuild) compiled for the old Node against an unchanged
echo lockfile, so they fail at TEST time. A clean reinstall fixes it.
echo.

echo Checking Node.js and npm versions...
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if "%NODEMAJOR%"=="" (
  echo.
  echo ERROR: Node.js not found on PATH. Install Node 26 LTS and retry.
  pause
  exit /b 1
)
REM Node and npm, checked before anything is deleted: pnpm and the engine's npm
REM would refuse the installs below only after every node_modules is gone.
call node scripts\check-node-floor.mjs
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Removing all node_modules folders...
if exist node_modules rmdir /s /q node_modules
if exist packages\schema\node_modules rmdir /s /q packages\schema\node_modules
if exist packages\viewer-ui\node_modules rmdir /s /q packages\viewer-ui\node_modules
if exist apps\web\node_modules rmdir /s /q apps\web\node_modules
if exist apps\mcp-viewer\node_modules rmdir /s /q apps\mcp-viewer\node_modules
if exist apps\electron\node_modules rmdir /s /q apps\electron\node_modules
if exist apps\server\node_modules rmdir /s /q apps\server\node_modules
if exist packages\engine\mcp-server\node_modules rmdir /s /q packages\engine\mcp-server\node_modules
if exist eval\app\node_modules rmdir /s /q eval\app\node_modules

echo.
echo Installing the pnpm workspace ^(web, electron, mcp-viewer, viewer-ui, schema, eval\app^)...
REM Before pnpm, not as its preinstall hook -- pnpm plans its linking first,
REM so a tree removed during preinstall leaves eval\app unlinked on that run.
call node scripts\drop-npm-managed-trees.mjs
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

REM No separate eval CRUD UI install: eval\app is a pnpm workspace member
REM (#1488), so the "pnpm install" above already covers it. npm cannot parse its
REM "workspace:*" dependency and would fail with EUNSUPPORTEDPROTOCOL.

echo.
echo === Reinstall complete ===
echo Python venvs (apps\server, eval\harness) self-heal on the next 'uv run'.
echo.
pause
