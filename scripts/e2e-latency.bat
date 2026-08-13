@echo off
REM Windows equivalent of: make e2e-latency [TEST=<slug>] [MD=1] [BY_SKILL=1] [SINCE=...]
REM Phase-0 latency breakdown of committed e2e runs (no API needed)
setlocal

set TEST_FLAG=
set MD_FLAG=
set BSKILL_FLAG=
set SINCE_FLAG=
if not "%TEST%"==""     set TEST_FLAG=--test %TEST%
if "%MD%"=="1"          set MD_FLAG=--markdown
if "%BY_SKILL%"=="1"    set BSKILL_FLAG=--by-skill
if not "%SINCE%"==""    set SINCE_FLAG=--since %SINCE%
if "%TEST_FLAG%"==""    set TEST_FLAG=--all

cd /d "%~dp0.."
cd eval\harness
uv run python -m e2e.latency_report %TEST_FLAG% %MD_FLAG% %BSKILL_FLAG% %SINCE_FLAG%
