@echo off
cd %~dp0

echo === Cowork Genealogy - Research Viewer ===
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

REM A warm pnpm store can skip electron's postinstall (the binary download +
REM path.txt write), so a checkout can have every JS dep yet no launchable
REM Electron -- electron-vite then dies with "Error: Electron uninstall".
REM require('electron') throws when path.txt is missing, so this is a
REM path-independent presence check. If it's missing, install it and retry.
call pnpm --filter @genealogy/electron exec node -e "require('electron')" >nul 2>nul
if errorlevel 1 (
  echo Electron binary not found -- installing it now ^(one-time, ~30s^)...
  call pnpm --filter @genealogy/electron rebuild electron
  if errorlevel 1 (
    echo.
    echo ERROR: Could not install the Electron binary. Re-run Setup.bat, or
    echo        from the repo root run:
    echo          pnpm --filter @genealogy/electron rebuild electron
    pause
    exit /b 1
  )
)

call pnpm --filter @genealogy/electron dev
