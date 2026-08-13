@echo off
REM Windows equivalent of: make skill-latency [SKILL=<name>] [VS_PREV=1] [BEFORE=a.json AFTER=b.json] [SINCE=...]
REM Per-skill output-token profile from unit runlogs (read-only)
setlocal

set SKILL_FLAG=
set BFLAG=
set AFLAG=
set SINCE_FLAG=
set MD_FLAG=
if not "%SKILL%"=="" (
    set SKILL_FLAG=--skill %SKILL%
    if "%VS_PREV%"=="1" set SKILL_FLAG=--skill %SKILL% --vs-prev
)
if not "%BEFORE%"=="" set BFLAG=--before %BEFORE%
if not "%AFTER%"==""  set AFLAG=--after %AFTER%
if not "%SINCE%"==""  set SINCE_FLAG=--since %SINCE%
if "%MD%"=="1"        set MD_FLAG=--markdown

cd /d "%~dp0.."
cd eval\harness
if "%SKILL_FLAG%%BFLAG%%AFLAG%"=="" (
    uv run python -m skill_latency_report --all %MD_FLAG% %SINCE_FLAG%
) else (
    uv run python -m skill_latency_report %SKILL_FLAG% %BFLAG% %AFLAG% %SINCE_FLAG%
)
