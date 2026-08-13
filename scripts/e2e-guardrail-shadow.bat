@echo off
REM Windows equivalent of: make e2e-guardrail-shadow [TEST=<slug>] [WINDOWS=10,40] [SINCE=all|N|YYYY-MM-DD]
REM Retroactive guardrail shadow-window calibration over committed runs (no API)
setlocal

set TEST_FLAG=
set WIN_FLAG=
set SINCE_FLAG=
if not "%TEST%"==""    set TEST_FLAG=--test %TEST%
if not "%WINDOWS%"=="" set WIN_FLAG=--windows %WINDOWS%
if not "%SINCE%"==""   set SINCE_FLAG=--since %SINCE%

cd /d "%~dp0.."
cd eval\harness
uv run python -m e2e.guardrail_shadow_report %TEST_FLAG% %WIN_FLAG% %SINCE_FLAG%
