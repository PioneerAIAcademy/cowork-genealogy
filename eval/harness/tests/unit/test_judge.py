"""Tests for harness.judge — prompt rendering and response parsing.

The actual API call lives in the e2e test. These tests check the prompt
assembly, hash stability, and response decoding without spending a cent.
"""

import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from harness import judge
from harness.versioning import classify
from harness.rubric import (
    InvalidRubricError,
    empty_rubric,
    parse_rubric,
    parse_rubric_or_empty,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
# Use citation/ as the rubric fixture — it stays after the search-familysearch-wiki
# rubric deletion (citation is pure GPS craft, see phase-2 triage).
CITATION_RUBRIC = REPO_ROOT / "eval/tests/unit/citation/rubric.md"
# Real rubric with the exact dimension names implicated in #1361's evidence
# (re-cased and duplicated in historical record-extraction run logs).
RECORD_EXTRACTION_RUBRIC = REPO_ROOT / "eval/tests/unit/record-extraction/rubric.md"


@pytest.fixture
def sample_rubric():
    return parse_rubric(CITATION_RUBRIC.read_text(encoding="utf-8"))


@pytest.fixture
def record_extraction_rubric():
    return parse_rubric(RECORD_EXTRACTION_RUBRIC.read_text(encoding="utf-8"))


# _extract_dimensions tests that only exercise base dimensions don't care
# what the rubric's valid name set is — pass an empty one so the #1361
# rubric-name validation has nothing to check against.
_NO_RUBRIC = empty_rubric("test-skill")

# A run that made at least one MCP call. `_extract_dimensions` takes
# `tool_calls` as a required keyword argument (#1406) and coerces Tool
# Arguments to null when it is empty, so every test that is NOT about the
# N/A rule passes this and keeps its pre-#1406 meaning exactly. Tests that
# ARE about the rule pass `[]` explicitly.
_SOME_TOOL_CALLS = [
    {
        "tool": "mcp__genealogy__record_search",
        "args": {"surname": "Flynn"},
        "matched": {"kind": "predicate", "index": None},
    }
]


def test_prompt_hash_is_sha256_hex():
    h = judge.judge_prompt_hash()
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)


def test_render_prompt_includes_all_slots(sample_rubric):
    prompt = judge.render_prompt(
        rubric=sample_rubric,
        judge_context=["Should save to a file"],
        scenario_readme="(stateless test)",
        user_message="Look up Ohio.",
        skills_invoked=["search-familysearch-wiki"],
        text_response="I saved the summary to ohio.md.",
        file_changes_summary="(no research.json changes)",
        tool_calls=[
            {
                "tool": "mcp__genealogy__wikipedia_search",
                "args": {"query": "Ohio"},
                "matched": {"kind": "predicate", "index": None},
                "response": {"title": "Ohio"},
            }
        ],
    )
    assert "Look up Ohio." in prompt
    assert "search-familysearch-wiki" in prompt
    assert "Should save to a file" in prompt
    assert "wikipedia_search" in prompt
    assert "Evidence Explained compliance" in prompt  # from citation rubric.md


def test_render_prompt_handles_empty_criteria(sample_rubric):
    prompt = judge.render_prompt(
        rubric=sample_rubric,
        judge_context=[],
        scenario_readme="",
        user_message="hi",
        skills_invoked=[],
        text_response="",
        file_changes_summary="",
        tool_calls=[],
    )
    assert "(none)" in prompt
    assert "(stateless test)" in prompt
    assert "(empty)" in prompt
    assert "(no file changes)" in prompt


def _base_dims_with_tool_arguments_null():
    """All three required base dimensions, Tool Arguments null (the
    no-MCP-calls happy path)."""
    return [
        {"source": "base", "name": "Correctness", "score": 3,
         "rationale": "everything checks out fine"},
        {"source": "base", "name": "Completeness", "score": 3,
         "rationale": "everything addressed cleanly"},
        {"source": "base", "name": "Tool Arguments", "score": None,
         "rationale": "no tool calls — N/A for this test"},
    ]


def test_extract_dimensions_happy_path():
    tool_block = SimpleNamespace(
        type="tool_use",
        name="submit_grading",
        input={"dimensions": _base_dims_with_tool_arguments_null()},
    )
    response = SimpleNamespace(content=[tool_block])
    dims, warnings = judge._extract_dimensions(response, _NO_RUBRIC, tool_calls=_SOME_TOOL_CALLS)
    names = [d["name"] for d in dims]
    assert names == ["Correctness", "Completeness", "Tool Arguments"]
    assert warnings == []


def test_extract_dimensions_strips_unknown_fields():
    """Sonnet 5 emits an extra `index` field on each grading dimension.
    The run-log schema is additionalProperties:False on dimensions, so an
    unstripped extra key crashes run-log validation for the whole suite.
    _extract_dimensions must project each dimension to the known field set.
    """
    dims = _base_dims_with_tool_arguments_null()
    for i, d in enumerate(dims):
        d["index"] = i  # the field Sonnet 5 adds
    dims[0]["some_future_field"] = "junk"
    tool_block = SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": dims},
    )
    response = SimpleNamespace(content=[tool_block])
    out, warnings = judge._extract_dimensions(response, _NO_RUBRIC, tool_calls=_SOME_TOOL_CALLS)
    for d in out:
        assert set(d) <= {"source", "name", "score", "rationale"}, d
    assert [d["name"] for d in out] == [
        "Correctness", "Completeness", "Tool Arguments"
    ]
    assert warnings == []


def test_extract_dimensions_rejects_missing_tool_arguments():
    """Adding Tool Arguments as a required base dimension means the
    judge can no longer omit it."""
    bad = _base_dims_with_tool_arguments_null()[:2]  # drop Tool Arguments
    tool_block = SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": bad},
    )
    response = SimpleNamespace(content=[tool_block])
    with pytest.raises(judge.JudgeError, match="Tool Arguments"):
        judge._extract_dimensions(response, _NO_RUBRIC, tool_calls=_SOME_TOOL_CALLS)


def test_extract_dimensions_rejects_null_score_on_correctness():
    """Only Tool Arguments may be null. A null on Correctness signals
    the judge dodged a substantive dimension and is rejected."""
    dims = _base_dims_with_tool_arguments_null()
    dims[0]["score"] = None  # null Correctness
    tool_block = SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": dims},
    )
    response = SimpleNamespace(content=[tool_block])
    with pytest.raises(judge.JudgeError, match="null"):
        judge._extract_dimensions(response, _NO_RUBRIC, tool_calls=_SOME_TOOL_CALLS)


def test_extract_dimensions_accepts_integer_score_on_tool_arguments():
    """The null is permissive, not required — when MCP calls happened
    Tool Arguments should be 1/2/3 like any other dimension."""
    dims = _base_dims_with_tool_arguments_null()
    dims[2]["score"] = 2
    dims[2]["rationale"] = "one call had a wrong query phrasing"
    tool_block = SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": dims},
    )
    response = SimpleNamespace(content=[tool_block])
    out, warnings = judge._extract_dimensions(response, _NO_RUBRIC, tool_calls=_SOME_TOOL_CALLS)
    ta = next(d for d in out if d["name"] == "Tool Arguments")
    assert ta["score"] == 2
    assert warnings == []


# --- #1406: Tool Arguments N/A rule, enforced rather than requested -------
#
# judge/prompt.md asks the judge to report `null` when a run made zero MCP
# tool calls. It complies most of the time and not always. `_extract_dimensions`
# now settles it from the caller's own `tool_calls` list. The four cells of
# (zero calls?) x (null score?) are pinned below, plus both outcome gates.


