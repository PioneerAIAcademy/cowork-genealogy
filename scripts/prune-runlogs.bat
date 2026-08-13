@echo off
REM Windows equivalent of: make prune-runlogs [REHASH=1] [PRUNE=1|K] [DRY=1]
REM Maintenance sweep over committed unit run logs
setlocal

set REHASH_FLAG=
set PRUNE_FLAG=
set DRY_FLAG=
if "%REHASH%"=="1" set REHASH_FLAG=--rehash
if not "%PRUNE%"=="" set PRUNE_FLAG=--prune-unit %PRUNE%
if "%DRY%"=="1"    set DRY_FLAG=--dry-run

cd /d "%~dp0.."
cd eval\harness
uv run python -m scripts.prune_runlogs %REHASH_FLAG% %PRUNE_FLAG% %DRY_FLAG%
