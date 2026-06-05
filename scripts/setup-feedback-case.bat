@echo off
setlocal enabledelayedexpansion

REM Set up a feedback case directory from a submitted zip (Windows).
REM Contract: docs/specs/feedback-case-spec.md section 11.
REM Counterpart to setup-feedback-case.sh.

set "FORCE=0"
set "ZIP_PATH="
set "DEST_DIR="

:parse
if "%~1"=="" goto :done_parse
if /i "%~1"=="--force" (
    set "FORCE=1"
    shift
    goto :parse
)
if /i "%~1"=="-h" goto :usage
if /i "%~1"=="--help" goto :usage
set "ARG=%~1"
if "!ARG:~0,2!"=="--" (
    echo Unknown flag: %~1 1>&2
    goto :usage
)
if "!ZIP_PATH!"=="" (
    set "ZIP_PATH=%~1"
    shift
    goto :parse
)
if "!DEST_DIR!"=="" (
    set "DEST_DIR=%~1"
    shift
    goto :parse
)
echo Too many positional arguments 1>&2
goto :usage
:done_parse

if "!ZIP_PATH!"=="" goto :usage
if not exist "!ZIP_PATH!" (
    echo Error: zip not found: !ZIP_PATH! 1>&2
    exit /b 1
)

REM --- Resolve repo root from script location ---
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%" >nul
for /f "delims=" %%i in ('git rev-parse --show-toplevel 2^>nul') do set "REPO_ROOT=%%i"
popd >nul
if "!REPO_ROOT!"=="" (
    echo Error: could not determine repo root from %SCRIPT_DIR% 1>&2
    echo Run this script from inside the cowork-genealogy repo. 1>&2
    exit /b 1
)
REM git rev-parse on Windows returns forward slashes; normalize.
set "REPO_ROOT=!REPO_ROOT:/=\!"

REM --- Derive slug from zip basename (no extension) ---
for %%I in ("!ZIP_PATH!") do set "SLUG=%%~nI"

REM --- Resolve dest dir ---
if "!DEST_DIR!"=="" set "DEST_DIR=%USERPROFILE%\feedback\!SLUG!"

REM --- Refuse to overwrite non-empty dest dir (unless --force) ---
if exist "!DEST_DIR!\." (
    set "_HAS_FILES=0"
    for /f %%C in ('dir /b /a "!DEST_DIR!" 2^>nul ^| find /c /v ""') do set "_HAS_FILES=%%C"
    if not "!_HAS_FILES!"=="0" (
        if "!FORCE!"=="0" (
            echo Error: !DEST_DIR! exists and is non-empty. 1>&2
            echo Pass --force to overwrite, or investigate manually. 1>&2
            exit /b 1
        )
        echo --force: removing existing !DEST_DIR!
        rmdir /s /q "!DEST_DIR!"
    )
)

REM --- Unzip via PowerShell (Expand-Archive ships with Windows 10+) ---
if not exist "!DEST_DIR!" mkdir "!DEST_DIR!"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '!ZIP_PATH!' -DestinationPath '!DEST_DIR!' -Force"
if errorlevel 1 (
    echo Error: failed to unzip !ZIP_PATH! 1>&2
    exit /b 1
)

REM --- Write .feedback-repo-root ---
> "!DEST_DIR!\.feedback-repo-root" echo !REPO_ROOT!

REM --- Update .gitignore (append-if-missing) before git init ---
pushd "!DEST_DIR!" >nul
if exist .gitignore (
    findstr /x ".claude/" .gitignore >nul 2>nul
    if errorlevel 1 (>> .gitignore echo .claude/)
) else (
    > .gitignore echo .claude/
)

REM --- git init + initial commit ---
git init -q
git add .
git commit -q -m "imported"

REM --- Per-skill junctions under .claude\skills\ ---
REM Junctions (mklink /J) work without admin or Developer Mode, unlike /D.
if not exist .claude\skills mkdir .claude\skills
for /d %%d in ("!REPO_ROOT!\plugin\skills\*") do (
    if not exist ".claude\skills\%%~nxd" (
        mklink /J ".claude\skills\%%~nxd" "%%d" >nul
    )
)
if exist "!REPO_ROOT!\.claude\skills" (
    for /d %%d in ("!REPO_ROOT!\.claude\skills\*") do (
        if not exist ".claude\skills\%%~nxd" (
            mklink /J ".claude\skills\%%~nxd" "%%d" >nul
        )
    )
)
popd >nul

REM --- Print "next steps" ---
echo.
echo Imported to !DEST_DIR!
echo.
echo Next steps:
echo   cd /d "!DEST_DIR!"
echo   claude
echo.
set "FB_JSON=!DEST_DIR!\_feedback\feedback.json"
if exist "!FB_JSON!" (
    echo User's prompt to issue first:
    echo ---------------------------------------------
    powershell -NoProfile -Command "try { (Get-Content -Raw -LiteralPath '!FB_JSON!' | ConvertFrom-Json).user_prompt } catch { '(could not parse feedback.json)' }"
    echo ---------------------------------------------
) else (
    echo User's prompt: see !DEST_DIR!\_feedback\feedback.json ^(user_prompt field^)
)
echo.
echo Then: /compare-state --against=what-went-wrong
echo.
echo Full workflow: docs\feedback-workflow.md
exit /b 0

:usage
echo Usage: setup-feedback-case.bat ^<path-to-feedback.zip^> [^<dest-dir^>] [--force]
echo.
echo Unzips a feedback submission into a case directory, initializes a git
echo baseline, writes .feedback-repo-root, wires per-skill junctions, and
echo prints the user's prompt for first-paste.
echo.
echo Arguments:
echo   ^<path-to-feedback.zip^>  The zip file downloaded from the feedback Drive.
echo   ^<dest-dir^>              Optional. Default: %%USERPROFILE%%\feedback\^<slug^>\
echo                           where ^<slug^> is the zip basename without ".zip".
echo   --force                 Overwrite an existing non-empty dest-dir.
echo.
echo See docs\specs\feedback-case-spec.md section 11 for the full contract.
exit /b 2
