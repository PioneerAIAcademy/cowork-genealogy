"""Pre-flight runnability gate per unit-test-spec.md §9.

Block a test from executing when:
- scenario_notes is a non-empty string (test author flagged a state gap)
- the referenced scenario directory doesn't exist
- any referenced fixture is missing
- the scenario's research.json or tree.gedcomx.json fails to JSON-parse
  OR fails schema validation per spec §9 (unless the test sets
  `intentionally_invalid: true`, for validator skills that must run
  against broken-on-purpose scenarios)
- the skill directory doesn't exist
- the skill's rubric.md is missing or malformed
"""

from __future__ import annotations

import ast
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


# eval/harness/harness/runnability.py -> eval/harness/validators/
DEFAULT_VALIDATORS_DIR = Path(__file__).resolve().parent.parent / "validators"


@dataclass
class RunnabilityResult:
    runnable: bool
    reason: str | None


def tag_gated_validator_tags(validators_dir: Path, skill: str) -> set[str]:
    """Tags that gate an opt-in validator in the skill's validator file.

    Recognizes the repo-wide opt-in gate idiom — an `if` whose test is
    `"<tag>" not in test.get("tags", [])` and whose body calls
    `pytest.skip(...)`:

        if "no-browse-no-write" not in test.get("tags", []):
            pytest.skip("not a no-browse-no-write scenario")

    The tag check may be one operand of a compound condition, as in
    citation's `if test.get("type") != "positive" and "no-new-source" not
    in test.get("tags", []):`, so the whole `if` test is walked rather
    than shape-matched. Both `test.get("tags", [])` and
    `(test.get("tags") or [])` spellings are recognized.

    Only the `not in` direction counts. The inverse (`"<tag>" in tags` ->
    skip) is an *exclusion* gate — it turns a validator OFF for tagged
    tests (e.g. `redirect-no-browse`), so it can never be the invariant a
    grade_on_invariant test relies on.

    Static (ast) rather than by import: the validator modules declare
    pytest fixtures the harness injects by signature, so importing them
    here to introspect would drag in a fixture-resolution dependency the
    gate has no business owning.

    Returns an empty set when the file is absent or unparseable — the
    caller turns that into the same "no invariant validator" failure,
    which is the correct verdict either way.
    """
    path = Path(validators_dir) / f"test_{skill.replace('-', '_')}.py"
    if not path.exists():
        return set()
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError:
        return set()

    tags: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        if not any(
            isinstance(sub, ast.Call)
            and ast.unparse(sub.func).endswith("pytest.skip")
            for sub in ast.walk(node)
        ):
            continue
        for cmp_node in ast.walk(node.test):
            if not isinstance(cmp_node, ast.Compare):
                continue
            if len(cmp_node.ops) != 1 or not isinstance(cmp_node.ops[0], ast.NotIn):
                continue
            if not (
                isinstance(cmp_node.left, ast.Constant)
                and isinstance(cmp_node.left.value, str)
            ):
                continue
            if "tags" not in ast.unparse(cmp_node.comparators[0]):
                continue
            tags.add(cmp_node.left.value)
    return tags


def check_runnable(
    spec: TestSpec,
    *,
    scenarios_dir: Path,
    fixtures_dir: Path,
    skills_dir: Path,
    tests_dir: Path,
    validators_dir: Path = DEFAULT_VALIDATORS_DIR,
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
                data = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                return RunnabilityResult(
                    False, f"scenario {fname} is not valid JSON: {e}"
                )
            schema_errors = validator(data)
            # A test may declare its scenario broken on purpose (e.g. a
            # validator/guardrail skill that must detect invalid input). The
            # schema gate would otherwise wrongly abort it, so honour the flag.
            if schema_errors and not spec.intentionally_invalid:
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

        # `grade_on_invariant` hands the whole verdict to the test's
        # deterministic invariant validator(s): _compute_outcome returns
        # "pass" once nothing aborted and the validators passed. A tag
        # that reaches no validator therefore doesn't fail loudly — it
        # passes VACUOUSLY, green forever, asserting nothing. The spec
        # warns about it ("REQUIRES a tag-gated invariant validator that
        # actually runs; without one the pass is vacuous") but nothing
        # enforced it until now. Same failure mode and same gate-time
        # treatment as the correct_skill typo above.
        if spec.negative.get("grade_on_invariant"):
            gate_tags = tag_gated_validator_tags(validators_dir, spec.skill)
            matched = sorted(set(spec.tags or []) & gate_tags)
            if not matched:
                validator_file = (
                    f"{validators_dir}/test_{spec.skill.replace('-', '_')}.py"
                )
                return RunnabilityResult(
                    False,
                    "negative.grade_on_invariant is true but no invariant "
                    f"validator gates on any of this test's tags "
                    f"{sorted(spec.tags or [])} — the pass would be vacuous. "
                    f"Add a validator to {validator_file} opening with "
                    '`if "<tag>" not in test.get("tags", []): pytest.skip(...)`'
                    f", then tag the test with it. Tags currently gating a "
                    f"validator there: {sorted(gate_tags) or 'none'}",
                )

    rubric_path = Path(tests_dir) / spec.skill / "rubric.md"
    # Rubric is opt-in per unit-test-spec-v2.md: a missing or empty file
    # is fine — the skill is graded on base dimensions only. A present-
    # but-malformed file is still a runnability failure (it's a typo,
    # not an opt-out).
    try:
        parse_rubric_or_empty(
            spec.skill,
            rubric_path.read_text(encoding="utf-8") if rubric_path.exists() else None,
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
