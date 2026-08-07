@echo off
cd %~dp0

echo === Cowork Genealogy E2E — Preflight check ===
echo.
echo Verifies your machine is ready to run e2e tests (FamilySearch login,
echo built MCP server, Anthropic API key, harness dependencies, and that
echo the genealogy MCP server actually CONNECTS). Run this FIRST — it
echo catches setup problems before you spend time and money on a real run.
echo.
echo This takes about 30 seconds. The last check starts the MCP server and
echo waits for it to connect, so a pause with no output is normal.
echo.

cd harness
call uv run python -m e2e.preflight

echo.
pause
