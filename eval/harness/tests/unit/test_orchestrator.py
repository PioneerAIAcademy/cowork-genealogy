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
WIKI_TEST_PATH = REPO_ROOT / "eval/tests/unit/wiki-lookup/simple-topic-lookup.json"


def test_judge_error_in_run_records_skip_with_error(tmp_path, monkeypatch):
    """Bug #3: a JudgeError must not crash the suite. The run records
    skipped=true with the error captured, and assemble_run_log succeeds."""
    spec = load_test(WIKI_TEST_PATH)
    paths = OrchestratorPaths(runlogs_root=tmp_path)
    auth = AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub")

    # Monkey-patch the skill runner to return a successful stub (no SDK call).
    async def fake_run_skill(**kwargs):
        from harness.skill_runner import SkillRunResult
        return SkillRunResult(
            text_response="I saved the file.",
            skills_invoked=["wiki-lookup"],
            tool_calls=[
                {"tool": "mcp__genealogy__wikipedia_search", "args": {"query": "X"},
                 "matched": {"kind": "queue", "index": None},
                 "response_fixture": None, "response": {"title": "X"}}
            ],
            duration_ms=10.0,
            usage={"total_cost_usd": 0.01, "usage": {"input_tokens": 100,
                  "output_tokens": 10, "cache_read_input_tokens": 50}},
        )

    # Make the judge layer always raise.
    def fake_grade(**kwargs):
        raise JudgeError("synthetic judge failure")

    monkeypatch.setattr(orchestrator, "run_skill", fake_run_skill)
    monkeypatch.setattr(orchestrator, "grade", fake_grade)

    log = asyncio.run(_run_one_test_async(
        spec=spec, auth=auth, paths=paths,
        model="claude-sonnet-4-6", judge_model="claude-haiku-4-5-20251001",
    ))

    # Did NOT crash. Judge recorded with skipped=true + error.
    assert log["runs"][0]["judge"]["skipped"] is True
    assert "synthetic judge failure" in log["runs"][0]["judge"]["error"]
    # v1.7 fix: outcome must be "fail" — empty judge_dimensions can't
    # silently satisfy "every dimension scored pass" (spec §7).
    assert log["outcome"] == "fail"


def _positive_spec(skill="wiki-lookup"):
    return load_test_from_dict({
        "test": {"id": "ut_o_001", "skill": skill, "name": "n", "type": "positive",
                  "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "additional_criteria": [],
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
        "additional_criteria": [],
    })


# --- positive tests ------------------------------------------------------


def test_positive_fails_when_validators_failed():
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=False, judge_dimensions=[],
        aborted_reason=None, activated=True, skills_invoked=["wiki-lookup"],
    ) == "fail"


def test_positive_fails_when_not_activated():
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason=None, activated=False, skills_invoked=["wiki-lookup"],
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
        aborted_reason=None, activated=True, skills_invoked=["wiki-lookup"],
    ) == "pass"


def test_positive_partial_when_any_dim_partial():
    spec = _positive_spec()
    dims = [
        {"source": "base", "name": "Correctness", "score": 3, "rationale": "x"},
        {"source": "rubric", "name": "File handling", "score": 2, "rationale": "x"},
    ]
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=dims,
        aborted_reason=None, activated=True, skills_invoked=["wiki-lookup"],
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
        skills_invoked=["wiki-lookup"],
        judge_skipped=True,
    ) == "fail"


def test_judge_skipped_doesnt_override_aborted():
    """When the run aborted, that dominates regardless of judge_skipped."""
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason="max_turns", activated=True,
        skills_invoked=["wiki-lookup"],
        judge_skipped=True,
    ) == "aborted"


def test_judge_skipped_doesnt_override_validator_fail():
    """When validators failed, that's the load-bearing signal — don't
    'fix it' to fail via judge_skipped (which is also True in this case)."""
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=False, judge_dimensions=[],
        aborted_reason=None, activated=True,
        skills_invoked=["wiki-lookup"],
        judge_skipped=True,
    ) == "fail"


def test_aborted_dominates_everything():
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason="max_turns", activated=True,
        skills_invoked=["wiki-lookup"],
    ) == "aborted"


def test_error_aborted_reason_treated_as_aborted():
    spec = _positive_spec()
    assert _compute_outcome(
        spec=spec, validators_passed=True, judge_dimensions=[],
        aborted_reason="error", activated=False, skills_invoked=[],
    ) == "aborted"
