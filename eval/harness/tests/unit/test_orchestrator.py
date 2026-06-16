"""Unit tests for orchestrator's pure helpers — outcome computation."""

from harness.loader import load_test_from_dict
from harness.orchestrator import _compute_outcome, _negative_judge_context


# --- judge error handling (item #27) -----------------------------------

import asyncio
from pathlib import Path
from unittest.mock import patch

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
    # test_slug_schuylkill_county_pennsylvania) pass — otherwise this
    # test would exercise the validator-failed branch instead of the
    # judge-error branch it is meant to cover.
    async def fake_run_skill(**kwargs):
        from harness.skill_runner import SkillRunResult
        workspace = kwargs["workspace"]
        (workspace / "schuylkill-county-pennsylvania.md").write_text(
            "# Schuylkill County, Pennsylvania\n\nstub extract\n\nhttps://example/\n"
        )
        return SkillRunResult(
            text_response="I saved the file.",
            skills_invoked=["search-wikipedia"],
            tool_calls=[
                {"tool": "mcp__genealogy__wikipedia_search", "args": {"query": "X"},
                 "matched": {"kind": "predicate", "index": None},
                 "response_fixture": None, "response": {"title": "X"}}
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


def _positive_spec(skill="search-wikipedia"):
    return load_test_from_dict({
        "test": {"id": "ut_o_001", "skill": skill, "name": "n", "type": "positive",
                  "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    })


_SENTINEL = object()


def _negative_spec(skill="record-extraction", correct=_SENTINEL):
    if correct is _SENTINEL:
        correct = ["search-records"]
    return load_test_from_dict({
        "test": {"id": "ut_o_002", "skill": skill, "name": "n", "type": "negative",
                  "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "negative": {"correct_skill": correct, "explanation": "x"},
        "judge_context": [],
    })


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
    pass requires skills_invoked is also []. The earlier had_substantive_effect
    interpretation was too lenient — for an out-of-scope user message,
    Claude shouldn't even try a skill, regardless of whether it had effect."""
    spec = _negative_spec(correct=[])
    dims = [{"source": "base", "name": "Correctness", "score": 3, "rationale": "x"}]

    # No skill fired → pass
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=False, skills_invoked=[],
        had_substantive_effect=False,
    ) == "pass"

    # Claude routed to some other skill that then declined → fail
    # (spec §6 step 2: "no skill should fire").
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=False, skills_invoked=["something-else"],
        had_substantive_effect=False,
    ) == "fail"

    # A skill fired AND did work → also fail.
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=False, skills_invoked=["something-else"],
        had_substantive_effect=True,
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
        "test": {"id": "ut_o_003", "skill": "assertion-classification",
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
    assert "assertion-classification" in ctx[1]
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
