@echo off
cd %~dp0

echo === Cowork Genealogy — Research Viewer ===
echo.
echo Launches the Electron Research Viewer. Use its "Open Project" button to
echo open a project folder:
echo   eval\e2e-project\^<slug^>   a live debug run  ^(SeedProject.bat^)
echo   eval\e2e-view              a scored run       ^(ViewE2E.bat^)
echo.
echo Leave this window open while you work; close it or press Ctrl+C to stop
echo the viewer.
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: 'pnpm' was not found on PATH. Run Setup.bat first to install
  echo        dependencies, or install pnpm from https://pnpm.io/installation
  pause
  exit /b 1
)

cd ..
call pnpm --filter cowork-genealogy-ui dev
