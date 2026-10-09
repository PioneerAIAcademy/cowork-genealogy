"""Tests for the judge-regrade target (issue #2479 PR 1).

The important invariants, all testable WITHOUT a model call:

1. `render_judge_prompt_for_test` reads the judge prompt from disk every time
   (bypasses `judge.judge_prompt_template()`'s @lru_cache). A regression that
   caches a stored prompt would certify a prose-only judge edit as a no-op
   without noticing — these tests catch that at $0.
2. The renderer is deterministic: same inputs render byte-identical twice.
3. A rubric edit moves every prompt hash in that skill's log; a scenario edit
   moves only its referencing tests; a SKILL.md edit moves nothing (the judge
   prompt doesn't embed SKILL.md).
4. `collect_regradeable_logs` includes active-but-mismatched logs AND returns a
   `reason_refused` on skill-side-stale logs (which rule 2 owns).

The tests build minimal on-disk fixtures under `tmp_path` and monkeypatch
`judge_regrade`'s module-level path constants onto them — never editing the
real tree. That is the pattern that makes assertion 3 safe to run in CI.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from harness import judge
import judge_regrade


# --- Fixtures --------------------------------------------------------------


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _minimal_test_spec(scenario: str | None = None) -> dict:
    """Schema-valid skeleton — the loader validates against unit-test.schema.json."""
    inp: dict = {"user_message": "demo message"}
    if scenario:
        inp["scenario"] = scenario
    return {
        "test": {
            "id": "ut_demo_001",
            "skill": "demo",
            "name": "Demo test",
            "type": "positive",
            "description": "A minimal fixture used by the judge-regrade unit tests.",
            "tags": [],
        },
        "input": inp,
        "mcp_fixtures": [],
        "judge_context": ["check that output names the person"],
    }


def _minimal_run_log(skill: str = "demo", scenario: str | None = None) -> dict:
    """Minimal run log matching the real envelope shape (verified against
    `eval/runlogs/unit/citation/v*.json`): per-test uses `test_id` not `id`,
    and `activated`/`skills_invoked`/`text_response`/`tool_calls`/`file_changes`/
    `builtin_tool_calls`/`warnings` are all nested under `output`."""
    return {
        "schema_version": 3,
        "skill": skill,
        "version": 1,
        "released": False,
        "releasable": True,
        "invocation": "skill",
        "timestamp": "2026-10-09_00-00-00",
        "harness_version": "0.1.0",
        "model": "claude-sonnet-4-5",
        "judge_prompt_hash": "a" * 64,  # STALE on purpose
        "snapshot": {},  # empty → diff_snapshot_vs_disk returns {} → active
        "tests": [
            {
                "test_id": "ut_demo_001",
                "outcome": "pass",
                "runs": [
                    {
                        "run_index": 0,
                        "aborted_reason": None,
                        "outcome": "pass",
                        "judge_skipped": False,
                        "output": {
                            "activated": True,
                            "skills_invoked": ["demo"],
                            "text_response": "John Smith is the person.",
                            "tool_calls": [],
                            "file_changes": [],
                            "builtin_tool_calls": [],
                            "warnings": [],
                        },
                        "validators": {"passed": True, "results": []},
                        "judge": {
                            "dimensions": [
                                {"source": "base", "name": "Correctness", "score": 3, "rationale": "names the person"},
                            ],
                            "judge_cost_usd": 0.01,
                            "input_tokens": 100,
                            "cached_input_tokens": 0,
                            "output_tokens": 50,
                            "skipped": False,
                        },
                    }
                ],
            }
        ],
        "totals": {},
    }


@pytest.fixture
def disk_tree(tmp_path, monkeypatch):
    """Build a minimal on-disk corpus and point judge_regrade at it."""
    repo = tmp_path / "repo"
    tests_unit = repo / "eval" / "tests" / "unit" / "demo"
    scenarios = repo / "eval" / "fixtures" / "scenarios" / "demo-scenario"
    mcp_fixtures = repo / "eval" / "fixtures" / "mcp"
    runlogs = repo / "eval" / "runlogs" / "unit" / "demo"
    judge_prompt_dir = repo / "eval" / "harness" / "judge"

    _write(
        tests_unit / "test-001.json",
        json.dumps(_minimal_test_spec(scenario="demo-scenario")),
    )
    _write(
        tests_unit / "rubric.md",
        "# demo\n\n## Demo dimension\n\n- **pass:** demo passes\n"
        "- **partial:** demo partial\n- **fail:** demo fails\n",
    )
    _write(scenarios / "README.md", "# Scenario README\n\nSome prose.\n")
    _write(scenarios / "research.json", "{}")
    _write(scenarios / "tree.gedcomx.json", "{}")
    _write(mcp_fixtures / "demo.json", json.dumps({"tool": "x", "args": {}, "response": {"ok": True}}))

    # Judge prompt — minimal but non-empty so JUDGE_PROMPT_PATH.read_text works.
    _write(
        judge_prompt_dir / "prompt.md",
        "# Judge prompt\n\n{rubric}\n\n{judge_context}\n\n{scenario_readme}\n\n"
        "{user_message}\n\n{skills_invoked}\n\n{text_response}\n\n"
        "{file_changes_summary}\n\n{tool_calls}\n\n{before_state}\n\n"
        "{validator_failures}\n\n{harness_observations}\n",
    )

    # Point module path constants onto the tmp tree.
    monkeypatch.setattr(judge_regrade, "REPO_ROOT", repo)
    monkeypatch.setattr(judge_regrade, "UNIT_RUNLOGS", runlogs.parent)
    monkeypatch.setattr(judge_regrade, "TESTS_UNIT", repo / "eval" / "tests" / "unit")
    monkeypatch.setattr(judge_regrade, "SCENARIOS", repo / "eval" / "fixtures" / "scenarios")
    monkeypatch.setattr(judge_regrade, "MCP_FIXTURES", mcp_fixtures)
    # judge.py uses its own JUDGE_PROMPT_PATH; redirect it AND clear the lru_cache.
    monkeypatch.setattr(judge, "JUDGE_PROMPT_PATH", judge_prompt_dir / "prompt.md")
    monkeypatch.setattr(
        judge_regrade, "JUDGE_PROMPT_PATH", judge_prompt_dir / "prompt.md"
    )
    judge.judge_prompt_template.cache_clear()

    yield {
        "repo": repo,
        "tests_unit": tests_unit,
        "scenarios": scenarios,
        "mcp_fixtures": mcp_fixtures,
        "runlogs": runlogs,
        "judge_prompt": judge_prompt_dir / "prompt.md",
    }

    # Clean cache state after the test too, so a later test seeing a different
    # judge prompt doesn't re-use this one's.
    judge.judge_prompt_template.cache_clear()


# --- Rendering: deterministic, reads from disk -----------------------------


def test_render_is_deterministic(disk_tree):
    """Two renders of the same inputs produce byte-identical text."""
    log = _minimal_run_log(scenario="demo-scenario")
    test_entry = log["tests"][0]
    run_entry = test_entry["runs"][0]
    a = judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    b = judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    assert a == b


def test_render_includes_on_disk_rubric_verbatim(disk_tree):
    """The rendered text embeds the rubric file's current bytes."""
    log = _minimal_run_log(scenario="demo-scenario")
    test_entry = log["tests"][0]
    run_entry = test_entry["runs"][0]
    rendered = judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    rubric_text = (disk_tree["tests_unit"] / "rubric.md").read_text(encoding="utf-8")
    # Rubric content is embedded (first line is a non-empty marker).
    assert rubric_text.splitlines()[0] in rendered


