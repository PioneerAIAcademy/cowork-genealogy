"""Unit tests for orchestrator's pure helpers — outcome computation."""

from types import SimpleNamespace

from harness.loader import load_test_from_dict
from harness.orchestrator import (
    _summarize_changes,
    _summarize_before_state_sources,
    _build_warnings,
    _compute_outcome,
    _COMMISSION_VALIDATORS,
    _negative_judge_context,
    _routing_short_circuit_skills,
    apply_deterministic_deference,
    flag_routing_negative_judge_fail,
)


# --- Skill-tool contract drift -----------------------------------------


def test_no_unread_skill_warning_on_a_clean_run():
    assert _build_warnings([], unread_skill_calls=[]) == []


def test_unread_skill_call_warns_and_names_the_keys_seen():
    """The only surface that reports Skill-tool drift. It has to name the
    keys the SDK actually sent — that string is what tells whoever reads the
    run log which key to add to SKILL_TOOL_NAME_KEYS."""
    warnings = _build_warnings(
        [],
        unread_skill_calls=[["args", "skill_name"], ["skill_name"]],
    )

    assert [w["kind"] for w in warnings] == ["unread_skill_call"]
    assert warnings[0]["observed_keys"] == ["args", "skill_name"]
    assert "2 Skill tool call(s)" in warnings[0]["advisory"]
    assert "skill_name" in warnings[0]["advisory"]


# --- deterministic-validator deference ---------------------------------


def _vr(name, passed):
    return SimpleNamespace(name=name, passed=passed)


def test_deference_floors_classification_fail_when_validator_passed():
    """A passing expected_classifications validator floors Evidence type
    accuracy / Informant identification from 1 to 2 — the deterministic check
    verified the classifications, so the judge cannot fail them."""
    dims = [
        {"name": "Evidence type accuracy", "score": 1, "rationale": "should be indirect"},
        {"name": "Informant identification", "score": 1, "rationale": "x"},
        {"name": "Correctness", "score": 3, "rationale": "ok"},
    ]
    apply_deterministic_deference(
        dims,
        [_vr("test_expected_classifications", True), _vr("test_id_references_resolve", True)],
        has_expected_classifications=True,
    )
    assert [d["score"] for d in dims] == [2, 2, 3]
    assert "deterministic-deference" in dims[0]["rationale"]
    assert "should be indirect" in dims[0]["rationale"]  # original preserved


def test_deference_noop_when_validator_failed():
    """If the expected_classifications validator FAILED, the judge's fail
    stands — the deterministic check did not verify the classifications."""
    dims = [{"name": "Evidence type accuracy", "score": 1, "rationale": "wrong"}]
    apply_deterministic_deference(
        dims,
        [_vr("test_expected_classifications", False)],
        has_expected_classifications=True,
    )
    assert dims[0]["score"] == 1


def test_deference_noop_without_expected_classifications():
    dims = [{"name": "Evidence type accuracy", "score": 1, "rationale": "wrong"}]
    apply_deterministic_deference(
        dims, [_vr("test_expected_classifications", True)], has_expected_classifications=False
    )
    assert dims[0]["score"] == 1


def test_deference_leaves_partial_and_pass_and_non_classification_dims_untouched():
    """Only a score of 1 on a classification dimension is floored; a 2, a 3,
    and non-classification dimensions (e.g. Correctness) are never touched."""
    dims = [
        {"name": "Evidence type accuracy", "score": 2, "rationale": "x"},
        {"name": "Informant identification", "score": 3, "rationale": "x"},
        {"name": "Correctness", "score": 1, "rationale": "fabricated a value"},
        {"name": "Assertion atomicity", "score": 1, "rationale": "compound"},
    ]
    apply_deterministic_deference(
        dims, [_vr("test_expected_classifications", True)], has_expected_classifications=True
    )
    assert [d["score"] for d in dims] == [2, 3, 1, 1]
    # Score alone cannot catch a widened predicate: a 2 floored to 2 looks
    # identical. The deference prefix on the rationale is the observable
    # difference, so assert on that too.
    for d in dims:
        assert "deterministic-deference" not in (d["rationale"] or "")


# --- routing deference (correctly-routed negative tests) ----------------
#
# `_negative_spec` is defined further down this file; these tests are placed
# here to sit beside the deference tests they mirror, and Python resolves the
# name at call time.


def _routing_dims(correctness=1, completeness=1):
    return [
        {"name": "Correctness", "score": correctness, "rationale": "No such routing occurred"},
        {"name": "Completeness", "score": completeness, "rationale": "nothing was done"},
        {"name": "Tool Arguments", "score": None, "rationale": "no calls"},
    ]


def test_judge_fail_on_correctly_routed_negative_is_reported_not_floored():
    """The behaviour change: scores are left exactly as the judge set them.

    This used to floor 1 -> 2. Replaying the floor's own guards over the 121
    committed run logs, a human confirmed the judge's 1 on 20 of the 24
    floor-eligible cells, so the floor overrode a correct grade far more often
    than a wrong one."""
    dims = _routing_dims()
    warnings: list = []
    flag_routing_negative_judge_fail(
        dims,
        spec=_negative_spec(correct=["search-records"]),
        activated=False,
        skills_invoked=["search-records"],
        warnings=warnings,
    )
    assert [d["score"] for d in dims] == [1, 1, None]
    # Assert the RATIONALE too: a score-only assertion could not catch a
    # reintroduced floor that rewrote the text but happened to keep the 1.
    assert dims[0]["rationale"] == "No such routing occurred"
    assert [w["kind"] for w in warnings] == [
        "routing_negative_judge_fail",
        "routing_negative_judge_fail",
    ]


def test_reported_warning_carries_the_judge_score_and_rationale():
    """`rubric-critic` flags dimensions that never fail, so the 1 has to stay
    trendable — and this is now the ONLY signal that the skill may have done its
    own task inline while `skills_invoked` was empty."""
    dims = _routing_dims()
    warnings: list = []
    flag_routing_negative_judge_fail(
        dims,
        spec=_negative_spec(correct=["search-records"]),
        activated=False,
        skills_invoked=["search-records"],
        warnings=warnings,
    )
    assert [w["name"] for w in warnings] == ["Correctness", "Completeness"]
    assert all(w["score"] == 1 for w in warnings)
    assert warnings[0]["rationale"] == "No such routing occurred"


def test_no_warning_when_the_judge_did_not_fail():
    dims = _routing_dims(correctness=3, completeness=3)
    warnings: list = []
    flag_routing_negative_judge_fail(
        dims,
        spec=_negative_spec(correct=["search-records"]),
        activated=False,
        skills_invoked=["search-records"],
        warnings=warnings,
    )
    assert warnings == []


def test_no_warning_when_skill_activated():
    """The skill under test activated, so the negative test FAILED on routing.
    Nothing diagnostic to report."""
    dims = _routing_dims()
    warnings: list = []
    flag_routing_negative_judge_fail(
        dims,
        spec=_negative_spec(correct=["search-records"]),
        activated=True,
        skills_invoked=["search-records"],
        warnings=warnings,
    )
    assert [d["score"] for d in dims] == [1, 1, None]
    assert warnings == []


def test_no_warning_when_no_accepted_skill_fired():
    """Declined but routed nowhere acceptable: the test fails on routing."""
    dims = _routing_dims()
    warnings: list = []
    flag_routing_negative_judge_fail(
        dims,
        spec=_negative_spec(correct=["search-records"]),
        activated=False,
        skills_invoked=["timeline"],
        warnings=warnings,
    )
    assert warnings == []


