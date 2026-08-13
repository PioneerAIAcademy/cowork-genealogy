@echo off
REM Windows equivalent of: make cowork-install
REM Builds BOTH the .mcpb extension and the Cowork plugin .zip, then prints install instructions
setlocal
cd /d "%~dp0.."

echo [cowork-install] Building .mcpb extension...
node scripts\build-mcpb.mjs
if errorlevel 1 ( echo ERROR: mcpb build failed & exit /b 1 )

echo [cowork-install] Building plugin .zip...
node scripts\package-plugin.mjs
if errorlevel 1 ( echo ERROR: plugin build failed & exit /b 1 )

echo.
echo === Built. Now install BOTH, then fully quit and reopen Claude Desktop ===
echo.
echo 1. MCP server (.mcpb):  Claude Desktop -^> Settings -^> Extensions -^>
echo    Advanced Settings -^> Install extension -^> releases\genealogy-mcp.mcpb
echo    (install straight over the old copy -- no uninstall needed)
echo.
echo 2. Plugin (.zip):  Claude Desktop -^> COWORK tab -^> Customize -^>
echo    REMOVE any existing Genealogy Research plugin, then Add -^> Upload
echo    Plugin -^> releases\genealogy-plugin.zip
echo    (the Cowork tab and the Code tab keep separate plugin lists)
echo.
echo 3. Fully QUIT and reopen Claude Desktop.
echo.
if exist "releases\genealogy-mcp.mcpb"   dir /b "releases\genealogy-mcp.mcpb"
if exist "releases\genealogy-plugin.zip" dir /b "releases\genealogy-plugin.zip"
