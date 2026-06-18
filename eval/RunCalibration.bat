@echo off
cd %~dp0

echo === Cowork Genealogy E2E — Judge calibration ===
echo.
echo Runs ONLY the judge against the committed per-run annotations and
echo reports how often it agrees with the human graders. Cheap (no agent,
echo no live FamilySearch) — run it whenever the judge prompt or model
echo changes. Target: at least 80%% per-finding recall agreement.
echo.

cd harness
call uv run python -m e2e.calibrate_judge

echo.
echo Done. Inspect every disagreement printed above — those are the signal.
pause
