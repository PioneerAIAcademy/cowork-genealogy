@echo off
cd %~dp0

echo === Cowork Genealogy E2E — Preflight check ===
echo.
echo Verifies your machine is ready to run e2e tests (FamilySearch login,
echo built MCP server, Anthropic API key, harness dependencies). Run this
echo FIRST — it catches setup problems before you spend time and money on
echo a real run.
echo.

cd harness
call uv run python -m e2e.preflight

echo.
pause