def _na_case(score, *, tool_calls):
    """Run one (tool_calls, Tool Arguments score) combination through
    extraction. Returns (tool_arguments_dimension, warnings)."""
    dims = _base_dims_with_tool_arguments_null()
    dims[2]["score"] = score
    dims[2]["rationale"] = "judge's own account of the tool arguments"
    response = SimpleNamespace(content=[SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": dims},
    )])
    out, warnings = judge._extract_dimensions(
        response, _NO_RUBRIC, tool_calls=tool_calls
    )
    return next(d for d in out if d["name"] == "Tool Arguments"), warnings


def test_na_rule_coerces_integer_score_when_no_tool_calls():
    """The defect #1406 was filed for: zero MCP calls, judge reports 3."""
    ta, warnings = _na_case(3, tool_calls=[])
    assert ta["score"] is None
    assert len(warnings) == 1
    w = warnings[0]
    assert w["kind"] == "coerced_tool_arguments_to_na"
    assert w["name"] == "Tool Arguments"
    # The discarded draw is preserved, or the defect stays untrendable —
    # the same reason #1361 preserves a dropped dimension's score.
    assert w["score"] == 3
    assert w["rationale"] == "judge's own account of the tool arguments"


def test_na_rule_silent_when_judge_already_reported_null():
    """The overwhelmingly common path — 646 of the 1806 judge draws in the
    committed corpus made zero tool calls. A warning here would be noise on
    every one of them."""
    ta, warnings = _na_case(None, tool_calls=[])
    assert ta["score"] is None
    assert warnings == []


def test_na_rule_leaves_integer_score_alone_when_tool_calls_happened():
    """The fail-open direction. A coercion that fired whenever the list
    merely looked empty would null out real gradings across the corpus."""
    ta, warnings = _na_case(2, tool_calls=_SOME_TOOL_CALLS)
    assert ta["score"] == 2
    assert warnings == []


def test_na_rule_leaves_null_alone_when_tool_calls_happened():
    """Null with calls present is odd but permitted today, and #1406 does
    not change that. Pinned so the change stays visibly scoped."""
    ta, warnings = _na_case(None, tool_calls=_SOME_TOOL_CALLS)
    assert ta["score"] is None
    assert warnings == []


def test_na_rule_coercion_flips_a_positive_test_outcome():
    """DELIBERATE consequence, pinned so it reads as a decision.

    orchestrator._compute_outcome fails a positive test the moment any
    dimension scores 1. Coercing a zero-tool-call Tool Arguments 1 to null
    removes it from that list, so `fail` becomes `pass`. That is intended:
    there are no arguments to grade on a run that called no tool, and "a
    required action never happened" belongs on Correctness/Completeness
    per judge/prompt.md's Correctness section.
    """
    from harness.orchestrator import _compute_outcome
    from harness.loader import TestSpec

    ta, warnings = _na_case(1, tool_calls=[])
    assert ta["score"] is None
    assert warnings[0]["score"] == 1

    spec = SimpleNamespace(type="positive", skill="citation", negative=None)
    before = _compute_outcome(
        spec=spec, validators_passed=True, aborted_reason=None, activated=True,
        skills_invoked=["citation"],
        judge_dimensions=[{"score": 3}, {"score": 3}, {"score": 1}],
    )
    after = _compute_outcome(
        spec=spec, validators_passed=True, aborted_reason=None, activated=True,
        skills_invoked=["citation"],
        judge_dimensions=[{"score": 3}, {"score": 3}, {"score": None}],
    )
    assert before == "fail"
    assert after == "pass"
    assert TestSpec is not None  # import guard: the spec shape is real


def test_na_rule_coercion_flips_an_out_of_scope_negative_outcome():
    """The second outcome gate, and the shape most exposed to it.

    _compute_outcome has TWO `1 in scores` gates. The other one governs
    out-of-scope negatives (`correct_skill: []`), where the judge's base
    dimensions are the ONLY outcome signal because "no skill fired" holds
    whether the model declined cleanly or answered the request itself.

    ut_search_wikipedia_008 is the corpus's only such test, and passing
    means no skill acted — so making zero MCP tool calls is its correct
    behaviour, and it has made zero in all 8 of its historical run logs.
    Tool Arguments drew null in every one, so this flip has no instances;
    it is pinned because a single 1 there would silently turn `fail` into
    `pass` on the one test whose job is catching a skill that answered
    something it should have ignored.
    """
    from harness.orchestrator import _compute_outcome

    # The coercion half, so this test covers the same hop test 5 does
    # rather than only the gate below it.
    ta, warnings = _na_case(1, tool_calls=[])
    assert ta["score"] is None
    assert warnings[0]["score"] == 1

    spec = SimpleNamespace(
        type="negative", skill="search-wikipedia",
        negative={"correct_skill": []},
    )
    kw = dict(
        spec=spec, validators_passed=True, aborted_reason=None,
        activated=False, skills_invoked=[],
    )
    assert _compute_outcome(
        judge_dimensions=[{"score": 3}, {"score": 3}, {"score": 1}], **kw
    ) == "fail"
    assert _compute_outcome(
        judge_dimensions=[{"score": 3}, {"score": 3}, {"score": None}], **kw
    ) == "pass"


def test_na_rule_coercion_flips_a_positive_test_from_partial():
    """The coercion guard is `is not None`, so it nulls a 2 as well as a 1
    and can turn `partial` into `pass` through the second gate.

    Same intent as the fail case: there is nothing to deduct for on a run
    that called no tool, at any band. Pinned separately because a reader
    checking only the fail case would reasonably assume a 2 survives.
    """
    from harness.orchestrator import _compute_outcome

    ta, warnings = _na_case(2, tool_calls=[])
    assert ta["score"] is None
    assert warnings[0]["score"] == 2

    spec = SimpleNamespace(type="positive", skill="citation", negative=None)
    kw = dict(
        spec=spec, validators_passed=True, aborted_reason=None,
        activated=True, skills_invoked=["citation"],
    )
    assert _compute_outcome(
        judge_dimensions=[{"score": 3}, {"score": 3}, {"score": 2}], **kw
    ) == "partial"
    assert _compute_outcome(
        judge_dimensions=[{"score": 3}, {"score": 3}, {"score": None}], **kw
    ) == "pass"


def test_na_rule_rewrites_the_now_stale_rationale():
    """A null score beside a rationale still arguing about specific tool
    arguments reads as a harness bug to whoever opens the run log, and the
    CRUD UI never surfaces output.warnings — so an annotator correcting
    this dimension would see only the stale text with no sign it was
    overridden. Follows orchestrator.apply_deterministic_deference, which
    is this codebase's established shape for overriding a judge score.
    """
    ta, warnings = _na_case(3, tool_calls=[])
    assert ta["rationale"].startswith("[coerced-to-na]")
    # The judge's own words survive inside the rewrite, not replaced by it.
    assert "judge's own account of the tool arguments" in ta["rationale"]
    # And the warning still carries the original untouched, for trending.
    assert warnings[0]["rationale"] == "judge's own account of the tool arguments"


def test_extract_dimensions_drops_an_invented_base_dimension():
    """The rubric-name drop only inspects source=="rubric", and the
    required-base check only verifies the three are PRESENT — it never
    rejects a fourth. Without this, {"source": "base", "name":
    "Thoroughness", "score": 1} reaches _compute_outcome's fail gate.

    Never observed: zero of the committed corpus's 5418 base-sourced
    dimensions carry a name outside the required three. A floor, not a fix.
    """
    dims = _base_dims_with_tool_arguments_null()
    dims.append({"source": "base", "name": "Thoroughness", "score": 1,
                 "rationale": "invented out of nowhere by the judge"})
    response = SimpleNamespace(content=[SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": dims},
    )])
    out, warnings = judge._extract_dimensions(
        response, _NO_RUBRIC, tool_calls=_SOME_TOOL_CALLS
    )
    assert [d["name"] for d in out] == [
        "Correctness", "Completeness", "Tool Arguments"
    ]
    assert 1 not in [d["score"] for d in out]
    assert len(warnings) == 1
    assert warnings[0]["kind"] == "dropped_unknown_base_dimension"
    assert warnings[0]["name"] == "Thoroughness"
    # The dropped draw's score is preserved, so a dropped fail cannot
    # vanish from the outcome computation without a trace.
    assert warnings[0]["score"] == 1


