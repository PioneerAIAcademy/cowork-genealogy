"""Tests for run_tests.py CLI surface — argument parsing and selection logic."""

import json
import sys
from pathlib import Path

import pytest

# Add the harness root to sys.path so we can import run_tests.py as a module.
_HARNESS_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS_ROOT))

import run_tests  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_mcp_build(monkeypatch):
    """Isolate these tests from the engine-build preflight.

    Every test here monkeypatches away real execution, so none needs the
    compiled engine — but main()'s staleness gate checks
    packages/engine/mcp-server/build/ before anything else. In a checkout
    without a build (a fresh git worktree; the link-worktree hook links
    node_modules but not build/), the gate exits 2 and every exit-code
    assertion fails with `assert 2 == ...` instead of the behavior under
    test. The gate itself is production behavior, deliberately untested
    here.
    """
    monkeypatch.setattr(run_tests, "_check_mcp_build_fresh", lambda: [])


def test_no_args_prints_help_and_exits_zero(capsys):
    rc = run_tests.main([])
    assert rc == 0
    captured = capsys.readouterr()
    assert "usage" in captured.out.lower()


def test_mutually_exclusive_test_and_skill():
    parser = run_tests._build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["--test", "ut_x", "--skill", "search-familysearch-wiki"])


def test_tag_can_repeat():
    parser = run_tests._build_parser()
    args = parser.parse_args(["--tag", "census", "--tag", "1850"])
    assert args.tag == ["census", "1850"]


def _make_tests_dir(tmp_path: Path) -> Path:
    """Build a fake tests/unit directory with two tests."""
    root = tmp_path / "unit"
    skill_a = root / "skill-a"
    skill_b = root / "skill-b"
    skill_a.mkdir(parents=True)
    skill_b.mkdir(parents=True)
    (skill_a / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
    )
    (skill_b / "rubric.md").write_text(
        "# skill-b\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
    )
    (skill_a / "t1.json").write_text(json.dumps({
        "test": {"id": "ut_a_001", "skill": "skill-a", "name": "n", "type": "positive",
                  "description": "x", "tags": ["census", "1850"]},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    }))
    (skill_a / "t2.json").write_text(json.dumps({
        "test": {"id": "ut_a_002", "skill": "skill-a", "name": "n2", "type": "positive",
                  "description": "x", "tags": ["census"]},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    }))
    (skill_b / "t3.json").write_text(json.dumps({
        "test": {"id": "ut_b_001", "skill": "skill-b", "name": "n3", "type": "positive",
                  "description": "x", "tags": ["probate"]},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    }))
    return root


def test_select_by_skill(tmp_path):
    root = _make_tests_dir(tmp_path)
    args = run_tests._build_parser().parse_args(["--skill", "skill-a"])
    specs = run_tests._select_tests(args, root)
    ids = sorted(s.id for s in specs)
    assert ids == ["ut_a_001", "ut_a_002"]


def test_select_by_id(tmp_path):
    root = _make_tests_dir(tmp_path)
    args = run_tests._build_parser().parse_args(["--test", "ut_b_001"])
    specs = run_tests._select_tests(args, root)
    assert [s.id for s in specs] == ["ut_b_001"]


def test_select_by_tag(tmp_path):
    root = _make_tests_dir(tmp_path)
    args = run_tests._build_parser().parse_args(["--tag", "census"])
    specs = run_tests._select_tests(args, root)
    ids = sorted(s.id for s in specs)
    assert ids == ["ut_a_001", "ut_a_002"]


def test_select_by_multiple_tags_is_and(tmp_path):
    root = _make_tests_dir(tmp_path)
    args = run_tests._build_parser().parse_args(["--tag", "census", "--tag", "1850"])
    specs = run_tests._select_tests(args, root)
    ids = sorted(s.id for s in specs)
    assert ids == ["ut_a_001"]  # only this one has BOTH tags


