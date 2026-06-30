@echo off
cd %~dp0

echo === Cowork Genealogy E2E — Load a run into the Research Viewer ===
echo.
echo Copies the latest run's final tree + research into eval\e2e-view\ so you
echo can open it in the Research Viewer. Cheap and instant — no rebuild, no login.
echo.
set /p SLUG="Which fixture (slug) do you want to view? (e.g. kenneth-quass-death): "

if "%SLUG%"=="" (
  echo.
  echo No fixture entered. Aborting.
  pause
  exit /b 1
)

cd harness
call uv run python -m e2e.view --test %SLUG%

echo.
echo Now open the  eval\e2e-view  folder in the Research Viewer using its
echo "Open Project" button. Keep the viewer open — run this again after each
echo e2e run and the viewer refreshes live.
pause
