@echo off
REM Windows equivalent of: make agent-tool-bind
REM Live probe that gps-mentor's wiki_search grant BINDS at runtime (issue #1084).
REM SPENDS ONE MODEL TURN (~$0.35/run) — the only check that bills. Opt-in.
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
set AGENT_TOOL_BIND=1
set LIVE_ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY%
uv run pytest tests\test_agent_tool_binding.py -q -rs
