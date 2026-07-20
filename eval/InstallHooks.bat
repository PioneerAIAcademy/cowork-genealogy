@echo off
REM InstallHooks.bat -- Windows equivalent of "make install-hooks".
REM
REM Installs the two shared git hooks into this clone. Opt-in, once per clone
REM (not once per branch). What lands in .git\hooks\ is a small stub that
REM re-runs the tracked hook under scripts\git-hooks\, so editing a hook there
REM takes effect immediately -- there is nothing to reinstall after a pull.
REM Rerun this only when a NEW hook is added to the list below.

cd %~dp0

echo === Cowork Genealogy - Install shared git hooks ===
echo.
echo Installs two hooks into this clone:
echo   post-checkout  auto-links shared files ^(node_modules, .env^) into new
echo                  worktrees, so they can build and run tests immediately
echo   commit-msg     warns -- never blocks -- when a commit is missing a
echo                  human Co-authored-by: trailer
echo.
echo Safe to re-run. It refuses rather than clobbering a hook it did not write.
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: 'git' was not found on PATH. Install Git for Windows, or run
  echo        Setup.bat first.
  pause
  exit /b 1
)

cd ..

REM --git-common-dir points at the SHARED .git of this clone, so this keeps
REM working when run from inside a worktree.
for /f "delims=" %%i in ('git rev-parse --path-format^=absolute --git-common-dir 2^>nul') do set "COMMON=%%i"
if not defined COMMON (
  echo ERROR: not inside a git repository ^(is this a real clone?^).
  pause
  exit /b 1
)

for %%i in ("%COMMON%\..") do set "MAINDIR=%%~fi"
set "SHIM=%MAINDIR%\scripts\git-hooks\shim.sh"

if not exist "%SHIM%" (
  echo ERROR: %SHIM% not found.
  echo        Check out a branch that has scripts\git-hooks\, then re-run.
  pause
  exit /b 1
)

if not exist "%COMMON%\hooks" mkdir "%COMMON%\hooks"

for %%H in (post-checkout commit-msg) do call :install %%H
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Done. Hooks are active for this clone.
pause
exit /b 0

:install
set "DST=%COMMON%\hooks\%~1"
if exist "%DST%" (
  findstr /C:"cowork-genealogy managed hook shim" "%DST%" >nul 2>nul
  if errorlevel 1 (
    echo ERROR: %DST% already exists and is not ours -- not overwriting.
    echo        Merge it by hand, then re-run.
    exit /b 1
  )
  del /q "%DST%"
)
copy /y "%SHIM%" "%DST%" >nul
if errorlevel 1 (
  echo ERROR: could not write %DST%
  exit /b 1
)
echo   installed %~1 hook -^> %DST%
exit /b 0
