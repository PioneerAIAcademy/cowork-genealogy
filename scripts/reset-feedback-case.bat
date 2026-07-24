@echo off
setlocal enabledelayedexpansion

REM Reset a feedback case directory to the pristine state it was imported in.
REM Contract: docs/specs/feedback-case-spec.md section 4.
REM Counterpart to reset-feedback-case.sh.
REM
REM Run this between attempts: the agent mutates research.json /
REM tree.gedcomx.json / results/ as it works, and a second run on top of a
REM first one is testing contaminated state.
REM
REM Deliberately the ONLY thing a triager has to know about restoring a case.
REM The git baseline underneath is an implementation detail of
REM setup-feedback-case.bat, not something to teach a genealogist.
REM
REM Safe by construction: .claude\ (the linked-in skills) is gitignored by the
REM setup script, so `git clean -fd` leaves it alone; .feedback-repo-root is
REM committed in the baseline, so it survives too.

if /i "%~1"=="-h" goto :usage
if /i "%~1"=="--help" goto :usage

set "CASE_DIR=%~1"
if "!CASE_DIR!"=="" set "CASE_DIR=%CD%"

if not exist "!CASE_DIR!" (
    echo Error: no such directory: !CASE_DIR! 1>&2
    exit /b 1
)

if not exist "!CASE_DIR!\.feedback-repo-root" (
    echo Error: !CASE_DIR! is not a feedback case directory. 1>&2
    echo        ^(no .feedback-repo-root marker - set one up with setup-feedback-case.bat^) 1>&2
    exit /b 1
)

git -C "!CASE_DIR!" rev-parse --verify HEAD >nul 2>nul
if errorlevel 1 (
    echo Error: !CASE_DIR! has no imported baseline to reset to. 1>&2
    echo        Re-import it with setup-feedback-case.bat ^<zip^> --force. 1>&2
    exit /b 1
)

git -C "!CASE_DIR!" checkout -- .
if errorlevel 1 exit /b 1
git -C "!CASE_DIR!" clean -qfd
if errorlevel 1 exit /b 1

echo.
echo Reset !CASE_DIR! to the state it was imported in.
echo.
echo Next: start a fresh Claude Code session ^(or /clear^), then re-issue the
echo       user's prompt. Both halves - data and conversation - have to be
echo       fresh or you're testing contaminated state.
exit /b 0

:usage
echo Usage: reset-feedback-case.bat [^<case-dir^>]
echo        defaults to the current directory
exit /b 1
