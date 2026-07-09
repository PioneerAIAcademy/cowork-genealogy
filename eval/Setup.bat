@echo off
cd %~dp0

echo === Cowork Genealogy Eval Setup ===
echo.

echo Allowing local PowerShell scripts for the current user...
powershell -NoProfile -Command "Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force"
if errorlevel 1 (
  echo.
  echo ERROR: Could not set the PowerShell execution policy.
  echo The uv installer cannot run until this succeeds. Setup aborted.
  pause
  exit /b 1
)

echo.
echo Installing Python package manager (uv)...
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; irm https://astral.sh/uv/install.ps1 | iex"
if errorlevel 1 (
  echo.
  echo ERROR: uv installation failed. Setup aborted.
  pause
  exit /b 1
)

REM The uv installer updates the *persistent* user PATH, but this already-
REM running cmd session won't see it. Add uv's install dir to PATH for the
REM rest of this script so the "uv sync" step below can find it.
set "PATH=%USERPROFILE%\.local\bin;%PATH%"

echo.
echo Installing Node.js dependencies...
cd app
call npm install
if errorlevel 1 (
  echo.
  echo ERROR: npm install failed. Setup aborted.
  cd ..
  pause
  exit /b 1
)
cd ..

echo.
echo Installing MCP server dependencies...
cd ..\packages\engine\mcp-server
call npm install
if errorlevel 1 (
  echo.
  echo ERROR: npm install in mcp-server failed. Setup aborted.
  cd ..\..\..\eval
  pause
  exit /b 1
)

echo.
echo Building MCP server...
call npm run build
if errorlevel 1 (
  echo.
  echo ERROR: MCP server build failed. Setup aborted.
  cd ..\..\..\eval
  pause
  exit /b 1
)
cd ..\..\..\eval

echo.
echo Installing pnpm (Node package manager for the viewer)...
REM Pin to the version in package.json "packageManager". pnpm 10 blocks
REM dependency build scripts by default, which skips electron's binary
REM download and breaks the viewer; pnpm 9.x runs them. Keep this in sync
REM with the "packageManager" field in the repo-root package.json.
call npm install -g pnpm@9.15.9
if errorlevel 1 (
  echo.
  echo ERROR: Could not install pnpm. Setup aborted.
  echo Re-open cmd as Administrator and rerun Setup.bat, or install pnpm
  echo manually from https://pnpm.io/installation.
  pause
  exit /b 1
)

echo.
echo Installing viewer dependencies...
cd ..
call pnpm install
if errorlevel 1 (
  echo.
  echo ERROR: pnpm install failed. Setup aborted.
  cd eval
  pause
  exit /b 1
)

REM A warm pnpm store can skip electron's postinstall (the binary download +
REM path.txt write), so "pnpm install" alone doesn't guarantee a launchable
REM viewer -- electron-vite then dies with "Error: Electron uninstall". Force
REM the rebuild so the binary is always materialized in this checkout.
echo.
echo Ensuring the Electron viewer binary is installed...
call pnpm --filter @genealogy/electron rebuild electron
if errorlevel 1 (
  echo.
  echo ERROR: Could not install the Electron binary. Setup aborted.
  echo Re-run Setup.bat, or from the repo root run:
  echo   pnpm --filter @genealogy/electron rebuild electron
  cd eval
  pause
  exit /b 1
)
cd eval

echo.
echo Installing Claude Code CLI globally (required by the test harness)...
call npm install -g @anthropic-ai/claude-code
if errorlevel 1 (
  echo.
  echo ERROR: Claude Code CLI install failed. Setup aborted.
  echo If npm reported a permissions error, re-open cmd as Administrator
  echo and rerun Setup.bat -- or install manually with:
  echo   npm install -g @anthropic-ai/claude-code
  pause
  exit /b 1
)

echo.
echo Installing Python dependencies...
cd harness
call uv sync
if errorlevel 1 (
  echo.
  echo ERROR: uv sync failed. Setup aborted.
  cd ..
  pause
  exit /b 1
)
cd ..

echo.
set /p APIKEY="Paste your Anthropic API key: "
echo ANTHROPIC_API_KEY=%APIKEY%> .env

echo.
echo === Setup complete! ===
echo.
echo Before your first RunTests.bat run, run this once to authenticate
echo the Claude Code CLI (browser login or paste an API key):
echo   claude
echo.
echo Then double-click Start.bat to launch the test-creation app, or
echo RunTests.bat to run the harness.
pause
