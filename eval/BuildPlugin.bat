@echo off
cd %~dp0

echo === Cowork Genealogy - Build the Cowork plugin (.zip) ===
echo.
echo Packs releases\genealogy-plugin.zip, the skills and agents Cowork runs.
echo After it builds, upload it in Claude Desktop -^> Customize -^> Plugins -^>
echo + Add -^> Upload plugin, then FULLY QUIT Desktop ^(tray icon -^> Exit^) and
echo reopen it. Rebuild and reinstall whenever a skill under
echo packages\engine\plugin changes.
echo.
echo Already have an older copy installed? REMOVE it first ^(Customize -^>
echo Plugins -^> Yours -^> ... -^> Remove^), then upload the new .zip -- that is
echo the reliable way to be sure you are running the new skills.
echo.
echo This runs scripts\package-plugin.mjs with Node (same as "make plugin"). No
echo bash or zip needed -- just Node, which Setup.bat already installs.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: 'node' was not found on PATH. Install Node.js, or run Setup.bat
  echo        first -- the eval setup installs the dependencies this needs.
  pause
  exit /b 1
)

cd ..
call node scripts\package-plugin.mjs
set RC=%errorlevel%

echo.
if "%RC%"=="0" (
  echo Built releases\genealogy-plugin.zip. Upload it in Customize -^> Plugins,
  echo then fully quit Desktop ^(tray icon -^> Exit^) and reopen it.
) else (
  echo Build failed ^(exit %RC%^). Scroll up for the error.
)
pause
