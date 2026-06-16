@echo off
cd %~dp0

echo === Cowork Genealogy E2E — Seed a judge-calibration case ===
echo.
echo Turns a real e2e run into a calibration-case stub (the judge's grades
echo pre-filled, the `human` block blank for you to correct). Run a fixture
echo first so it has a run log.
echo.
set /p SLUG="Which fixture (slug) did you run? (e.g. kenneth-quass-death): "
if "%SLUG%"=="" (
  echo No fixture entered. Aborting.
  pause
  exit /b 1
)
set /p WHO="Your name/initials (used in the case filename): "
if "%WHO%"=="" set WHO=ungraded

cd harness
call uv run python -m e2e.seed_calibration_case --test %SLUG% --who %WHO%

echo.
echo Now open the case file under eval\tests\e2e\calibration\cases\ and fill
echo in the `human` block (compare the agent's tree to expected-findings),
echo then run RunCalibration.bat. Commit your case file via GitHub Desktop.
pause
