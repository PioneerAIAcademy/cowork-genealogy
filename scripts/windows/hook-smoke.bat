@echo off
REM Windows equivalent of: make hook-smoke
REM Live probe: does the plugin's PreToolUse hook actually BIND in the hosted
REM SDK loader? (issue #1160)
setlocal
cd /d "%~dp0..\.."
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1
if "%ANTHROPIC_API_KEY%"=="" (
    for /f "tokens=1,* delims==" %%a in ('findstr /R "^ANTHROPIC_API_KEY=" eval\.env 2^>nul') do (
        if "%%a"=="ANTHROPIC_API_KEY" set ANTHROPIC_API_KEY=%%b
    )
)
cd /d "%~dp0..\..\apps\server"
uv run python dev\probe_hook_binding.py
if errorlevel 1 exit /b 1
