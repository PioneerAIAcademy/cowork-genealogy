@echo off
cd %~dp0

echo === Cowork Genealogy E2E — Scratch /research workspace ===
echo.
echo Sets up a throwaway directory (outside the repo) with a fixture's
echo starting state and the plugin skills, so you can run /research BY HAND
echo in an interactive Claude Code session. This is how you debug WHY the
echo agent stops or skips a step — something a headless harness run can't
echo show you.
echo.
set /p SLUG="Which fixture (slug) to seed from? (e.g. kenneth-quass-death): "
if "%SLUG%"=="" (
  echo No fixture entered. Aborting.
  pause
  exit /b 1
)

cd harness
call uv run python -m e2e.scratch --test %SLUG%

echo.
echo Follow the "Next:" steps printed above — cd into the scratch dir and
echo run `claude`, then paste the /research command.
pause
