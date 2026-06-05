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


def _scenario_dirs() -> list[Path]:
    dirs = sorted(
        p for p in SCENARIOS_DIR.glob("*") if (p / "research.json").exists()
    )
    assert dirs, (
        f"No scenario fixtures found under {SCENARIOS_DIR}. Check the "
        "fixtures directory layout."
    )
    return dirs


@pytest.mark.parametrize("scenario", _scenario_dirs(), ids=lambda p: p.name)
def test_scenario_research_json_is_schema_valid(scenario: Path) -> None:
    path = scenario / "research.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_research_json(data)
    assert errors == [], (
        f"{path.relative_to(REPO_ROOT)} fails research.schema.json "
        "validation:\n  - " + "\n  - ".join(errors)
    )


@pytest.mark.parametrize("scenario", _scenario_dirs(), ids=lambda p: p.name)
def test_scenario_tree_gedcomx_json_is_schema_valid(scenario: Path) -> None:
    path = scenario / "tree.gedcomx.json"
    if not path.exists():
        pytest.skip(f"{scenario.name} has no tree.gedcomx.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_tree_gedcomx_json(data)
    assert errors == [], (
        f"{path.relative_to(REPO_ROOT)} fails tree.gedcomx schema "
        "validation:\n  - " + "\n  - ".join(errors)
    )
