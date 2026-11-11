@echo off
REM Windows equivalent of: make reinstall
REM Cleans every node_modules then installs everything from scratch
setlocal
cd /d "%~dp0..\.."
REM Node and npm first: the installs would refuse a wrong one only after
REM clean-deps has deleted every node_modules.
call node scripts\check-node-floor.mjs
if errorlevel 1 exit /b 1
call "%~dp0clean-deps.bat"
if errorlevel 1 exit /b %errorlevel%
call "%~dp0install.bat"
