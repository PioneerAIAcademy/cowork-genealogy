@echo off
REM Windows equivalent of: make e2e-thinking-probe [MODEL=<id>]
REM Reproduces the record-extractor runaway-thinking freeze (needs ANTHROPIC_API_KEY)
setlocal
cd /d "%~dp0.."
if "%ANTHROPIC_API_KEY%"=="" (
    for /f "tokens=1,* delims==" %%a in ('findstr /R "^ANTHROPIC_API_KEY=" eval\.env 2^>nul') do (
        if "%%a"=="ANTHROPIC_API_KEY" set ANTHROPIC_API_KEY=%%b
    )
)
set MODEL_FLAG=
if not "%MODEL%"=="" set MODEL_FLAG=--model %MODEL%
cd eval\harness
uv run python -m e2e.try_record_extractor_thinking %MODEL_FLAG%
