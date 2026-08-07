@echo off
REM Windows equivalent of: make gate-skill SKILL=<name> TEST=<id> [DIMENSION=<dim>]
REM Gates a SKILL.md edit vs its step-4 run-log baseline (advisory, writes no run-logs)
REM Usage: set SKILL=tree-edit & set TEST=ut_tree_edit_007 & scripts\gate-skill.bat
setlocal

if "%SKILL%"=="" (
    echo ERROR: set SKILL, e.g. set SKILL=tree-edit
    exit /b 1
)
if "%TEST%"=="" (
    echo ERROR: set TEST, e.g. set TEST=ut_tree_edit_007
    exit /b 1
)

set DIM_FLAG=
if not "%DIMENSION%"=="" set DIM_FLAG=--dimension "%DIMENSION%"

cd /d "%~dp0.."
call "%~dp0engine-build.bat"
if errorlevel 1 exit /b 1
cd eval\harness
uv run python skill_gate.py --skill %SKILL% --test %TEST% %DIM_FLAG%
