"""Unit tests for e2e.report — roll-up output formatting."""

from __future__ import annotations

import io
from contextlib import redirect_stdout

from e2e.report import print_rollup
from e2e.result import E2eResult


def _capture(results: list[E2eResult]) -> str:
    buf = io.StringIO()
    with redirect_stdout(buf):
        print_rollup(results)
    return buf.getvalue()


def _make_result(
    test_id: str,
    verdict: str,
    *,
    tags: dict[str, str] | None = None,
    cost: float | None = None,
    duration: float | None = None,
) -> E2eResult:
    usage = {}
    if cost is not None:
        usage["total_cost_usd"] = cost
    if duration is not None:
        usage["wall_clock_seconds"] = duration
    return E2eResult(
        test_id=test_id,
        captured_at="2026-05-26_14-30-45",
        verdict=verdict,
        stop_reason="completed",
        usage=usage,
        tags=tags or {},
    )


def test_print_rollup_empty():
    out = _capture([])
    assert "no runs" in out


def test_print_rollup_all_passes():
    results = [
        _make_result("a", "pass"),
        _make_result("b", "pass"),
    ]
    out = _capture(results)
    assert "2/2 recall pass" in out


def test_print_rollup_mixed():
    results = [
        _make_result("a", "pass"),
        _make_result("b", "partial"),
        _make_result("c", "fail"),
        _make_result("d", "skipped"),
    ]
    out = _capture(results)
    assert "1/4 recall pass" in out
    assert "1 partial" in out
    assert "1 fail" in out
    assert "1 skipped" in out


def test_print_rollup_groups_by_tag():
    results = [
        _make_result("a", "pass", tags={"question_type": "parents", "era": "1850s"}),
        _make_result("b", "pass", tags={"question_type": "parents", "era": "1900s"}),
        _make_result("c", "fail", tags={"question_type": "siblings", "era": "1850s"}),
    ]
    out = _capture(results)
    # Each tag dimension gets its own line
    assert "by question_type" in out
    assert "by era" in out
    # Pass-counts per tag value
    assert "parents 2/2" in out
    assert "siblings 0/1" in out
    assert "1850s 1/2" in out
    assert "1900s 1/1" in out


def test_print_rollup_reports_cost_and_duration():
    results = [
        _make_result("a", "pass", cost=2.50, duration=600),
        _make_result("b", "pass", cost=4.10, duration=1200),
    ]
    out = _capture(results)
    assert "avg cost: $3.30" in out
    assert "total cost: $6.60" in out
    # 600s + 1200s = 1800s = 30 min total, 15 min avg
    assert "avg wall-clock: 15.0 min" in out
    assert "total: 30.0 min" in out


def test_print_rollup_handles_missing_usage_fields():
    """Some runs may have no cost/duration (e.g., harness errored before
    the SDK returned). Roll-up should not crash."""
    results = [
        _make_result("a", "pass"),
        _make_result("b", "fail"),
    ]
    out = _capture(results)
    # No cost/duration lines printed when nothing to average
    assert "avg cost" not in out
    assert "avg wall-clock" not in out


# --- The compliance axis is visible in the roll-up (issue #972) -------------


def _noncompliant(test_id: str, verdict: str) -> E2eResult:
    return E2eResult(
        test_id=test_id,
        captured_at="2026-05-26_14-30-45",
        verdict=verdict,
        stop_reason="completed",
        guardrail_bypass_violations=["'same_person' was never called for 'I1'"],
    )


def test_a_correct_but_noncompliant_run_reads_differently_from_a_wrong_one():
    """The literal ask of issue #972: these two runs used to render
    identically, because a guardrail bypass rewrote the verdict to `fail`."""
    correct_but_bypassing = _capture([_noncompliant("isabel-carvajal-daughter", "pass")])
    genealogically_wrong = _capture([_make_result("other-fixture", "fail")])
    assert correct_but_bypassing != genealogically_wrong

    # The correct-but-bypassing run is reported as recall pass, gate fail.
    assert "1/1 recall pass" in correct_but_bypassing
    assert "isabel-carvajal-daughter" in correct_but_bypassing
    assert "overall gate: 0/1 pass" in correct_but_bypassing

    # The wrong one fails on recall and is clean on compliance.
    assert "1/1 clean" in genealogically_wrong
    assert "0/1 recall pass" in genealogically_wrong


def test_rollup_always_states_compliance_even_when_clean():
    """A silent compliance line puts us back to one number meaning two things."""
    out = _capture([_make_result("a", "pass")])
    assert "compliance: 1/1 clean" in out
    assert "overall gate: 1/1 pass" in out


