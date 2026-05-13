"""Tests for harness.runlog — assembly and schema validation of run logs."""

import json
from pathlib import Path

import pytest

from harness.runlog import (
    JudgeResult,
    RunlogAssemblyError,
    SingleRun,
    ValidatorResult,
    aggregate_per_run_outcome,
    assemble_run_log,
    derive_activated,
    validate_run_log,
)


def _stub_judge():
    return JudgeResult(
        skipped=False,
        dimensions=[
            {"source": "base", "name": "Correctness", "score": "pass", "rationale": "looks good"},
            {"source": "base", "name": "Completeness", "score": "pass", "rationale": "complete"},
            {"source": "rubric", "name": "Query formulation", "score": "pass", "rationale": "ok"},
        ],
        judge_cost_usd=0.001,
    )


def _stub_run(outcome="pass", validators_passed=True, judge=None, activated=True, skills_invoked=None):
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
            results=[{"name": "test_log_append_only", "passed": validators_passed, "error": None}],
        ),
        judge=judge or _stub_judge(),
    )


def test_assembles_passing_run_log():
    run = _stub_run()
    log = assemble_run_log(
        test_id="ut_wiki_lookup_001",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=["wikipedia-schuylkill-county"],
        harness_version="0.1.0",
        model="claude-sonnet-4-6-20250514",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=[run],
    )
    assert log["outcome"] == "pass"
    assert log["flaky"] is False
    assert log["outcome_summary"]["per_run_outcomes"] == ["pass"]
    assert log["totals"]["input_tokens"] == 1000
    assert log["totals"]["total_cost_usd"] == pytest.approx(0.011)
    validate_run_log(log)  # must pass schema validation


def test_validators_failed_run_log():
    judge = JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)
    run = _stub_run(outcome="fail", validators_passed=False, judge=judge)
    log = assemble_run_log(
        test_id="ut_wiki_lookup_001",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6-20250514",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=[run],
    )
    assert log["outcome"] == "fail"
    assert log["runs"][0]["judge"]["skipped"] is True
    validate_run_log(log)


def test_aborted_run_log():
    judge = JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)
    run = SingleRun(
        outcome="aborted",
        aborted_reason="not_runnable",
        duration_ms=0,
        input_tokens=0,
        cached_input_tokens=0,
        output_tokens=0,
        skill_cost_usd=0.0,
        output={
            "text_response": "",
            "activated": False,
            "skills_invoked": [],
            "tool_calls": [],
            "files_created": [],
        },
        validators=ValidatorResult(passed=False, results=[]),
        judge=judge,
    )
    log = assemble_run_log(
        test_id="ut_wiki_lookup_001",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6-20250514",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=[run],
    )
    assert log["outcome"] == "aborted"
    validate_run_log(log)


def test_xfail_remap_failing_run_becomes_xfail():
    judge = JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)
    run = _stub_run(outcome="fail", validators_passed=False, judge=judge)
    log = assemble_run_log(
        test_id="ut_x_001",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="xfail",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=[run],
    )
    assert log["outcome"] == "xfail"
    # Per-run outcome stays "fail"; only the aggregated outcome flips.
    assert log["outcome_summary"]["per_run_outcomes"] == ["fail"]
    validate_run_log(log)


def test_xfail_remap_passing_run_becomes_xpass():
    run = _stub_run(outcome="pass")
    log = assemble_run_log(
        test_id="ut_x_002",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="xfail",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=[run],
    )
    assert log["outcome"] == "xpass"
    validate_run_log(log)


def test_xfail_does_not_remap_aborted_runs():
    judge = JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)
    run = SingleRun(
        outcome="aborted",
        aborted_reason="max_turns",
        duration_ms=0,
        input_tokens=0,
        cached_input_tokens=0,
        output_tokens=0,
        skill_cost_usd=0.0,
        output={
            "text_response": "",
            "activated": False,
            "skills_invoked": [],
            "tool_calls": [],
            "files_created": [],
        },
        validators=ValidatorResult(passed=False, results=[]),
        judge=judge,
    )
    log = assemble_run_log(
        test_id="ut_x_003",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="xfail",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=[run],
    )
    assert log["outcome"] == "aborted"
    validate_run_log(log)