def _stub_log(test_id, skill, outcome, aborted_reason=None):
    """Return a minimal test ENTRY for exit-code logic tests.

    The harness CLI accumulates per-test entries and writes one envelope
    per skill at the end; what matters here is the fields the CLI loop
    reads (outcome, totals, runs[0].aborted_reason). The `skill` parameter
    is preserved on the loop's `per_skill_entries` bucket — passed via the
    spec, not the entry.
    """
    # Normalize the synthetic outcomes so callers can write expressive
    # cases ("aborted_exec", "aborted_nr") and the entry still has a valid
    # outcome enum value.
    actual_outcome = "aborted" if outcome.startswith("aborted") else outcome
    return {
        "test_id": test_id,
        "outcome": actual_outcome,
        "runs": [{"aborted_reason": aborted_reason}],
        "totals": {"total_cost_usd": 0.0},
    }


def test_exit_code_zero_when_all_pass(tmp_path, monkeypatch):
    _run_with_stubbed_outcomes(tmp_path, monkeypatch, ["pass", "partial", "xfail"])
    # Cannot use process exit; check the returned code from main().
    # _run_with_stubbed_outcomes returns the exit code.


def _run_with_stubbed_outcomes(tmp_path, monkeypatch, outcomes):
    """Drive main() with stub specs and stubbed run_one_test producing
    outcomes in order. Return the exit code."""
    from pathlib import Path
    import json

    root = tmp_path / "unit"
    skill_dir = root / "skill-a"
    skill_dir.mkdir(parents=True)
    (skill_dir / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
    )
    for i, _ in enumerate(outcomes):
        (skill_dir / f"t{i}.json").write_text(json.dumps({
            "test": {"id": f"ut_a_{i:03d}", "skill": "skill-a", "name": "n",
                      "type": "positive", "description": "x", "tags": []},
            "input": {"user_message": "m", "scenario": None},
            "judge_context": [],
        }))

    # Stub auth + run_one_test + write_run_log.
    from harness.auth import AuthConfig
    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    counter = {"n": 0}

    def fake_run(spec, **kwargs):
        outcome = outcomes[counter["n"]]
        counter["n"] += 1
        return _stub_log(spec.id, spec.skill, outcome,
                          aborted_reason="max_turns" if outcome == "aborted_exec"
                                        else "not_runnable" if outcome == "aborted_nr"
                                        else "unmatched_tool_call" if outcome == "aborted_umc"
                                        else None)

    def fake_write(log, *, runlogs_root, filename):
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}")
        return out

    monkeypatch.setattr(run_tests, "run_one_test", fake_run)
    monkeypatch.setattr(run_tests, "write_run_log", fake_write)
    # The incremental partial writer validates against the schema; these
    # exit-code tests use minimal non-schema entries, so stub it like
    # write_run_log above.
    monkeypatch.setattr(
        run_tests, "write_partial_runlog",
        lambda log, *, runlogs_root, skill, timestamp:
            Path(runlogs_root) / "unit" / skill / f".partial_{timestamp}.json",
    )

    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    return run_tests.main([
        "--skill", "skill-a",
        "--tests-dir", str(root), "--runlogs-root", str(runlogs),
    ])


def test_exit_zero_for_all_pass_partial_xfail(tmp_path, monkeypatch):
    rc = _run_with_stubbed_outcomes(tmp_path, monkeypatch, ["pass", "partial", "xfail"])
    assert rc == 0


def test_exit_one_for_fail(tmp_path, monkeypatch):
    rc = _run_with_stubbed_outcomes(tmp_path, monkeypatch, ["pass", "fail"])
    assert rc == 1


def test_exit_one_for_xpass(tmp_path, monkeypatch):
    rc = _run_with_stubbed_outcomes(tmp_path, monkeypatch, ["xpass"])
    assert rc == 1


def test_exit_two_for_not_runnable(tmp_path, monkeypatch):
    rc = _run_with_stubbed_outcomes(tmp_path, monkeypatch, ["pass", "aborted_nr"])
    assert rc == 2


def test_exit_three_for_exec_abort(tmp_path, monkeypatch):
    rc = _run_with_stubbed_outcomes(tmp_path, monkeypatch, ["pass", "aborted_exec"])
    assert rc == 3


