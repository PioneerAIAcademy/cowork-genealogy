"""Tests for the partial (in-progress) run-log helpers — the Ctrl-C safety
net that keeps completed tests when a harness run is stopped part-way.

See docs/plan/eval-harness-stop-early.md.
"""

import json

import pytest

from harness.runlog import (
    JudgeResult,
    SingleRun,
    ValidatorResult,
    assemble_test_entry,
    build_run_log,
    partial_runlog_path,
    promote_partial_to_scratch,
    validate_run_log,
    write_partial_runlog,
)
from harness.versioning import classify


def _entry(test_id="ut_demo_001", outcome="pass"):
    run = SingleRun(
        outcome=outcome,
        aborted_reason=None,
        duration_ms=1000.0,
        input_tokens=100,
        cached_input_tokens=0,
        output_tokens=10,
        skill_cost_usd=0.01,
        output={
            "text_response": "did the thing",
            "activated": True,
            "skills_invoked": ["search-familysearch-wiki"],
            "tool_calls": [],
            "files_created": [],
        },
        validators=ValidatorResult(passed=True, results=[]),
        judge=JudgeResult(
            skipped=False,
            dimensions=[
                {"source": "base", "name": "Correctness", "score": 3, "rationale": "ok"},
                {"source": "base", "name": "Completeness", "score": 3, "rationale": "ok"},
                {"source": "base", "name": "Tool Arguments", "score": None,
                 "rationale": "no tool calls — N/A"},
            ],
            judge_cost_usd=0.001,
        ),
    )
    return assemble_test_entry(
        test_id=test_id,
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        runs=[run],
        timestamp_for_run_id="2026-06-28_10-00-00",
    )


def _envelope(entries):
    # A partial is always scratch-shaped: no version, not releasable.
    return build_run_log(
        skill="search-familysearch-wiki",
        version=None,
        released=False,
        releasable=False,
        invocation="skill",
        timestamp="2026-06-28_10-00-00",
        harness_version="0.2.0",
        model="claude-sonnet-4-6",
        judge_prompt_hash="a" * 64,
        snapshot={},
        tests=entries,
    )


TS = "2026-06-28_10-00-00"
SKILL = "search-familysearch-wiki"


def test_write_partial_creates_dotfile_thats_a_valid_envelope(tmp_path):
    log = _envelope([_entry()])
    out = write_partial_runlog(log, runlogs_root=tmp_path, skill=SKILL, timestamp=TS)

    assert out == partial_runlog_path(tmp_path, SKILL, TS)
    assert out.name == f".partial_{TS}.json"
    # Round-trips and still validates against the v2 schema.
    reloaded = json.loads(out.read_text(encoding="utf-8"))
    validate_run_log(reloaded)
    assert len(reloaded["tests"]) == 1


def test_partial_dotfile_is_not_classified_as_a_run_log():
    # The dotfile must stay invisible to version numbering / the release gate.
    assert classify(f".partial_{TS}.json").kind == "other"


def test_write_partial_overwrites_in_place_and_leaves_no_tmp(tmp_path):
    write_partial_runlog(_envelope([_entry("ut_a")]),
                         runlogs_root=tmp_path, skill=SKILL, timestamp=TS)
    out = write_partial_runlog(_envelope([_entry("ut_a"), _entry("ut_b")]),
                               runlogs_root=tmp_path, skill=SKILL, timestamp=TS)

    reloaded = json.loads(out.read_text(encoding="utf-8"))
    assert len(reloaded["tests"]) == 2  # second write replaced the first
    # The atomic-write staging file is gone.
    assert not (out.parent / (out.name + ".tmp")).exists()
    assert list(out.parent.glob(".partial_*")) == [out]


def test_promote_partial_to_scratch_renames(tmp_path):
    partial = write_partial_runlog(_envelope([_entry()]),
                                   runlogs_root=tmp_path, skill=SKILL, timestamp=TS)
    scratch = promote_partial_to_scratch(partial, timestamp=TS)

    assert scratch.name == f"scratch_{TS}.json"
    assert classify(scratch.name).kind == "scratch"
    assert not partial.exists()  # the dotfile was moved, not copied
    validate_run_log(json.loads(scratch.read_text(encoding="utf-8")))
