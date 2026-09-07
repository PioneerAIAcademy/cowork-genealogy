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

REM Open 127.0.0.1, not localhost. The dev server binds loopback IPv4 ONLY
REM (--hostname in eval/app/package.json), so there is no IPv6 listener at all —
REM verified: one IPv4 127.0.0.1 socket, nothing on ::1. "localhost" may resolve
REM to ::1 first, so 127.0.0.1 is the spelling that cannot depend on the
REM resolver. Measured on macOS, localhost DOES still connect (the client falls
REM back to IPv4); the Windows behaviour is untested here, which is the reason
REM to use the unambiguous address rather than rely on that fallback.
REM Do not change the binding without changing this URL: the binding is what
REM keeps this app off the LAN.
start http://127.0.0.1:3000
call npm run dev
