@echo off
REM Windows equivalent of: make e2e-corpus [TEST=<slug>] [SINCE=all|N|YYYY-MM-DD]
REM Three axes + violation detail over recent committed e2e runs (no API needed)
REM Usage: scripts\e2e-corpus.bat
REM   or:  set TEST=<slug>   then  scripts\e2e-corpus.bat
REM   or:  set SINCE=all     then  scripts\e2e-corpus.bat
setlocal

set TEST_FLAG=
set SINCE_FLAG=
if not "%TEST%"==""  set TEST_FLAG=--test %TEST%
if not "%SINCE%"=="" set SINCE_FLAG=--since %SINCE%

cd /d "%~dp0.."
cd eval\harness
uv run python -m e2e.corpus_report %TEST_FLAG% %SINCE_FLAG%
