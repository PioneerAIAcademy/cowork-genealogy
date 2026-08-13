@echo off
REM Windows equivalent of: make mcpb
REM Builds the .mcpb desktop extension
setlocal
cd /d "%~dp0.."
node scripts\build-mcpb.mjs
