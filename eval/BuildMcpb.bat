@echo off
cd %~dp0

echo === Cowork Genealogy — Build the .mcpb desktop extension ===
echo.
echo Compiles the MCP server and packs releases\genealogy-mcp.mcpb, the
echo Claude Desktop extension. After it builds, install it in Claude Desktop
echo via Settings -^> Extensions -^> Install Extension, then FULLY QUIT and
echo reopen Desktop. Rebuild and reinstall whenever the MCP server changes.
echo.
echo This runs the same scripts\build-mcpb.sh that "make mcpb" runs, so it
echo needs a bash environment such as Git Bash or WSL.
echo.

where bash >nul 2>nul
if errorlevel 1 (
  echo ERROR: 'bash' was not found on PATH. Install Git for Windows
  echo        ^(it includes Git Bash^) or use WSL -- or just install a
  echo        released genealogy-mcp.mcpb instead of building it yourself.
  pause
  exit /b 1
)

cd ..
call bash scripts/build-mcpb.sh
set RC=%errorlevel%

echo.
if "%RC%"=="0" (
  echo Built releases\genealogy-mcp.mcpb. Install it in Claude Desktop, then
  echo fully quit and reopen Desktop.
) else (
  echo Build failed ^(exit %RC%^). Scroll up for the error.
)
pause
