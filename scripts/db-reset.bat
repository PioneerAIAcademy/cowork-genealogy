@echo off
REM Windows equivalent of: make db-reset
REM Wipes the local SQLite DB and sandbox dirs (schema rebuilds on next server start)
setlocal
cd /d "%~dp0.."
if exist ".workbench-data\workbench.db" del /f ".workbench-data\workbench.db"
if exist ".workbench-data\sandboxes" (
    for /d %%d in (".workbench-data\sandboxes\*") do rmdir /s /q "%%d"
)
echo Done -- local DB and sandbox dirs reset. Restart the server to recreate the schema.
