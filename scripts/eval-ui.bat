@echo off
REM Windows equivalent of: make eval-ui
REM Launches the Eval CRUD UI dev server (Next.js, port 3000)
setlocal
cd /d "%~dp0.."
if not exist "eval\app\node_modules" (
    echo Installing eval-ui deps...
    pushd eval\app
    npm install
    popd
)
cd eval\app
npm run dev