def test_rubric_edit_moves_prompt_hash(disk_tree):
    """Editing rubric.md moves the prompt hash — not caching anything stale."""
    log = _minimal_run_log(scenario="demo-scenario")
    test_entry = log["tests"][0]
    run_entry = test_entry["runs"][0]
    h0 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )

    rubric_path = disk_tree["tests_unit"] / "rubric.md"
    rubric_path.write_text(
        rubric_path.read_text(encoding="utf-8") + "\nextra line\n",
        encoding="utf-8",
    )
    h1 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )
    assert h0 != h1


def test_scenario_readme_edit_moves_prompt_hash(disk_tree):
    log = _minimal_run_log(scenario="demo-scenario")
    test_entry = log["tests"][0]
    run_entry = test_entry["runs"][0]
    h0 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )

    readme = disk_tree["scenarios"] / "README.md"
    readme.write_text(readme.read_text(encoding="utf-8") + "edit\n", encoding="utf-8")
    h1 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )
    assert h0 != h1


def test_judge_prompt_edit_moves_hash_without_rebuild(disk_tree):
    """Editing the judge prompt body itself must move the hash on the very next
    call — proves the disk read is NOT cached per invocation."""
    log = _minimal_run_log(scenario="demo-scenario")
    test_entry = log["tests"][0]
    run_entry = test_entry["runs"][0]
    h0 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )

    prompt_path = disk_tree["judge_prompt"]
    prompt_path.write_text(
        prompt_path.read_text(encoding="utf-8") + "\n# extra section\n",
        encoding="utf-8",
    )
    # Must also clear the module cache since judge.render_prompt_parts reads
    # via judge_prompt_template(). The regrader does this itself in
    # dry_run / regrade_run_log via the direct disk read on the hash side.
    judge.judge_prompt_template.cache_clear()
    h1 = judge_regrade.hash_rendered_prompt(
        judge_regrade.render_judge_prompt_for_test(log, test_entry, run_entry)
    )
    assert h0 != h1


