@echo off
REM Windows equivalent of: make typecheck
REM Typecheck the whole JS workspace (turbo)
setlocal
cd /d "%~dp0..\.."
call pnpm typecheck
