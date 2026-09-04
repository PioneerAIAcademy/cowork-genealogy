@echo off
setlocal enabledelayedexpansion

REM Set up a feedback case directory from a submitted zip (Windows).
REM Contract: docs/specs/feedback-case-spec.md section 3.
REM Counterpart to setup-feedback-case.sh.

set "FORCE=0"
set "ZIP_PATH="
set "DEST_DIR="
REM %~dp0 must be read BEFORE :parse -- `shift` moves %1 into %0, so
REM after the loop %~dp0 is the zip's directory, not the script's (issue #1876).
set "SCRIPT_DIR=%~dp0"

:parse
if "%~1"=="" goto :done_parse
if /i "%~1"=="--force" (
    set "FORCE=1"
    shift /1
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
    shift /1
    goto :parse
)
if "!DEST_DIR!"=="" (
    set "DEST_DIR=%~1"
    shift /1
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
pushd "%SCRIPT_DIR%" >nul
for /f "delims=" %%i in ('git rev-parse --show-toplevel 2^>nul') do set "REPO_ROOT=%%i"
popd >nul
if "!REPO_ROOT!"=="" (
    echo Error: could not determine repo root from %SCRIPT_DIR% 1>&2
    echo This script must live inside the repo checkout; the cwd is irrelevant. 1>&2
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
REM -ErrorAction Stop + exit 1: without them powershell.exe returns 0 even
REM when Expand-Archive errors, so the errorlevel check below never fired
REM and a corrupt zip printed "Imported to ..." and exited 0 (issue #1876).
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -LiteralPath '!ZIP_PATH!' -DestinationPath '!DEST_DIR!' -Force -ErrorAction Stop } catch { Write-Error $_; exit 1 }"
if errorlevel 1 (
    echo Error: failed to unzip !ZIP_PATH! 1>&2
    exit /b 1
)

REM --- Strip Claude Code config that may have been injected into the zip ---
REM Legitimate feedback zips never contain dotfiles (both walkers skip entries
REM starting with "."), so .claude\, .claude.json, and .mcp.json in the zip are
REM either hand-crafted or from an unexpected source. Remove them so the script's
REM own fresh .claude\ (with repo-junctioned skills only) is the sole config
REM Claude Code reads.
for %%F in (.claude .claude.json .mcp.json) do (
    if exist "!DEST_DIR!\%%F" (
        echo Warning: stripped %%F from the zip ^(not expected in a feedback submission^).
        if exist "!DEST_DIR!\%%F\." (
            rmdir /s /q "!DEST_DIR!\%%F"
        ) else (
            del /q "!DEST_DIR!\%%F"
        )
    )
)
REM CLAUDE.md is NOT a dotfile, so the walkers ship it deliberately and it
REM arrives in ordinary submissions. Claude Code would load it as project
REM instructions, so rename rather than delete -- the triager keeps the content
REM for reproduction, but it no longer executes as config.
if exist "!DEST_DIR!\CLAUDE.md" (
    echo Note: renamed CLAUDE.md to CLAUDE.md.submitted so it is not loaded as instructions.
    ren "!DEST_DIR!\CLAUDE.md" "CLAUDE.md.submitted"
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
REM The .sh counterpart runs under `set -euo pipefail`, so a failing git
REM baseline aborts there. cmd has no equivalent, so check each step --
REM an unset user.email made all three fail while the script still
REM reported success (issue #1876).
git init -q
if errorlevel 1 goto :git_baseline_failed
git add .
if errorlevel 1 goto :git_baseline_failed
git commit -q -m "imported"
if errorlevel 1 goto :git_baseline_failed

REM --- Per-skill junctions under .claude\skills\ ---
REM Junctions (mklink /J) work without admin or Developer Mode, unlike /D.
if not exist .claude\skills mkdir .claude\skills
for /d %%d in ("!REPO_ROOT!\packages\engine\plugin\skills\*") do (
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
echo Full workflow: docs\alpha-feedback-guide.md
exit /b 0

:git_baseline_failed
echo Error: could not create the git baseline in !DEST_DIR!. 1>&2
echo The case was unpacked, but it has no baseline to reset to. 1>&2
echo Re-import with: scripts\reset-feedback-case.bat, then retry. 1>&2
echo A partial import leaves files behind, so the retry needs --force. 1>&2
echo If git reported an unknown author, set user.name and user.email. 1>&2
exit /b 1

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
echo See docs\specs\feedback-case-spec.md section 3 for the full contract.
exit /b 2
