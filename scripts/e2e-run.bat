@echo off
REM Windows equivalent of: make e2e-run TEST=<slug>
REM Runs ONE e2e benchmark fixture against live FamilySearch (expensive: ~20-60 min, $3-10)
REM Usage: scripts\e2e-run.bat <test-slug>
REM   or:  set TEST=<test-slug>  then  scripts\e2e-run.bat
setlocal

if not "%~1"=="" set TEST=%~1

if "%TEST%"=="" (
    echo ERROR: provide a test slug, e.g.:
    echo   scripts\e2e-run.bat mary-mcandrew-son
    echo   set TEST=mary-mcandrew-son  then  scripts\e2e-run.bat
    exit /b 1
)

cd /d "%~dp0.."
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1

cd eval\harness
set _MODEL_ARG=
set _EFFORT_ARG=
set _TOKENS_ARG=
if not "%AGENT_MODEL%"=="" set _MODEL_ARG=--agent-model %AGENT_MODEL%
if not "%EFFORT_LEVEL%"=="" set _EFFORT_ARG=--effort-level %EFFORT_LEVEL%
if not "%MAX_OUTPUT_TOKENS%"=="" set _TOKENS_ARG=--max-output-tokens %MAX_OUTPUT_TOKENS%
uv run python -m e2e.run_e2e --test %TEST% %_MODEL_ARG% %_EFFORT_ARG% %_TOKENS_ARG%
