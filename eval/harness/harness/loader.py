"""Load and validate unit-test JSON files against unit-test.schema.json."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import jsonschema


HARNESS_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = HARNESS_DIR.parents[1]
SCHEMA_PATH = REPO_ROOT / "docs/specs/schemas/unit-test.schema.json"


class InvalidTestError(Exception):
    """Raised when a test file is missing, unreadable, or fails schema validation."""


@dataclass
class TestSpec:
    __test__ = False  # tell pytest not to collect this as a test class

    id: str
    skill: str
    name: str
    type: str
    description: str
    tags: list[str]
    user_message: str
    scenario: str | None
    scenario_notes: str | None
    mcp_fixtures: list[str]
    judge_context: list[str]
    negative: dict[str, Any] | None
    expected_outcome: str
    xfail_reason: str | None
    runs_per_test: int
    execution: dict[str, int]
    intentionally_invalid: bool = False
    judge_reads_files: bool = False
    source_path: Path | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@lru_cache(maxsize=1)
def _schema() -> dict[str, Any]:
    if not SCHEMA_PATH.exists():
        raise InvalidTestError(f"unit-test schema not found at {SCHEMA_PATH}")
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def load_test(path: Path) -> TestSpec:
    """Load a unit-test JSON file from disk and return a validated TestSpec."""
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as e:
        raise InvalidTestError(f"test file not found: {path}") from e
    except json.JSONDecodeError as e:
        raise InvalidTestError(f"test file is not valid JSON: {path}: {e}") from e
    spec = load_test_from_dict(raw)
    spec.source_path = Path(path)
    return spec


def load_test_from_dict(raw: dict[str, Any]) -> TestSpec:
    """Validate an in-memory dict against the schema and return a TestSpec."""
    try:
        jsonschema.validate(raw, _schema())
    except jsonschema.ValidationError as e:
        raise InvalidTestError(f"test fails schema validation: {e.message}") from e

    test = raw["test"]
    input_block = raw["input"]
    return TestSpec(
        id=test["id"],
        skill=test["skill"],
        name=test["name"],
        type=test["type"],
        description=test["description"],
        tags=list(test.get("tags", [])),
        user_message=input_block["user_message"],
        scenario=input_block.get("scenario"),
        scenario_notes=input_block.get("scenario_notes"),
        mcp_fixtures=list(raw.get("mcp_fixtures", [])),
        judge_context=list(raw.get("judge_context", [])),
        negative=raw.get("negative"),
        expected_outcome=test.get("expected_outcome", "pass"),
        xfail_reason=test.get("xfail_reason"),
        runs_per_test=int(raw.get("runs_per_test", 1)),
        execution=dict(raw.get("execution", {})),
        intentionally_invalid=bool(raw.get("intentionally_invalid", False)),
        judge_reads_files=bool(raw.get("judge_reads_files", False)),
        raw=raw,
    )
