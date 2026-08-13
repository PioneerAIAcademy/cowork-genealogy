@echo off
REM Windows equivalent of: make eval-timings [TOP=20] [SINCE=all|N|YYYY-MM-DD]
REM Weekly timing review: scan latest run logs, rank slowest tests (read-only)
setlocal

set TOP_FLAG=
set SINCE_FLAG=
if not "%TOP%"==""   set TOP_FLAG=--top %TOP%
if not "%SINCE%"=="" set SINCE_FLAG=--since %SINCE%

cd /d "%~dp0.."
cd eval\harness
uv run python -m scripts.timing_report %TOP_FLAG% %SINCE_FLAG%
