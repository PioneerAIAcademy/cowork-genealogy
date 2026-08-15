@echo off
REM Windows equivalent of: make judge-report [SKILL=<name>] [SINCE=...]
REM Non-discrimination scan of the unit eval judge (read-only; no API calls)
setlocal

set SKILL_FLAG=
set SINCE_FLAG=
if not "%SKILL%"=="" set SKILL_FLAG=--skill %SKILL%
if not "%SINCE%"=="" set SINCE_FLAG=--since %SINCE%

cd /d "%~dp0.."
cd eval\harness
uv run python -m judge_report %SKILL_FLAG% %SINCE_FLAG%