def test_judge_error_recorded_and_validates():
    """When the judge fails, the run records skipped=true + error message,
    and the run log still validates against the schema."""
    judge = JudgeResult(
        skipped=True,
        dimensions=[],
        judge_cost_usd=0.0,
        error="JudgeError: missing tool_use in response",
    )
    run = _stub_run(outcome="fail", validators_passed=True, judge=judge)
    log = assemble_run_log(
        test_id="ut_x_005",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=[run],
    )
    assert log["runs"][0]["judge"]["skipped"] is True
    assert "missing tool_use" in log["runs"][0]["judge"]["error"]
    validate_run_log(log)


def test_aborted_reason_error_validates():
    judge = JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0)
    run = SingleRun(
        outcome="aborted",
        aborted_reason="error",
        duration_ms=0,
        input_tokens=0,
        cached_input_tokens=0,
        output_tokens=0,
        skill_cost_usd=0.0,
        output={
            "text_response": "(crash)",
            "activated": False,
            "skills_invoked": [],
            "tool_calls": [],
            "files_created": [],
        },
        validators=ValidatorResult(passed=False, results=[]),
        judge=judge,
    )
    log = assemble_run_log(
        test_id="ut_x_004",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=[run],
    )
    # Must validate against the schema with "error" as a valid aborted_reason.
    validate_run_log(log)


def test_aggregate_per_run_outcome_single_run():
    assert aggregate_per_run_outcome(["pass"]) == "pass"
    assert aggregate_per_run_outcome(["fail"]) == "fail"
    assert aggregate_per_run_outcome(["aborted"]) == "aborted"


def test_aggregate_per_run_outcome_modal_two_pass_one_fail():
    """Modal: 2 pass + 1 fail = pass (matches the dashboard signal)."""
    assert aggregate_per_run_outcome(["pass", "pass", "fail"]) == "pass"
    assert aggregate_per_run_outcome(["pass", "fail", "pass"]) == "pass"


def test_aggregate_per_run_outcome_three_way_split_collapses_down():
    """Three-way split: no mode → tie among all 3 → tie-break to lowest (fail)."""
    assert aggregate_per_run_outcome(["pass", "partial", "fail"]) == "fail"


def test_aggregate_per_run_outcome_tied_partial_pass_collapses_to_partial():
    """Tied: 1 partial + 1 pass → tie-break down to partial."""
    assert aggregate_per_run_outcome(["pass", "partial"]) == "partial"


def test_aggregate_per_run_outcome_aborted_dominates():
    """Any aborted → aborted, regardless of mode."""
    assert aggregate_per_run_outcome(["pass", "pass", "aborted"]) == "aborted"
    assert aggregate_per_run_outcome(["aborted"]) == "aborted"


def test_flaky_true_when_outcomes_differ():
    judge = _stub_judge()
    runs = [_stub_run(outcome="pass", judge=judge), _stub_run(outcome="fail",
            validators_passed=False, judge=JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0))]
    log = assemble_run_log(
        test_id="ut_multi_001",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=runs,
    )
    assert log["flaky"] is True
    # Modal of [pass, fail] is a tie, breaks down to fail.
    assert log["outcome"] == "fail"


def test_flaky_false_when_all_outcomes_match():
    judge = _stub_judge()
    runs = [_stub_run(outcome="pass", judge=judge) for _ in range(3)]
    log = assemble_run_log(
        test_id="ut_multi_002",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=runs,
    )
    assert log["flaky"] is False
    assert log["outcome"] == "pass"


