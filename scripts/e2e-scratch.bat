@echo off
REM Windows equivalent of: make e2e-scratch TEST=<slug>
REM Sets up a throwaway dir to run /research by hand against a fixture
REM Usage: scripts\e2e-scratch.bat <test-slug>
setlocal

if not "%~1"=="" set TEST=%~1
if "%TEST%"=="" (
    echo ERROR: provide a test slug, e.g.: scripts\e2e-scratch.bat mary-mcandrew-son
    exit /b 1
)

cd /d "%~dp0.."
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1
cd eval\harness
uv run python -m e2e.scratch --test %TEST% --launch
