@echo off
REM Windows equivalent of: make harness-lint
REM Undefined-name check for eval/harness (ruff F821)
setlocal
cd /d "%~dp0..\.."
cd eval\harness
uv run ruff check .
