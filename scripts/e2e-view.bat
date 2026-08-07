@echo off
REM Windows equivalent of: make e2e-view TEST=<slug>
REM Loads the latest e2e run into the Research Viewer
REM Usage: scripts\e2e-view.bat <test-slug>
REM   or:  set TEST=<test-slug>  then  scripts\e2e-view.bat
setlocal

if not "%~1"=="" set TEST=%~1
if "%TEST%"=="" (
    echo ERROR: provide a test slug, e.g.: scripts\e2e-view.bat mary-mcandrew-son
    exit /b 1
)

cd /d "%~dp0.."
cd eval\harness
uv run python -m e2e.view --test %TEST%
