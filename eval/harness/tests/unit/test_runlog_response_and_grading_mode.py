"""Issue #1000 — the two things the run log dropped that the harness already had.

Both halves are offline and free: no paid `make eval-skill` run, no API call.
`eval/harness/**` is not in the run-log snapshot, so nothing here flips a skill's
run log inactive.
"""

from __future__ import annotations

from harness.loader import TestSpec
from harness.orchestrator import _compute_outcome, _tool_call_entry, grading_mode_for
from harness.runlog import assemble_test_entry

from tests.unit.test_partial_runlog import _entry  # reuse the SingleRun builder


def _spec(**over) -> TestSpec:
    base = dict(
        id="ut_demo_001",
        skill="citation",
        name="n",
        type="positive",
        description="d",
        tags=[],
        user_message="m",
        scenario=None,
        scenario_notes=None,
        mcp_fixtures=[],
        judge_context=[],
        negative=None,
        expected_outcome="pass",
        xfail_reason=None,
        runs_per_test=1,
        execution={},
    )
    base.update(over)
    return TestSpec(**base)


# --- half 1: the response the orchestrator already had and threw away --------


def test_a_live_call_keeps_the_response():
    """The load-bearing case. `research_append` is live, and calibrating the
    warn-only `person_evidence` guardrail (#1550) means reading what it
    returned. Before this, the projection copied five named keys and dropped
    `response` — measured 2026-08-24 as 2,812 tool calls with zero responses.

    Revert `_tool_call_entry` to those five keys and this goes red.
    """
    call = {
        "tool": "mcp__genealogy__research_append",
        "args": {"section": "person_evidence"},
        "expected_args": None,
        "matched": {"kind": "live", "index": None},
        "response_fixture": None,
        "response": {"ok": True, "warnings": ["person_evidence: no same_person call"]},
    }
    entry = _tool_call_entry(call)
    assert entry["response"] == call["response"]
    # And the five original keys are untouched.
    assert entry["tool"] == call["tool"]
    assert entry["matched"] == call["matched"]
    assert entry["response_fixture"] is None


def test_an_unmatched_call_keeps_the_response():
    """`matched.kind == "none"` means no fixture answered it, so the content
    exists nowhere else on disk either."""
    entry = _tool_call_entry({
        "tool": "mcp__genealogy__record_search",
        "args": {"surname": "Smith"},
        "expected_args": None,
        "matched": {"kind": "none", "index": None},
        "response_fixture": None,
        "response": {"error": "fixture_not_found"},
    })
    assert entry["response"] == {"error": "fixture_not_found"}


def test_a_fixture_matched_call_omits_the_response():
    """The retention rule (lead, 2026-08-24). A `predicate` match is exactly
    recoverable from `response_fixture` + `matched.index` at that commit, so
    storing it again re-adds bytes git already holds — ~16% on the largest run
    log, against a schema version introduced to make run logs smaller.

    Absent, not null: null would assert "this call returned nothing".
    """
    entry = _tool_call_entry({
        "tool": "mcp__genealogy__wikipedia_search",
        "args": {"query": "Albert Einstein"},
        "expected_args": {"query": "Albert Einstein"},
        "matched": {"kind": "predicate", "index": 0},
        "response_fixture": "wikipedia-search-albert-einstein",
        "response": {"pages": ["..."]},
    })
    assert "response" not in entry
    # The recovery path the spec names is still fully present.
    assert entry["response_fixture"] == "wikipedia-search-albert-einstein"
    assert entry["matched"]["index"] == 0


# --- half 2: whether the judge dimensions gate the outcome -------------------


def test_grading_mode_covers_all_four_branches():
    assert grading_mode_for(_spec(type="positive")) == ("dimensions", True)
    assert grading_mode_for(
        _spec(type="negative", negative={"grade_on_invariant": True})
    ) == ("invariant", False)
    assert grading_mode_for(
        _spec(type="negative", negative={"correct_skill": []})
    ) == ("dimensions", True)
    assert grading_mode_for(
        _spec(type="negative", negative={"correct_skill": ["research-plan"]})
    ) == ("routing", False)


def test_grading_mode_matches_what_compute_outcome_does():
    """The anti-drift guard, and the reason this field is trustworthy.

    A field that *claims* the dimensions do not gate is worth nothing if
    `_compute_outcome` later starts gating on them. So rather than assert the
    classifier against a hand-written table, drive the real function twice per
    branch — once with a clean dimension, once with the same dimension scored 1
    — and assert the outcome moves **iff** `dimensions_gate_outcome` is True.

    Change any branch of `_compute_outcome` to gate differently and this goes
    red without anyone remembering to update `grading_mode_for`.
    """
    cases = [
        _spec(type="positive"),
        _spec(type="negative", negative={"grade_on_invariant": True}),
        _spec(type="negative", negative={"correct_skill": []}),
        _spec(type="negative", negative={"correct_skill": ["research-plan"]}),
    ]
    for spec in cases:
        mode, gates = grading_mode_for(spec)
        # A state the branch itself would otherwise pass on, so the ONLY thing
        # that can differ between the two calls is the dimension score.
        common = dict(
            spec=spec,
            validators_passed=True,
            aborted_reason=None,
            activated=(spec.type == "positive"),
            skills_invoked=(
                ["citation"] if spec.type == "positive"
                else ["research-plan"] if (spec.negative or {}).get("correct_skill")
                else []
            ),
        )
        clean = _compute_outcome(
            judge_dimensions=[{"name": "Correctness", "score": 3}], **common
        )
        failed = _compute_outcome(
            judge_dimensions=[{"name": "Correctness", "score": 1}], **common
        )
        if gates:
            assert clean != failed, (
                f"{mode}: dimensions_gate_outcome=True but a dimension scored 1 "
                f"did not change the outcome ({clean!r} both times)"
            )
        else:
            assert clean == failed, (
                f"{mode}: dimensions_gate_outcome=False but a dimension scored 1 "
                f"changed the outcome {clean!r} -> {failed!r}"
            )


def test_the_entry_carries_the_two_fields():
    entry = _entry()
    assert "grading_mode" not in entry, "default stays absent for old callers"

    entry = assemble_test_entry(
        test_id="ut_demo_001",
        test_type="negative",
        expected_outcome="pass",
        scenario=None,
        mcp_fixtures=[],
        runs=_RUNS(),
        timestamp_for_run_id="2026-08-25_10-00-00",
        grading_mode="invariant",
        dimensions_gate_outcome=False,
    )
    assert entry["grading_mode"] == "invariant"
    assert entry["dimensions_gate_outcome"] is False


def _RUNS():
    """One SingleRun carrying a dimension scored 1 — the exact shape #1000 was
    filed on: a passing invariant negative whose judge noted a real routing
    imperfection."""
    from harness.runlog import JudgeResult, SingleRun, ValidatorResult

    return [
        SingleRun(
            outcome="pass",
            aborted_reason=None,
            duration_ms=1000.0,
            input_tokens=100,
            cached_input_tokens=0,
            output_tokens=10,
            skill_cost_usd=0.01,
            output={
                "text_response": "x",
                "activated": True,
                "skills_invoked": [],
                "tool_calls": [],
                "files_created": [],
            },
            validators=ValidatorResult(passed=True, results=[]),
            judge=JudgeResult(
                skipped=False,
                dimensions=[{"source": "base", "name": "Correctness",
                             "score": 1, "rationale": "routing imperfection"}],
                judge_cost_usd=0.001,
            ),
        )
    ]
