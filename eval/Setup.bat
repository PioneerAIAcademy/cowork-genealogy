@echo off
cd %~dp0

echo === Cowork Genealogy Eval Setup ===
echo.
echo Installing Python package manager (uv)...
powershell -Command "irm https://astral.sh/uv/install.ps1 | iex"

echo.
echo Installing Node.js dependencies...
cd app
call npm install
cd ..

echo.
echo Installing Python dependencies...
cd harness
call uv sync
cd ..

echo.
set /p APIKEY="Paste your Anthropic API key: "
echo ANTHROPIC_API_KEY=%APIKEY%> .env

echo.
echo === Setup complete! ===
echo Double-click Start.bat to launch the test-creation app.
pause
