@echo off
cd %~dp0

echo === Cowork Genealogy - Build the Cowork plugin (.zip) ===
echo.
echo Packs releases\genealogy-plugin.zip, the skills and agents Cowork runs.
echo After it builds, upload it in Claude Desktop -^> Cowork -^> Customize -^>
echo Add -^> Upload Plugin, then FULLY QUIT and reopen Desktop. Rebuild and
echo reinstall whenever a skill under packages\engine\plugin changes.
echo.
echo Already have an older copy installed? REMOVE it in Cowork -^> Customize
echo first, then upload the new .zip -- that is the reliable way to be sure
echo you are running the new skills.
echo.
echo Upload it from the COWORK tab, not the Code tab -- they keep separate
echo plugin lists, and a plugin added in Code will not appear in Cowork.
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
