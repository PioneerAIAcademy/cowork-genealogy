@echo off
cd /d "%~dp0"

call "%~dp0_CheckSync.bat" || exit /b 1

echo === Cowork Genealogy E2E — Preflight check ===
echo.
echo Verifies your machine is ready to run e2e tests (FamilySearch login,
echo built MCP server, Anthropic API key, harness dependencies, live MCP
echo connection, OpenRouter key, and a live FamilySearch search). Run this
echo FIRST — it catches setup problems before you spend time and money on
echo a real run.
echo.
echo This takes about 60 seconds. Two checks start MCP server sessions —
echo one waits for it to connect, the other makes a live search call —
echo so a pause with no output is normal.
echo.

cd harness
call uv run python -m e2e.preflight

echo.
pause
