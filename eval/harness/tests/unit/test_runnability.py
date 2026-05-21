"""Tests for harness.runnability — the §9 pre-flight gate."""

import json
from pathlib import Path

import pytest

from harness.loader import TestSpec, load_test_from_dict
from harness.runnability import check_runnable


REPO_ROOT = Path(__file__).resolve().parents[4]
SCENARIOS = REPO_ROOT / "eval/fixtures/scenarios"
FIXTURES = REPO_ROOT / "eval/fixtures/mcp"
SKILLS = REPO_ROOT / "plugin/skills"
TESTS = REPO_ROOT / "eval/tests/unit"


def _runnable_test_dict():
    return {
        "test": {
            "id": "ut_runnability_001",
            "skill": "search-wikipedia",
            "name": "rn",
            "type": "positive",
            "description": "x",
            "tags": [],
        },
        "input": {"user_message": "look it up", "scenario": None},
        "mcp_fixtures": ["wikipedia-search-schuylkill-county"],
        "judge_context": [],
    }


def test_happy_path_runnable():
    spec = load_test_from_dict(_runnable_test_dict())
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is True
    assert result.reason is None


def test_blocks_when_scenario_notes_non_empty():
    d = _runnable_test_dict()
    d["input"]["scenario_notes"] = "need a variant where..."
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "scenario_notes" in result.reason


def test_blocks_when_scenario_missing():
    d = _runnable_test_dict()
    d["input"]["scenario"] = "nope-not-real"
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "scenario" in result.reason


def test_blocks_when_fixture_missing():
    d = _runnable_test_dict()
    d["mcp_fixtures"] = ["nope"]
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "fixture" in result.reason


def test_blocks_when_fixture_missing_args(tmp_path):
    """Fixtures must declare a non-empty `args` block — required for
    dispatch and Tool Arguments grading. The gate catches authors who
    forget to add it."""
    fake_fixtures = tmp_path / "fixtures"
    fake_fixtures.mkdir()
    (fake_fixtures / "noargs.json").write_text(
        '{"tool": "wikipedia_search", "description": "x", "response": {"title": "X"}}'
    )
    d = _runnable_test_dict()
    d["mcp_fixtures"] = ["noargs"]
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=fake_fixtures,
        skills_dir=SKILLS, tests_dir=TESTS,
    )
    assert result.runnable is False
    assert "args" in result.reason


def test_blocks_when_fixture_args_empty(tmp_path):
    fake_fixtures = tmp_path / "fixtures"
    fake_fixtures.mkdir()
    (fake_fixtures / "emptyargs.json").write_text(
        '{"tool": "wikipedia_search", "description": "x", "args": {},'
        ' "response": {"title": "X"}}'
    )
    d = _runnable_test_dict()
    d["mcp_fixtures"] = ["emptyargs"]
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=fake_fixtures,
        skills_dir=SKILLS, tests_dir=TESTS,
    )
    assert result.runnable is False
    assert "args" in result.reason


def test_blocks_when_skill_missing():
    d = _runnable_test_dict()
    d["test"]["skill"] = "imaginary-skill"
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "skill" in result.reason


def test_runnable_when_rubric_missing(tmp_path):
    """Rubric is opt-in per unit-test-spec-v2.md. A missing rubric.md is
    NOT a runnability failure — the skill is graded on base dimensions
    only."""
    fake_tests = tmp_path / "tests"
    (fake_tests / "search-wikipedia").mkdir(parents=True)
    # no rubric.md
    spec = load_test_from_dict(_runnable_test_dict())
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=fake_tests)
    assert result.runnable is True


def test_runnable_when_rubric_empty(tmp_path):
    """An empty rubric.md is equivalent to a missing one — base dims only."""
    fake_tests = tmp_path / "tests"
    (fake_tests / "search-wikipedia").mkdir(parents=True)
    (fake_tests / "search-wikipedia" / "rubric.md").write_text("")
    spec = load_test_from_dict(_runnable_test_dict())
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=fake_tests)
    assert result.runnable is True


def test_blocks_when_rubric_malformed(tmp_path):
    fake_tests = tmp_path / "tests"
    (fake_tests / "search-wikipedia").mkdir(parents=True)
    (fake_tests / "search-wikipedia" / "rubric.md").write_text("no proper structure here")
    spec = load_test_from_dict(_runnable_test_dict())
    result = check_runnable(spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=fake_tests)
    assert result.runnable is False
    assert "rubric" in result.reason