def test_aggregate_dimensions_modal_across_runs():
    """Aggregated dimensions take the modal score per (source, name)."""
    from harness.runlog import aggregate_dimensions

    def _make_run(name_score: list[tuple[str, str, str]]) -> SingleRun:
        dims = [
            {"source": s, "name": n, "score": sc, "rationale": f"r-{sc}"}
            for s, n, sc in name_score
        ]
        return SingleRun(
            outcome="pass",
            aborted_reason=None,
            duration_ms=0,
            input_tokens=0,
            cached_input_tokens=0,
            output_tokens=0,
            skill_cost_usd=0.0,
            output={"text_response": "", "activated": True, "skills_invoked": [],
                    "tool_calls": [], "files_created": []},
            validators=ValidatorResult(passed=True, results=[]),
            judge=JudgeResult(skipped=False, dimensions=dims, judge_cost_usd=0.0),
        )

    runs = [
        _make_run([("base", "Correctness", "pass"), ("rubric", "Foo", "pass")]),
        _make_run([("base", "Correctness", "pass"), ("rubric", "Foo", "fail")]),
        _make_run([("base", "Correctness", "fail"), ("rubric", "Foo", "fail")]),
    ]
    agg = aggregate_dimensions(runs)
    by_name = {(d["source"], d["name"]): d for d in agg}
    # Correctness: 2 pass, 1 fail → modal pass
    assert by_name[("base", "Correctness")]["score"] == "pass"
    # Foo: 1 pass, 2 fail → modal fail
    assert by_name[("rubric", "Foo")]["score"] == "fail"


def test_aggregate_dimensions_skipped_runs_ignored():
    from harness.runlog import aggregate_dimensions
    skipped = SingleRun(
        outcome="aborted", aborted_reason="max_turns",
        duration_ms=0, input_tokens=0, cached_input_tokens=0, output_tokens=0,
        skill_cost_usd=0.0,
        output={"text_response": "", "activated": False, "skills_invoked": [],
                "tool_calls": [], "files_created": []},
        validators=ValidatorResult(passed=False, results=[]),
        judge=JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0),
    )
    assert aggregate_dimensions([skipped]) == []


def test_large_text_response_spills_to_sidecar(tmp_path):
    """Spec §10: text_response > 100 KB goes to a sidecar file with a
    {"ref": "..."} reference in the run log."""
    from harness.runlog import write_run_log

    big_text = "X" * 200_000  # 200 KB
    run = _stub_run()
    run.output["text_response"] = big_text
    log = assemble_run_log(
        test_id="ut_wiki_lookup_001",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=[run],
    )
    path = write_run_log(log, runlogs_root=tmp_path)

    loaded = json.loads(path.read_text())
    text_field = loaded["runs"][0]["output"]["text_response"]
    assert isinstance(text_field, dict)
    assert text_field["ref"].startswith("runs/")

    # The sidecar file actually exists with the full text.
    sidecar = path.parent / text_field["ref"]
    assert sidecar.exists()
    assert sidecar.read_text() == big_text


def test_small_text_response_stays_inline(tmp_path):
    from harness.runlog import write_run_log

    run = _stub_run()
    run.output["text_response"] = "Just a small text response."
    log = assemble_run_log(
        test_id="ut_wiki_lookup_001",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=[run],
    )
    path = write_run_log(log, runlogs_root=tmp_path)
    loaded = json.loads(path.read_text())
    text_field = loaded["runs"][0]["output"]["text_response"]
    assert text_field == "Just a small text response."


def test_writes_to_disk_in_expected_path(tmp_path):
    from harness.runlog import write_run_log

    run = _stub_run()
    log = assemble_run_log(
        test_id="ut_wiki_lookup_001",
        skill="wiki-lookup",
        test_type="positive",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        harness_version="0.1.0",
        model="claude-sonnet-4-6-20250514",
        judge_model="claude-haiku-4-5-20251001",
        rubric_hash="a" * 64,
        judge_prompt_hash="b" * 64,
        runs=[run],
    )
    path = write_run_log(log, runlogs_root=tmp_path)
    assert path.exists()
    assert "wiki-lookup" in str(path)
    assert "claude-sonnet-4-6-20250514" in str(path)
    assert path.suffix == ".json"
    loaded = json.loads(path.read_text())
    assert loaded["test_id"] == "ut_wiki_lookup_001"


# --- derive_activated() ---------------------------------------------------


def test_activated_true_when_wrote_owned_section():
    activated = derive_activated(
        skill="conflict-resolution",
        skills_invoked=[],
        tool_calls=[],
        file_changes={"research.json": {"sections_modified": ["conflicts"], "diff": {}}},
        files_created=[],
        text_response="resolved",
    )
    assert activated is True


def test_activated_true_when_invoked_with_substantive_response():
    activated = derive_activated(
        skill="conflict-resolution",
        skills_invoked=["conflict-resolution"],
        tool_calls=[],
        file_changes=None,
        files_created=[],
        text_response="I have analyzed the conflict thoroughly and weighed the informant proximity and temporal distance of each source. The competing assertions are...",
    )
    assert activated is True


