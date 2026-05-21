"""Unit tests for orchestrator's pure helpers — outcome computation."""

from harness.loader import load_test_from_dict
from harness.orchestrator import _compute_outcome


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


def test_uncovered_tool_call_aborts_run(tmp_path, monkeypatch):
    """WS1: a skill that emits an MCP call no fixture predicate matched
    must abort with aborted_reason='unmatched_tool_call'. Scoring the run
    would grade output the skill produced from a fixture_not_found error."""
    spec = load_test(WIKI_TEST_PATH)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")

    async def fake_run_skill(**kwargs):
        from harness.skill_runner import SkillRunResult
        # The model emitted a wikipedia_search call, but nothing reached
        # the mock (tool_calls empty) — e.g. no fixture registered the
        # tool, or the allowlist denied it.
        return SkillRunResult(
            text_response="(produced from an error response)",
            skills_invoked=["search-wikipedia"],
            tool_calls=[],
            duration_ms=10.0,
            usage={"total_cost_usd": 0.0, "usage": {}},
            attempted_mcp_calls=[
                {"tool": "mcp__genealogy__wikipedia_search", "args": {"query": "X"}}
            ],
        )

    # The judge must never be reached on an aborted run.
    def fail_if_called(**kwargs):
        raise AssertionError("judge ran on an aborted run")

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    monkeypatch.setattr(orchestrator, "grade", fail_if_called)

    entry = asyncio.run(_run_one_test_async(
        spec=spec, auth=auth, paths=paths,
        model="claude-sonnet-4-6", judge_model="claude-haiku-4-5-20251001",
        timestamp="2026-05-20_10-30-00",
    ))

    assert entry["outcome"] == "aborted"
    run = entry["runs"][0]
    assert run["aborted_reason"] == "unmatched_tool_call"
    assert run["judge"]["skipped"] is True
    # The uncovered_tool_call warning carries the attempted-call detail.
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
