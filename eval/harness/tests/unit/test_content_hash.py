"""Tests for harness.content_hash — the resolved-test SHA-256 used for
cross-PR comparison (see docs/plan/per-pr-review-workflow.md §2.4)."""

import json
from pathlib import Path

import pytest

from harness.content_hash import compute_test_content_hash


# A minimal but realistic test JSON, used as the base for hash-stability tests.
_BASE_TEST = {
    "test": {
        "id": "ut_x_001",
        "skill": "wiki-lookup",
        "name": "simple lookup",
        "type": "positive",
        "description": "1-2 sentences",
        "tags": ["wikipedia"],
    },
    "input": {
        "user_message": "Look up Schuylkill County, Pennsylvania",
        "scenario": None,
    },
    "additional_criteria": ["Should save the summary to a markdown file"],
    "mcp_fixtures": ["wikipedia-schuylkill-county"],
}


def _write_fixture(dir_: Path, name: str, body: dict) -> None:
    (dir_ / f"{name}.json").write_text(json.dumps(body))


def _make_dirs(tmp_path: Path) -> tuple[Path, Path]:
    scenarios_dir = tmp_path / "scenarios"
    fixtures_dir = tmp_path / "fixtures"
    scenarios_dir.mkdir()
    fixtures_dir.mkdir()
    return scenarios_dir, fixtures_dir


# --- Stability -----------------------------------------------------------


def test_hash_stable_across_calls(tmp_path):
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    _write_fixture(fixtures_dir, "wikipedia-schuylkill-county", {"tool": "wiki", "response": {"x": 1}})

    h1 = compute_test_content_hash(
        _BASE_TEST, None, ["wikipedia-schuylkill-county"], scenarios_dir, fixtures_dir,
    )
    h2 = compute_test_content_hash(
        _BASE_TEST, None, ["wikipedia-schuylkill-county"], scenarios_dir, fixtures_dir,
    )
    assert h1 == h2
    assert len(h1) == 64
    assert all(c in "0123456789abcdef" for c in h1)


def test_hash_stable_across_key_order(tmp_path):
    """Reordering keys in the test JSON or the fixture file must not change
    the hash — canonical JSON normalizes key order."""
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)

    fixture_a = {"tool": "wiki", "response": {"a": 1, "b": 2}, "description": "ordered"}
    fixture_b = {"description": "ordered", "response": {"b": 2, "a": 1}, "tool": "wiki"}
    _write_fixture(fixtures_dir, "f", fixture_a)
    h1 = compute_test_content_hash(_BASE_TEST, None, ["f"], scenarios_dir, fixtures_dir)
    _write_fixture(fixtures_dir, "f", fixture_b)
    h2 = compute_test_content_hash(_BASE_TEST, None, ["f"], scenarios_dir, fixtures_dir)
    assert h1 == h2


def test_hash_stable_across_whitespace(tmp_path):
    """Pretty-printed vs minified fixture JSON must hash the same."""
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)

    pretty = {"tool": "wiki", "response": {"x": 1}}
    (fixtures_dir / "f.json").write_text(json.dumps(pretty, indent=4))
    h1 = compute_test_content_hash(_BASE_TEST, None, ["f"], scenarios_dir, fixtures_dir)
    (fixtures_dir / "f.json").write_text(json.dumps(pretty, separators=(",", ":")))
    h2 = compute_test_content_hash(_BASE_TEST, None, ["f"], scenarios_dir, fixtures_dir)
    assert h1 == h2


# --- Cosmetic-field exclusion -------------------------------------------


def test_cosmetic_name_change_does_not_affect_hash(tmp_path):
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    h1 = compute_test_content_hash(_BASE_TEST, None, [], scenarios_dir, fixtures_dir)
    edited = json.loads(json.dumps(_BASE_TEST))
    edited["test"]["name"] = "different name"
    h2 = compute_test_content_hash(edited, None, [], scenarios_dir, fixtures_dir)
    assert h1 == h2


