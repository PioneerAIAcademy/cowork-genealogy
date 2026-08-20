@echo off
cd %~dp0

REM --- OneDrive / syncing-folder check ---
if defined OneDrive (
    REM Substring compare, not findstr: findstr /c: treats a backslash-escape in
    REM the search string as syntax, so a OneDrive path containing "\-" (e.g.
    REM C:\Users\-TIFE-\OneDrive) silently never matches. Verified under cmd.exe.
    setlocal enabledelayedexpansion
    if /i not "!CD:%OneDrive%=!"=="!CD!" (
        echo WARNING: This checkout is inside your OneDrive folder.
        echo OneDrive's sync conflicts with build tools ^(uv, Next.js^).
        echo Move the clone to a plain local path, e.g. C:\src\.
        echo.
        pause
    )
    endlocal
)

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
