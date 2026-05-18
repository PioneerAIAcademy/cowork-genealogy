@echo off
cd %~dp0

echo Starting test-creation app...
echo Close this window to stop the app.
echo.

cd app
if not exist node_modules (
  echo First run: installing dependencies. This takes a minute.
  call npm install
)

start http://localhost:3000
call npm run dev