def test_extract_dimensions_rejects_zero_tool_uses():
    response = SimpleNamespace(content=[SimpleNamespace(type="text", text="foo")])
    with pytest.raises(judge.JudgeError):
        judge._extract_dimensions(response, _NO_RUBRIC, tool_calls=_SOME_TOOL_CALLS)


def test_extract_dimensions_rejects_multiple_tool_uses():
    tu = SimpleNamespace(type="tool_use", name="submit_grading", input={"dimensions": []})
    response = SimpleNamespace(content=[tu, tu])
    with pytest.raises(judge.JudgeError):
        judge._extract_dimensions(response, _NO_RUBRIC, tool_calls=_SOME_TOOL_CALLS)


def test_extract_dimensions_rejects_wrong_tool_name():
    bad = SimpleNamespace(type="tool_use", name="other_tool", input={})
    response = SimpleNamespace(content=[bad])
    with pytest.raises(judge.JudgeError):
        judge._extract_dimensions(response, _NO_RUBRIC, tool_calls=_SOME_TOOL_CALLS)


# --- #1361: rubric dimension name validation ----------------------------
#
# eval/tests/unit/record-extraction/rubric.md has carried the same three
# `##` headings ("Assertion atomicity", "Informant identification",
# "Evidence type accuracy") across 39 historical run logs. The fixtures
# below reproduce real incidents recovered from git history at commit
# a2d5a4cf (eval/runlogs/unit/record-extraction/, pruned from the working
# tree by the #1238 retention policy but preserved in git objects):
# v1_2026-07-11_23-19-58 (ut_record_extraction_014, Title-Cased all THREE
# real dimensions) and v1_2026-07-19_22-34-49 (ut_record_extraction_018,
# emitted "Informant identification" twice in one run, both scored 3).
#
# REDESIGN NOTE (second commit): an unknown/re-cased rubric name or a
# duplicate (source, name) pair is DROPPED with a warning, not raised.
# Replaying the original raise-based fix against every committed run log's
# real judge output showed why: the judge routinely truncates or re-cases
# rubric headings (`## Score discipline (advisory)` -> "Score discipline")
# and on some tests invents a dimension every single run because the
# rubric has no matching heading at all. `_compute_outcome` fails a
# positive test outright whenever the judge produced zero dimensions, and
# the resample loop can't rescue a prompt-correlated mistake (attempt 0 is
# temperature-pinned, so a retry can repeat the identical error) — so a
# hard raise here would have turned correct skill output into a recorded
# failure. Measured against the committed corpus with each run's rubric
# resolved to the text actually in force at run time (a digest-only
# snapshot resolved against git history, not assumed to match today's
# on-disk file): one test drops on every historical draw
# (research-plan/ut_research_plan_007, 5/5) and 21 more drop on at least
# one draw (22 tests total; see
# test_corpus_replay_never_raises_on_committed_run_logs). Structural
# garbage (an invalid `source`, a non-string `name`) still raises: see the
# structural-garbage tests below and the docstring on _extract_dimensions.


def _record_extraction_base_dims():
    """The three base dimensions, scored as in the real
    ut_record_extraction_014 run (v1_2026-07-11_23-19-58)."""
    return [
        {"source": "base", "name": "Correctness", "score": 2,
         "rationale": "mostly correct but one compound non-atomic assertion"},
        {"source": "base", "name": "Completeness", "score": 3,
         "rationale": "all required components addressed for every person"},
        {"source": "base", "name": "Tool Arguments", "score": 3,
         "rationale": "all MCP tool calls passed appropriate arguments"},
    ]


def _ut018_base_dims():
    """The three base dimensions, scored as in the REAL
    ut_record_extraction_018 run (v1_2026-07-19_22-34-49): Correctness 2,
    Completeness 2, Tool Arguments 3. (Verified directly against the
    recovered run log — an earlier draft of the duplicate-dimension
    fixture below wrongly reused ut_014's base scores instead.)"""
    return [
        {"source": "base", "name": "Correctness", "score": 2,
         "rationale": "geocoder misfire resolved Springfield to the wrong country"},
        {"source": "base", "name": "Completeness", "score": 2,
         "rationale": "the geocoder error was flagged but not corrected"},
        {"source": "base", "name": "Tool Arguments", "score": 3,
         "rationale": "all MCP tool calls passed appropriate arguments"},
    ]


def _tool_use_response(dims):
    tool_block = SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": dims},
    )
    return SimpleNamespace(content=[tool_block])


def test_extract_dimensions_accepts_correctly_cased_rubric_dimensions(
    record_extraction_rubric,
):
    """Sanity check the new validation isn't overly strict: the real,
    correctly-cased rubric dimension names must still pass, with no
    warnings recorded."""
    dims = _record_extraction_base_dims() + [
        {"source": "rubric", "name": "Assertion atomicity", "score": 3,
         "rationale": "correct casing, matches the rubric.md heading"},
        {"source": "rubric", "name": "Informant identification", "score": 3,
         "rationale": "correct casing, matches the rubric.md heading"},
        {"source": "rubric", "name": "Evidence type accuracy", "score": 3,
         "rationale": "correct casing, matches the rubric.md heading"},
    ]
    out, warnings = judge._extract_dimensions(
        _tool_use_response(dims), record_extraction_rubric,
        tool_calls=_SOME_TOOL_CALLS,
    )
    rubric_names = [d["name"] for d in out if d["source"] == "rubric"]
    assert rubric_names == [
        "Assertion atomicity", "Informant identification", "Evidence type accuracy",
    ]
    assert warnings == []


def test_extract_dimensions_drops_all_recased_rubric_dimensions_ut014_shape(
    record_extraction_rubric,
):
    """Reproduces v1_2026-07-11_23-19-58 ut_record_extraction_014 exactly:
    the judge Title-Cased ALL THREE real dimensions, not just one. Every
    one of the three must be independently dropped — a check that only
    looks at the first or the last rubric-sourced entry would let the
    other two silently survive into the persisted run log."""
    dims = _record_extraction_base_dims() + [
        {"source": "rubric", "name": "Assertion Atomicity", "score": 2,
         "rationale": "title-cased, position 1 of 3"},
        {"source": "rubric", "name": "Informant Identification", "score": 2,
         "rationale": "title-cased, position 2 of 3"},
        {"source": "rubric", "name": "Evidence Type Accuracy", "score": 3,
         "rationale": "title-cased, position 3 of 3"},
    ]
    out, warnings = judge._extract_dimensions(
        _tool_use_response(dims), record_extraction_rubric,
        tool_calls=_SOME_TOOL_CALLS,
    )
    # Only the 3 base dims survive — none of the 3 mis-cased rubric names do.
    assert [d["name"] for d in out] == ["Correctness", "Completeness", "Tool Arguments"]
    assert {w["name"] for w in warnings} == {
        "Assertion Atomicity", "Informant Identification", "Evidence Type Accuracy",
    }
    assert all(w["kind"] == "dropped_unknown_rubric_dimension" for w in warnings)
    # The real name is surfaced in the valid-set list on every warning.
    assert all("Assertion atomicity" in w["valid_names"] for w in warnings)