# Phase 1: unmatched_tool_call no longer aborts. Tests with wrong tool args
# continue to the judge, which fails them (exit 1) after seeing the
# fixture_not_found errors. The following tests were removed:
# - test_exit_two_for_unmatched_tool_call
# - test_unmatched_tool_call_takes_precedence_over_exec_abort


def test_fail_takes_precedence_over_aborts(tmp_path, monkeypatch):
    rc = _run_with_stubbed_outcomes(tmp_path, monkeypatch, ["fail", "aborted_nr"])
    assert rc == 1


def test_not_runnable_takes_precedence_over_exec_abort(tmp_path, monkeypatch):
    rc = _run_with_stubbed_outcomes(tmp_path, monkeypatch, ["aborted_exec", "aborted_nr"])
    assert rc == 2


def test_suite_cost_cap_stops_after_threshold(tmp_path, monkeypatch, capsys):
    """When cumulative cost crosses --max-cost-usd, remaining tests are skipped."""
    import json
    from pathlib import Path
    from harness.auth import AuthConfig

    root = tmp_path / "unit"
    skill_dir = root / "skill-a"
    skill_dir.mkdir(parents=True)
    (skill_dir / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
    )
    for i in range(5):
        (skill_dir / f"t{i}.json").write_text(json.dumps({
            "test": {"id": f"ut_a_{i:03d}", "skill": "skill-a", "name": "n",
                      "type": "positive", "description": "x", "tags": []},
            "input": {"user_message": "m", "scenario": None},
            "judge_context": [],
        }))

    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    counter = {"n": 0}

    def fake_run(spec, **kwargs):
        counter["n"] += 1
        # Each test costs $0.40; cap is $1 → should run 3 tests then stop.
        return {
            "test_id": spec.id,
            "skill": spec.skill,
            "outcome": "pass",
            "runs": [{"aborted_reason": None}],
            "totals": {"total_cost_usd": 0.40},
        }

    def fake_write(log, *, runlogs_root, filename):
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}")
        return out

    monkeypatch.setattr(run_tests, "run_one_test", fake_run)
    monkeypatch.setattr(run_tests, "write_run_log", fake_write)
    # The incremental partial writer validates against the schema; these
    # exit-code tests use minimal non-schema entries, so stub it like
    # write_run_log above.
    monkeypatch.setattr(
        run_tests, "write_partial_runlog",
        lambda log, *, runlogs_root, skill, timestamp:
            Path(runlogs_root) / "unit" / skill / f".partial_{timestamp}.json",
    )

    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    # Pinned to --concurrency 1: exact-count cost gating is a serial guarantee.
    # Under concurrency the suite submits up to N tests before any completes,
    # so cumulative cost lags and the cap becomes an approximate safety net
    # (it stops *new* submissions once completed cost crosses the threshold,
    # but in-flight tests finish). The projection math below only holds serially.
    rc = run_tests.main([
        "--skill", "skill-a",
        "--tests-dir", str(root),
        "--runlogs-root", str(runlogs),
        "--max-cost-usd", "1.0",
        "--concurrency", "1",
    ])

    # v1.4 projects per-test cost before allowing it. With seed avg $0.10
    # first test runs (projected $0.10 ≤ $1.00). After the first $0.40 test,
    # avg = $0.40, so before test #3 we project $0.80 + 0.40 = $1.20, which
    # exceeds the $1.00 cap → skip starting from test #3. So 2 tests run.
    #
    # The earlier (pre-#56) check was after-the-fact, which let cumulative
    # cost overrun by one test. Projection-based gating stops cleanly.
    assert counter["n"] == 2
    captured = capsys.readouterr()
    assert "cap" in captured.err.lower()
    assert rc == 0  # all tests that ran were pass


