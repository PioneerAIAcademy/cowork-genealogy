@echo off
REM Windows equivalent of: make agent-smoke
REM Live agent-registration check (issue #939) + dead-stub MCP abort check (issue #1743)
setlocal
cd /d "%~dp0..\.."
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1
if "%ANTHROPIC_API_KEY%"=="" (
    for /f "tokens=1,* delims==" %%a in ('findstr /R "^ANTHROPIC_API_KEY=" eval\.env 2^>nul') do (
        if "%%a"=="ANTHROPIC_API_KEY" set ANTHROPIC_API_KEY=%%b
    )
)

REM --- Arm 1: agent registration (issue #939) ---
cd /d "%~dp0..\..\apps\server"
set AGENT_SMOKE=1
set LIVE_ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY%
uv run pytest tests\test_plugin_agents.py -q -rs
if errorlevel 1 exit /b 1

REM --- Arm 2: dead-stub e2e abort (issue #1743) ---
set SMOKE_RUNLOG=%TEMP%\smoke-runlog-%RANDOM%
set SMOKE_OUT=%TEMP%\smoke-out-%RANDOM%
mkdir "%SMOKE_RUNLOG%"
mkdir "%SMOKE_OUT%"
cd /d "%~dp0..\..\eval\harness"
uv run --frozen python -m e2e.run_e2e ^
  --test kenneth-quass-death ^
  --mcp-server-entry "%~dp0..\..\eval\harness\tests\fixtures\dead-stub.js" ^
  --runlog-root "%SMOKE_RUNLOG%" ^
  --skip-judge > "%SMOKE_OUT%\capture.txt" 2>&1
echo --- Asserting dead-stub arm ---
findstr /C:"MCP UNAVAILABLE" "%SMOKE_OUT%\capture.txt" >nul
if errorlevel 1 (
    echo FAIL: output missing "MCP UNAVAILABLE" 1>&2
    rmdir /s /q "%SMOKE_RUNLOG%" 2>nul
    rmdir /s /q "%SMOKE_OUT%" 2>nul
    exit /b 1
)
findstr /C:"the 'genealogy' MCP server reported 'failed'" "%SMOKE_OUT%\capture.txt" >nul
if errorlevel 1 (
    echo FAIL: output missing server-reported-failed text 1>&2
    rmdir /s /q "%SMOKE_RUNLOG%" 2>nul
    rmdir /s /q "%SMOKE_OUT%" 2>nul
    exit /b 1
)
findstr /C:"STUB-MARKER" "%SMOKE_OUT%\capture.txt" >nul
if errorlevel 1 (
    echo FAIL: output missing stub stderr ^(STUB-MARKER^) 1>&2
    rmdir /s /q "%SMOKE_RUNLOG%" 2>nul
    rmdir /s /q "%SMOKE_OUT%" 2>nul
    exit /b 1
)
dir /b /s "%SMOKE_RUNLOG%" 2>nul | findstr "." >nul
if not errorlevel 1 (
    echo FAIL: runlog-root should hold no files 1>&2
    rmdir /s /q "%SMOKE_RUNLOG%" 2>nul
    rmdir /s /q "%SMOKE_OUT%" 2>nul
    exit /b 1
)
rmdir /s /q "%SMOKE_RUNLOG%" 2>nul
rmdir /s /q "%SMOKE_OUT%" 2>nul
echo Dead-stub arm: PASS
