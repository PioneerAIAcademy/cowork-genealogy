@echo off
REM Windows equivalent of: make conflict-verdicts [SKILL=<name>]
REM Run logs whose own tests reach opposite verdicts on one conflict
REM (read-only; no API calls)
setlocal

set SKILL_FLAG=
if not "%SKILL%"=="" set SKILL_FLAG=--skill %SKILL%

cd /d "%~dp0..\.."
cd eval\harness
uv run python -m conflict_verdict_report %SKILL_FLAG%
