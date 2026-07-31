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