def test_no_warning_on_out_of_scope_negative():
    """An empty `correct_skill` is out-of-scope, where the base dimensions DO
    gate the outcome in `_compute_outcome`. A 1 there IS the outcome, not a
    diagnostic worth flagging."""
    dims = _routing_dims()
    warnings: list = []
    flag_routing_negative_judge_fail(
        dims,
        spec=_negative_spec(correct=[]),
        activated=False,
        skills_invoked=[],
        warnings=warnings,
    )
    assert [d["score"] for d in dims] == [1, 1, None]
    assert warnings == []


def test_no_warning_on_grade_on_invariant():
    dims = _routing_dims()
    warnings: list = []
    flag_routing_negative_judge_fail(
        dims,
        spec=_negative_spec(correct=["search-records"], grade_on_invariant=True),
        activated=False,
        skills_invoked=["search-records"],
        warnings=warnings,
    )
    assert warnings == []


def test_no_warning_on_positive_test():
    """Covered by the same `any(correct)` guard as an out-of-scope negative: the
    schema forbids a positive test a `negative` block, so `correct` is empty."""
    dims = _routing_dims()
    warnings: list = []
    spec = load_test_from_dict({
        "test": {"id": "ut_o_003", "skill": "search-records", "name": "n",
                 "type": "positive", "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    })
    flag_routing_negative_judge_fail(
        dims,
        spec=spec,
        activated=False,
        skills_invoked=["search-records"],
        warnings=warnings,
    )
    assert [d["score"] for d in dims] == [1, 1, None]
    assert warnings == []


# --- judge error handling (item #27) -----------------------------------

import asyncio
from pathlib import Path
from unittest.mock import patch

import pytest

from harness import orchestrator
from harness.auth import AuthConfig
from harness.judge import JudgeError
from harness.loader import load_test
from harness.orchestrator import OrchestratorPaths, _run_one_test_async


REPO_ROOT = Path(__file__).resolve().parents[4]
WIKI_TEST_PATH = REPO_ROOT / "eval/tests/unit/search-wikipedia/simple-topic-lookup.json"


def test_judge_error_in_run_records_skip_with_error(tmp_path, monkeypatch):
    """Bug #3: a JudgeError must not crash the suite. The run records
    skipped=true with the error captured, and assemble_test_entry succeeds."""
    spec = load_test(WIKI_TEST_PATH)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")

    # Monkey-patch the skill runner to return a successful stub (no SDK
    # call). Also write the expected output file so the search-wikipedia
    # validators (test_wrote_one_markdown_file +
    # test_slug_schuylkill_county_pennsylvania +
    # test_saved_file_matches_template) pass — otherwise this test would
    # exercise the validator-failed branch instead of the judge-error
    # branch it is meant to cover.
    #
    # The stubbed file and the stubbed tool response have to agree: the
    # saved-file validator compares one against the other byte-for-byte,
    # so a response of {"title": "X"} beside a Schuylkill County file
    # fails the run before the judge is ever reached.
    stub_response = {
        "title": "Schuylkill County, Pennsylvania",
        "extract": "stub extract",
        "url": "https://en.wikipedia.org/wiki/Schuylkill_County,_Pennsylvania",
    }

    async def fake_run_skill(**kwargs):
        from harness.skill_runner import SkillRunResult
        workspace = kwargs["workspace"]
        (workspace / "schuylkill-county-pennsylvania.md").write_text(
            f"# {stub_response['title']}\n\n{stub_response['extract']}\n\n"
            f"---\n[Source]({stub_response['url']})\n",
            encoding="utf-8",
        )
        return SkillRunResult(
            text_response="I saved the file.",
            skills_invoked=["search-wikipedia"],
            tool_calls=[
                # LIVE, so this test also covers the production wiring of
                # #1000's two new fields — the retention rule keeps a live
                # response, and reverting either call site in
                # `_run_one_test_async` must fail something.
                {"tool": "mcp__genealogy__wikipedia_search", "args": {"query": "X"},
                 "matched": {"kind": "live", "index": None},
                 "response_fixture": "live:wikipedia_search",
                 "response": stub_response},
            ],
            duration_ms=10.0,
            usage={"total_cost_usd": 0.01, "usage": {"input_tokens": 100,
                  "output_tokens": 10, "cache_read_input_tokens": 50}},
            # One emitted call, one predicate-matched tool_call → covered.
            # The uncovered-call gate (WS1) must NOT fire here, so the run
            # still reaches the judge and exercises the judge-error path.
            attempted_mcp_calls=[
                {"tool": "mcp__genealogy__wikipedia_search", "args": {"query": "X"}}
            ],
        )

    # Make the judge layer always raise.
    def fake_grade(**kwargs):
        raise JudgeError("synthetic judge failure")

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    monkeypatch.setattr(orchestrator, "grade", fake_grade)

    entry = asyncio.run(_run_one_test_async(
        spec=spec, auth=auth, paths=paths,
        model="claude-sonnet-4-6", judge_model="claude-haiku-4-5-20251001",
        timestamp="2026-05-18_10-30-00",
    ))

    # Did NOT crash. Judge recorded with skipped=true + error.
    assert entry["runs"][0]["judge"]["skipped"] is True
    assert "synthetic judge failure" in entry["runs"][0]["judge"]["error"]
    # v1.7 fix: outcome must be "fail" — empty judge_dimensions can't
    # silently satisfy "every dimension scored pass" (spec §7).
    assert entry["outcome"] == "fail"

    # --- #1000: the PRODUCTION WIRING, not the helpers -----------------------
    #
    # Every other test for these fields drives a helper directly, so reverting
    # either call site in `_run_one_test_async` — the path that wrote all 1,945
    # committed entries — left the whole suite green. Only the aborted path (11
    # entries) was pinned. These four assertions close that, and they belong in
    # this test because it is the one that already drives the real function end
    # to end.
    #
    # It matters here specifically because ABSENT means "predates #1000": a
    # refactor dropping either line yields fresh run logs that misrepresent
    # themselves as old ones, with CI green.
    assert entry["grading_mode"] == "dimensions"
    assert entry["dimensions_gate_outcome"] is True
    live = entry["runs"][0]["output"]["tool_calls"][0]
    assert live["matched"]["kind"] == "live"
    assert live["response"] == stub_response, "a live response survives the projection"


def test_uncovered_tool_call_continues_to_judge(tmp_path, monkeypatch):
    """Phase 2 (Type 2): a skill that emits an MCP call to an existing tool
    but with args that don't match any fixture continues to the judge (rather
    than aborting). The judge sees the fixture_not_found error and typically
    fails the test on Tool Arguments."""
    spec = load_test(WIKI_TEST_PATH)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")

    async def fake_run_skill(**kwargs):
        from harness.skill_runner import SkillRunResult
        # The model emitted a wikipedia_search call. The tool exists but
        # the call didn't match any fixture (tool_calls empty but tool is
        # registered) — Type 2.
        return SkillRunResult(
            text_response="(produced from an error response)",
            skills_invoked=["search-wikipedia"],
            tool_calls=[],
            duration_ms=10.0,
            usage={"total_cost_usd": 0.0, "usage": {}},
            attempted_mcp_calls=[
                {"tool": "mcp__genealogy__wikipedia_search", "args": {"query": "X"}}
            ],
            registered_mcp_tools={"wikipedia_search"},  # Tool exists, but call didn't match fixture
        )

    # Stub validators to pass (search-wikipedia has validators that check for
    # output files, which we didn't create). We want to test the judge, not
    # validators, so make validators trivially pass.
    monkeypatch.setattr(orchestrator, "run_validators", lambda **kw: [])

    # The judge should be called and will see the uncovered call warning.
    # Stub it to return failing scores.
    from harness.judge import JudgeOutput
    def fake_run_judge(**kwargs):
        return JudgeOutput(
            dimensions=[
                {"source": "base", "name": "Correctness", "score": 1, "rationale": "fixture_not_found error"},
                {"source": "base", "name": "Completeness", "score": 1, "rationale": "incomplete"},
                {"source": "base", "name": "Tool Arguments", "score": 1, "rationale": "matched.kind == none"},
            ],
            cost_usd=0.0,
            input_tokens=0,
            cached_input_tokens=0,
            output_tokens=0,
            prompt_hash="stub-hash",
        )

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    monkeypatch.setattr(orchestrator, "_run_judge", fake_run_judge)

    entry = asyncio.run(_run_one_test_async(
        spec=spec, auth=auth, paths=paths,
        model="claude-sonnet-4-6", judge_model="claude-haiku-4-5-20251001",
        timestamp="2026-05-20_10-30-00",
    ))

    # Phase 2 (Type 2): no abort, continues to judge which fails it
    run = entry["runs"][0]
    assert entry["outcome"] == "fail"
    assert run["aborted_reason"] is None
    assert run["judge"]["skipped"] is False
    # The uncovered_tool_call warning still carries the attempted-call detail.
    warnings = run["output"].get("warnings", [])
    assert any(w["kind"] == "uncovered_tool_call" for w in warnings)


def test_judge_dimension_warnings_flow_into_output_warnings(tmp_path, monkeypatch):
    """#1361: a dropped judge dimension (unknown/duplicate rubric name) is
    recorded on JudgeOutput.warnings — judge_results has no warnings field
    of its own (additionalProperties:false on that schema object), so it
    must be folded into the skill-level output.warnings instead. A clean
    run (matched tool call, no uncovered calls) isolates the wiring."""
    spec = load_test(WIKI_TEST_PATH)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")

    async def fake_run_skill(**kwargs):
        from harness.skill_runner import SkillRunResult
        workspace = kwargs["workspace"]
        (workspace / "schuylkill-county-pennsylvania.md").write_text(
            "# Schuylkill County, Pennsylvania\n\nstub extract\n\nhttps://example/\n",
            encoding="utf-8",
        )
        return SkillRunResult(
            text_response="I saved the file.",
            skills_invoked=["search-wikipedia"],
            tool_calls=[
                {"tool": "mcp__genealogy__wikipedia_search", "args": {"query": "X"},
                 "matched": {"kind": "predicate", "index": None},
                 "response_fixture": "some-fixture"}
            ],
            duration_ms=10.0,
            usage={"total_cost_usd": 0.0, "usage": {}},
            attempted_mcp_calls=[
                {"tool": "mcp__genealogy__wikipedia_search", "args": {"query": "X"}}
            ],
            registered_mcp_tools={"wikipedia_search"},
        )

    monkeypatch.setattr(orchestrator, "run_validators", lambda **kw: [])

    from harness.judge import JudgeOutput

    def fake_run_judge(**kwargs):
        return JudgeOutput(
            dimensions=[
                {"source": "base", "name": "Correctness", "score": 3, "rationale": "fine"},
                {"source": "base", "name": "Completeness", "score": 3, "rationale": "fine"},
                {"source": "base", "name": "Tool Arguments", "score": 3, "rationale": "fine"},
            ],
            warnings=[{
                "kind": "dropped_unknown_rubric_dimension",
                "advisory": "judge emitted rubric dimension 'X', not found in the rubric",
                "name": "X",
                "valid_names": [],
            }],
            cost_usd=0.0,
            input_tokens=0,
            cached_input_tokens=0,
            output_tokens=0,
            prompt_hash="stub-hash",
        )

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    monkeypatch.setattr(orchestrator, "_run_judge", fake_run_judge)

    entry = asyncio.run(_run_one_test_async(
        spec=spec, auth=auth, paths=paths,
        model="claude-sonnet-4-6", judge_model="claude-haiku-4-5-20251001",
        timestamp="2026-05-20_10-30-00",
    ))

    run = entry["runs"][0]
    # judge_results itself carries no warnings (additionalProperties:false).
    assert "warnings" not in run["judge"]
    warnings = run["output"].get("warnings", [])
    dropped = [w for w in warnings if w["kind"] == "dropped_unknown_rubric_dimension"]
    assert len(dropped) == 1
    assert dropped[0]["name"] == "X"


def _positive_spec(skill="search-wikipedia"):
    return load_test_from_dict({
        "test": {"id": "ut_o_001", "skill": skill, "name": "n", "type": "positive",
                  "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    })


_SENTINEL = object()


def _negative_spec(skill="record-extraction", correct=_SENTINEL, grade_on_invariant=False):
    if correct is _SENTINEL:
        correct = ["search-records"]
    negative = {"correct_skill": correct, "explanation": "x"}
    if grade_on_invariant:
        negative["grade_on_invariant"] = True
    return load_test_from_dict({
        "test": {"id": "ut_o_002", "skill": skill, "name": "n", "type": "negative",
                  "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "negative": negative,
        "judge_context": [],
    })


# --- routing short-circuit (negative-test speedup) -----------------------


def test_routing_short_circuit_negative_returns_correct_skill_set():
    spec = _negative_spec(correct=["proof-conclusion", "conflict-resolution"])
    assert _routing_short_circuit_skills(spec) == {
        "proof-conclusion",
        "conflict-resolution",
    }


def test_routing_short_circuit_none_for_positive_test():
    assert _routing_short_circuit_skills(_positive_spec()) is None


def test_routing_short_circuit_none_for_out_of_scope_negative():
    # correct_skill == [] (out-of-scope): must run normally to be graded.
    assert _routing_short_circuit_skills(_negative_spec(correct=[])) is None


# --- positive tests ------------------------------------------------------


def test_positive_fails_when_validators_failed():
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=False, judge_dimensions=[],
        aborted_reason=None, activated=True, skills_invoked=["search-wikipedia"],
    ) == "fail"


def test_positive_fails_when_not_activated():
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason=None, activated=False, skills_invoked=["search-wikipedia"],
    ) == "fail"


def test_positive_fails_when_skill_not_in_skills_invoked():
    """Bug #6 fix: previously the dead-branch logic let this pass."""
    spec = _positive_spec()
    # Skill produced a file write (activated=True) but never went through
    # the Skill tool, so skills_invoked is empty. Must fail.
    dims = [{"source": "base", "name": "Correctness", "score": 3,
             "rationale": "looks fine"}]
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=True, skills_invoked=[],
    ) == "fail"


def test_positive_passes_with_skill_invoked_and_all_dims_pass():
    spec = _positive_spec()
    dims = [
        {"source": "base", "name": "Correctness", "score": 3, "rationale": "x"},
        {"source": "rubric", "name": "Tool usage", "score": 3, "rationale": "x"},
    ]
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=True, skills_invoked=["search-wikipedia"],
    ) == "pass"


def test_positive_partial_when_any_dim_partial():
    spec = _positive_spec()
    dims = [
        {"source": "base", "name": "Correctness", "score": 3, "rationale": "x"},
        {"source": "rubric", "name": "File handling", "score": 2, "rationale": "x"},
    ]
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=True, skills_invoked=["search-wikipedia"],
    ) == "partial"


# --- negative tests ------------------------------------------------------


def test_negative_fails_when_skill_under_test_activated():
    """Negative test fails iff the skill under test ACTIVATED (per spec §6
    step 1, not just `skill in skills_invoked` — a routing-only Skill call
    is allowed)."""
    spec = _negative_spec()  # tested skill = record-extraction
    # activated=True simulates "skill fired AND did substantive work"
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason=None, activated=True,
        skills_invoked=["record-extraction"],
    ) == "fail"


def test_negative_passes_when_skill_under_test_was_invoked_but_declined():
    """Bug #8 fix (v1.4): spec §6 explicitly allows routing-only Skill
    calls — Claude invokes the skill, it reads project files, decides it
    doesn't apply, and declines. activated=False → not a fail."""
    spec = _negative_spec(correct=["search-records"])
    # Claude routed to BOTH the skill under test (which declined) AND the
    # correct alternative (which handled it). activated=False because the
    # skill under test didn't substantively engage.
    dims = [{"source": "base", "name": "Correctness", "score": 3, "rationale": "x"}]
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=False,
        skills_invoked=["record-extraction", "search-records"],
    ) == "pass"


