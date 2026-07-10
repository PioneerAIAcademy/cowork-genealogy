@echo off
cd %~dp0

echo === Cowork Genealogy - Build the .mcpb desktop extension ===
echo.
echo Compiles the MCP server and packs releases\genealogy-mcp.mcpb, the
echo Claude Desktop extension. After it builds, install it in Claude Desktop
echo via Settings -^> Extensions -^> Advanced Settings -^> Install extension,
echo then FULLY QUIT and reopen Desktop. Rebuild and reinstall whenever the
echo MCP server changes.
echo.
echo This runs scripts\build-mcpb.mjs with Node (same as "make mcpb"). No bash
echo needed -- just Node, which Setup.bat already installs.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: 'node' was not found on PATH. Install Node.js, or run Setup.bat
  echo        first -- the eval setup installs the dependencies this needs.
  pause
  exit /b 1
)

cd ..
call node scripts\build-mcpb.mjs
set RC=%errorlevel%

echo.
if "%RC%"=="0" (
  echo Built releases\genealogy-mcp.mcpb. Install it in Claude Desktop, then
  echo fully quit and reopen Desktop.
) else (
  echo Build failed ^(exit %RC%^). Scroll up for the error.
)
pause