def test_extract_dimensions_drops_invented_dimension_after_valid_ones_ut016_shape(
    record_extraction_rubric,
):
    """Reproduces the ut_016 incident from the #974/#1361 audit: three
    correctly-named rubric dimensions followed by a fourth, invented one
    ("Handling of suspect required identifier", no rubric.md heading
    behind it — one of the five invented names #1361's own evidence table
    cites). The three valid ones survive untouched; only the invented one
    is dropped."""
    dims = _record_extraction_base_dims() + [
        {"source": "rubric", "name": "Assertion atomicity", "score": 3,
         "rationale": "valid, position 1"},
        {"source": "rubric", "name": "Informant identification", "score": 3,
         "rationale": "valid, position 2"},
        {"source": "rubric", "name": "Evidence type accuracy", "score": 3,
         "rationale": "valid, position 3"},
        {"source": "rubric", "name": "Handling of suspect required identifier",
         "score": 3, "rationale": "invented — no matching rubric.md heading"},
    ]
    out, warnings = judge._extract_dimensions(
        _tool_use_response(dims), record_extraction_rubric,
        tool_calls=_SOME_TOOL_CALLS,
    )
    rubric_names = [d["name"] for d in out if d["source"] == "rubric"]
    assert rubric_names == [
        "Assertion atomicity", "Informant identification", "Evidence type accuracy",
    ]
    assert [w["kind"] for w in warnings] == ["dropped_unknown_rubric_dimension"]
    assert warnings[0]["name"] == "Handling of suspect required identifier"
    assert warnings[0]["valid_names"] == sorted([
        "Assertion atomicity", "Informant identification", "Evidence type accuracy",
    ])


def test_extract_dimensions_dropped_dimension_preserves_score_and_rationale(
    record_extraction_rubric,
):
    """#1361 review (S1): a dropped dimension's own score and rationale must
    survive into its warning dict, not just kind/name. Without this, a
    dropped fail (score 1) or partial (score 2) vanishes from
    judge_dimensions with no trace, and
    orchestrator._compute_outcome's `scores = [d["score"] for d in
    judge_dimensions]` can silently turn a fail/partial into a more
    lenient outcome purely because the dropped entry no longer
    contributes to that list — reachable case the review constructed:
    a dropped score-1 dimension with a substantive rationale."""
    dims = _record_extraction_base_dims() + [
        {"source": "rubric", "name": "Assertion Atomicity", "score": 1,
         "rationale": "a substantive fail rationale that must not vanish"},
        {"source": "rubric", "name": "Informant identification", "score": 3,
         "rationale": "valid, first occurrence"},
        {"source": "rubric", "name": "Evidence type accuracy", "score": 3,
         "rationale": "valid"},
        {"source": "rubric", "name": "Informant identification", "score": 2,
         "rationale": "duplicate, partial score that must not vanish either"},
    ]
    out, warnings = judge._extract_dimensions(
        _tool_use_response(dims), record_extraction_rubric,
        tool_calls=_SOME_TOOL_CALLS,
    )
    assert len(warnings) == 2
    by_kind = {w["kind"]: w for w in warnings}
    unknown = by_kind["dropped_unknown_rubric_dimension"]
    assert unknown["score"] == 1
    assert unknown["rationale"] == "a substantive fail rationale that must not vanish"
    duplicate = by_kind["dropped_duplicate_dimension"]
    assert duplicate["score"] == 2
    assert duplicate["rationale"] == "duplicate, partial score that must not vanish either"


def test_extract_dimensions_drops_rubric_dimension_under_empty_rubric():
    """Negative tests grade against empty_rubric (see orchestrator._run_judge)
    — every source:'rubric' dimension is unconditionally invalid there,
    since there is no rubric.md to validate against. Must still be
    dropped-with-warning, not silently kept (the pre-#1361 defect) and not
    silently skipped because the valid set is empty (a mutant this pins
    against: a check that no-ops when `not valid_rubric_names` would leave
    this dimension untouched)."""
    dims = _base_dims_with_tool_arguments_null() + [
        {"source": "rubric", "name": "Assertion atomicity", "score": 3,
         "rationale": "looks like a real heading, but this test's rubric is empty"},
    ]
    out, warnings = judge._extract_dimensions(
        _tool_use_response(dims), empty_rubric("record-extraction"),
        tool_calls=_SOME_TOOL_CALLS,
    )
    assert [d["name"] for d in out] == ["Correctness", "Completeness", "Tool Arguments"]
    assert [w["kind"] for w in warnings] == ["dropped_unknown_rubric_dimension"]
    assert warnings[0]["valid_names"] == []


_CORRECTNESS_NAMED_RUBRIC_MD = """\
# some-skill

Grading dimensions.

## Correctness

A rubric dimension that happens to share a name with the Correctness base
dimension — exercises that the duplicate-detection key is (source, name),
not name alone (#1361).

- **pass:** thorough
- **partial:** adequate
- **fail:** poor
"""


def test_extract_dimensions_dedup_key_is_source_and_name_not_name_alone():
    """A base dimension and a rubric dimension that happen to share a name
    are NOT duplicates of each other — the key is (source, name), so both
    must survive (#1361 acceptance criterion 3, pinning against a dedup
    key built from `name` alone)."""
    rubric = parse_rubric(_CORRECTNESS_NAMED_RUBRIC_MD)
    dims = _base_dims_with_tool_arguments_null() + [
        {"source": "rubric", "name": "Correctness", "score": 2,
         "rationale": "the rubric's own Correctness dimension, distinct from base"},
    ]
    out, warnings = judge._extract_dimensions(
        _tool_use_response(dims), rubric, tool_calls=_SOME_TOOL_CALLS
    )
    keys = [(d["source"], d["name"]) for d in out]
    assert ("base", "Correctness") in keys
    assert ("rubric", "Correctness") in keys
    assert warnings == []


def test_extract_dimensions_drops_duplicate_rubric_dimension_ut018_shape(
    record_extraction_rubric,
):
    """Reproduces v1_2026-07-19_22-34-49 ut_record_extraction_018 exactly:
    'Informant identification' emitted twice in one run's raw judge
    output, both scored 3. The duplicate is dropped with a warning; the
    first occurrence and the other two (correctly single) dimensions
    survive (#1361 acceptance criterion 3)."""
    dims = _ut018_base_dims() + [
        {"source": "rubric", "name": "Assertion atomicity", "score": 3,
         "rationale": "first dimension, correct name"},
        {"source": "rubric", "name": "Informant identification", "score": 3,
         "rationale": "first occurrence of this dimension"},
        {"source": "rubric", "name": "Evidence type accuracy", "score": 3,
         "rationale": "third dimension, correct name"},
        {"source": "rubric", "name": "Informant identification", "score": 3,
         "rationale": "duplicate occurrence, same score as the first"},
    ]
    out, warnings = judge._extract_dimensions(
        _tool_use_response(dims), record_extraction_rubric,
        tool_calls=_SOME_TOOL_CALLS,
    )
    rubric_names = [d["name"] for d in out if d["source"] == "rubric"]
    assert rubric_names == [
        "Assertion atomicity", "Informant identification", "Evidence type accuracy",
    ]
    assert [w["kind"] for w in warnings] == ["dropped_duplicate_dimension"]
    assert warnings[0]["name"] == "Informant identification"
    assert warnings[0]["source"] == "rubric"


