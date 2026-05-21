"""Pre-flight runnability gate per unit-test-spec.md §9.

Block a test from executing when:
- scenario_notes is a non-empty string (test author flagged a state gap)
- the referenced scenario directory doesn't exist
- any referenced fixture is missing
- the scenario's research.json or tree.gedcomx.json fails to JSON-parse
  OR fails schema validation per spec §9
- the skill directory doesn't exist
- the skill's rubric.md is missing or malformed
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from harness.allowed_tools import load_skill_frontmatter
from harness.fixtures import InvalidFixtureError, build_manifest, load_fixtures
from harness.loader import TestSpec
from harness.rubric import InvalidRubricError, parse_rubric_or_empty
from harness.schema_validator import (
    validate_research_json,
    validate_tree_gedcomx_json,
)


@dataclass
class RunnabilityResult:
    runnable: bool
    reason: str | None


def check_runnable(
    spec: TestSpec,
    *,
    scenarios_dir: Path,
    fixtures_dir: Path,
    skills_dir: Path,
    tests_dir: Path,
) -> RunnabilityResult:
    if spec.scenario_notes and spec.scenario_notes.strip():
        return RunnabilityResult(False, "test has non-empty scenario_notes — scenario doesn't match")

    if spec.scenario is not None:
        scenario_path = Path(scenarios_dir) / spec.scenario
        if not scenario_path.is_dir():
            return RunnabilityResult(False, f"scenario directory not found: {scenario_path}")
        for fname, validator in (
            ("research.json", validate_research_json),
            ("tree.gedcomx.json", validate_tree_gedcomx_json),
        ):
            f = scenario_path / fname
            if not f.exists():
                continue
            try:
                data = json.loads(f.read_text())
            except json.JSONDecodeError as e:
                return RunnabilityResult(
                    False, f"scenario {fname} is not valid JSON: {e}"
                )
            schema_errors = validator(data)
            if schema_errors:
                # Surface the first few to keep the message scannable; the
                # full list lives in the run log when this gate aborts.
                preview = "; ".join(schema_errors[:3])
                more = f" (and {len(schema_errors) - 3} more)" if len(schema_errors) > 3 else ""
                return RunnabilityResult(
                    False,
                    f"scenario {fname} fails schema validation: {preview}{more}",
                )

    # Single parse + validate path: load_fixtures handles missing-file +
    # JSON-decode errors; build_manifest enforces required non-empty `args`.
    # Reusing them here means the gate and the mock server share the same
    # validation surface — no drift between gate-time and run-time errors.
    if spec.mcp_fixtures:
        try:
            fixtures = load_fixtures(spec.mcp_fixtures, Path(fixtures_dir))
            build_manifest(fixtures)
        except InvalidFixtureError as e:
            return RunnabilityResult(False, str(e))

    skill_path = Path(skills_dir) / spec.skill
    if not skill_path.is_dir():
        return RunnabilityResult(False, f"skill not found: {skill_path}")

    # Validate negative.correct_skill entries — typos silently produce
    # unsatisfiable tests (Claude can route correctly and the test
    # still fails). Catch them at gate time. xfail tests are exempt: an
    # xfail test is an explicitly declared known-failing test, so a
    # correct_skill naming a not-yet-built skill is the documented
    # reason for the xfail (see xfail_reason), not a typo to catch.
    if spec.type == "negative" and spec.negative and spec.expected_outcome != "xfail":
        for i, name in enumerate(spec.negative.get("correct_skill", []) or []):
            if not (Path(skills_dir) / name).is_dir():
                return RunnabilityResult(
                    False,
                    f"negative.correct_skill[{i}]='{name}' is not an "
                    f"existing skill (no directory at {skills_dir}/{name})",
                )

    rubric_path = Path(tests_dir) / spec.skill / "rubric.md"
    # Rubric is opt-in per unit-test-spec-v2.md: a missing or empty file
    # is fine — the skill is graded on base dimensions only. A present-
    # but-malformed file is still a runnability failure (it's a typo,
    # not an opt-out).
    try:
        parse_rubric_or_empty(
            spec.skill,
            rubric_path.read_text() if rubric_path.exists() else None,
        )
    except InvalidRubricError as e:
        return RunnabilityResult(False, f"rubric.md is malformed: {e}")

    return RunnabilityResult(True, None)


# Substring match (case-insensitive) against each rubric dimension's
# `name`. Authors phrase tool-coverage dimensions various ways; the
# common ones we accept. Used by orchestrator._build_warnings to emit a
# non-blocking advisory when the skill called MCP tools but no dimension
# names suggest tool-usage coverage.
TOOL_DIMENSION_KEYWORDS = (
    "tool usage", "tool use", "tool work", "tool call",
    "argument quality", "argument-quality",
    "response interpretation", "tool selection",
    "mcp tool", "fixture",
)


def has_tool_usage_dimension(dimensions) -> bool:
    for d in dimensions:
        name_lower = d.name.lower()
        if any(kw in name_lower for kw in TOOL_DIMENSION_KEYWORDS):
            return True
    return False
