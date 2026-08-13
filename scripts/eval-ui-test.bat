@echo off
REM Windows equivalent of: make eval-ui-test
REM Runs Eval CRUD UI tests (vitest)
setlocal
cd /d "%~dp0.."
if not exist "eval\app\node_modules" (
    echo Installing eval-ui deps...
    pushd eval\app
    npm install
    popd
)
cd eval\app
npm test