def test_suite_cost_cap_resists_early_outlier(tmp_path, monkeypatch):
    """v1.8: one expensive early test shouldn't extrapolate to stall the
    suite. Median-of-recent estimator is robust to a single $2 outlier
    when subsequent tests cost $0.10."""
    import json
    from pathlib import Path
    from harness.auth import AuthConfig

    root = tmp_path / "unit"
    skill_dir = root / "skill-a"
    skill_dir.mkdir(parents=True)
    (skill_dir / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
    )
    # 8 tests, $5 cap, one $2 outlier first then $0.10 each.
    for i in range(8):
        (skill_dir / f"t{i}.json").write_text(json.dumps({
            "test": {"id": f"ut_a_{i:03d}", "skill": "skill-a", "name": "n",
                      "type": "positive", "description": "x", "tags": []},
            "input": {"user_message": "m", "scenario": None},
            "judge_context": [],
        }))

    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    costs = [2.0] + [0.10] * 7  # outlier first, then cheap

    counter = {"n": 0}
    def fake_run(spec, **kwargs):
        c = costs[counter["n"]]
        counter["n"] += 1
        return {
            "test_id": spec.id, "skill": spec.skill, "outcome": "pass",
            "runs": [{"aborted_reason": None}],
            "totals": {"total_cost_usd": c},
        }

    def fake_write(log, *, runlogs_root, filename):
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}")
        return out

    monkeypatch.setattr(run_tests, "run_one_test", fake_run)
    monkeypatch.setattr(run_tests, "write_run_log", fake_write)
    # The incremental partial writer validates against the schema; these
    # exit-code tests use minimal non-schema entries, so stub it like
    # write_run_log above.
    monkeypatch.setattr(
        run_tests, "write_partial_runlog",
        lambda log, *, runlogs_root, skill, timestamp:
            Path(runlogs_root) / "unit" / skill / f".partial_{timestamp}.json",
    )

    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    # Pinned to --concurrency 1: this exercises the serial median estimator,
    # which depends on the order costs accumulate. Under concurrency the
    # stubbed counter/cost indexing would also race across worker threads.
    rc = run_tests.main([
        "--skill", "skill-a",
        "--tests-dir", str(root),
        "--runlogs-root", str(runlogs),
        "--max-cost-usd", "5.0",
        "--concurrency", "1",
    ])
    # Pre-v1.8: cumulative mean = ($2 + 6×$0.10) / 7 ≈ $0.37 after run 7;
    # earlier the mean is dominated by the $2 outlier ($2/2, $2.1/3 = $0.7...)
    # and projection stalls the suite at test 3 or 4.
    # v1.8 median resists: median of [$2.0] = $2.0 (stalls test 2!) — but
    # after the second cheap run, median of [$2.0, $0.10] = $1.05; after
    # the third, median = $0.10. So the suite runs 1 test ($2) + stalls
    # OR runs more if order is favorable. Acceptable cap is "outlier
    # doesn't cause every subsequent test to be skipped". Verify at
    # least 4 tests run with $5 cap.
    assert counter["n"] >= 4, (
        f"expected at least 4 tests to run despite the early outlier; ran {counter['n']}"
    )
    assert rc == 0


def test_suite_wall_clock_cap_stops(tmp_path, monkeypatch):
    """Wall-clock cap of 0 should skip every test after the first."""
    import json, time
    from pathlib import Path
    from harness.auth import AuthConfig

    root = tmp_path / "unit"
    skill_dir = root / "skill-a"
    skill_dir.mkdir(parents=True)
    (skill_dir / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
    )
    for i in range(3):
        (skill_dir / f"t{i}.json").write_text(json.dumps({
            "test": {"id": f"ut_a_{i:03d}", "skill": "skill-a", "name": "n",
                      "type": "positive", "description": "x", "tags": []},
            "input": {"user_message": "m", "scenario": None},
            "judge_context": [],
        }))

    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    counter = {"n": 0}

    def fake_run(spec, **kwargs):
        counter["n"] += 1
        time.sleep(0.05)
        return {
            "test_id": spec.id, "skill": spec.skill, "outcome": "pass",
            "runs": [{"aborted_reason": None}],
            "totals": {"total_cost_usd": 0.0},
        }

    def fake_write(log, *, runlogs_root, filename):
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}")
        return out

    monkeypatch.setattr(run_tests, "run_one_test", fake_run)
    monkeypatch.setattr(run_tests, "write_run_log", fake_write)
    # The incremental partial writer validates against the schema; these
    # exit-code tests use minimal non-schema entries, so stub it like
    # write_run_log above.
    monkeypatch.setattr(
        run_tests, "write_partial_runlog",
        lambda log, *, runlogs_root, skill, timestamp:
            Path(runlogs_root) / "unit" / skill / f".partial_{timestamp}.json",
    )

    # max-wall-clock-seconds of 0 means "stop before any test runs"
    # except the first one — the cap check happens at the start of each
    # iteration, and elapsed starts at 0.
    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    rc = run_tests.main([
        "--skill", "skill-a",
        "--tests-dir", str(root),
        "--runlogs-root", str(runlogs),
        "--max-wall-clock-seconds", "0",
    ])
    assert counter["n"] <= 1  # at most one test before cap fires


