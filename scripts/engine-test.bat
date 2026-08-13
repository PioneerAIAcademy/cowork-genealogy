@echo off
REM Windows equivalent of: make engine-test
REM Runs genealogy engine unit tests (vitest)
setlocal
cd /d "%~dp0.."
cd packages\engine\mcp-server
npm test
