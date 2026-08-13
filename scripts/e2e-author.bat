@echo off
REM Windows equivalent of: make e2e-author ARGS="<args>"
REM Fixture-authoring script: snapshot, strip, scaffold, validate
REM Usage: scripts\e2e-author.bat snapshot --slug foo --pid ABCD-123
REM   or:  set ARGS=snapshot --slug foo --pid ABCD-123  then  scripts\e2e-author.bat
setlocal

if not "%~1"=="" set ARGS=%*
if "%ARGS%"=="" (
    echo Usage: scripts\e2e-author.bat ^<args^>
    echo   e.g.: scripts\e2e-author.bat snapshot --slug foo --pid ABCD-123
    echo         scripts\e2e-author.bat --help
    exit /b 1
)

cd /d "%~dp0.."
cd eval\harness
uv run python -m e2e.author %ARGS%
