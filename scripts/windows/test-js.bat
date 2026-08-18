@echo off
REM Windows equivalent of: make test-js
REM JS workspace tests: web, electron, viewer-ui, schema (turbo)
setlocal
cd /d "%~dp0..\.."
call pnpm test
