@echo off
REM Windows equivalent of: make electron
REM Run the Electron Research Viewer
setlocal
cd /d "%~dp0.."
pnpm --filter @genealogy/electron dev
