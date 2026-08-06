@echo off
REM Windows equivalent of: make e2e-validate TEST=<slug>
REM Stripping linter for an e2e fixture (or all fixtures if TEST is omitted)
REM Usage: scripts\e2e-validate.bat [test-slug]
REM   or:  set TEST=<slug>  then  scripts\e2e-validate.bat
REM   or:  scripts\e2e-validate.bat   (validates ALL fixtures)
setlocal

if not "%~1"=="" set TEST=%~1

cd /d "%~dp0.."
cd eval\harness
if "%TEST%"=="" (
    uv run python -m e2e.validate_fixture --all
) else (
    uv run python -m e2e.validate_fixture %TEST%
)
