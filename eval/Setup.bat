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
cd ..\mcp-server
call npm install
if errorlevel 1 (
  echo.
  echo ERROR: npm install in mcp-server failed. Setup aborted.
  cd ..\eval
  pause
  exit /b 1
)

echo.
echo Building MCP server...
call npm run build
if errorlevel 1 (
  echo.
  echo ERROR: MCP server build failed. Setup aborted.
  cd ..\eval
  pause
  exit /b 1
)
cd ..\eval

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
echo Double-click Start.bat to launch the test-creation app.
pause
