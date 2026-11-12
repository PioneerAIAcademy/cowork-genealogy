@echo off
cd %~dp0

echo === Cowork Genealogy - Build the .mcpb desktop extension ===
echo.
echo Compiles the MCP server and packs releases\genealogy-mcp.mcpb, the
echo Claude Desktop extension. After it builds, install it in Claude Desktop
echo via Settings ^(Ctrl+,^) -^> Desktop app -^> Extensions: Manage -^> Advanced
echo settings -^> Install extension, then FULLY QUIT Desktop ^(tray icon -^>
echo Exit^) and reopen it. If an old copy is installed, the window offers only
echo Uninstall: click it, then Install. Rebuild and reinstall whenever the MCP
echo server changes.
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
  echo fully quit Desktop ^(tray icon -^> Exit^) and reopen it.
) else (
  echo Build failed ^(exit %RC%^). Scroll up for the error.
)
pause
