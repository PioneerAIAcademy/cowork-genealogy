@echo off
cd %~dp0

echo === Cowork Genealogy E2E — Seed an editable project to debug /research live ===
echo.
echo Copies a fixture's STARTING state into eval\.e2e-project\<slug>\ as a fresh,
echo editable project. Open it in Claude Cowork to run /research step-by-step, and
echo open the same folder in the Research Viewer to watch it live.
echo.
echo For DEBUGGING the process, not scoring: a live run does NOT block the
echo tree-read tools, so use RunE2E.bat for the honest pass/fail.
echo.
set /p SLUG="Which fixture (slug) do you want to debug? (e.g. kenneth-quass-death): "

if "%SLUG%"=="" (
  echo.
  echo No fixture entered. Aborting.
  pause
  exit /b 1
)

cd harness
call uv run python -m e2e.project --test %SLUG%

echo.
echo (Already seeded and want to start over? Re-run and it will tell you how to
echo re-seed from scratch.)
pause