def test_empty_selection_exits_two(tmp_path):
    """Bug #5: a --skill typo should not silently green CI."""
    # Build a tests dir with one test that won't match the typo.
    root = tmp_path / "unit"
    skill_dir = root / "skill-a"
    skill_dir.mkdir(parents=True)
    (skill_dir / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
    )
    import json
    (skill_dir / "t1.json").write_text(json.dumps({
        "test": {"id": "ut_a_001", "skill": "skill-a", "name": "n",
                  "type": "positive", "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    }))
    rc = run_tests.main(["--skill", "skill-nope", "--tests-dir", str(root)])
    assert rc == 2


def test_unknown_test_id_returns_empty(tmp_path):
    root = _make_tests_dir(tmp_path)
    args = run_tests._build_parser().parse_args(["--test", "ut_nope"])
    specs = run_tests._select_tests(args, root)
    assert specs == []


# --- concurrency -----------------------------------------------------------


def test_resolve_concurrency_honors_explicit_flag():
    # An explicit --concurrency wins over the RAM-aware default, both ways.
    assert run_tests._resolve_concurrency(8) == (8, "flag")
    assert run_tests._resolve_concurrency(1) == (1, "flag")
    assert run_tests._resolve_concurrency(16) == (16, "flag")


def test_resolve_concurrency_auto_is_bounded():
    # With no flag, the auto value stays within [floor, cap] regardless of
    # the host's RAM (None/unknown RAM falls back to the floor).
    value, source = run_tests._resolve_concurrency(None)
    assert source == "auto"
    assert run_tests._MIN_AUTO_CONCURRENCY <= value <= run_tests._MAX_AUTO_CONCURRENCY


def test_resolve_concurrency_zero_or_negative_falls_back_to_auto():
    # argparse can't stop a user passing 0/-1; treat it as "use the default".
    assert run_tests._resolve_concurrency(0)[1] == "auto"
    assert run_tests._resolve_concurrency(-4)[1] == "auto"


def test_concurrency_runs_every_test_and_preserves_order(tmp_path, monkeypatch):
    """Under --concurrency N, all tests still run and the per-skill run log
    keeps selection order even when they finish out of order."""
    import threading
    import time
    from harness.auth import AuthConfig

    root = tmp_path / "unit"
    skill_dir = root / "skill-a"
    skill_dir.mkdir(parents=True)
    (skill_dir / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
    )
    n = 6
    for i in range(n):
        (skill_dir / f"t{i}.json").write_text(json.dumps({
            "test": {"id": f"ut_a_{i:03d}", "skill": "skill-a", "name": "n",
                      "type": "positive", "description": "x", "tags": []},
            "input": {"user_message": "m", "scenario": None},
            "judge_context": [],
        }))

    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )

    lock = threading.Lock()
    seen: list[str] = []
    max_in_flight = {"v": 0, "cur": 0}

    def fake_run(spec, **kwargs):
        with lock:
            seen.append(spec.id)
            max_in_flight["cur"] += 1
            max_in_flight["v"] = max(max_in_flight["v"], max_in_flight["cur"])
        # Reverse the finish order vs. submission order: earlier ids sleep
        # longer, so completion order != selection order. This proves the
        # final ordering is rebuilt from selection order, not arrival order.
        idx = int(spec.id.rsplit("_", 1)[-1])
        time.sleep(0.02 * (n - idx))
        with lock:
            max_in_flight["cur"] -= 1
        return {
            "test_id": spec.id, "skill": spec.skill, "outcome": "pass",
            "runs": [{"aborted_reason": None}],
            "totals": {"total_cost_usd": 0.01, "duration_ms": 1.0},
        }

    captured_logs: list[dict] = []

    def fake_write(log, *, runlogs_root, filename):
        captured_logs.append(log)
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}")
        return out

    monkeypatch.setattr(run_tests, "run_one_test", fake_run)
    monkeypatch.setattr(run_tests, "write_run_log", fake_write)
    # The incremental partial writer validates against the schema; these
    # exit-code tests use minimal non-schema entries, so stub it like
    # write_run_log above.
    monkeypatch.setattr(
        run_tests, "write_partial_runlog",
        lambda log, *, runlogs_root, skill, timestamp:
            Path(runlogs_root) / "unit" / skill / f".partial_{timestamp}.json",
    )

    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    rc = run_tests.main([
        "--skill", "skill-a",
        "--tests-dir", str(root),
        "--runlogs-root", str(runlogs),
        "--concurrency", "4",
    ])

    assert rc == 0
    assert sorted(seen) == [f"ut_a_{i:03d}" for i in range(n)]  # all ran
    assert max_in_flight["v"] > 1  # actually overlapped (was parallel)
    assert max_in_flight["v"] <= 4  # never exceeded the cap
    # Run log keeps selection order despite reversed completion order.
    assert len(captured_logs) == 1
    logged_ids = [t["test_id"] for t in captured_logs[0]["tests"]]
    assert logged_ids == [f"ut_a_{i:03d}" for i in range(n)]


def _write_minimal_test(skill_dir: Path, test_id: str, skill: str, *, execution=None):
    body = {
        "test": {"id": test_id, "skill": skill, "name": "n",
                 "type": "positive", "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    }
    if execution is not None:
        body["execution"] = execution
    (skill_dir / f"{test_id}.json").write_text(json.dumps(body))


def _stub_partial(monkeypatch):
    """Stub the incremental partial writer. These tests use minimal
    non-schema entries that the real (validating) writer would reject —
    same reason the exit-code tests above stub it."""
    monkeypatch.setattr(
        run_tests, "write_partial_runlog",
        lambda log, *, runlogs_root, skill, timestamp:
            Path(runlogs_root) / "unit" / skill / f".partial_{timestamp}.json",
    )


def test_multi_skill_runs_both_and_writes_one_runlog_each(tmp_path, monkeypatch):
    """--skill a b runs every test from both skills in one pool and writes
    one releasable run log per skill."""
    from harness.auth import AuthConfig

    root = tmp_path / "unit"
    for skill, ids in (("skill-a", ["ut_a_000", "ut_a_001"]), ("skill-b", ["ut_b_000"])):
        sdir = root / skill
        sdir.mkdir(parents=True)
        (sdir / "rubric.md").write_text(
            "# x\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
        )
        for tid in ids:
            _write_minimal_test(sdir, tid, skill)

    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )

    def fake_run(spec, **kwargs):
        return {
            "test_id": spec.id, "skill": spec.skill, "outcome": "pass",
            "runs": [{"aborted_reason": None}],
            "totals": {"total_cost_usd": 0.01, "duration_ms": 1.0},
        }

    captured_logs: list[dict] = []

    def fake_write(log, *, runlogs_root, filename):
        captured_logs.append(log)
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}")
        return out

    monkeypatch.setattr(run_tests, "run_one_test", fake_run)
    monkeypatch.setattr(run_tests, "write_run_log", fake_write)
    _stub_partial(monkeypatch)

    rc = run_tests.main([
        "--skill", "skill-a", "skill-b",
        "--tests-dir", str(root),
        "--runlogs-root", str(tmp_path / "runlogs"),
        "--concurrency", "3",
    ])

    assert rc == 0
    # One run log per skill, each marked releasable (full --skill, no --tag).
    by_skill = {log["skill"]: log for log in captured_logs}
    assert set(by_skill) == {"skill-a", "skill-b"}
    assert all(log["releasable"] for log in captured_logs)
    assert {t["test_id"] for t in by_skill["skill-a"]["tests"]} == {"ut_a_000", "ut_a_001"}
    assert {t["test_id"] for t in by_skill["skill-b"]["tests"]} == {"ut_b_000"}


def test_longest_first_scheduling_submits_heaviest_test_earliest(tmp_path, monkeypatch):
    """With concurrency=1, submission order == execution order, so the
    heaviest test (largest wall-clock cap) must run first regardless of
    selection order."""
    from harness.auth import AuthConfig

    root = tmp_path / "unit"
    sdir = root / "skill-a"
    sdir.mkdir(parents=True)
    (sdir / "rubric.md").write_text(
        "# x\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
    )
    # Selection order is light, heavy, medium; LPT should run heavy->medium->light.
    _write_minimal_test(sdir, "ut_a_000_light", "skill-a")  # default 300
    _write_minimal_test(sdir, "ut_a_001_heavy", "skill-a", execution={"max_wall_clock_seconds": 1200})
    _write_minimal_test(sdir, "ut_a_002_medium", "skill-a", execution={"max_wall_clock_seconds": 600})

    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )

    seen: list[str] = []

    def fake_run(spec, **kwargs):
        seen.append(spec.id)
        return {
            "test_id": spec.id, "skill": spec.skill, "outcome": "pass",
            "runs": [{"aborted_reason": None}],
            "totals": {"total_cost_usd": 0.01, "duration_ms": 1.0},
        }

    monkeypatch.setattr(run_tests, "run_one_test", fake_run)
    monkeypatch.setattr(
        run_tests, "write_run_log",
        lambda log, *, runlogs_root, filename: Path(runlogs_root),
    )
    _stub_partial(monkeypatch)

    rc = run_tests.main([
        "--skill", "skill-a",
        "--tests-dir", str(root),
        "--runlogs-root", str(tmp_path / "runlogs"),
        "--concurrency", "1",
    ])

    assert rc == 0
    assert seen == ["ut_a_001_heavy", "ut_a_002_medium", "ut_a_000_light"]


def _write_prior_runlog(runlogs_root: Path, skill: str, durations_s: dict[str, float],
                        *, timestamp: str = "2026-01-01_00-00-00") -> None:
    d = runlogs_root / "unit" / skill
    d.mkdir(parents=True, exist_ok=True)
    env = {
        "skill": skill,
        "timestamp": timestamp,
        "tests": [
            {"test_id": tid, "totals": {"duration_ms": s * 1000.0}}
            for tid, s in durations_s.items()
        ],
    }
    (d / f"v1_{timestamp}.json").write_text(json.dumps(env))


def test_load_actual_durations_reads_latest_by_timestamp(tmp_path):
    root = tmp_path / "runlogs"
    _write_prior_runlog(root, "skill-a", {"ut_a_000": 10.0},
                        timestamp="2026-01-01_00-00-00")
    _write_prior_runlog(root, "skill-a", {"ut_a_000": 99.0},
                        timestamp="2026-02-02_00-00-00")  # newer wins
    got = run_tests._load_actual_durations(root, {"skill-a"})
    assert got == {"ut_a_000": 99.0}


def test_est_test_seconds_prefers_actuals_over_cap():
    from harness.loader import load_test_from_dict
    spec = load_test_from_dict({
        "test": {"id": "ut_cap_001", "skill": "skill-a", "name": "n",
                 "type": "positive", "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "execution": {"max_wall_clock_seconds": 1200},
        "judge_context": [],
    })
    # No actuals -> cap.
    assert run_tests._est_test_seconds(spec) == 1200.0
    # Actual present -> actual wins over the cap.
    assert run_tests._est_test_seconds(spec, {spec.id: 42.0}) == 42.0


def test_longest_first_uses_actual_durations_over_caps(tmp_path, monkeypatch):
    """A prior run log's actual durations drive ordering even when wall-clock
    caps are equal — the heaviest *actual* runs first."""
    from harness.auth import AuthConfig

    root = tmp_path / "unit"
    sdir = root / "skill-a"
    sdir.mkdir(parents=True)
    (sdir / "rubric.md").write_text(
        "# x\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n"
    )
    # All default cap (300) — only the prior actuals differentiate them.
    for tid in ("ut_a_000", "ut_a_001", "ut_a_002"):
        _write_minimal_test(sdir, tid, "skill-a")

    runlogs = tmp_path / "runlogs"
    _write_prior_runlog(runlogs, "skill-a",
                        {"ut_a_000": 50.0, "ut_a_001": 400.0, "ut_a_002": 150.0})

    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    seen: list[str] = []

    def fake_run(spec, **kwargs):
        seen.append(spec.id)
        return {"test_id": spec.id, "skill": spec.skill, "outcome": "pass",
                "runs": [{"aborted_reason": None}],
                "totals": {"total_cost_usd": 0.01, "duration_ms": 1.0}}

    monkeypatch.setattr(run_tests, "run_one_test", fake_run)
    monkeypatch.setattr(run_tests, "write_run_log",
                        lambda log, *, runlogs_root, filename: Path(runlogs_root))
    _stub_partial(monkeypatch)

    rc = run_tests.main([
        "--skill", "skill-a",
        "--tests-dir", str(root),
        "--runlogs-root", str(runlogs),
        "--concurrency", "1",
    ])
    assert rc == 0
    # Heaviest actual first: 400 (a_001) > 150 (a_002) > 50 (a_000).
    assert seen == ["ut_a_001", "ut_a_002", "ut_a_000"]


def test_ctrl_c_keeps_completed_tests_as_scratch_and_exits_130(tmp_path, monkeypatch):
    """A Ctrl-C part-way through saves the tests that finished as a partial
    scratch run log, never a releasable v{N}, and exits 130.

    Concurrency is pinned to 1 so exactly one test completes before the
    interrupt, deterministically.
    """
    from harness.auth import AuthConfig

    root = tmp_path / "unit"
    skill_dir = root / "skill-a"
    skill_dir.mkdir(parents=True)
    (skill_dir / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n",
        encoding="utf-8",
    )
    for i in range(3):
        (skill_dir / f"t{i}.json").write_text(json.dumps({
            "test": {"id": f"ut_a_{i:03d}", "skill": "skill-a", "name": "n",
                      "type": "positive", "description": "x", "tags": []},
            "input": {"user_message": "m", "scenario": None},
            "judge_context": [],
        }), encoding="utf-8")

    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )

    counter = {"n": 0}

    def fake_run(spec, **kwargs):
        counter["n"] += 1
        if counter["n"] == 1:
            return _stub_log(spec.id, spec.skill, "pass")
        raise KeyboardInterrupt  # genealogist hits Ctrl-C during test 2

    # Stub the partial writer (real one validates full schema entries); write a
    # real dotfile so the *real* promote_partial_to_scratch can rename it.
    def fake_partial_write(log, *, runlogs_root, skill, timestamp):
        out = Path(runlogs_root) / "unit" / skill / f".partial_{timestamp}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"n_tests": len(log["tests"])}), encoding="utf-8")
        return out

    monkeypatch.setattr(run_tests, "run_one_test", fake_run)
    monkeypatch.setattr(run_tests, "write_partial_runlog", fake_partial_write)

    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    rc = run_tests.main([
        "--skill", "skill-a",
        "--tests-dir", str(root),
        "--runlogs-root", str(runlogs),
        "--concurrency", "1",
    ])

    assert rc == 130
    out_dir = runlogs / "unit" / "skill-a"
    scratch = list(out_dir.glob("scratch_*.json"))
    assert len(scratch) == 1, "completed tests should be promoted to a scratch log"
    # The completed test was captured...
    assert json.loads(scratch[0].read_text(encoding="utf-8"))["n_tests"] == 1
    # ...and we must NOT mint a releasable candidate from an interrupted run.
    assert list(out_dir.glob("v*.json")) == []
    # The in-progress dotfile was moved, not left behind.
    assert list(out_dir.glob(".partial_*")) == []