def test_negative_passes_when_correct_skill_was_invoked():
    spec = _negative_spec(correct=["search-records"])
    dims = [{"source": "base", "name": "Correctness", "score": 3,
             "rationale": "x"}]
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=False,
        skills_invoked=["search-records"],
    ) == "pass"


def test_negative_fails_when_no_correct_skill_invoked():
    spec = _negative_spec(correct=["search-records"])
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason=None, activated=False, skills_invoked=[],
    ) == "fail"


def test_negative_with_empty_correct_skill_requires_empty_skills_invoked():
    """v1.6 reverts to spec §6 step 2 literal: correct_skill: [] →
    pass requires skills_invoked is also []. An earlier, more lenient
    interpretation keyed on whether the run had a substantive effect; for
    an out-of-scope user message, Claude shouldn't even try a skill,
    regardless of whether it had effect."""
    spec = _negative_spec(correct=[])
    dims = [{"source": "base", "name": "Correctness", "score": 3, "rationale": "x"}]

    # No skill fired → pass
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=False, skills_invoked=[],
    ) == "pass"

    # Claude routed to some other skill that then declined → fail
    # (spec §6 step 2: "no skill should fire").
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=False, skills_invoked=["something-else"],
    ) == "fail"

    # A skill fired AND did work → also fail.
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=False, skills_invoked=["something-else"],
    ) == "fail"


