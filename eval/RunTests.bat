@echo off
cd %~dp0

echo Running tests...
echo.

cd harness
call uv run python run_tests.py

echo.
echo Done. Result files have been written.
echo Review them in the test-creation app, then commit via GitHub Desktop.
pause
