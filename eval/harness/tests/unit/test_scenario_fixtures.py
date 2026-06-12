"""Lint: every shared scenario fixture under `eval/fixtures/scenarios/`
must be schema-valid.

The harness runnability gate (`harness.runnability.check_runnable`)
validates a scenario's `research.json` **and** `tree.gedcomx.json`
against the project schemas before running any test that references the
scenario. A fixture that drifts from the schema — e.g. when a new
required field is added to `research.schema.json` but the fixtures are
not migrated — silently makes every test using that scenario un-runnable
at harness runtime.

No other unit test loads these fixtures, so without this lint the drift
only surfaces when someone runs `run_tests.py`. This test pins the same
schema contract the runnability gate enforces, but as a fast,
network-free unit test that runs in CI.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from harness.schema_validator import (
    validate_research_json,
    validate_tree_gedcomx_json,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
SCENARIOS_DIR = REPO_ROOT / "eval" / "fixtures" / "scenarios"
TESTS_DIR = REPO_ROOT / "eval" / "tests"


def _scenario_dirs() -> list[Path]:
    dirs = sorted(
        p for p in SCENARIOS_DIR.glob("*") if (p / "research.json").exists()
    )
    assert dirs, (
        f"No scenario fixtures found under {SCENARIOS_DIR}. Check the "
        "fixtures directory layout."
    )
    return dirs


def _intentionally_invalid_scenarios(tests_dir: Path = TESTS_DIR) -> set[str]:
    """Scenario names referenced by tests that set `intentionally_invalid`.

    These scenarios are broken on purpose (a validator/guardrail skill must
    be able to run against invalid input), so the schema-validity lint must
    exempt them. The per-test flag stays the single source of truth — this
    lint reads it from the tests rather than introducing a per-scenario
    marker.
    """
    invalid: set[str] = set()
    for f in tests_dir.rglob("*.json"):
        try:
            raw = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(raw, dict) and raw.get("intentionally_invalid") is True:
            scenario = (raw.get("input") or {}).get("scenario")
            if isinstance(scenario, str) and scenario:
                invalid.add(scenario)
    return invalid


INTENTIONALLY_INVALID_SCENARIOS = _intentionally_invalid_scenarios()


@pytest.mark.parametrize("scenario", _scenario_dirs(), ids=lambda p: p.name)
def test_scenario_research_json_is_schema_valid(scenario: Path) -> None:
    if scenario.name in INTENTIONALLY_INVALID_SCENARIOS:
        pytest.skip(
            f"{scenario.name} is broken on purpose (referenced by an "
            "intentionally_invalid test)"
        )
    path = scenario / "research.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_research_json(data)
    assert errors == [], (
        f"{path.relative_to(REPO_ROOT)} fails research.schema.json "
        "validation:\n  - " + "\n  - ".join(errors)
    )


@pytest.mark.parametrize("scenario", _scenario_dirs(), ids=lambda p: p.name)
def test_scenario_tree_gedcomx_json_is_schema_valid(scenario: Path) -> None:
    if scenario.name in INTENTIONALLY_INVALID_SCENARIOS:
        pytest.skip(
            f"{scenario.name} is broken on purpose (referenced by an "
            "intentionally_invalid test)"
        )
    path = scenario / "tree.gedcomx.json"
    if not path.exists():
        pytest.skip(f"{scenario.name} has no tree.gedcomx.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_tree_gedcomx_json(data)
    assert errors == [], (
        f"{path.relative_to(REPO_ROOT)} fails tree.gedcomx schema "
        "validation:\n  - " + "\n  - ".join(errors)
    )


def test_intentionally_invalid_scenarios_reads_the_flag(tmp_path) -> None:
    tests_dir = tmp_path / "tests" / "some-skill"
    tests_dir.mkdir(parents=True)
    # A flagged test contributes its scenario; an unflagged one does not.
    (tests_dir / "flagged.json").write_text(
        json.dumps(
            {
                "input": {"scenario": "broken-on-purpose"},
                "intentionally_invalid": True,
            }
        ),
        encoding="utf-8",
    )
    (tests_dir / "normal.json").write_text(
        json.dumps({"input": {"scenario": "perfectly-fine"}}),
        encoding="utf-8",
    )
    result = _intentionally_invalid_scenarios(tmp_path / "tests")
    assert result == {"broken-on-purpose"}
