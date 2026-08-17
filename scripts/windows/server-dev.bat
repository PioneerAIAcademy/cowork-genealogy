@echo off
REM Windows equivalent of: make server-dev
REM REAL agent, dev-login (no FamilySearch), port 8000 — needs ANTHROPIC_API_KEY
REM Pair with: scripts\windows\web-dev.bat
setlocal
cd /d "%~dp0..\.."
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1
if "%ANTHROPIC_API_KEY%"=="" (
    for /f "tokens=1,* delims==" %%a in ('findstr /R "^ANTHROPIC_API_KEY=" eval\.env 2^>nul') do (
        if "%%a"=="ANTHROPIC_API_KEY" set ANTHROPIC_API_KEY=%%b
    )
)
cd apps\server
set AGENT_MODE=real
set SANDBOX_PROVIDER=local
set FAMILYSEARCH_WEB_ENABLED=false
uv run uvicorn app.main:app --reload --port 8000