def test_extract_dimensions_drops_duplicate_not_at_list_boundary(
    record_extraction_rubric,
):
    """The duplicate sits in the middle of the list, with a distinct valid
    dimension both before and after it — guards a dedup pass that only
    checks the first or last element of dims[] (mirrors the position-based
    coverage gap the ut014/ut016-shaped tests above close for the
    name-validity loop)."""
    dims = _record_extraction_base_dims() + [
        {"source": "rubric", "name": "Assertion atomicity", "score": 3,
         "rationale": "before the duplicate pair"},
        {"source": "rubric", "name": "Informant identification", "score": 3,
         "rationale": "first occurrence — the one that must survive"},
        {"source": "rubric", "name": "Informant identification", "score": 3,
         "rationale": "duplicate occurrence — must be dropped"},
        {"source": "rubric", "name": "Evidence type accuracy", "score": 3,
         "rationale": "after the duplicate pair"},
    ]
    out, warnings = judge._extract_dimensions(
        _tool_use_response(dims), record_extraction_rubric,
        tool_calls=_SOME_TOOL_CALLS,
    )
    rubric_names = [d["name"] for d in out if d["source"] == "rubric"]
    assert rubric_names == [
        "Assertion atomicity", "Informant identification", "Evidence type accuracy",
    ]
    assert len(warnings) == 1
    assert warnings[0]["kind"] == "dropped_duplicate_dimension"


def test_extract_dimensions_drops_duplicate_base_dimension(record_extraction_rubric):
    """The duplicate check is symmetric across both sources, not just
    rubric — a repeated base dimension is dropped (first occurrence kept)
    rather than silently collapsing to whichever instance base_by_name's
    dict lookup reaches first (#1361 acceptance criterion 3)."""
    dims = _record_extraction_base_dims()
    dims.append(dict(dims[0]))  # duplicate the first base dimension verbatim
    out, warnings = judge._extract_dimensions(
        _tool_use_response(dims), record_extraction_rubric,
        tool_calls=_SOME_TOOL_CALLS,
    )
    assert [d["name"] for d in out] == ["Correctness", "Completeness", "Tool Arguments"]
    assert [w["kind"] for w in warnings] == ["dropped_duplicate_dimension"]
    assert warnings[0]["source"] == "base"
    assert warnings[0]["name"] == "Correctness"


# --- #1361: structural garbage still raises -----------------------------
#
# A `source` outside {"base","rubric"} sails past every check above
# untouched (neither the rubric-name check nor base_by_name looks at it)
# and then fails the run-log schema's `source: enum["base","rubric"]` at
# flush time — crashing the ENTIRE run log (judge_results is
# additionalProperties:false — docs/specs/schemas/run-log.schema.json). A
# non-string `name` would raise a bare TypeError when hashed in the
# duplicate check, escaping grade()'s resample loop entirely. Neither has
# been observed in any committed run log (see the corpus-replay test
# below) — this is a defensive floor.


@pytest.mark.parametrize(
    "bad_source", ["Rubric", "rubric ", "skill", None],
    ids=["capitalized", "trailing-space", "wrong-value", "none"],
)
def test_extract_dimensions_rejects_invalid_source_value(
    bad_source, record_extraction_rubric,
):
    dims = _record_extraction_base_dims() + [
        {"source": bad_source, "name": "Assertion atomicity", "score": 3,
         "rationale": "y" * 25},
    ]
    with pytest.raises(judge.JudgeError, match="invalid source"):
        judge._extract_dimensions(
            _tool_use_response(dims), record_extraction_rubric,
            tool_calls=_SOME_TOOL_CALLS,
        )


def test_extract_dimensions_rejects_missing_source(record_extraction_rubric):
    dims = _record_extraction_base_dims() + [
        {"name": "Assertion atomicity", "score": 3, "rationale": "y" * 25},
    ]
    with pytest.raises(judge.JudgeError, match="invalid source"):
        judge._extract_dimensions(
            _tool_use_response(dims), record_extraction_rubric,
            tool_calls=_SOME_TOOL_CALLS,
        )


@pytest.mark.parametrize(
    "bad_name", [["a"], 7, None, 3.5],
    ids=["list", "int", "none", "float"],
)
def test_extract_dimensions_rejects_non_string_name(bad_name, record_extraction_rubric):
    """A non-string `name` (e.g. a list) would raise a bare, non-JudgeError
    TypeError when hashed in the duplicate-detection tuple key below,
    escaping grade()'s 3-attempt resample loop entirely. Caught here
    first, as a JudgeError, instead (#1361)."""
    dims = _record_extraction_base_dims() + [
        {"source": "rubric", "name": bad_name, "score": 3, "rationale": "y" * 25},
    ]
    with pytest.raises(judge.JudgeError, match="non-string name"):
        judge._extract_dimensions(
            _tool_use_response(dims), record_extraction_rubric,
            tool_calls=_SOME_TOOL_CALLS,
        )


def test_extract_dimensions_rejects_missing_name(record_extraction_rubric):
    dims = _record_extraction_base_dims() + [
        {"source": "rubric", "score": 3, "rationale": "y" * 25},
    ]
    with pytest.raises(judge.JudgeError, match="non-string name"):
        judge._extract_dimensions(
            _tool_use_response(dims), record_extraction_rubric,
            tool_calls=_SOME_TOOL_CALLS,
        )


# --- #1361: enum steering on the per-call tool schema --------------------


def test_grading_tool_for_rubric_constrains_name_enum(record_extraction_rubric):
    """_grading_tool_for_rubric narrows `name` to base ∪ this rubric's
    dimension names. Unenforced steering (see the function's docstring),
    not the guarantee — the drop-with-warning behavior above is that."""
    tool = judge._grading_tool_for_rubric(record_extraction_rubric)
    name_schema = (
        tool["input_schema"]["properties"]["dimensions"]["items"]["properties"]["name"]
    )
    assert set(name_schema["enum"]) == {
        "Correctness", "Completeness", "Tool Arguments",
        "Assertion atomicity", "Informant identification", "Evidence type accuracy",
    }
    # The module-level template is a deep-copy source, never mutated in place.
    template_name_schema = (
        judge.GRADING_TOOL["input_schema"]["properties"]["dimensions"]["items"]
        ["properties"]["name"]
    )
    assert "enum" not in template_name_schema


def test_grading_tool_for_rubric_empty_rubric_is_base_only():
    tool = judge._grading_tool_for_rubric(empty_rubric("some-skill"))
    name_schema = (
        tool["input_schema"]["properties"]["dimensions"]["items"]["properties"]["name"]
    )
    assert set(name_schema["enum"]) == {"Correctness", "Completeness", "Tool Arguments"}


# --- #1361: corpus replay -------------------------------------------------
#
# The missing guard the redesign needed: does the real judge output
# committed in eval/runlogs/unit/ actually survive this function without
# raising? Everything above is a hand-built fixture; this is the check
# against reality that caught the original raise-based design's blocker.
# Measured rate against the committed corpus (1873 judge draws): 2.19%
# (41 draws) would have raised under the original raise-based design once
# each run's rubric snapshot is resolved to the text actually in force at
# run time (a digest-only snapshot resolved against git history — see
# _rubric_for_snapshot's caveat below on what THIS quick guard does
# instead, which is cheaper and slightly less precise).

_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _rubric_for_snapshot(skill: str, snapshot_text, disk_rubrics: dict):
    """The rubric to replay a run log's judge output against.

    When the run log's snapshot stored rubric.md's real content directly
    (schema_version < 3, or a skill excluded from hashing), use that. When
    it stored a bare sha256 digest instead (the common case — true for
    most of the committed corpus), this does NOT resolve the digest
    against git history to recover the text that was actually in force at
    run time; it falls back to TODAY's on-disk rubric.md for that skill.
    That is a real approximation, not a stand-in for the true text: a
    rubric heading renamed since a run was made (e.g. timeline's
    "Impossibility detection" -> "Deferral of logical-impossibility
    detection", commit 5350504a) makes that run's real, contemporaneous
    dimension name look like a drop here even though it wasn't one at the
    time. This guard is deliberately cheap (no git subprocess calls) and
    exists to catch a raise, not to produce a precise drop-rate — a
    disk-fallback drop is still a drop (never a raise), so the guarantee
    this test checks (never raises) holds regardless of which rubric
    version is used; only the exact drop *count*, not the raise
    guarantee, is sensitive to this approximation.
    """
    if isinstance(snapshot_text, str) and not _HEX64.match(snapshot_text.strip()):
        try:
            return parse_rubric_or_empty(skill, snapshot_text)
        except InvalidRubricError:
            return disk_rubrics.get(skill)
    return disk_rubrics.get(skill)