def test_cosmetic_description_change_does_not_affect_hash(tmp_path):
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    h1 = compute_test_content_hash(_BASE_TEST, None, [], scenarios_dir, fixtures_dir)
    edited = json.loads(json.dumps(_BASE_TEST))
    edited["test"]["description"] = "rewritten description entirely"
    h2 = compute_test_content_hash(edited, None, [], scenarios_dir, fixtures_dir)
    assert h1 == h2


def test_cosmetic_tags_change_does_not_affect_hash(tmp_path):
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    h1 = compute_test_content_hash(_BASE_TEST, None, [], scenarios_dir, fixtures_dir)
    edited = json.loads(json.dumps(_BASE_TEST))
    edited["test"]["tags"] = ["totally", "different", "tags"]
    h2 = compute_test_content_hash(edited, None, [], scenarios_dir, fixtures_dir)
    assert h1 == h2


# --- Grading-relevant-field inclusion -----------------------------------


def test_user_message_change_changes_hash(tmp_path):
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    h1 = compute_test_content_hash(_BASE_TEST, None, [], scenarios_dir, fixtures_dir)
    edited = json.loads(json.dumps(_BASE_TEST))
    edited["input"]["user_message"] = "Look up a different topic entirely"
    h2 = compute_test_content_hash(edited, None, [], scenarios_dir, fixtures_dir)
    assert h1 != h2


def test_additional_criteria_change_changes_hash(tmp_path):
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    h1 = compute_test_content_hash(_BASE_TEST, None, [], scenarios_dir, fixtures_dir)
    edited = json.loads(json.dumps(_BASE_TEST))
    edited["additional_criteria"] = ["A different criterion"]
    h2 = compute_test_content_hash(edited, None, [], scenarios_dir, fixtures_dir)
    assert h1 != h2


def test_negative_block_change_changes_hash(tmp_path):
    """Even though _BASE_TEST is positive, adding a `negative` block to test
    serialization captures it. Used here to verify exclusion logic only
    touches name/description/tags."""
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    edited_a = json.loads(json.dumps(_BASE_TEST))
    edited_a["test"]["type"] = "negative"
    edited_a["negative"] = {"correct_skill": ["search-records"], "explanation": "x"}
    edited_b = json.loads(json.dumps(edited_a))
    edited_b["negative"]["correct_skill"] = ["record-extraction"]
    ha = compute_test_content_hash(edited_a, None, [], scenarios_dir, fixtures_dir)
    hb = compute_test_content_hash(edited_b, None, [], scenarios_dir, fixtures_dir)
    assert ha != hb


def test_execution_block_change_changes_hash(tmp_path):
    """The exclusion-based phrasing means execution.max_turns participates
    in the hash even though it's not in the §2.4 'inclusion' shortlist."""
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    h1 = compute_test_content_hash(_BASE_TEST, None, [], scenarios_dir, fixtures_dir)
    edited = json.loads(json.dumps(_BASE_TEST))
    edited["execution"] = {"max_turns": 50}
    h2 = compute_test_content_hash(edited, None, [], scenarios_dir, fixtures_dir)
    assert h1 != h2


# --- Scenario sensitivity -----------------------------------------------


def test_scenario_contents_change_changes_hash(tmp_path):
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    scenario = scenarios_dir / "flynn"
    scenario.mkdir()
    (scenario / "research.json").write_text(json.dumps({"project": {"id": "rp_001"}, "questions": []}))
    (scenario / "tree.gedcomx.json").write_text(json.dumps({"persons": [], "relationships": [], "sources": []}))
    h1 = compute_test_content_hash(_BASE_TEST, "flynn", [], scenarios_dir, fixtures_dir)

    (scenario / "research.json").write_text(json.dumps({"project": {"id": "rp_002"}, "questions": []}))
    h2 = compute_test_content_hash(_BASE_TEST, "flynn", [], scenarios_dir, fixtures_dir)
    assert h1 != h2


