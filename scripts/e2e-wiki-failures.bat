@echo off
REM Windows equivalent of: make e2e-wiki-failures [TEST=<slug>] [SINCE=all|N|YYYY-MM-DD]
REM Why wiki/pop-stats calls fail, over committed e2e runs (no API needed)
setlocal

set TEST_FLAG=
set SINCE_FLAG=
if not "%TEST%"==""     set TEST_FLAG=--test %TEST%
if not "%SINCE%"==""    set SINCE_FLAG=--since %SINCE%

cd /d "%~dp0.."
cd eval\harness
uv run python -m e2e.wiki_failure_report %TEST_FLAG% %SINCE_FLAG%