def test_corpus_replay_never_raises_on_committed_run_logs():
    """Feed every committed unit run log's real judge output through
    _extract_dimensions. Must NEVER raise JudgeError for a naming/
    duplicate mismatch — only structural garbage may still raise, and
    none has been observed (see the dedicated tests above). Dropping is
    fine and expected; this only guards against the one thing the
    redesign exists to prevent: a historical judge draw that would newly
    convert a passing test into a hard `fail`.

    Rubric resolution is a fallback-to-disk approximation for most of the
    corpus, not each log's true historical rubric — see
    _rubric_for_snapshot's docstring. That affects the exact drop count
    this test would report, not the never-raises guarantee it actually
    asserts.

    Negative tests are graded against empty_rubric, matching
    orchestrator._run_judge's actual behavior.
    """
    runlogs_dir = REPO_ROOT / "eval/runlogs/unit"
    # Classify rather than glob `v1_*.json`. That literal matches neither a
    # RELEASED `v{N}.json` nor any v2+ candidate, so the first time any of the
    # 25+ skills is released — a normal step in the documented per-PR workflow,
    # not an edge case — this corpus would quietly shrink and the test would go
    # on passing over whatever was left. Nothing in the corpus is released
    # today, which is exactly why it has not been noticed.
    log_paths = sorted(
        p for p in runlogs_dir.rglob("v*.json")
        if not p.name.endswith(".ann.json")
        and classify(p.name).kind in ("released", "candidate")
    )
    assert len(log_paths) > 50, (
        f"sanity check: expected a substantial committed run-log corpus, "
        f"found {len(log_paths)} under {runlogs_dir}"
    )

    disk_rubrics: dict[str, object] = {}
    for rp in sorted((REPO_ROOT / "eval/tests/unit").glob("*/rubric.md")):
        skill = rp.parent.name
        try:
            disk_rubrics[skill] = parse_rubric_or_empty(
                skill, rp.read_text(encoding="utf-8")
            )
        except InvalidRubricError:
            disk_rubrics[skill] = None

    total_draws = 0
    dropped_total = 0
    unexpected_raises: list[str] = []
    zero_call_draws = 0
    na_coerced: set[tuple[str, str]] = set()
    na_leaked: list[str] = []

    for p in log_paths:
        d = json.loads(p.read_text(encoding="utf-8"))
        skill = d.get("skill")
        snap = d.get("snapshot") or {}
        full_rubric = _rubric_for_snapshot(
            skill, snap.get(f"eval/tests/unit/{skill}/rubric.md"), disk_rubrics
        )
        if full_rubric is None:
            continue  # unknown/unparseable skill rubric — nothing to replay against
        neg_rubric = empty_rubric(skill)

        for t in d.get("tests", []):
            rub = neg_rubric if t.get("test_type") == "negative" else full_rubric
            for r in t.get("runs", []):
                jd = r.get("judge") or {}
                if jd.get("skipped"):
                    continue
                dims = jd.get("dimensions") or []
                if not dims:
                    continue
                total_draws += 1
                # The run's OWN tool calls, never a stand-in: the #1406
                # N/A rule keys on this list being empty, so substituting
                # a placeholder here would measure the placeholder.
                run_tool_calls = (r.get("output") or {}).get("tool_calls") or []
                if not run_tool_calls:
                    zero_call_draws += 1
                try:
                    out, warns = judge._extract_dimensions(
                        _tool_use_response(dims), rub,
                        tool_calls=run_tool_calls,
                    )
                    dropped_total += len(warns)
                    if any(
                        w["kind"] == "coerced_tool_arguments_to_na" for w in warns
                    ):
                        na_coerced.add((t.get("test_id"), p.name))
                    if not run_tool_calls:
                        ta = next(
                            (x for x in out if x["name"] == "Tool Arguments"), None
                        )
                        # .get(), not [...]: a judge draw missing "score"
                        # entirely is a real historical shape, and a raw
                        # KeyError here escapes the JudgeError guard above and
                        # crashes the test instead of reporting its diagnostic.
                        if ta is not None and ta.get("score") is not None:
                            na_leaked.append(
                                f"{p.relative_to(REPO_ROOT)}::{t.get('test_id')} "
                                f"= {ta.get('score')!r}"
                            )
                except judge.JudgeError as e:
                    unexpected_raises.append(
                        f"{p.relative_to(REPO_ROOT)}::{t.get('test_id')}: {e}"
                    )

    print(
        f"\ncorpus replay: {len(log_paths)} run logs, {total_draws} judge draws, "
        f"{dropped_total} dimension(s) dropped-with-warning, "
        f"{len(unexpected_raises)} unexpected raise(s)"
    )
    # #1361 review (S2): without these two, the loop above can silently
    # process zero draws (every log's rubric resolves to None and every
    # iteration hits the `continue` above) and the test still passes,
    # since `unexpected_raises == []` holds vacuously on an empty run.
    # Mutant-verified: `return None` at the top of _rubric_for_snapshot
    # made every log skip and this test stayed green until these were
    # added. 1000 is a loose floor well under the measured 1873 draws —
    # tight enough to catch "nothing ran", loose enough not to need
    # updating as the corpus grows.
    assert total_draws > 1000, (
        f"only {total_draws} judge draws were actually replayed — the loop "
        f"may be skipping every log (e.g. every rubric resolved to None)"
    )
    assert dropped_total > 0, (
        "zero dimensions were dropped across the whole corpus — expected "
        "at least the known historical drops (unknown-name/duplicate); "
        "a value of exactly 0 here is itself suspicious, not reassuring"
    )
    assert unexpected_raises == [], (
        f"{len(unexpected_raises)} historical judge draw(s) newly raise JudgeError "
        f"under the drop-with-warning redesign — should only be structural "
        f"garbage, never observed historically: {unexpected_raises[:5]}"
    )

    # --- #1406: the Tool Arguments N/A rule, three ways -----------------
    #
    # An earlier draft of this pinned `len(na_coerced) == 3`. That number
    # was wrong twice over: it counted a run log that made a tool call (so
    # its integer score was an ordinary grade, not an N/A violation), and
    # it counted a pruned blob this rglob cannot see. Assert the property,
    # the non-vacuity, and the drift bound instead of a census.
    print(
        f"corpus replay (#1406): {zero_call_draws} zero-tool-call draws, "
        f"{len(na_coerced)} coerced to N/A -> {sorted(na_coerced)}"
    )

    # 1. PROPERTY — holds for every entry, under pruning and for run logs
    #    not yet written. This is the invariant the change installs.
    assert na_leaked == [], (
        f"{len(na_leaked)} zero-tool-call draw(s) kept a non-null Tool "
        f"Arguments score after extraction: {na_leaked[:5]}"
    )

    # 2. NON-VACUITY — without this the property above passes with the
    #    coercion deleted, since the historical corpus is overwhelmingly
    #    already-null. A skipped check is a passing check.
    assert zero_call_draws > 100, (
        f"only {zero_call_draws} zero-tool-call draws replayed — the N/A "
        f"assertions below are near-vacuous; is output.tool_calls being read?"
    )
    assert na_coerced, (
        "the N/A coercion never fired across the whole corpus — it is "
        "known to fire on ut_search_records_003; a value of zero here means "
        "the coercion is not running, not that the corpus is clean"
    )

    # 3. NO NEW DRIFT — subset, not equality: retention prunes to the
    #    newest 5 candidates per skill, so these two will age out and an
    #    equality assertion would then fail for the wrong reason. A *new*
    #    violation appearing still fails, which is the direction worth
    #    catching.
    known = {
        ("ut_search_records_003", "v1_2026-08-01_13-11-14.json"),
        ("ut_search_records_003", "v1_2026-08-06_01-03-04.json"),
    }
    assert na_coerced <= known, (
        f"a judge draw outside the known set ignored the Tool Arguments "
        f"N/A rule: {sorted(na_coerced - known)}"
    )


