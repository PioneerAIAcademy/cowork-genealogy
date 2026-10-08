@echo off
REM Windows equivalent of: make eval-ui-test
REM Runs Eval CRUD UI typecheck + tests (tsc + vitest)
setlocal
cd /d "%~dp0..\.."
REM eval\app is a pnpm workspace member (#1488) -- install from the repo root.
REM Test the workspace link, not the repo-root node_modules: that folder
REM predates the move on an upgraded checkout, so testing it skips the install
REM for the people who still need one.
if not exist "eval\app\node_modules\@genealogy\schema" (
    echo Installing workspace deps...
    call pnpm install
)
call pnpm --filter cowork-genealogy-eval-app typecheck
if errorlevel 1 exit /b 1
call pnpm --filter cowork-genealogy-eval-app test
