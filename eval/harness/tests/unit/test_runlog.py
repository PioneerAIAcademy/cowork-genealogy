"""Tests for harness.runlog v2 — per-test entries + multi-test envelopes."""

import json
from pathlib import Path

import pytest

from harness.runlog import (
    JudgeResult,
    RunlogAssemblyError,
    RunlogCollisionError,
    SingleRun,
    ValidatorResult,
    aggregate_dimensions,
    aggregate_per_run_outcome,
    assemble_test_entry,
    build_run_log,
    derive_activated,
    validate_run_log,
    write_run_log,
)


def _stub_judge():
    return JudgeResult(
        skipped=False,
        dimensions=[
            {"source": "base", "name": "Correctness", "score": 3, "rationale": "looks good"},
            {"source": "base", "name": "Completeness", "score": 3, "rationale": "complete"},
            {"source": "rubric", "name": "Query formulation", "score": 3, "rationale": "ok"},
        ],
        judge_cost_usd=0.001,
    )


def _stub_run(outcome="pass", validators_passed=True, judge=None, activated=True,
              skills_invoked=None):
    return SingleRun(
        outcome=outcome,
        aborted_reason=None,
        duration_ms=1234.5,
        input_tokens=1000,
        cached_input_tokens=800,
        output_tokens=200,
        skill_cost_usd=0.01,
        output={
            "text_response": "I called the wiki tool and saved the file.",
            "activated": activated,
            "skills_invoked": skills_invoked or ["wiki-lookup"],
            "tool_calls": [],
            "files_created": ["schuylkill-county-pennsylvania.md"],
        },
        validators=ValidatorResult(
            passed=validators_passed,
            results=[{"name": "test_log_append_only", "passed": validators_passed,
                      "error": None}],
        ),
        judge=judge or _stub_judge(),
    )


def _make_entry(*, test_id="ut_wiki_lookup_001", expected_outcome="pass", runs=None,
                scenario=None, mcp_fixtures=None, timestamp="2026-05-18-10-30-00"):
    return assemble_test_entry(
        test_id=test_id,
        test_type="positive",
        expected_outcome=expected_outcome,
        scenario=scenario,
        mcp_fixtures=mcp_fixtures or [],
        runs=runs or [_stub_run()],
        timestamp_for_run_id=timestamp,
    )


def _wrap_envelope(entry, *, skill="wiki-lookup", version=1, releasable=True,
                   invocation="skill", timestamp="2026-05-18-10-30-00",
                   snapshot=None, judge_prompt_hash="b" * 64):
    return build_run_log(
        skill=skill,
        version=version,
        released=False,
        releasable=releasable,
        invocation=invocation,
        timestamp=timestamp,
        harness_version="0.2.0",
        model="claude-sonnet-4-6",
        judge_prompt_hash=judge_prompt_hash,
        snapshot=snapshot or {},
        tests=[entry],
    )


# ---- assemble_test_entry behaviors ---------------------------------------


def test_assembles_passing_entry():
    entry = _make_entry()
    assert entry["outcome"] == "pass"
    assert entry["flaky"] is False
    assert entry["outcome_summary"]["per_run_outcomes"] == ["pass"]
    assert entry["totals"]["input_tokens"] == 1000
    assert entry["totals"]["total_cost_usd"] == pytest.approx(0.011)


def test_validators_failed_entry():
    judge = JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)
    entry = _make_entry(runs=[_stub_run(outcome="fail", validators_passed=False, judge=judge)])
    assert entry["outcome"] == "fail"
    assert entry["runs"][0]["judge"]["skipped"] is True


def test_aborted_entry():
    judge = JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)
    run = SingleRun(
        outcome="aborted",
        aborted_reason="not_runnable",
        duration_ms=0,
        input_tokens=0,
        cached_input_tokens=0,
        output_tokens=0,
        skill_cost_usd=0.0,
        output={"text_response": "", "activated": False, "skills_invoked": [],
                "tool_calls": [], "files_created": []},
        validators=ValidatorResult(passed=None, results=[]),
        judge=judge,
    )
    entry = _make_entry(runs=[run])
    assert entry["outcome"] == "aborted"


def test_xfail_remap_failing_run_becomes_xfail():
    judge = JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)
    entry = _make_entry(
        expected_outcome="xfail",
        runs=[_stub_run(outcome="fail", validators_passed=False, judge=judge)],
    )
    assert entry["outcome"] == "xfail"
    assert entry["outcome_summary"]["per_run_outcomes"] == ["fail"]


def test_xfail_remap_passing_run_becomes_xpass():
    entry = _make_entry(expected_outcome="xfail")
    assert entry["outcome"] == "xpass"


def test_xfail_does_not_remap_aborted_runs():
    judge = JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)
    run = SingleRun(
        outcome="aborted", aborted_reason="max_turns", duration_ms=0,
        input_tokens=0, cached_input_tokens=0, output_tokens=0, skill_cost_usd=0.0,
        output={"text_response": "", "activated": False, "skills_invoked": [],
                "tool_calls": [], "files_created": []},
        validators=ValidatorResult(passed=None, results=[]),
        judge=judge,
    )
    entry = _make_entry(expected_outcome="xfail", runs=[run])
    assert entry["outcome"] == "aborted"


