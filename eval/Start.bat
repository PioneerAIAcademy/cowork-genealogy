@echo off
cd /d "%~dp0"

call "%~dp0_CheckSync.bat" || exit /b 1

echo Starting test-creation app...
echo Close this window to stop the app.
echo.

REM eval\app is a pnpm workspace member (#1488), so its dependencies come from
REM the repo-root install, not from a lockfile of its own. Do NOT run `npm
REM install` in eval\app: npm cannot parse the `workspace:*` dependency and
REM fails with EUNSUPPORTEDPROTOCOL. Setup.bat installs pnpm.
cd ..
where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: 'pnpm' was not found on PATH. Run eval\Setup.bat first to install
  echo        dependencies, or install pnpm from https://pnpm.io/installation
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies. This takes a minute.
  call pnpm install
  if errorlevel 1 ( echo ERROR: pnpm install failed. & pause & exit /b 1 )
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
call pnpm --filter cowork-genealogy-eval-app dev