def test_negative_passes_despite_failing_judge_dimensions():
    """Regression (ut_003): a negative test that routed correctly must
    PASS even when the judge scored dimensions 1 (fail). The skill
    correctly declined — there is no craft output, so judge scores don't
    gate the outcome (spec §6 grading sequence is routing-based; spec §7:
    negative tests don't have rubric dimensions). Previously the trailing
    `1 in scores` check flipped correctly-routed negative tests to fail
    whenever the judge graded the decline against the full skill rubric."""
    spec = _negative_spec(correct=["search-records"])
    dims = [
        {"source": "base", "name": "Correctness", "score": 1, "rationale": "x"},
        {"source": "base", "name": "Completeness", "score": 1, "rationale": "x"},
    ]
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=False,
        skills_invoked=["search-records"],
    ) == "pass"


def test_negative_passes_when_judge_skipped_but_routing_correct():
    """A judge crash must not fail a correctly-routed negative test —
    negative outcomes are routing-determined, so the judge call is
    diagnostic only."""
    spec = _negative_spec(correct=["search-records"])
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason=None, activated=False,
        skills_invoked=["search-records"], judge_skipped=True,
    ) == "pass"


def test_negative_judge_context_frames_decline_and_keeps_test_context():
    """_negative_judge_context prepends negative-test framing (so the
    base-only judge grades the decline, not the skill's craft task) and
    appends the test's own judge_context unchanged."""
    spec = load_test_from_dict({
        "test": {"id": "ut_o_003", "skill": "citation",
                  "name": "n", "type": "negative", "description": "x",
                  "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "negative": {"correct_skill": ["record-extraction"],
                      "explanation": "x"},
        "judge_context": ["Should explicitly name record-extraction"],
    })
    ctx = _negative_judge_context(spec)
    assert "NEGATIVE test" in ctx[0]
    assert "record-extraction" in ctx[0]
    assert "citation" in ctx[1]
    assert ctx[-1] == "Should explicitly name record-extraction"


def test_negative_out_of_scope_fails_when_judge_scored_a_dimension_1():
    """Regression (ut_008): an out-of-scope test (correct_skill: []) has
    no routing signal — "no skill fired" holds whether the model declined
    or answered the off-topic request itself. The judge's base dimensions
    gate it: a dimension scored 1 → fail. A prior fix made ALL negative
    outcomes routing-determined, which false-passed this case."""
    spec = _negative_spec(correct=[])
    dims = [
        {"source": "base", "name": "Correctness", "score": 1, "rationale": "x"},
        {"source": "base", "name": "Completeness", "score": 1, "rationale": "x"},
    ]
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=False, skills_invoked=[],
    ) == "fail"


def test_negative_out_of_scope_fails_when_judge_skipped():
    """An out-of-scope test is judge-gated; if the judge was skipped the
    decline is unverified, so the run fails rather than green-lighting an
    unchecked out-of-scope answer."""
    spec = _negative_spec(correct=[])
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason=None, activated=False, skills_invoked=[],
        judge_skipped=True,
    ) == "fail"


# --- invariant grading (negative.grade_on_invariant) ---------------------


def test_negative_invariant_passes_despite_activation():
    """grade_on_invariant grades on the deterministic invariant validator
    only (validators_passed above). Activation is NOT gated: the skill
    under test may fire, and as long as it harmed no state (validator
    passed) the routing-flaky negative still passes."""
    spec = _negative_spec(grade_on_invariant=True)
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason=None, activated=True, skills_invoked=["record-extraction"],
    ) == "pass"


def test_negative_invariant_passes_despite_unsatisfied_correct_skill():
    """Routing is not gated either: even when no `correct_skill` fired,
    an invariant negative passes on a clean invariant validator."""
    spec = _negative_spec(correct=["search-records"], grade_on_invariant=True)
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason=None, activated=False, skills_invoked=["something-else"],
    ) == "pass"


def test_negative_invariant_fails_when_validators_failed():
    """The invariant validator is the sole gate — if it fails (state was
    harmed) the test fails, exactly as a routing negative would."""
    spec = _negative_spec(grade_on_invariant=True)
    assert _compute_outcome(
        spec=spec, validators_passed=False, judge_dimensions=[],
        aborted_reason=None, activated=True, skills_invoked=["record-extraction"],
    ) == "fail"


# --- skill-execution retry ----------------------------------------------


def _stub_workspace_helpers(monkeypatch):
    """Neutralize the filesystem helpers _execute_skill_with_retry calls
    so a retry test exercises only the retry loop."""
    monkeypatch.setattr(orchestrator, "build_workspace", lambda **kw: None)
    monkeypatch.setattr(orchestrator, "snapshot_files", lambda ws: {})
    monkeypatch.setattr(orchestrator, "cleanup_session_store", lambda ws: None)


def _retry_stub_result(aborted_reason=None):
    from harness.skill_runner import SkillRunResult
    return SkillRunResult(
        text_response="", skills_invoked=[], tool_calls=[],
        duration_ms=1.0, usage={}, aborted_reason=aborted_reason,
        error="transient SDK failure" if aborted_reason else None,
        attempted_mcp_calls=[],
    )


