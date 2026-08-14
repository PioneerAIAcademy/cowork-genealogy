@echo off
REM Windows equivalent of: make reinstall
REM Cleans every node_modules then installs everything from scratch
setlocal
cd /d "%~dp0.."
call scripts\clean-deps.bat
if errorlevel 1 exit /b %errorlevel%
call scripts\install.bat
