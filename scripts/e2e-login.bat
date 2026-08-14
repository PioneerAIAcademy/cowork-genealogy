@echo off
REM Windows equivalent of: make e2e-login
REM Log in to FamilySearch (opens a browser; token lasts ~24h, shared by all e2e runs)
setlocal
cd /d "%~dp0.."
if not exist "packages\engine\mcp-server\node_modules" (
    echo [e2e-login] Installing engine node_modules first...
    pushd packages\engine\mcp-server
    npm ci
    popd
    if errorlevel 1 exit /b 1
)
cd packages\engine\mcp-server
npx tsx dev\e2e-login.ts
