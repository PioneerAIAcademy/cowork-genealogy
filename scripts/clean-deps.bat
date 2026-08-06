@echo off
REM Windows equivalent of: make clean-deps
REM Removes ALL node_modules so the next install is from scratch
setlocal
cd /d "%~dp0.."
echo Removing node_modules...
for %%d in (
    node_modules
    packages\engine\mcp-server\node_modules
    eval\app\node_modules
) do (
    if exist "%%d" (
        echo   removing %%d
        rmdir /s /q "%%d"
    )
)
REM Also remove pnpm workspace package node_modules
for /d %%d in (packages\*\node_modules apps\*\node_modules) do (
    if exist "%%d" ( echo   removing %%d & rmdir /s /q "%%d" )
)
echo Done. Run scripts\install.bat to reinstall from scratch.
