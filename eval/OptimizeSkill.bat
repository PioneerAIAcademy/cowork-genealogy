@echo off
cd %~dp0

echo === Cowork Genealogy - Tune a skill's description ===
echo.
echo Tunes the one-line DESCRIPTION in SKILL.md -- the sentence that decides
echo WHEN the skill fires. It never runs the skill or any MCP tool, so it
echo cannot fix "the skill did the task wrong" (that is RunTests.bat plus the
echo skill-improver loop).
echo.
echo It builds should-trigger / should-not-trigger queries from this skill's
echo unit tests, then tries candidate descriptions against them. Those are
echo real model calls -- it needs network and costs money.
echo.
echo It does NOT edit the skill. Apply the winning description yourself, as a
echo reviewed SKILL.md edit.
echo.

set /p SKILL="Which skill's description do you want to tune? (e.g. citation): "
if "%SKILL%"=="" (
  echo.
  echo No skill entered. Aborting.
  pause
  exit /b 1
)

where claude >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: the 'claude' CLI was not found on PATH. Run Setup.bat once to
  echo        install it, then retry.
  pause
  exit /b 1
)

cd triggering

echo.
echo Building the trigger query set for %SKILL% ...
call uv run python build_eval_set.py --skill %SKILL%
if errorlevel 1 (
  echo.
  echo ERROR: could not build the query set. Does %SKILL% have unit tests
  echo        under eval\tests\unit\%SKILL%\ ?
  pause
  exit /b 1
)

echo.
echo Tuning the description (this makes real model calls -- give it a few minutes)...
echo.
call uv run python -m scripts.run_loop --eval-set eval_sets/%SKILL%.json --skill-path ../../packages/engine/plugin/skills/%SKILL% --model claude-sonnet-4-6 --results-dir ../runlogs/optimizer --verbose

echo.
echo Done. Open the newest folder under eval\runlogs\optimizer\ -- report.html
echo shows the best description and how it scored. If you agree with it, paste
echo it into SKILL.md by hand, then re-run RunTests.bat to confirm the skill's
echo behavior did not move.
pause