def test_runnable_when_mcp_skill_has_non_keyword_dimension_name(tmp_path):
    """v1.8 relaxed: the runnability gate no longer blocks based on
    tool-usage-keyword match against dimension names. A rubric whose
    author named the dimension "Search quality" rather than "Tool usage"
    runs fine; if the skill actually calls MCP tools and no keyword-matching
    dimension exists, the orchestrator emits a `warnings` entry instead
    of failing the gate."""
    fake_skills = tmp_path / "skills"
    fake_tests = tmp_path / "tests"
    (fake_skills / "search-records-clone").mkdir(parents=True)
    (fake_skills / "search-records-clone" / "SKILL.md").write_text(
        "---\nname: search-records-clone\nallowed-tools:\n  - record_search\n---\n# Search\n"
    )
    (fake_tests / "search-records-clone").mkdir(parents=True)
    (fake_tests / "search-records-clone" / "rubric.md").write_text(
        "# search-records-clone\n\n## Search quality\n\n"
        "- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
    )
    d = _runnable_test_dict()
    d["test"]["skill"] = "search-records-clone"
    d["mcp_fixtures"] = []
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES,
        skills_dir=fake_skills, tests_dir=fake_tests,
    )
    assert result.runnable is True


def test_blocks_when_negative_correct_skill_has_typo(tmp_path):
    """Spec: a typo in negative.correct_skill silently produces an
    unsatisfiable test — Claude can route correctly and still fail.
    The gate must catch this."""
    d = _runnable_test_dict()
    d["test"]["type"] = "negative"
    d["negative"] = {
        "correct_skill": ["search-record"],  # typo: missing 's'
        "explanation": "x",
    }
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=SCENARIOS, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS,
    )
    assert result.runnable is False
    assert "search-record" in result.reason
    assert "not an existing skill" in result.reason


def test_blocks_when_scenario_research_json_fails_schema(tmp_path):
    """Spec §9: scenario must pass schema validation, not just JSON parse."""
    fake_scenarios = tmp_path / "scenarios"
    (fake_scenarios / "schemabad").mkdir(parents=True)
    # Parseable JSON, but missing required project fields.
    (fake_scenarios / "schemabad" / "research.json").write_text(
        '{"project": {"id": "rp_1"}, "questions": [], "plans": [],'
        ' "log": [], "sources": [], "assertions": [], "person_evidence": [],'
        ' "conflicts": [], "hypotheses": [], "timelines": [],'
        ' "proof_summaries": []}'
    )
    (fake_scenarios / "schemabad" / "tree.gedcomx.json").write_text(
        '{"persons":[],"relationships":[],"sources":[]}'
    )
    d = _runnable_test_dict()
    d["input"]["scenario"] = "schemabad"
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=fake_scenarios, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS,
    )
    assert result.runnable is False
    assert "schema" in result.reason.lower()


def test_blocks_when_scenario_tree_gedcomx_json_fails_schema(tmp_path):
    """Spec §9: scenario's tree.gedcomx.json must also pass schema
    validation, not just JSON-parse. Earlier coverage tested research.json
    only; tree.gedcomx.json is the parallel case."""
    fake_scenarios = tmp_path / "scenarios"
    (fake_scenarios / "treebad").mkdir(parents=True)
    # Valid research.json so the test reaches the tree check.
    (fake_scenarios / "treebad" / "research.json").write_text(
        '{"project": {"id": "rp_1", "objective": "x", "status": "active",'
        ' "created": "2026-01-01", "updated": "2026-01-01"},'
        ' "questions": [], "plans": [], "log": [], "sources": [],'
        ' "assertions": [], "person_evidence": [], "conflicts": [],'
        ' "hypotheses": [], "timelines": [], "proof_summaries": []}'
    )
    # Parseable JSON but missing the required `persons` array.
    (fake_scenarios / "treebad" / "tree.gedcomx.json").write_text(
        '{"relationships": [], "sources": []}'
    )
    d = _runnable_test_dict()
    d["input"]["scenario"] = "treebad"
    spec = load_test_from_dict(d)
    result = check_runnable(
        spec, scenarios_dir=fake_scenarios, fixtures_dir=FIXTURES,
        skills_dir=SKILLS, tests_dir=TESTS,
    )
    assert result.runnable is False
    assert "schema" in result.reason.lower()
    assert "tree.gedcomx.json" in result.reason


def test_blocks_when_scenario_research_json_invalid(tmp_path):
    # Build a fake scenarios dir with an invalid research.json
    fake_scenarios = tmp_path / "scenarios"
    (fake_scenarios / "broken").mkdir(parents=True)
    (fake_scenarios / "broken" / "research.json").write_text("{ not json")
    (fake_scenarios / "broken" / "tree.gedcomx.json").write_text('{"persons":[],"relationships":[],"sources":[]}')
    d = _runnable_test_dict()
    d["input"]["scenario"] = "broken"
    spec = load_test_from_dict(d)
    result = check_runnable(spec, scenarios_dir=fake_scenarios, fixtures_dir=FIXTURES, skills_dir=SKILLS, tests_dir=TESTS)
    assert result.runnable is False
    assert "research.json" in result.reason or "scenario" in result.reason
