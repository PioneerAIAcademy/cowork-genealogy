@echo off
REM Windows equivalent of: make e2e-calibrate
REM Runs judge calibration against committed run annotations (needs ANTHROPIC_API_KEY)
setlocal
cd /d "%~dp0.."
if "%ANTHROPIC_API_KEY%"=="" (
    for /f "tokens=1,* delims==" %%a in ('findstr /R "^ANTHROPIC_API_KEY=" eval\.env 2^>nul') do (
        if "%%a"=="ANTHROPIC_API_KEY" set ANTHROPIC_API_KEY=%%b
    )
)
cd eval\harness
uv run python -m e2e.calibrate_judge
