@echo off
cd %~dp0

echo === Cowork Genealogy — Build the Cowork plugin (.zip) ===
echo.
echo Packs releases\genealogy-plugin.zip, the skills and agents Cowork runs.
echo After it builds, upload it in Claude Desktop -^> Cowork -^> Customize -^>
echo Browse plugins -^> Upload custom plugin, then FULLY QUIT and reopen
echo Desktop. Rebuild and reinstall whenever a skill under
echo packages\engine\plugin changes.
echo.
echo This runs the same scripts\package-plugin.sh that "make plugin" runs, so
echo it needs a bash environment such as Git Bash or WSL with the 'zip' command.
echo.

where bash >nul 2>nul
if errorlevel 1 (
  echo ERROR: 'bash' was not found on PATH. Install Git for Windows
  echo        ^(it includes Git Bash^) or use WSL -- or just install a
  echo        released genealogy-plugin.zip instead of building it yourself.
  pause
  exit /b 1
)

cd ..
call bash scripts/package-plugin.sh
set RC=%errorlevel%

echo.
if "%RC%"=="0" (
  echo Built releases\genealogy-plugin.zip. Upload it in Cowork -^> Customize,
  echo then fully quit and reopen Desktop.
) else (
  echo Build failed ^(exit %RC%^). If it says 'zip: command not found', install
  echo zip ^(on WSL: sudo apt install zip^) or build on macOS/Linux.
)
pause