# --- ungradeable runs must not read as failures (#1245) ---------------
#
# A run that produced no grade is not a run that failed the genealogy. The
# rollup used to render an all-ungraded tag as "0/N", byte-identical to a tag
# where every run genuinely failed, which is the miscount acceptance criterion
# 4 of #1245 asks about.


def test_an_all_ungraded_tag_is_not_rendered_as_an_all_failed_tag():
    ungraded = _capture(
        [_make_result(f"t{i}", "skipped", tags={"era": "1800s"}) for i in range(3)]
    )
    failed = _capture(
        [_make_result(f"t{i}", "fail", tags={"era": "1800s"}) for i in range(3)]
    )
    assert "0/3" in ungraded and "0/3" in failed  # the recall count is the same...
    assert ungraded != failed, "...so the line must say which of the two it is"
    assert "3 ungraded" in ungraded
    assert "ungraded" not in failed


def test_a_mixed_tag_names_only_the_ungraded_ones():
    out = _capture(
        [
            _make_result("a", "pass", tags={"era": "1800s"}),
            _make_result("b", "fail", tags={"era": "1800s"}),
            _make_result("c", "skipped", tags={"era": "1800s"}),
        ]
    )
    assert "1/3 (1 ungraded)" in out


def test_an_unrecognised_verdict_is_printed_rather_than_swallowed():
    """`verdict` arrives as whatever string the judge returned, so a value
    outside the vocabulary is reachable. It used to land in a dict key nothing
    rendered, leaving the totals quietly failing to reconcile."""
    out = _capture(
        [
            _make_result("a", "pass", tags={"era": "1800s"}),
            _make_result("b", "kinda-ok?", tags={"era": "1800s"}),
        ]
    )
    assert "1 unrecognised" in out


def test_an_unrecognised_verdict_does_not_crash_the_rollup():
    # The pre-fix bucket seeded four fixed keys; anything else had to be
    # tolerated by `.get`. Assert the tolerance survives the rewrite.
    out = _capture([_make_result("a", "???", tags={"era": "1800s"})])
    assert "era" in out


# --- an ungradeable run must say WHY (#1245) --------------------------
#
# The clause after "scratch run" used to be one fixed string for all three
# causes. For a judge crash it printed directly under `stop_reason: completed`,
# so the two lines together read "this run succeeded and produced nothing".

from e2e.run_e2e import ungradeable_reason  # noqa: E402


def _skipped(**kw) -> E2eResult:
    return E2eResult(
        test_id="t", captured_at="2026-08-05_00-00-00", verdict="skipped",
        stop_reason="completed", usage={}, **kw,
    )


def test_a_judge_crash_says_so_and_says_the_work_survived():
    out = ungradeable_reason(_skipped(judge_output={"error": "APIStatusError: 401"}))
    assert "judge itself failed" in out
    assert "401" in out, "quote the judge's own error, not a generic phrase"
    assert "re-running" in out


def test_no_tree_is_not_confused_with_a_judge_crash():
    out = ungradeable_reason(_skipped(judge_output={}))
    assert "no final tree" in out
    assert "judge itself failed" not in out


def test_skip_judge_is_named_as_the_deliberate_choice_it_is():
    out = ungradeable_reason(_skipped(judge_output={}), skip_judge=True)
    assert "--skip-judge" in out


def test_a_judge_crash_outranks_skip_judge():
    # If the judge raised, it was asked to run, so skip_judge cannot also be
    # the explanation. Order matters here, not just coverage.
    out = ungradeable_reason(
        _skipped(judge_output={"error": "boom"}), skip_judge=True
    )
    assert "judge itself failed" in out


def test_the_three_causes_are_mutually_distinguishable():
    """The whole point: #1245 could not be diagnosed because they were not."""
    reasons = {
        ungradeable_reason(_skipped(judge_output={"error": "x"})),
        ungradeable_reason(_skipped(judge_output={})),
        ungradeable_reason(_skipped(judge_output={}), skip_judge=True),
    }
    assert len(reasons) == 3


def test_no_grade_is_ever_disclosed():
    """Spec 7.4 blindness: the operator grades this run later, so the message
    must not leak the judge's conclusion."""
    out = ungradeable_reason(
        _skipped(judge_output={"error": "boom", "verdict": "pass", "proof_quality": 3})
    )
    for leaked in ("pass", "proof_quality", "verdict"):
        assert leaked not in out, f"leaked {leaked!r} into a pre-grading message"
