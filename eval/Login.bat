@echo off
cd %~dp0

echo === Cowork Genealogy E2E — FamilySearch login ===
echo.
echo Logs in to FamilySearch and saves a token to your home directory.
echo The token is shared by every e2e run and lasts ~24 hours, so this is
echo a once-per-day step, not something to do before each run. Your browser
echo will open for authorization.
echo.

cd ..\packages\engine\mcp-server
call npx tsx dev/e2e-login.ts

echo.
echo If login succeeded, run CheckSetup.bat to confirm you're ready.
pause
