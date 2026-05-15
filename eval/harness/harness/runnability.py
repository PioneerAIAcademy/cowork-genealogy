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
from harness.loader import TestSpec
from harness.rubric import InvalidRubricError, parse_rubric
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

    for fixture in spec.mcp_fixtures:
        fpath = Path(fixtures_dir) / f"{fixture}.json"
        if not fpath.exists():
            return RunnabilityResult(False, f"fixture not found: {fpath}")

    skill_path = Path(skills_dir) / spec.skill
    if not skill_path.is_dir():
        return RunnabilityResult(False, f"skill not found: {skill_path}")

    # Validate negative.correct_skill entries — typos silently produce
    # unsatisfiable tests (Claude can route correctly and the test
    # still fails). Catch them at gate time.
    if spec.type == "negative" and spec.negative:
        for i, name in enumerate(spec.negative.get("correct_skill", []) or []):
            if not (Path(skills_dir) / name).is_dir():
                return RunnabilityResult(
                    False,
                    f"negative.correct_skill[{i}]='{name}' is not an "
                    f"existing skill (no directory at {skills_dir}/{name})",
                )

    rubric_path = Path(tests_dir) / spec.skill / "rubric.md"
    if not rubric_path.exists():
        return RunnabilityResult(False, f"rubric.md not found: {rubric_path}")
    try:
        rubric = parse_rubric(rubric_path.read_text())
    except InvalidRubricError as e:
        return RunnabilityResult(False, f"rubric.md is malformed: {e}")

    # Spec §7: skills with `allowed-tools` should include a tool-usage
    # rubric dimension. Pre-v1.8 this was a hard runnability gate with
    # substring-keyword matching against dimension names — but legit
    # phrasings like "Search quality" for search-records would block
    # the test. v1.8 demotes this to a per-run warning surfaced in
    # `output.warnings` when (skill called MCP tools) AND (no rubric
    # dimension has a tool-usage keyword). See orchestrator._build_warnings.
    # The gate stays only for the obvious case of an empty rubric.
    if not rubric.dimensions:
        return RunnabilityResult(
            False, f"skill '{spec.skill}' has no rubric dimensions"
        )

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