def test_compute_cost_for_known_model():
    usage = SimpleNamespace(
        input_tokens=1000,
        cache_read_input_tokens=800,
        output_tokens=500,
    )
    response = SimpleNamespace(usage=usage)
    cost = judge._compute_cost(response, "claude-haiku-4-5-20251001")
    # 200 fresh input * $1/M + 800 cached * $0.10/M + 500 output * $5/M
    expected = (200 * 1.0 + 800 * 0.10 + 500 * 5.0) / 1_000_000
    assert cost == pytest.approx(expected)


def test_compute_cost_unknown_model_falls_back_to_default_and_warns(capsys):
    # Reset the per-process warn-once cache so this test is independent.
    judge._warned_about_pricing.discard("never-heard-of-it")
    usage = SimpleNamespace(
        input_tokens=1000,
        cache_read_input_tokens=0,
        output_tokens=500,
    )
    response = SimpleNamespace(usage=usage)
    cost = judge._compute_cost(response, "never-heard-of-it")
    # Default fallback is Sonnet-class rates.
    expected = (1000 * 3.0 + 500 * 15.0) / 1_000_000
    assert cost == pytest.approx(expected)
    err = capsys.readouterr().err
    assert "never-heard-of-it" in err
    assert "JUDGE_PRICING" in err


def test_known_extra_models_priced_nonzero():
    """Sonnet 4.6 and Opus 4.7 should have entries so explicit judge-model
    overrides produce non-zero cost."""
    for model in ("claude-sonnet-4-6", "claude-opus-4-7"):
        assert model in judge.JUDGE_PRICING
        assert judge.JUDGE_PRICING[model]["input"] > 0


def test_summarize_response_truncates_long_strings():
    long = "x" * (judge._RESPONSE_STRING_MAX + 100)
    out = judge._summarize_response(long)
    assert "truncated by harness" in out
    assert str(len(long)) in out  # full length surfaced


def test_summarize_response_short_string_unchanged():
    """A typical Wikipedia extract (~300 chars) must NOT be truncated."""
    assert judge._summarize_response("short") == "short"
    medium = "x" * 1500  # under the cap
    assert judge._summarize_response(medium) == medium


def test_summarize_response_dict_recurses():
    out = judge._summarize_response(
        {"a": "x" * (judge._RESPONSE_STRING_MAX + 1), "b": 42}
    )
    assert "truncated by harness" in out["a"]
    assert out["b"] == 42


def test_summarize_response_small_array_passed_through():
    """Arrays at or under the sample size are returned intact."""
    assert judge._summarize_response([1, 2, 3]) == [1, 2, 3]


def test_summarize_response_large_array_keeps_length_and_sample():
    arr = list(range(20))
    out = judge._summarize_response(arr)
    assert out["_summary_truncated"] is True
    assert out["_full_length"] == 20
    assert out["_first_n"] == [0, 1, 2]


def test_summarize_response_nested_array_in_dict():
    out = judge._summarize_response({"hits": [{"title": "X" * 5000}] * 10})
    assert out["hits"]["_full_length"] == 10
    assert "truncated by harness" in out["hits"]["_first_n"][0]["title"]


def test_render_prompt_uses_summarized_responses(sample_rubric):
    prompt = judge.render_prompt(
        rubric=sample_rubric,
        judge_context=[],
        scenario_readme="",
        user_message="x",
        skills_invoked=[],
        text_response="",
        file_changes_summary="",
        tool_calls=[
            {
                "tool": "mcp__genealogy__record_search",
                "args": {"q": "Flynn"},
                "matched": {"kind": "predicate", "index": None},
                "response": {"results": ["A" * 5000] * 50},  # huge
            }
        ],
    )
    # The 50-element array should be condensed with an explicit marker.
    assert "_summary_truncated" in prompt
    assert "_full_length" in prompt
    # The 5000-char string inside should also be flagged truncated.
    assert "truncated by harness" in prompt


def test_tool_calls_size_guard_drops_oldest_when_over_cap():
    """The total-size guard drops oldest tool calls when the rendered JSON
    exceeds _TOOL_CALLS_MAX_CHARS."""
    # Build many calls; each has a large response that survives the
    # per-response summariser (under 2KB strings), so the total grows linearly.
    calls = [
        {
            "tool": f"mcp__genealogy__tool_{i}",
            "args": {"q": f"call-{i}"},
            "matched": {"kind": "predicate", "index": None},
            "response": {"data": "x" * 1500},  # ~1500 chars per call
        }
        for i in range(100)  # ~150K chars total
    ]
    rendered = judge._render_tool_calls_with_size_guard(calls)
    assert "_dropped_for_size" in rendered
    # Should fit under the cap after dropping.
    assert len(rendered) <= judge._TOOL_CALLS_MAX_CHARS + 500  # +marker overhead


def test_tool_calls_no_drop_when_under_cap():
    calls = [
        {"tool": "mcp__genealogy__x", "args": {"q": "y"},
         "matched": {"kind": "predicate", "index": None},
         "response": {"title": "small"}}
    ]
    rendered = judge._render_tool_calls_with_size_guard(calls)
    assert "_dropped_for_size" not in rendered


def test_tool_calls_empty_returns_none_marker():
    assert judge._render_tool_calls_with_size_guard([]) == "(none)"


def _prompt_parts_kwargs(sample_rubric):
    return dict(
        rubric=sample_rubric,
        judge_context=["save to file"],
        scenario_readme="readme",
        user_message="look up X",
        skills_invoked=["citation"],
        text_response="text",
        file_changes_summary="changes",
        tool_calls=[],
    )


def test_render_prompt_parts_splits_at_context_boundary(sample_rubric):
    """The stable prefix ends at the first VARYING section so the rubric
    (constant per skill) is cacheable.

    The boundary was `# Per-test context` until that section moved down
    beside `How to report` (#1403), leaving `# Before-state` first. The
    marker has to track that move: everything before it is substituted
    from `stable_slots`, which holds only `{rubric}`.
    """
    prefix, suffix = judge.render_prompt_parts(**_prompt_parts_kwargs(sample_rubric))
    # Prefix must contain rubric (stable) but NOT the per-test context (varying).
    assert "Evidence Explained compliance" in prefix  # rubric content
    assert "save to file" not in prefix
    # Suffix has the per-test content and starts at the boundary.
    assert suffix.startswith("# Before-state")
    assert "save to file" in suffix
    assert "look up X" in suffix


def test_render_prompt_parts_leaves_no_unsubstituted_slot(sample_rubric):
    """No `{slot}` may survive rendering, in either half.

    This is the assertion that catches a split marker set too late.
    `render_prompt_parts` substitutes the prefix from `stable_slots` and
    the suffix from `varying_slots`, passing anything unmatched through
    verbatim — so moving the marker below a varying slot ships a prompt
    containing the literal text "{user_message}" and the judge grades
    nothing. Every heading-order assertion in this file still passes in
    that state, because the headings are all still there; only the slots
    go dead. Guards every future edit to prompt.md, not just this one.
    """
    prefix, suffix = judge.render_prompt_parts(**_prompt_parts_kwargs(sample_rubric))
    leftovers = judge._SLOT_RE.findall(prefix + suffix)
    assert leftovers == [], (
        f"unsubstituted slot(s) survived rendering: {leftovers} — is the "
        f"split_marker in render_prompt_parts below one of them?"
    )


