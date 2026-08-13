@echo off
REM Windows equivalent of: make optimize-skill SKILL=<name> [MODEL=<id>]
REM Tunes a skill's SKILL.md description from its tests' trigger queries
REM Needs: claude CLI + network + ANTHROPIC_API_KEY
setlocal

if not "%~1"=="" set SKILL=%~1
if "%SKILL%"=="" (
    echo ERROR: provide a skill name, e.g.: scripts\optimize-skill.bat tree-edit
    exit /b 1
)

set MODEL_VAL=claude-sonnet-4-6
if not "%MODEL%"=="" set MODEL_VAL=%MODEL%

cd /d "%~dp0.."
if "%ANTHROPIC_API_KEY%"=="" (
    for /f "tokens=1,* delims==" %%a in ('findstr /R "^ANTHROPIC_API_KEY=" eval\.env 2^>nul') do (
        if "%%a"=="ANTHROPIC_API_KEY" set ANTHROPIC_API_KEY=%%b
    )
)
cd eval\triggering
uv run python build_eval_set.py --skill %SKILL%
uv run python -m scripts.run_loop ^
  --eval-set eval_sets\%SKILL%.json ^
  --skill-path ..\..\packages\engine\plugin\skills\%SKILL% ^
  --model %MODEL_VAL% ^
  --results-dir ..\runlogs\optimizer ^
  --verbose
