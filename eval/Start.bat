@echo off
cd %~dp0

echo Starting test-creation app...
echo Close this window to stop the app.
echo.

start http://localhost:3000
cd app
call npm run dev