# --- collect_regradeable_logs classification -------------------------------


def test_collect_classifies_active_mismatched_as_regradeable(disk_tree, monkeypatch):
    log = _minimal_run_log(scenario="demo-scenario")
    log_path = disk_tree["runlogs"] / "v1_2026-10-09_00-00-00.json"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(log), encoding="utf-8")

    # Current prompt hash is NOT "a" * 64, so the log reads as mismatched.
    targets = judge_regrade.collect_regradeable_logs(disk_tree["runlogs"].parent)
    assert len(targets) == 1
    t = targets[0]
    assert t.skill == "demo"
    assert t.reason_refused is None


def test_collect_refuses_skill_side_stale(disk_tree):
    """A log whose snapshot points at a missing file is skill-side stale."""
    log = _minimal_run_log(scenario="demo-scenario")
    log["snapshot"] = {"eval/__no_such_file__/x.md": "deadbeef" * 8}
    log_path = disk_tree["runlogs"] / "v1_2026-10-09_00-00-00.json"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(log), encoding="utf-8")

    targets = judge_regrade.collect_regradeable_logs(disk_tree["runlogs"].parent)
    assert len(targets) == 1
    t = targets[0]
    assert t.reason_refused is not None
    assert "skill-side" in t.reason_refused


def test_collect_skips_logs_already_on_current_prompt(disk_tree):
    log = _minimal_run_log(scenario="demo-scenario")
    log["judge_prompt_hash"] = judge.judge_prompt_hash()  # current
    log_path = disk_tree["runlogs"] / "v1_2026-10-09_00-00-00.json"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(log), encoding="utf-8")

    targets = judge_regrade.collect_regradeable_logs(disk_tree["runlogs"].parent)
    assert targets == []


# --- Warning dedupe (S3) ---------------------------------------------------


def test_strip_prior_coerced_warnings_removes_only_that_kind():
    warnings = [
        {"kind": "prose_observation", "observation": "keep"},
        {"kind": "coerced_routing_negative_to_na", "score_was": 1},
        {"kind": "prose_observation", "observation": "also keep"},
    ]
    out = judge_regrade._strip_prior_coerced_warnings(warnings)
    assert len(out) == 2
    assert all(w["kind"] == "prose_observation" for w in out)