def test_skill_retry_recovers_after_transient_error(tmp_path, monkeypatch):
    """_execute_skill_with_retry retries an aborted_reason='error' run and
    returns the first successful attempt's result."""
    _stub_workspace_helpers(monkeypatch)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")
    calls = {"n": 0}

    async def fake_run_skill(**kwargs):
        calls["n"] += 1
        return _retry_stub_result(
            aborted_reason="error" if calls["n"] < 3 else None
        )

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    result, _b, _a = asyncio.run(orchestrator._execute_skill_with_retry(
        run_index=0, spec=_positive_spec(), paths=paths,
        skill_baseline=["Read"], auth=auth, model="claude-sonnet-4-6",
        base_delay=0,
    ))
    assert calls["n"] == 3
    assert result.aborted_reason is None


def test_a_recursionerror_from_the_body_is_not_swallowed(tmp_path, monkeypatch):
    """The tempdir-cleanup `except RecursionError` must not also swallow one
    raised from build_workspace/run_skill INSIDE the block.

    It used to. Attempt 1 aborts retryably, attempt 2 raises RecursionError
    from the body, the except swallows it, and the loop returns attempt 1's
    result stamped `attempts=2` — silently, no exception and no warning. That
    is corrupted eval data, not a lost run, which is why this raises instead.
    """
    _stub_workspace_helpers(monkeypatch)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")
    calls = {"n": 0}

    async def fake_run_skill(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return _retry_stub_result(aborted_reason="error")
        raise RecursionError("locked-file cleanup lookalike, raised from the body")

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    with pytest.raises(RecursionError):
        asyncio.run(orchestrator._execute_skill_with_retry(
            run_index=0, spec=_positive_spec(), paths=paths,
            skill_baseline=["Read"], auth=auth, model="claude-sonnet-4-6",
            base_delay=0,
        ))


def test_skill_retry_gives_up_after_attempts(tmp_path, monkeypatch):
    """When every attempt errors, _execute_skill_with_retry returns the
    last errored result after `attempts` tries — it does not loop
    forever."""
    _stub_workspace_helpers(monkeypatch)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")
    calls = {"n": 0}

    async def fake_run_skill(**kwargs):
        calls["n"] += 1
        return _retry_stub_result(aborted_reason="error")

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    result, _b, _a = asyncio.run(orchestrator._execute_skill_with_retry(
        run_index=0, spec=_positive_spec(), paths=paths,
        skill_baseline=["Read"], auth=auth, model="claude-sonnet-4-6",
        attempts=3, base_delay=0,
    ))
    assert calls["n"] == 3
    assert result.aborted_reason == "error"


def test_skill_retry_does_not_retry_execution_cap_abort(tmp_path, monkeypatch):
    """A deterministic cap abort (max_turns) is returned on the first
    attempt — retrying would just burn the same budget again."""
    _stub_workspace_helpers(monkeypatch)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")
    calls = {"n": 0}

    async def fake_run_skill(**kwargs):
        calls["n"] += 1
        return _retry_stub_result(aborted_reason="max_turns")

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    result, _b, _a = asyncio.run(orchestrator._execute_skill_with_retry(
        run_index=0, spec=_positive_spec(), paths=paths,
        skill_baseline=["Read"], auth=auth, model="claude-sonnet-4-6",
        base_delay=0,
    ))
    assert calls["n"] == 1
    assert result.aborted_reason == "max_turns"


# --- zero-progress wall-clock timeouts are a startup stall, not a slow test --


def _timeout_result(usage):
    from harness.skill_runner import SkillRunResult
    return SkillRunResult(
        text_response="", skills_invoked=[], tool_calls=[],
        duration_ms=1_900_000.0, usage=usage,
        aborted_reason="max_wall_clock_seconds",
        error="wall-clock timeout after 1500s", attempted_mcp_calls=[],
    )


def test_zero_progress_timeout_is_retryable():
    """The 2026-08-15 signature: the whole wall-clock budget elapsed without a
    single assistant turn, so the SDK subprocess hung during startup — the
    same transient the `error` path already retries. `num_turns` here is
    written by skill_runner's timeout handler, NOT read off a ResultMessage
    (which never arrives on this path); see test_skill_runner.py for the
    producer-side coverage."""
    usage = {"num_turns": 0}
    assert orchestrator._is_zero_progress_timeout(_timeout_result(usage)) is True
    assert orchestrator._is_retryable_abort(_timeout_result(usage)) is True


def test_timeout_with_no_turn_count_is_not_retried():
    """Fails CLOSED. A missing `num_turns` means the recording handler did not
    run, so a stall is indistinguishable from slow work — and retrying a slow
    test burns the full cap once per attempt at 3x the tokens. This is the
    case the first version of the guard got wrong: `usage` is empty on the
    timeout path unless explicitly populated, so treating falsy as
    zero-progress retried EVERY wall-clock abort."""
    assert orchestrator._is_zero_progress_timeout(_timeout_result({})) is False
    assert orchestrator._is_retryable_abort(_timeout_result({})) is False


@pytest.mark.parametrize("usage", [{"num_turns": 1}, {"num_turns": 7}, {"num_turns": 40}])
def test_a_genuinely_slow_test_is_still_not_retried(usage):
    """A test that timed out MID-WORK stays non-retryable — retrying would
    burn the same budget twice. This is the line that keeps the fix narrow."""
    assert orchestrator._is_zero_progress_timeout(_timeout_result(usage)) is False
    assert orchestrator._is_retryable_abort(_timeout_result(usage)) is False


def test_other_cap_aborts_are_never_retried_even_with_no_progress():
    """`max_turns` / `max_tool_calls` with an empty usage dict must NOT be
    swept in — the new predicate keys on the wall-clock reason specifically."""
    from harness.skill_runner import SkillRunResult
    for reason in ("max_turns", "max_tool_calls", "max_input_tokens_per_turn"):
        r = SkillRunResult(
            text_response="", skills_invoked=[], tool_calls=[],
            duration_ms=1.0, usage={}, aborted_reason=reason,
            error=f"{reason} exceeded", attempted_mcp_calls=[],
        )
        assert orchestrator._is_retryable_abort(r) is False, reason


def test_skill_retry_recovers_a_zero_progress_timeout(tmp_path, monkeypatch):
    """End to end through the retry loop: the stalled attempt is retried and
    the recovered attempt's result is returned. Without this, both tests that
    hit the stall on 2026-08-15 were simply lost from a paid suite run."""
    _stub_workspace_helpers(monkeypatch)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")
    calls = {"n": 0}

    async def fake_run_skill(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return _timeout_result({"num_turns": 0, "duration_api_ms": 0})
        return _retry_stub_result()

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    result, _b, _a = asyncio.run(orchestrator._execute_skill_with_retry(
        run_index=0, spec=_positive_spec(), paths=paths,
        skill_baseline=["Read"], auth=auth, model="claude-sonnet-4-6",
        base_delay=0,
    ))
    assert calls["n"] == 2
    assert result.aborted_reason is None
    assert result.attempts == 2


def test_skill_retry_does_not_retry_a_slow_wall_clock_abort(tmp_path, monkeypatch):
    """The counterpart: a wall-clock abort WITH progress returns on the first
    attempt, exactly as before this change."""
    _stub_workspace_helpers(monkeypatch)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")
    calls = {"n": 0}

    async def fake_run_skill(**kwargs):
        calls["n"] += 1
        return _timeout_result({"num_turns": 9, "duration_api_ms": 800_000})

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    result, _b, _a = asyncio.run(orchestrator._execute_skill_with_retry(
        run_index=0, spec=_positive_spec(), paths=paths,
        skill_baseline=["Read"], auth=auth, model="claude-sonnet-4-6",
        base_delay=0,
    ))
    assert calls["n"] == 1
    assert result.aborted_reason == "max_wall_clock_seconds"


# --- aborted ------------------------------------------------------------


def test_judge_skipped_after_passing_validators_fails():
    """v1.7 regression fix: when validators passed but the judge was
    skipped (JudgeError caught), the run must NOT silently pass on
    empty judge_dimensions. Spec §7: pass requires every dimension to
    score pass — zero dimensions can't satisfy that."""
    spec = _positive_spec()
    # Validators pass, run isn't aborted, activated=True, skill invoked,
    # judge_dimensions=[]. Pre-v1.7 this returned "pass".
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason=None, activated=True,
        skills_invoked=["search-wikipedia"],
        judge_skipped=True,
    ) == "fail"


def test_judge_skipped_doesnt_override_aborted():
    """When the run aborted, that dominates regardless of judge_skipped."""
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason="max_turns", activated=True,
        skills_invoked=["search-wikipedia"],
        judge_skipped=True,
    ) == "aborted"


