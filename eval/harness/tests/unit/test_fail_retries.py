"""A test whose single run fails is retried up to FAIL_RETRIES times (issue #3733)."""

import asyncio

import pytest

from harness import orchestrator
from harness.auth import AuthConfig
from harness.loader import load_test
from harness.orchestrator import FAIL_RETRIES, OrchestratorPaths, REPO_ROOT, _run_one_test_async
from harness.runlog import JudgeResult, SingleRun, ValidatorResult

WIKI_TEST_PATH = REPO_ROOT / "eval/tests/unit/search-wikipedia/simple-topic-lookup.json"


def _run(outcome: str) -> SingleRun:
    return SingleRun(
        outcome=outcome,
        aborted_reason="error" if outcome == "aborted" else None,
        duration_ms=1.0,
        input_tokens=0,
        cached_input_tokens=0,
        output_tokens=0,
        skill_cost_usd=0.0,
        output={},
        validators=ValidatorResult(passed=outcome != "fail", results=[]),
        judge=JudgeResult(skipped=True, dimensions=[], judge_cost_usd=0.0),
    )


def _run_test(monkeypatch, tmp_path, outcomes, *, fail_retries, runs_per_test=1):
    """Run the wiki test with `_execute_single_run` serving `outcomes` in order.
    Returns the entry and how many runs were asked for."""
    queue = list(outcomes)
    asked: list[int] = []

    async def fake_execute(*, run_index, **kwargs):
        asked.append(run_index)
        return _run(queue.pop(0))

    monkeypatch.setattr(orchestrator, "_execute_single_run", fake_execute)
    spec = load_test(WIKI_TEST_PATH)
    spec.runs_per_test = runs_per_test
    entry = asyncio.run(_run_one_test_async(
        spec=spec,
        auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
        paths=OrchestratorPaths(runlogs_root=tmp_path),
        model="claude-sonnet-4-6",
        judge_model="claude-haiku-4-5-20251001",
        timestamp="2026-10-22_10-00-00",
        fail_retries=fail_retries,
    ))
    return entry, asked


def test_fail_retries_is_three():
    assert FAIL_RETRIES == 3


def test_a_failed_run_that_passes_three_retries_is_a_pass(monkeypatch, tmp_path):
    entry, asked = _run_test(
        monkeypatch, tmp_path, ["fail", "pass", "pass", "pass"], fail_retries=3
    )
    assert asked == [0, 1, 2, 3]
    assert [r["outcome"] for r in entry["runs"]] == ["fail", "pass", "pass", "pass"]
    assert entry["outcome"] == "pass"
    assert entry["flaky"] is True


@pytest.mark.parametrize("bad", ["fail", "aborted"])
def test_retries_stop_at_the_first_retry_that_does_not_pass(monkeypatch, tmp_path, bad):
    entry, asked = _run_test(
        monkeypatch, tmp_path, ["fail", "pass", bad, "pass"], fail_retries=3
    )
    assert asked == [0, 1, 2]
    assert entry["outcome"] != "pass"


def test_a_partial_retry_does_not_stop_the_retries(monkeypatch, tmp_path):
    entry, asked = _run_test(
        monkeypatch, tmp_path, ["fail", "partial", "pass", "pass"], fail_retries=3
    )
    assert asked == [0, 1, 2, 3]
    assert entry["outcome"] == "pass"


@pytest.mark.parametrize("first", ["pass", "partial", "aborted"])
def test_only_a_failed_first_run_is_retried(monkeypatch, tmp_path, first):
    entry, asked = _run_test(monkeypatch, tmp_path, [first], fail_retries=3)
    assert asked == [0]


def test_no_retries_by_default(monkeypatch, tmp_path):
    entry, asked = _run_test(monkeypatch, tmp_path, ["fail"], fail_retries=0)
    assert asked == [0]
    assert entry["outcome"] == "fail"


def test_the_end_of_suite_table_shows_a_retried_tests_runs(capsys):
    import run_tests

    note = run_tests._runs_note({"runs": [{"outcome": o} for o in ("fail", "pass")]})
    row = {"test_id": "ut_x", "skill": "s", "outcome": "pass", "reason": "", "runs_note": note}
    run_tests._print_summary([row])
    assert "(runs: fail, pass)" in capsys.readouterr().out
    assert run_tests._runs_note({"runs": [{"outcome": "pass"}]}) == ""


def test_a_multi_run_probe_is_not_retried(monkeypatch, tmp_path):
    """`--runs-per-test N` is already a variance probe."""
    entry, asked = _run_test(
        monkeypatch, tmp_path, ["fail", "fail", "fail"], fail_retries=3, runs_per_test=3
    )
    assert asked == [0, 1, 2]
