@echo off
REM Windows equivalent of: make lint
REM ESLint over the two workspaces that have a config (apps/electron, eval/app)
setlocal
cd /d "%~dp0..\.."
call pnpm --filter @genealogy/electron lint
if errorlevel 1 exit /b 1
cd eval\app
call npm run lint
