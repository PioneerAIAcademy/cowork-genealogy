@echo off
cd %~dp0

echo === Cowork Genealogy E2E — Stripping linter ===
echo.
echo Checks that every expected finding is genuinely ABSENT from the
echo fixture's starting tree. WARN lines are findings that may not have
echo been stripped — review each before committing.
echo.
set /p SLUG="Which fixture (slug) to check? (blank = all fixtures): "

cd harness
if "%SLUG%"=="" (
  call uv run python -m e2e.validate_fixture --all
) else (
  call uv run python -m e2e.validate_fixture %SLUG%
)

echo.
echo Done.
pause
