@echo off
cd %~dp0

echo === Cowork Genealogy Test Harness ===
echo.
set /p SKILL="Which skill do you want to test? (e.g. wiki-lookup): "

if "%SKILL%"=="" (
  echo.
  echo No skill entered. Aborting.
  pause
  exit /b 1
)

echo.
echo Running tests for %SKILL%...
echo.

cd harness
call uv run python run_tests.py --skill %SKILL%

echo.
echo Done. Result files have been written.
echo Review them in the test-creation app, then commit via GitHub Desktop.
pause