def test_judge_skipped_doesnt_override_validator_fail():
    """When validators failed, that's the load-bearing signal — don't
    'fix it' to fail via judge_skipped (which is also True in this case)."""
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=False, judge_dimensions=[],
        aborted_reason=None, activated=True,
        skills_invoked=["search-wikipedia"],
        judge_skipped=True,
    ) == "fail"


def test_aborted_dominates_everything():
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason="max_turns", activated=True,
        skills_invoked=["search-wikipedia"],
    ) == "aborted"


def test_error_aborted_reason_treated_as_aborted():
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason="error", activated=False, skills_invoked=[],
    ) == "aborted"


# --- V7 (#1866): a COMMISSION-validator failure dominates a deterministic-cap
# abort. The demotion is scoped to `_COMMISSION_VALIDATORS` (johnmarkpeterbrown's
# ruling): a cap truncates a run mid-write, so an OMISSION-only failure ("expected
# X, got none") is the timeout's doing and must stay `aborted`, while a commission
# failure (wrote something it shouldn't) is a real defect a timeout cannot explain.
# Proof-of-failure: without the demotion, the first parametrisation reads "aborted"
# and a real defect hides behind a timeout (ut_research_plan_016's ownership-table
# failure); without the commission SCOPING, the omission-only case below reds a
# timeout as a skill regression (record_extraction_018/020, person_evidence_022).
# The rest pin the scope so the demotion cannot over-fire. Nothing in CI mutates a
# run to red a gating check (CLAUDE.md, "a new lint must be proven to fail"), so
# these assertions are that proof.

_A_COMMISSION_VALIDATOR = "test_ownership_table"  # a member of _COMMISSION_VALIDATORS
_AN_OMISSION_VALIDATOR = "test_research_plan_new_plan_for_q_001"  # not a member


@pytest.mark.parametrize("cap", ["max_wall_clock_seconds", "max_turns", "max_tool_calls"])
def test_commission_validator_failure_demotes_deterministic_cap_abort_to_fail(cap):
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=False,
        failed_validators=frozenset({_A_COMMISSION_VALIDATOR}),
        judge_dimensions=[], aborted_reason=cap, activated=True,
        skills_invoked=["search-wikipedia"],
    ) == "fail"


@pytest.mark.parametrize("cap", ["max_wall_clock_seconds", "max_turns", "max_tool_calls"])
def test_omission_only_validator_failure_under_cap_stays_aborted(cap):
    """The scoping half of the ruling, and the case nothing caught before: a run
    the clock killed before it wrote its plan fails only an OMISSION validator
    ("expected exactly one new plan; got []"). That is the timeout's doing, not a
    regression, so it must stay `aborted` — the exact mis-file (pointed the other
    way) V7 exists to prevent. Reds if the demotion ever keys on `validators_passed`
    instead of the commission set."""
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=False,
        failed_validators=frozenset({_AN_OMISSION_VALIDATOR}),
        judge_dimensions=[], aborted_reason=cap, activated=True,
        skills_invoked=["search-wikipedia"],
    ) == "aborted"


@pytest.mark.parametrize("cap", ["max_wall_clock_seconds", "max_turns", "max_tool_calls"])
def test_clean_deterministic_cap_abort_stays_aborted(cap):
    """The demotion must not over-fire: a cap abort with validators PASSING (no
    failed validators at all) is still a genuine no-gradeable-result abort."""
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=True, failed_validators=frozenset(),
        judge_dimensions=[], aborted_reason=cap, activated=True,
        skills_invoked=["search-wikipedia"],
    ) == "aborted"


@pytest.mark.parametrize("reason", ["error", "sdk_stream_silence", "unmatched_tool_call"])
def test_commission_failure_does_not_demote_non_cap_abort(reason):
    """Only the three deterministic caps are dominated, even with a commission
    failure. `error` and `sdk_stream_silence` feed the suite breaker and exit-code
    split; `unmatched_tool_call` is a test-corpus (exit 2) problem. Demoting any of
    them would report an environment/corpus failure as a skill regression."""
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=False,
        failed_validators=frozenset({_A_COMMISSION_VALIDATOR}),
        judge_dimensions=[], aborted_reason=reason, activated=True,
        skills_invoked=["search-wikipedia"],
    ) == "aborted"


def test_commission_validators_are_all_collected():
    """The lead's condition (#1866): a silent rename must not drop a name out of
    `_COMMISSION_VALIDATORS` and quietly stop demoting it. Every name in the set
    must match a real validator `def test_*` in the validators dir. Prove it by
    renaming any of the four members (or its collector) and watching this red."""
    import ast

    validators_dir = Path(__file__).resolve().parents[2] / "validators"
    collected: set[str] = set()
    for path in validators_dir.glob("test_*.py"):
        module = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(module):
            if isinstance(node, ast.FunctionDef) and node.name.startswith("test_"):
                collected.add(node.name)
    # Guard the guard: an empty/misdirected scan would make the subset check vacuous.
    assert "test_ownership_table" in collected, (
        f"validator collection found nothing at {validators_dir} — fix this test's "
        f"discovery, do not delete it"
    )
    missing = _COMMISSION_VALIDATORS - collected
    assert not missing, (
        f"_COMMISSION_VALIDATORS names validators no longer collected: "
        f"{sorted(missing)}. A validator was renamed — update the set, or its "
        f"failure under a cap silently stops demoting to fail."
    )


# --- Phase 2: unmatched tool calls (Type 1 vs Type 2) ----------------------


