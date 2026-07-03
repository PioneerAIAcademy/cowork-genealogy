@echo off
cd %~dp0

echo === Cowork Genealogy - Build the Cowork plugin (.zip) ===
echo.
echo Packs releases\genealogy-plugin.zip, the skills and agents Cowork runs.
echo After it builds, upload it in Claude Desktop -^> Cowork -^> Customize -^>
echo Browse plugins -^> Upload custom plugin, then FULLY QUIT and reopen
echo Desktop. Rebuild and reinstall whenever a skill under
echo packages\engine\plugin changes.
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
  echo Built releases\genealogy-plugin.zip. Upload it in Cowork -^> Customize,
  echo then fully quit and reopen Desktop.
) else (
  echo Build failed ^(exit %RC%^). Scroll up for the error.
)
pause
