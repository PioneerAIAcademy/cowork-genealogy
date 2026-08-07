@echo off
REM Windows equivalent of: make harness-test
REM Eval harness unit tests (pytest)
setlocal
cd /d "%~dp0.."
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1
cd eval\harness
uv run pytest -q
