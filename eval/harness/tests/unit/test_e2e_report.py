"""Unit tests for e2e.report — roll-up output formatting."""

from __future__ import annotations

import io
from contextlib import redirect_stdout

from e2e.report import print_rollup
from e2e.result import E2eResult, is_committable_run


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


# --- an ungradeable run must say WHY (#1245) --------------------------
#
# The clause after "scratch run" used to be one fixed string for all three
# causes. For a judge crash it printed directly under `stop_reason: completed`,
# so the two lines together read "this run succeeded and produced nothing".

from e2e.run_e2e import ungradeable_reason  # noqa: E402


def _skipped(verdict: str = "skipped", **kw) -> E2eResult:
    return E2eResult(
        test_id="t", captured_at="2026-08-05_00-00-00", verdict=verdict,
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


def test_an_untagged_unrecognised_verdict_is_named_at_the_headline():
    """The per-tag loop never sees an untagged run, so the headline has to be
    where an unreadable verdict surfaces. It previously printed nothing."""
    out = _capture([_make_result("a", "kinda-ok?")])
    assert "1 unrecognised" in out


def test_the_headline_reconciles_with_the_run_count():
    out = _capture(
        [
            _make_result("a", "pass"),
            _make_result("b", "fail"),
            _make_result("c", "skipped"),
            _make_result("d", "???"),
        ]
    )
    line = next(ln for ln in out.splitlines() if ln.startswith("E2E suite:"))
    assert "1/4 recall pass" in line
    for token in ("1 fail", "1 skipped", "1 unrecognised"):
        assert token in line, f"{token} missing; the headline must sum to 4"


# --- gradedness is a separate axis from committability (#1245 / #1239) ---
#
# The console block used to key both on `is_committable_run`. That is fine only
# while the two coincide. PR #1239 makes a judge crash committable (the tree
# exists and can be re-graded) while it is still ungraded, at which point a
# single committability branch would say nothing about the crash at all — the
# exact silence #1245 was filed about.

from e2e.run_e2e import is_ungraded  # noqa: E402


def test_a_graded_run_is_not_flagged_as_ungraded():
    for verdict in ("pass", "partial", "fail"):
        assert not is_ungraded(_skipped(verdict=verdict))


def test_todays_ungradeable_verdict_is_flagged():
    assert is_ungraded(_skipped())  # verdict="skipped"


def test_the_post_1239_verdict_is_flagged_too():
    """`ungraded` does not exist yet. When #1239 lands it must still be caught,
    which is why gradedness uses its own literal instead of importing
    result.py's set — that set is the COMMITTABILITY axis and #1239 widens it."""
    assert is_ungraded(_skipped(verdict="ungraded"))


def test_gradedness_does_not_import_the_committability_set():
    """Guards the reason the two are separate. If someone 'tidies' this by
    importing result.py's set, a judge crash starts reading as graded the
    moment #1239 merges, silently."""
    import e2e.run_e2e as r

    assert r._GRADED_VERDICTS == ("pass", "partial", "fail")
    assert "ungraded" not in r._GRADED_VERDICTS


def test_an_ungraded_run_is_also_uncommittable_today():
    """The assertion PLAN.md §3 asked for, and the reason gradedness needed its
    own axis: today the two coincide, so this passes on both. After #1239 a
    judge crash becomes committable while staying ungraded, and only the
    `is_ungraded` half will still hold — which is what `_GRADED_VERDICTS`
    being a separate literal protects."""
    r = _skipped(judge_output={"error": "APIStatusError: 401"})
    assert is_ungraded(r) is True
    assert is_committable_run(r.verdict) is False


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
    identically.  After #1114 removed the verdict lines, the distinction
    is carried by the compliance line alone."""
    correct_but_bypassing = _capture([_noncompliant("isabel-carvajal-daughter", "pass")])
    genealogically_wrong = _capture([_make_result("other-fixture", "fail")])
    assert correct_but_bypassing != genealogically_wrong

    # The correct-but-bypassing run shows a guardrail bypass.
    assert "guardrail bypass" in correct_but_bypassing
    assert "isabel-carvajal-daughter" in correct_but_bypassing

    # The wrong one is clean on compliance.
    assert "1/1 clean" in genealogically_wrong


def test_rollup_always_states_compliance_even_when_clean():
    """A silent compliance line puts us back to one number meaning two things."""
    out = _capture([_make_result("a", "pass")])
    assert "compliance: 1/1 clean" in out


# --- Blind grading: verdict must not leak (issue #1114) ---------------------


def test_rollup_does_not_leak_verdict():
    """The roll-up must not contain any verdict-bearing output — the person
    who runs the fixture usually grades it next (spec §7.4)."""
    out = _capture([_make_result("a", "pass", tags={"question_type": "parents"})])
    assert "recall pass" not in out
    assert "overall gate" not in out
    assert "by question_type" not in out