def test_type_1_unmatched_tool_call_aborts(tmp_path, monkeypatch):
    """Type 1 (tool doesn't exist at all): The skill calls a tool that is
    not registered in the mock server → aborts with unmatched_tool_call."""
    from harness.skill_runner import SkillRunResult

    # Override _stub_workspace_helpers to return snapshots with required keys
    monkeypatch.setattr(orchestrator, "build_workspace", lambda **kw: None)
    monkeypatch.setattr(orchestrator, "snapshot_files", lambda ws: {
        "research_json": {"researcher_profile": {}},
        "tree_gedcomx_json": {"persons": []},
        "files": [],
    })
    monkeypatch.setattr(orchestrator, "cleanup_session_store", lambda ws: None)

    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")
    spec = _positive_spec()

    # Skill attempts to call mcp__genealogy__nonexistent_tool, but the mock
    # server only has place_search registered. The attempted call doesn't
    # match any fixture, and the tool doesn't exist → Type 1.
    async def fake_run_skill(**kwargs):
        return SkillRunResult(
            text_response="I tried to use a tool that doesn't exist.",
            skills_invoked=["search-wikipedia"],
            tool_calls=[],  # No calls reached the mock
            duration_ms=100.0,
            usage={"num_turns": 1, "total_cost_usd": 0.0, "usage": {}},
            attempted_mcp_calls=[
                {"tool": "mcp__genealogy__nonexistent_tool", "args": {"query": "test"}}
            ],
            registered_mcp_tools={"place_search"},  # only place_search exists
        )

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    entry = orchestrator.run_one_test(spec, auth=auth, paths=paths)
    assert entry["outcome"] == "aborted"
    assert entry["runs"][0]["aborted_reason"] == "unmatched_tool_call"


def test_type_2_unmatched_tool_call_continues_to_judge(tmp_path, monkeypatch):
    """Type 2 (wrong args to existing tool): The skill calls an existing
    tool but with args that don't match any fixture → continues to judge,
    which sees the fixture_not_found error and typically fails."""
    from harness.skill_runner import SkillRunResult

    # Override _stub_workspace_helpers to return snapshots with required keys
    monkeypatch.setattr(orchestrator, "build_workspace", lambda **kw: None)
    monkeypatch.setattr(orchestrator, "snapshot_files", lambda ws: {
        "research_json": {"researcher_profile": {}},
        "tree_gedcomx_json": {"persons": []},
        "files": [],
    })
    monkeypatch.setattr(orchestrator, "cleanup_session_store", lambda ws: None)

    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")
    spec = _positive_spec()

    # Skill calls place_search with args that don't match any fixture.
    # The tool exists (place_search is registered), but the call returns
    # fixture_not_found → Type 2.
    async def fake_run_skill(**kwargs):
        return SkillRunResult(
            text_response="I searched but got an error.",
            skills_invoked=["search-wikipedia"],
            tool_calls=[
                {
                    "tool": "mcp__genealogy__place_search",
                    "args": {"query": "unexpected-query"},
                    "expected_args": None,
                    "matched": {"kind": "none", "index": None},
                    "response_fixture": None,
                }
            ],
            duration_ms=100.0,
            usage={"num_turns": 1, "total_cost_usd": 0.0, "usage": {}},
            attempted_mcp_calls=[
                {"tool": "mcp__genealogy__place_search", "args": {"query": "unexpected-query"}}
            ],
            registered_mcp_tools={"place_search"},  # place_search exists
        )

    # Stub validators to pass (search-wikipedia has validators that check for
    # output files, which we didn't create). We want to test the judge, not
    # validators, so make validators trivially pass.
    monkeypatch.setattr(orchestrator, "run_validators", lambda **kw: [])

    # Stub the judge to return failing scores (typical for Type 2)
    from harness.judge import JudgeOutput
    def fake_run_judge(**kwargs):
        return JudgeOutput(
            dimensions=[
                {"source": "base", "name": "Correctness", "score": 1, "rationale": "fixture_not_found error"},
                {"source": "base", "name": "Completeness", "score": 1, "rationale": "incomplete"},
                {"source": "base", "name": "Tool Arguments", "score": 1, "rationale": "matched.kind == none"},
            ],
            cost_usd=0.0,
            input_tokens=0,
            cached_input_tokens=0,
            output_tokens=0,
            prompt_hash="stub-hash",
        )

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    monkeypatch.setattr(orchestrator, "_run_judge", fake_run_judge)

    entry = asyncio.run(_run_one_test_async(
        spec=spec, auth=auth, paths=paths,
        model="claude-sonnet-4-6", judge_model="claude-haiku-4-5-20251001",
        timestamp="2026-05-20_10-30-00",
    ))
    # Type 2: no abort, continues to judge which fails it
    assert entry["outcome"] == "fail"
    assert entry["runs"][0]["aborted_reason"] is None
    assert entry["runs"][0]["judge"]["skipped"] is False


def test_live_tool_call_is_covered(tmp_path, monkeypatch):
    """Live tool calls (matched.kind == 'live') are counted as covered.
    The run must not abort, must not emit an uncovered_tool_call warning,
    and must reach the judge."""
    from harness.skill_runner import SkillRunResult

    monkeypatch.setattr(orchestrator, "build_workspace", lambda **kw: None)
    monkeypatch.setattr(orchestrator, "snapshot_files", lambda ws: {
        "research_json": {"researcher_profile": {}},
        "tree_gedcomx_json": {"persons": []},
        "files": [],
    })
    monkeypatch.setattr(orchestrator, "cleanup_session_store", lambda ws: None)

    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")
    spec = _positive_spec()

    # Skill calls validate_research_schema and it succeeds via the live handler.
    async def fake_run_skill(**kwargs):
        return SkillRunResult(
            text_response="Schema is valid.",
            skills_invoked=["search-wikipedia"],
            tool_calls=[
                {
                    "tool": "mcp__genealogy__validate_research_schema",
                    "args": {"projectPath": "/tmp/fake"},
                    "expected_args": None,
                    "matched": {"kind": "live", "index": None},
                    "response_fixture": "live:validate_research_schema",
                    "response": {"valid": True, "errors": [], "warnings": [], "message": "OK"},
                }
            ],
            duration_ms=100.0,
            usage={"num_turns": 1, "total_cost_usd": 0.0, "usage": {}},
            attempted_mcp_calls=[
                {"tool": "mcp__genealogy__validate_research_schema", "args": {"projectPath": "/tmp/fake"}}
            ],
            registered_mcp_tools={"validate_research_schema"},
        )

    monkeypatch.setattr(orchestrator, "run_validators", lambda **kw: [])

    from harness.judge import JudgeOutput
    def fake_run_judge(**kwargs):
        return JudgeOutput(
            dimensions=[
                {"source": "base", "name": "Correctness", "score": 3, "rationale": "correct"},
                {"source": "base", "name": "Completeness", "score": 3, "rationale": "complete"},
                {"source": "base", "name": "Tool Arguments", "score": 3, "rationale": "live tool used correctly"},
            ],
            cost_usd=0.0,
            input_tokens=0,
            cached_input_tokens=0,
            output_tokens=0,
            prompt_hash="stub-hash",
        )

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    monkeypatch.setattr(orchestrator, "_run_judge", fake_run_judge)

    entry = asyncio.run(_run_one_test_async(
        spec=spec, auth=auth, paths=paths,
        model="claude-sonnet-4-6", judge_model="claude-haiku-4-5-20251001",
        timestamp="2026-05-20_10-30-00",
    ))
    assert entry["runs"][0]["aborted_reason"] is None
    assert entry["runs"][0]["judge"]["skipped"] is False
    warnings = entry["runs"][0]["output"].get("warnings", [])
    assert not any(w["kind"] == "uncovered_tool_call" for w in warnings)


# --- intentionally_invalid: file-validity validators are not counted -----

from dataclasses import dataclass as _dataclass

from harness.orchestrator import (
    FILE_VALIDITY_VALIDATORS,
    compute_validators_passed,
)


@_dataclass
class _FakeValidator:
    name: str
    passed: bool
    reporting_only: bool = False


def test_compute_validators_passed_all_pass():
    results = [_FakeValidator("test_log_append_only", True)]
    assert compute_validators_passed(results, intentionally_invalid=False) is True
    assert compute_validators_passed(results, intentionally_invalid=True) is True