def test_render_prompt_puts_per_test_context_last(sample_rubric):
    """The per-test override renders AFTER the transcript it applies to
    and immediately before the reporting instruction it modifies (#1403).

    Asserted on ORDER, not presence: a presence check passes with the
    section back in its old position two thousand tokens earlier, which
    is the arrangement this change exists to undo.
    """
    prompt = judge.render_prompt(**_prompt_parts_kwargs(sample_rubric))
    tool_calls_at = prompt.index("## MCP tool calls")
    context_at = prompt.index("# Per-test context")
    override_at = prompt.index("save to file")
    report_at = prompt.index("# How to report")
    assert tool_calls_at < context_at < override_at < report_at

    # The two sentences the move must not destroy. Both are load-bearing:
    # the first is #1401's only prose defence against invented dimensions,
    # the second is the rule #1406 now enforces in the harness.
    assert "**Do not emit separate dimensions for them.**" in prompt
    assert "the test made zero MCP tool calls. Report" in prompt
    # And the precedence block the override rule now leans on.
    assert "# Which rule wins" in prompt
    assert prompt.index("# Which rule wins") < context_at


def test_render_prompt_concatenation_matches_parts(sample_rubric):
    """render_prompt() must equal prefix + suffix from render_prompt_parts."""
    kwargs = dict(
        rubric=sample_rubric,
        judge_context=[],
        scenario_readme="",
        user_message="x",
        skills_invoked=[],
        text_response="",
        file_changes_summary="",
        tool_calls=[],
    )
    prompt = judge.render_prompt(**kwargs)
    prefix, suffix = judge.render_prompt_parts(**kwargs)
    assert prompt == prefix + suffix


def test_grading_tool_schema_matches_spec():
    """The spec §7 defines the submit_grading schema; this test pins it."""
    schema = judge.GRADING_TOOL["input_schema"]
    assert schema["required"] == ["dimensions"]
    item_schema = schema["properties"]["dimensions"]["items"]
    assert set(item_schema["required"]) == {"source", "name", "score", "rationale"}
    assert set(item_schema["properties"]["source"]["enum"]) == {"base", "rubric"}
    # Score is `anyOf` — {1,2,3} integer OR null. Null is permitted only on
    # Tool Arguments; the per-name enforcement lives in _extract_dimensions.
    score_schema = item_schema["properties"]["score"]
    options = score_schema["anyOf"]
    enum_branch = next(b for b in options if "enum" in b)
    null_branch = next(b for b in options if b.get("type") == "null")
    assert set(enum_branch["enum"]) == {1, 2, 3}
    assert null_branch == {"type": "null"}
    assert item_schema["properties"]["rationale"]["minLength"] == 20


# --- sampling / temperature pinning -------------------------------------


class _RecordingClient:
    """Fake Anthropic client: records create() kwargs, replays scripted responses."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)


def _usage():
    return SimpleNamespace(
        input_tokens=10, cache_read_input_tokens=0, output_tokens=5
    )


def _parseable_response():
    tool_block = SimpleNamespace(
        type="tool_use",
        name="submit_grading",
        input={"dimensions": _base_dims_with_tool_arguments_null()},
    )
    return SimpleNamespace(
        content=[tool_block], stop_reason="tool_use", usage=_usage()
    )


def _malformed_response():
    """A draw _extract_dimensions rejects — dimensions is not a list."""
    tool_block = SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": "nonsense"},
    )
    return SimpleNamespace(
        content=[tool_block], stop_reason="tool_use", usage=_usage()
    )


def _grade_with(monkeypatch, rubric, responses):
    client = _RecordingClient(responses)
    monkeypatch.setattr(judge, "_make_client", lambda auth: client)
    out = judge.grade(
        rubric=rubric,
        judge_context=[],
        scenario_readme="",
        user_message="do the thing",
        skills_invoked=[],
        text_response="done",
        file_changes_summary="",
        tool_calls=[],
        auth=SimpleNamespace(api_key="test-key"),
    )
    return client, out


def test_judge_first_sample_is_temperature_pinned(sample_rubric, monkeypatch):
    """One transcript should grade the same way run to run."""
    client, _ = _grade_with(monkeypatch, sample_rubric, [_parseable_response()])
    assert len(client.calls) == 1
    assert client.calls[0]["temperature"] == 0.0
    assert judge.JUDGE_TEMPERATURE == 0.0


def test_grade_sends_rubric_constrained_tool_schema(sample_rubric, monkeypatch):
    """grade() must send the API a per-rubric tool schema (#1361 enum
    steering), not the bare module-level GRADING_TOOL template."""
    client, _ = _grade_with(monkeypatch, sample_rubric, [_parseable_response()])
    sent_tool = client.calls[0]["tools"][0]
    name_enum = (
        sent_tool["input_schema"]["properties"]["dimensions"]["items"]
        ["properties"]["name"]["enum"]
    )
    assert "Evidence Explained compliance" in name_enum  # from citation rubric.md
    assert "Correctness" in name_enum


def test_judge_resample_drops_back_to_default_sampling(sample_rubric, monkeypatch):
    """The re-sample loop recovers from a malformed draw only if the retry can
    draw something *different*. Pinned at temperature=0 the retry would re-decode
    the identical prompt to the identical bad output, silently turning three
    attempts into one. Retries must therefore omit the pin.
    """
    client, out = _grade_with(
        monkeypatch, sample_rubric, [_malformed_response(), _parseable_response()]
    )
    assert len(client.calls) == 2
    assert client.calls[0]["temperature"] == 0.0
    assert "temperature" not in client.calls[1]
    assert [d["name"] for d in out.dimensions] == [
        "Correctness",
        "Completeness",
        "Tool Arguments",
    ]


def _recased_rubric_dimension_response():
    """A first draw that Title-Cases a real rubric dimension name — the
    same #1361 defect as the ut_record_extraction_014 fixtures above, but
    exercised here through the full grade() call rather than a bare
    _extract_dimensions() call."""
    dims = _base_dims_with_tool_arguments_null() + [
        {"source": "rubric", "name": "Evidence Explained Compliance", "score": 2,
         "rationale": "title-cased variant of the real dimension name"},
    ]
    tool_block = SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": dims},
    )
    return SimpleNamespace(
        content=[tool_block], stop_reason="tool_use", usage=_usage()
    )


def test_judge_drops_recased_rubric_dimension_without_resampling(
    sample_rubric, monkeypatch
):
    """The scenario the whole redesign responds to: a first cut of #1361
    raised JudgeError here, forcing a resample (or, taken to its literal
    conclusion, failing the run outright once resamples were exhausted on
    a prompt-correlated mistake). The corpus replay showed that's wrong —
    the judge re-types rubric headings from raw markdown and routinely
    mis-cases or truncates them, so this needed to stop being fatal. Now
    the FIRST draw succeeds outright: the mis-cased dimension is dropped,
    a warning records exactly what and why, and the run is graded on its
    remaining valid dimensions instead of being wasted on a resample or
    failed."""
    client, out = _grade_with(
        monkeypatch,
        sample_rubric,
        [_recased_rubric_dimension_response()],
    )
    assert len(client.calls) == 1  # no resample needed
    assert [d["name"] for d in out.dimensions] == [
        "Correctness", "Completeness", "Tool Arguments",
    ]
    assert [w["kind"] for w in out.warnings] == ["dropped_unknown_rubric_dimension"]
    assert out.warnings[0]["name"] == "Evidence Explained Compliance"


def test_create_message_omits_temperature_when_none():
    """None omits the kwarg rather than hardcoding whatever the API default is."""
    client = _RecordingClient([_parseable_response()])
    judge._create_message_with_retry(
        client=client, model="m", prefix="p", suffix="s",
        grading_tool=judge.GRADING_TOOL, temperature=None,
    )
    assert "temperature" not in client.calls[0]
