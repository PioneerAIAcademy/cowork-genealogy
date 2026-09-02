@echo off
REM Shared syncing-folder guard, called by the eval\*.bat entry points.
REM Substring compare, not findstr: findstr /c: treats a backslash-escape in the
REM search string as syntax, so a OneDrive path containing "\-" never matches.
setlocal enabledelayedexpansion
set "_hit="
if defined OneDrive           if /i not "!CD:%OneDrive%=!"=="!CD!"           set "_hit=1"
if defined OneDriveCommercial if /i not "!CD:%OneDriveCommercial%=!"=="!CD!" set "_hit=1"
if defined OneDriveConsumer   if /i not "!CD:%OneDriveConsumer%=!"=="!CD!"   set "_hit=1"
if not defined _hit endlocal & exit /b 0

echo.
echo WARNING: This folder is inside OneDrive.
echo.
echo Files here sync to the cloud, and that stops the setup from finishing.
echo It will fail partway through, with errors that change each time you retry.
echo.
echo To fix it: close this window, delete this folder, and clone again to
echo C:\src\cowork-genealogy. In GitHub Desktop, set "Local path" to C:\src
echo before you click Clone.
echo.
choice /c YN /n /m "Continue anyway? (Y/N) "
if errorlevel 2 (endlocal & exit /b 1)
endlocal & exit /b 0
