@echo off
cd /d "%~dp0"

call "%~dp0_CheckSync.bat" || exit /b 1

echo Starting test-creation app...
echo Close this window to stop the app.
echo.

cd app
if not exist node_modules (
  echo First run: installing dependencies. This takes a minute.
  call npm install
)

REM Open 127.0.0.1, not localhost. The dev server binds loopback IPv4 only
REM (see eval/app/package.json), and on Windows "localhost" commonly resolves to
REM IPv6 ::1 first — which would fail to connect. Do not change either without
REM changing the other: the binding is what keeps this app off the LAN.
start http://127.0.0.1:3000
call npm run dev
