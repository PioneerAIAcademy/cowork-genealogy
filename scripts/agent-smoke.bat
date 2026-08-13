@echo off
REM Windows equivalent of: make agent-smoke
REM Live check that hosted path registers plugin agents (no model call, bills nothing)
setlocal
cd /d "%~dp0.."
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1
if "%ANTHROPIC_API_KEY%"=="" (
    for /f "tokens=1,* delims==" %%a in ('findstr /R "^ANTHROPIC_API_KEY=" eval\.env 2^>nul') do (
        if "%%a"=="ANTHROPIC_API_KEY" set ANTHROPIC_API_KEY=%%b
    )
)
cd apps\server
set LIVE_ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY%
uv run pytest tests\test_plugin_agents.py -q -rs
