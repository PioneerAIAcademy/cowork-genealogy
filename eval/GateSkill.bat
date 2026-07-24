@echo off
cd %~dp0

echo === Cowork Genealogy - Gate a candidate SKILL.md edit ===
echo.
echo Runs the mined test plus this skill's holdout tests against the SKILL.md
echo currently in your working tree, and compares to the baseline from the
echo RunTests.bat run you did BEFORE editing (with your grading corrections
echo overlaid). Prints LOOKS GOOD / NEEDS YOUR EYES / INCONCLUSIVE.
echo.
echo Advisory, not a verdict -- you decide. It writes no run logs, so it does
echo NOT replace the full RunTests.bat run you do before opening the PR.
echo.
echo Apply the skill-improver's edits to SKILL.md FIRST, then run this.
echo.

set /p SKILL="Which skill did you edit? (e.g. citation): "
if "%SKILL%"=="" (
  echo.
  echo No skill entered. Aborting.
  pause
  exit /b 1
)

set /p TEST="Which test id did you mine? (e.g. ut_citation_019): "
if "%TEST%"=="" (
  echo.
  echo No test id entered. Aborting.
  pause
  exit /b 1
)

if not exist ..\packages\engine\mcp-server\node_modules\ (
  echo.
  echo ERROR: mcp-server dependencies are not installed.
  echo Please run Setup.bat once to install everything, then retry.
  pause
  exit /b 1
)

echo.
echo Building MCP server (picks up any code changes from the last git pull)...
cd ..\packages\engine\mcp-server
call npm run build
if errorlevel 1 (
  echo.
  echo ERROR: MCP server build failed. Aborting gate run.
  cd ..\..\..\eval
  pause
  exit /b 1
)
cd ..\..\..\eval

echo.
echo Gating %SKILL% on %TEST% ...
echo.

cd harness
call uv run python skill_gate.py --skill %SKILL% --test %TEST%

echo.
echo (INCONCLUSIVE means the bug never showed up on the OLD skill -- usually a
echo  too-weak test, sometimes just run-to-run luck. Re-run once before
echo  rewriting the test.)
pause
