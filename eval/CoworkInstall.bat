@echo off
cd %~dp0

echo === Cowork Genealogy - Build BOTH artifacts for Cowork ===
echo.
echo Builds releases\genealogy-mcp.mcpb (the tools, runs on your machine) AND
echo releases\genealogy-plugin.zip (the skills and agents Cowork runs), then
echo prints exactly where to install each one.
echo.
echo Installing only ONE of the two is the most common way to lose an hour to a
echo /research that is really just running stale code. Do both, every time an
echo MCP tool or a skill changes.
echo.
echo Same as "make cowork-install" on Mac. Runs the two Node build scripts. No
echo bash or zip needed -- just Node 22.9+ and npm 11.12 (README, "Building from source").
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: 'node' was not found on PATH. Install Node.js, or run Setup.bat
  echo        first -- the eval setup installs the dependencies this needs.
  pause
  exit /b 1
)

cd ..

echo --- Building the MCP server (.mcpb) ---
call node scripts\build-mcpb.mjs
if errorlevel 1 (
  echo.
  echo Build FAILED on the .mcpb. Scroll up for the error; nothing was installed.
  pause
  exit /b 1
)

echo.
echo --- Building the Cowork plugin (.zip) ---
call node scripts\package-plugin.mjs
if errorlevel 1 (
  echo.
  echo Build FAILED on the plugin .zip. The .mcpb above did build, but install
  echo BOTH or neither -- a half install is worse than none.
  pause
  exit /b 1
)

echo.
echo === Built. Now install BOTH, then fully quit and reopen Claude Desktop ===
echo.
echo 1. MCP server ^(.mcpb^): Claude Desktop -^> Settings -^> Desktop app -^>
echo    Extensions: Manage -^> Advanced settings -^> Install extension -^>
echo    releases\genealogy-mcp.mcpb -^> Install, then Install again.
echo    Old copy installed? The window offers only Uninstall: click it,
echo    confirm, then Install. That also removes the OpenRouter key; paste
echo    it again under Configure.
echo.
echo 2. Plugin ^(.zip^): Claude Desktop -^> Customize -^> Plugins -^>
echo    REMOVE any existing Genealogy Research plugin ^(... -^> Remove^),
echo    then + Add -^> Upload plugin -^> releases\genealogy-plugin.zip -^> Upload
echo.
echo 3. Fully QUIT and reopen Claude Desktop.
echo.
pause
