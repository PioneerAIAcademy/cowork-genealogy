@echo off
REM Windows equivalent of: make e2e-project TEST=<slug>
REM Seeds an editable Cowork project from a fixture's STARTING state
REM Usage: scripts\e2e-project.bat <test-slug>  [--force]
REM   or:  set TEST=<slug>  then  scripts\e2e-project.bat
setlocal

if not "%~1"=="" set TEST=%~1
if "%TEST%"=="" (
    echo ERROR: provide a test slug, e.g.: scripts\e2e-project.bat mary-mcandrew-son
    exit /b 1
)
set FORCE_FLAG=
if /i "%~2"=="--force" set FORCE_FLAG=--force
if /i "%FORCE%"=="1"    set FORCE_FLAG=--force

cd /d "%~dp0.."
cd eval\harness
uv run python -m e2e.project --test %TEST% %FORCE_FLAG%
