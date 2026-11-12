@echo off
cd /d "%~dp0"

call "%~dp0_CheckSync.bat" || exit /b 1

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

REM A checkout can have every JS dep yet no Electron binary (Electron 42+
REM downloads it only through install-electron), and electron-vite then dies
REM with "Error: Electron uninstall". install-electron exits at once when the
REM binary is present and otherwise downloads it, so call it every launch.
call pnpm --filter @genealogy/electron exec install-electron
if errorlevel 1 (
  echo.
  echo ERROR: Could not install the Electron binary. Re-run Setup.bat, or
  echo        from the repo root run:
  echo          pnpm --filter @genealogy/electron exec install-electron
  pause
  exit /b 1
)

call pnpm --filter @genealogy/electron dev
