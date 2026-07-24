@echo off
cd %~dp0

echo === Cowork Genealogy - Install shared git hooks ===
echo.
echo The Windows counterpart to 'make install-hooks'. Installs two hooks into
echo this clone's shared .git\hooks, covering every worktree of the clone:
echo.
echo   post-checkout - auto-links shared dev files into a newly-added worktree
echo   commit-msg    - warns (never blocks) when a commit records no human
echo                   Co-authored-by trailer
echo.
echo Opt-in and per-clone. Touches only local .git state, never core.hooksPath,
echo so it cannot disable husky or other hook tooling, and is invisible to
echo teammates who don't run it. Safe to rerun.
echo.

REM --- Locate the SHARED .git dir (resolves to the primary worktree's, from
REM     inside any linked worktree) ---
set "COMMON="
for /f "delims=" %%i in ('git rev-parse --path-format=absolute --git-common-dir 2^>nul') do set "COMMON=%%i"
if "%COMMON%"=="" (
    echo ERROR: not inside a git repository, or git is not on PATH.
    pause
    exit /b 1
)
REM git prints forward slashes on Windows; normalize.
set "COMMON=%COMMON:/=\%"

REM --- The primary worktree is the parent of the common .git dir ---
for %%i in ("%COMMON%") do set "MAIN=%%~dpi"
if "%MAIN:~-1%"=="\" set "MAIN=%MAIN:~0,-1%"

set "SHIM=%MAIN%\scripts\git-hooks\shim.sh"
if not exist "%SHIM%" (
    echo ERROR: %SHIM% not found.
    echo The hooks live on the primary worktree's checked-out branch. Switch it
    echo to a branch that has scripts\git-hooks\shim.sh, then rerun.
    pause
    exit /b 1
)

if not exist "%COMMON%\hooks" mkdir "%COMMON%\hooks"

for %%h in (post-checkout commit-msg) do (
    call :install "%%h"
    if errorlevel 1 goto :failed
)

echo.
echo === Hooks installed ===
echo Editing scripts\git-hooks\^<name^> takes effect immediately - the installed
echo file is a stub that re-runs the tracked hook, so there is nothing to
echo reinstall after a pull.
echo.
pause
exit /b 0

:install
set "HOOK=%~1"
set "DST=%COMMON%\hooks\%HOOK%"
if exist "%DST%" (
    findstr /c:"cowork-genealogy managed hook shim" "%DST%" >nul 2>nul
    if errorlevel 1 (
        echo.
        echo install-hooks: %DST%
        echo   already exists and is not ours - not overwriting. Merge it
        echo   manually, then rerun.
        exit /b 1
    )
    del /q "%DST%"
)
copy /y "%SHIM%" "%DST%" >nul
if errorlevel 1 (
    echo ERROR: failed to copy the shim to %DST%
    exit /b 1
)
echo   installed %HOOK% hook -^> %DST%
exit /b 0

:failed
echo.
echo === Install aborted ===
pause
exit /b 1