def test_activated_false_for_one_line_routing():
    activated = derive_activated(
        skill="record-extraction",
        skills_invoked=[],
        tool_calls=[],
        file_changes=None,
        files_created=[],
        text_response="This looks like a search request — use search-records.",
    )
    assert activated is False


def test_activated_only_for_characteristic_tool_calls():
    """Bug #5: rule 3 must restrict to tools in allowed-tools frontmatter."""
    # Allowed-tools-respecting call → activated
    assert derive_activated(
        skill="search-records",
        skills_invoked=[],
        tool_calls=[{"tool": "mcp__genealogy__record_search", "args": {}}],
        file_changes=None,
        files_created=[],
        text_response="",
        skill_frontmatter={"allowed-tools": ["record_search"]},
    ) is True

    # Incidental call to an unrelated tool → NOT activated
    assert derive_activated(
        skill="record-extraction",
        skills_invoked=[],
        tool_calls=[{"tool": "mcp__genealogy__wikipedia_search", "args": {}}],
        file_changes=None,
        files_created=[],
        text_response="",
        skill_frontmatter={"allowed-tools": ["record_search"]},
    ) is False

    # No allowed-tools declared → no tool can flip activation by itself
    assert derive_activated(
        skill="conflict-resolution",
        skills_invoked=[],
        tool_calls=[{"tool": "mcp__genealogy__places", "args": {}}],
        file_changes=None,
        files_created=[],
        text_response="",
        skill_frontmatter={},
    ) is False


def test_is_substantive_short_legitimate_output_with_skill_set():
    """Bug #3 fix: convert-dates → '1850-03-15' is one word but legitimate.
    With skill-name-aware filtering, short responses that don't mention
    another skill are substantive."""
    from harness.runlog import _is_substantive
    others = {"wiki-lookup", "search-records", "record-extraction"}
    assert _is_substantive("1850-03-15", other_skill_names=others) is True
    assert _is_substantive("Patrick, son of John", other_skill_names=others) is True


def test_is_substantive_short_routing_acknowledgement_filtered():
    """A short response that mentions another skill is routing, not work."""
    from harness.runlog import _is_substantive
    others = {"wiki-lookup", "search-records", "record-extraction"}
    assert _is_substantive(
        "This is handled by search-records.", other_skill_names=others
    ) is False
    assert _is_substantive(
        "Use the wiki-lookup skill.", other_skill_names=others
    ) is False


def test_is_substantive_long_response_substantive_even_with_skill_name():
    """A long substantive response that happens to mention another skill
    is still substantive — the length implies real work."""
    from harness.runlog import _is_substantive
    others = {"wiki-lookup", "search-records"}
    long_text = (
        "I analyzed the conflict between the three sources and weighed "
        "informant proximity carefully. The 1850 census household "
        "composition, the 1860 census, and the death certificate all "
        "provide different perspectives — see also the search-records "
        "history in the log. My recommended resolution: prefer the "
        "Irish-birthplace evidence from the contemporary household."
    )
    assert _is_substantive(long_text, other_skill_names=others) is True


def test_is_substantive_short_one_sentence_decline_not_substantive():
    """Bug #11: sentence-split, ≥2 segments AND ≥10 words."""
    from harness.runlog import _is_substantive
    assert _is_substantive("Routing to search-records.") is False


def test_is_substantive_clean_two_sentence_decline():
    from harness.runlog import _is_substantive
    # 2 sentences, 13 words → substantive
    text = "I declined because this is search-records' job. Not record-extraction at all."
    assert _is_substantive(text) is True


def test_is_substantive_ok_done_not_substantive():
    """Two short sentences but under 10 words → not substantive."""
    from harness.runlog import _is_substantive
    assert _is_substantive("OK. Done.") is False


def test_activated_true_when_files_created():
    activated = derive_activated(
        skill="wiki-lookup",
        skills_invoked=[],
        tool_calls=[],
        file_changes=None,
        files_created=["schuylkill-county-pennsylvania.md"],
        text_response="Saved the summary.",
    )
    assert activated is True