def test_judge_error_recorded_on_entry():
    judge = JudgeResult(
        skipped=True, dimensions=[], judge_cost_usd=0.0,
        error="JudgeError: missing tool_use in response",
    )
    entry = _make_entry(runs=[_stub_run(outcome="fail", validators_passed=True, judge=judge)])
    assert entry["runs"][0]["judge"]["skipped"] is True
    assert "missing tool_use" in entry["runs"][0]["judge"]["error"]


def test_flaky_true_when_outcomes_differ():
    runs = [
        _stub_run(outcome="pass"),
        _stub_run(outcome="fail", validators_passed=False,
                  judge=JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)),
    ]
    entry = _make_entry(runs=runs)
    assert entry["flaky"] is True
    assert entry["outcome"] == "fail"  # tie breaks down


def test_flaky_false_when_all_outcomes_match():
    runs = [_stub_run(outcome="pass") for _ in range(3)]
    entry = _make_entry(runs=runs)
    assert entry["flaky"] is False
    assert entry["outcome"] == "pass"


# ---- aggregate helpers ---------------------------------------------------


def test_aggregate_per_run_outcome():
    assert aggregate_per_run_outcome(["pass"]) == "pass"
    assert aggregate_per_run_outcome(["pass", "pass", "fail"]) == "pass"
    assert aggregate_per_run_outcome(["pass", "partial", "fail"]) == "fail"
    assert aggregate_per_run_outcome(["pass", "partial"]) == "partial"
    assert aggregate_per_run_outcome(["pass", "pass", "aborted"]) == "aborted"


def test_aggregate_dimensions_modal():
    """Modal across runs; ties resolve down."""
    def _r(dims):
        return SingleRun(
            outcome="pass", aborted_reason=None, duration_ms=0,
            input_tokens=0, cached_input_tokens=0, output_tokens=0, skill_cost_usd=0.0,
            output={"text_response": "", "activated": True, "skills_invoked": [],
                    "tool_calls": [], "files_created": []},
            validators=ValidatorResult(passed=True, results=[]),
            judge=JudgeResult(skipped=False, dimensions=dims, judge_cost_usd=0.0),
        )

    runs = [
        _r([{"source": "base", "name": "Correctness", "score": 3, "rationale": "x"}]),
        _r([{"source": "base", "name": "Correctness", "score": 3, "rationale": "x"}]),
        _r([{"source": "base", "name": "Correctness", "score": 1, "rationale": "y"}]),
    ]
    agg = aggregate_dimensions(runs)
    assert len(agg) == 1
    assert agg[0]["score"] == 3


# ---- build_run_log + validate --------------------------------------------


def test_envelope_validates():
    log = _wrap_envelope(_make_entry())
    validate_run_log(log)
    assert log["schema_version"] == 2
    assert log["skill"] == "wiki-lookup"
    assert log["version"] == 1
    assert log["released"] is False
    assert log["releasable"] is True
    assert log["invocation"] == "skill"
    assert log["totals"]["total_cost_usd"] == pytest.approx(0.011)


def test_envelope_scratch_run_validates():
    log = _wrap_envelope(_make_entry(), version=None, releasable=False, invocation="test")
    validate_run_log(log)
    assert log["version"] is None
    assert log["releasable"] is False


def test_envelope_totals_sum_across_tests():
    e1 = _make_entry(test_id="ut_001")
    e2 = _make_entry(test_id="ut_002")
    log = build_run_log(
        skill="wiki-lookup",
        version=1,
        released=False,
        releasable=True,
        invocation="skill",
        timestamp="2026-05-18-10-30-00",
        harness_version="0.2.0",
        model="claude-sonnet-4-6",
        judge_prompt_hash="b" * 64,
        snapshot={},
        tests=[e1, e2],
    )
    # Sum is 2× single-test totals.
    assert log["totals"]["input_tokens"] == 2 * e1["totals"]["input_tokens"]
    assert log["totals"]["total_cost_usd"] == pytest.approx(2 * e1["totals"]["total_cost_usd"])
    validate_run_log(log)


# ---- write_run_log -------------------------------------------------------


def test_write_to_skill_directory(tmp_path: Path):
    log = _wrap_envelope(_make_entry())
    path = write_run_log(log, runlogs_root=tmp_path, filename="v1_2026-05-18-10-30-00.json")
    assert path.parent == tmp_path / "unit" / "wiki-lookup"
    assert path.name == "v1_2026-05-18-10-30-00.json"
    loaded = json.loads(path.read_text())
    assert loaded["skill"] == "wiki-lookup"


def test_write_collision_raises(tmp_path: Path):
    log = _wrap_envelope(_make_entry())
    write_run_log(log, runlogs_root=tmp_path, filename="v1_2026-05-18-10-30-00.json")
    with pytest.raises(RunlogCollisionError):
        write_run_log(log, runlogs_root=tmp_path, filename="v1_2026-05-18-10-30-00.json")


def test_write_spills_large_text_response_to_sidecar(tmp_path: Path):
    """Per-run text_response >100KB is spilled to runs/<run_id>.text.md."""
    big = "x" * 150_000
    run = _stub_run()
    run.output["text_response"] = big
    log = _wrap_envelope(_make_entry(runs=[run]))
    path = write_run_log(log, runlogs_root=tmp_path, filename="v1_2026-05-18-10-30-00.json")
    loaded = json.loads(path.read_text())
    text_field = loaded["tests"][0]["runs"][0]["output"]["text_response"]
    assert isinstance(text_field, dict)
    assert "ref" in text_field
    sidecar = path.parent / text_field["ref"]
    assert sidecar.read_text() == big
