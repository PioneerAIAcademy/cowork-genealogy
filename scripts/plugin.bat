@echo off
REM Windows equivalent of: make plugin
REM Builds the Cowork plugin .zip
setlocal
cd /d "%~dp0.."
node scripts\package-plugin.mjs