def test_scenario_readme_change_does_not_affect_hash(tmp_path):
    """README is documentation, not state — explicitly excluded."""
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    scenario = scenarios_dir / "flynn"
    scenario.mkdir()
    (scenario / "research.json").write_text(json.dumps({"project": {"id": "rp_001"}}))
    (scenario / "tree.gedcomx.json").write_text(json.dumps({"persons": []}))
    (scenario / "README.md").write_text("Initial description.")
    h1 = compute_test_content_hash(_BASE_TEST, "flynn", [], scenarios_dir, fixtures_dir)

    (scenario / "README.md").write_text("Totally rewritten description.")
    h2 = compute_test_content_hash(_BASE_TEST, "flynn", [], scenarios_dir, fixtures_dir)
    assert h1 == h2


def test_missing_scenario_marker(tmp_path):
    """A scenario that doesn't exist hashes as <missing-scenario:name>; later
    creating the directory changes the hash."""
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    h1 = compute_test_content_hash(_BASE_TEST, "ghost", [], scenarios_dir, fixtures_dir)

    (scenarios_dir / "ghost").mkdir()
    (scenarios_dir / "ghost" / "research.json").write_text(json.dumps({"project": {"id": "rp_001"}}))
    h2 = compute_test_content_hash(_BASE_TEST, "ghost", [], scenarios_dir, fixtures_dir)
    assert h1 != h2


def test_partial_scenario_files(tmp_path):
    """A scenario with only research.json (no tree.gedcomx.json) still
    hashes deterministically; adding tree.gedcomx.json changes the hash."""
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    scenario = scenarios_dir / "flynn"
    scenario.mkdir()
    (scenario / "research.json").write_text(json.dumps({"project": {"id": "rp_001"}}))
    h1 = compute_test_content_hash(_BASE_TEST, "flynn", [], scenarios_dir, fixtures_dir)

    (scenario / "tree.gedcomx.json").write_text(json.dumps({"persons": []}))
    h2 = compute_test_content_hash(_BASE_TEST, "flynn", [], scenarios_dir, fixtures_dir)
    assert h1 != h2


# --- Fixture sensitivity -------------------------------------------------


def test_fixture_contents_change_changes_hash(tmp_path):
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    _write_fixture(fixtures_dir, "f", {"tool": "wiki", "response": {"x": 1}})
    h1 = compute_test_content_hash(_BASE_TEST, None, ["f"], scenarios_dir, fixtures_dir)

    _write_fixture(fixtures_dir, "f", {"tool": "wiki", "response": {"x": 2}})
    h2 = compute_test_content_hash(_BASE_TEST, None, ["f"], scenarios_dir, fixtures_dir)
    assert h1 != h2


def test_fixture_order_changes_hash(tmp_path):
    """Fixture order matters — the harness's queue-mode dispatch consumes
    fixtures in declared order, so reordering changes runtime behavior."""
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    _write_fixture(fixtures_dir, "a", {"tool": "wiki", "response": {"x": 1}})
    _write_fixture(fixtures_dir, "b", {"tool": "wiki", "response": {"x": 2}})

    h1 = compute_test_content_hash(_BASE_TEST, None, ["a", "b"], scenarios_dir, fixtures_dir)
    h2 = compute_test_content_hash(_BASE_TEST, None, ["b", "a"], scenarios_dir, fixtures_dir)
    assert h1 != h2


def test_missing_fixture_marker(tmp_path):
    """A fixture that doesn't exist hashes as <missing-fixture:name>; later
    creating it changes the hash."""
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    h1 = compute_test_content_hash(_BASE_TEST, None, ["ghost"], scenarios_dir, fixtures_dir)

    _write_fixture(fixtures_dir, "ghost", {"tool": "x", "response": {}})
    h2 = compute_test_content_hash(_BASE_TEST, None, ["ghost"], scenarios_dir, fixtures_dir)
    assert h1 != h2


# --- No-input edge cases ------------------------------------------------


def test_no_scenario_no_fixtures(tmp_path):
    """Stateless skills with no MCP tools — minimal input still hashes
    deterministically and differs from any cross-PR variant."""
    scenarios_dir, fixtures_dir = _make_dirs(tmp_path)
    h = compute_test_content_hash(_BASE_TEST, None, [], scenarios_dir, fixtures_dir)
    assert len(h) == 64
    # An empty raw dict should hash to something different.
    h2 = compute_test_content_hash({}, None, [], scenarios_dir, fixtures_dir)
    assert h != h2
