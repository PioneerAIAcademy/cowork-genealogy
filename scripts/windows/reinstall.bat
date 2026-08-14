@echo off
REM Windows equivalent of: make reinstall
REM Cleans every node_modules then installs everything from scratch
setlocal
cd /d "%~dp0..\.."
call "%~dp0clean-deps.bat"
if errorlevel 1 exit /b %errorlevel%
call "%~dp0install.bat"