def test_compute_validators_passed_file_validity_failure_honors_flag():
    # A file-validity validator failing is expected when the scenario is
    # intentionally invalid, so it must not fail the test then — but it must
    # fail a normal test.
    name = sorted(FILE_VALIDITY_VALIDATORS)[0]
    results = [_FakeValidator(name, False)]
    assert compute_validators_passed(results, intentionally_invalid=False) is False
    assert compute_validators_passed(results, intentionally_invalid=True) is True


def test_compute_validators_passed_behavioral_failure_always_fails():
    # A behavioural validator (not file-validity) failing fails the test even
    # under the flag — the flag only excuses the invalid input, not bad skill
    # behaviour.
    results = [_FakeValidator("test_log_append_only", False)]
    assert compute_validators_passed(results, intentionally_invalid=True) is False
    assert compute_validators_passed(results, intentionally_invalid=False) is False

# --------------------------------------------------------------------------
# The judge's "persisted artifact" block — array-sampler truncation
# --------------------------------------------------------------------------


def _plan_changes(n_items: int):
    """A research.json diff whose single added entry nests an n-item plan."""
    return {
        "research.json": {
            "sections_modified": ["research_plans"],
            "diff": {
                "research_plans": {
                    "added": [
                        {
                            "plan_id": "pl_001",
                            "items": [
                                {"id": f"pli_{i:03d}", "rationale": f"cites loc_{i:03d}"}
                                for i in range(n_items)
                            ],
                        }
                    ],
                    "modified": [],
                    "deleted": [],
                }
            },
        }
    }


def test_persisted_artifact_block_shows_every_plan_item():
    """The block header tells the judge to grade "the persisted artifact", and it
    was showing the first 3 of 9 items — so a note saying "read the persisted
    plan items" pointed at a third of them. The outer added[] list is length 1,
    so nothing looked truncated; the cap bit at the nested depth."""
    out = _summarize_changes(_plan_changes(9), [], include_content=True)

    assert "_summary_truncated" not in out
    for i in range(9):
        assert f"pli_{i:03d}" in out, f"pli_{i:03d} missing from the artifact block"


def test_persisted_artifact_block_shows_every_item_on_the_modified_branch():
    """The modified branch had the identical hole and no test covered it."""
    changes = {
        "research.json": {
            "sections_modified": ["research_plans"],
            "diff": {
                "research_plans": {
                    "added": [],
                    "modified": [
                        {
                            "id": "pl_001",
                            "changed_fields": {
                                "items": {
                                    "after": [{"id": f"pli_{i:03d}"} for i in range(9)]
                                }
                            },
                        }
                    ],
                    "deleted": [],
                }
            },
        }
    }
    out = _summarize_changes(changes, [], include_content=True)

    assert "_summary_truncated" not in out
    for i in range(9):
        assert f"pli_{i:03d}" in out


def test_before_state_path_is_unchanged_by_the_artifact_fix():
    """Only the file-content path is uncapped. The before-state block keeps its
    own workaround — summarizing per source rather than handing the array over —
    because the default cap still applies inside each source. Lifting the cap
    globally would have made that workaround look redundant and invited its
    removal, which is the misgrade it exists to prevent."""
    sources = [{"id": f"src_{i:03d}", "citation": f"c{i}"} for i in range(9)]

    out = _summarize_before_state_sources(sources)

    assert out["count"] == 9
    assert out["all_ids"] == [f"src_{i:03d}" for i in range(9)]
    assert len(out["detail"]) == 9

    # And the generic sampler it calls per source still caps by default, which
    # is what makes the per-source loop necessary rather than decorative.
    from harness.judge import _summarize_response

    assert _summarize_response(sources)["_summary_truncated"] is True


def test_orchestrator_passes_text_response_to_validators(tmp_path, monkeypatch):
    """The reply reaches run_validators (#1662).

    Pinned behaviourally, not by grepping orchestrator source: the string
    `text_response=result.text_response` appears three times in that module
    (derive_activated, run_validators, grade), so a source assertion stays
    green when the run_validators one specifically is dropped. And the
    breakage is otherwise invisible — a validator that reads the reply
    guards with "no reply, nothing to check", so losing the argument turns it
    into a silent pass rather than an error.
    """
    spec = load_test(WIKI_TEST_PATH)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")
    reply = "Saved the Wikipedia summary to `schuylkill-county-pennsylvania.md`."

    async def fake_run_skill(**kwargs):
        from harness.skill_runner import SkillRunResult
        return SkillRunResult(
            text_response=reply,
            skills_invoked=["search-wikipedia"],
            tool_calls=[],
            duration_ms=1.0,
            usage={"total_cost_usd": 0.0, "usage": {}},
        )

    captured = {}

    def fake_run_validators(**kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    monkeypatch.setattr(orchestrator, "run_validators", fake_run_validators)
    monkeypatch.setattr(orchestrator, "grade", lambda **kw: (_ for _ in ()).throw(
        JudgeError("not under test")
    ))

    asyncio.run(_run_one_test_async(
        spec=spec, auth=auth, paths=paths,
        model="claude-sonnet-4-6", judge_model="claude-haiku-4-5-20251001",
        timestamp="2026-08-22_00-00-00",
    ))

    assert "text_response" in captured, (
        "orchestrator did not pass text_response into run_validators; every "
        "validator that reads the reply is now inert"
    )
    assert captured["text_response"] == reply


def test_orchestrator_threads_refinement_targets_into_validators(tmp_path, monkeypatch):
    """A test JSON's top-level `refinement_targets` must reach the `test`
    dict run_validators receives (issue #2021, F12).

    Adding a field to the unit-test JSON schema and reading it in a
    validator is NOT sufficient — `_run_one_test_async` builds the
    validator-facing `test` dict as an explicit whitelist
    (`{**spec.raw.get("test", {}), "expected_classifications": ...,
    "refinement_targets": ..., "execution": ...}`), so a field left off
    that literal never arrives even though `spec.raw` has it. This bug
    shipped once already: `refinement_targets` was declared in the schema
    and read by `test_refinement_preserves_extraction_fields_and_avoids_duplication`
    but never added to this dict, so the validator silently reported
    "skipped: test declares no refinement_targets" on every run instead of
    actually checking anything. Pinned behaviourally (via a patched
    `run_validators`, not a source grep) so it fails the same way if the
    threading line is ever removed again.
    """
    spec = load_test(WIKI_TEST_PATH)
    spec.raw["refinement_targets"] = ["a_002"]
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")

    async def fake_run_skill(**kwargs):
        from harness.skill_runner import SkillRunResult
        return SkillRunResult(
            text_response="done",
            skills_invoked=["search-wikipedia"],
            tool_calls=[],
            duration_ms=1.0,
            usage={"total_cost_usd": 0.0, "usage": {}},
        )

    captured = {}

    def fake_run_validators(**kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    monkeypatch.setattr(orchestrator, "run_validators", fake_run_validators)
    monkeypatch.setattr(orchestrator, "grade", lambda **kw: (_ for _ in ()).throw(
        JudgeError("not under test")
    ))

    asyncio.run(_run_one_test_async(
        spec=spec, auth=auth, paths=paths,
        model="claude-sonnet-4-6", judge_model="claude-haiku-4-5-20251001",
        timestamp="2026-08-22_00-00-00",
    ))

    assert captured["test"].get("refinement_targets") == ["a_002"], (
        "orchestrator did not thread spec.raw['refinement_targets'] into "
        "run_validators' test dict; test_refinement_preserves_extraction_"
        "fields_and_avoids_duplication silently skips on every run"
    )
