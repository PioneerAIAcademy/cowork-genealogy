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
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
    )
    (skill_b / "rubric.md").write_text(
        "# skill-b\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
    )
    (skill_a / "t1.json").write_text(json.dumps({
        "test": {"id": "ut_a_001", "skill": "skill-a", "name": "n", "type": "positive",
                  "description": "x", "tags": ["census", "1850"]},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    }), encoding="utf-8")
    (skill_a / "t2.json").write_text(json.dumps({
        "test": {"id": "ut_a_002", "skill": "skill-a", "name": "n2", "type": "positive",
                  "description": "x", "tags": ["census"]},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    }), encoding="utf-8")
    (skill_b / "t3.json").write_text(json.dumps({
        "test": {"id": "ut_b_001", "skill": "skill-b", "name": "n3", "type": "positive",
                  "description": "x", "tags": ["probate"]},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    }), encoding="utf-8")
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


def _stub_anthropic_ok(monkeypatch):
    """Stub the Anthropic client so the key-validity preflight succeeds.

    Existing tests that stub api_key="x" would hit the real Anthropic API
    during the liveness check. This makes the check a no-op so those tests
    continue to exercise exit-code logic, not auth validation.
    """
    import anthropic

    class _FakeMessages:
        def create(self, **kwargs):
            return None  # success — preflight passes

    class _FakeClient:
        def __init__(self, **kwargs):
            self.messages = _FakeMessages()

    monkeypatch.setattr(anthropic, "Anthropic", _FakeClient)


def _run_with_stubbed_outcomes(tmp_path, monkeypatch, outcomes):
    """Drive main() with stub specs and stubbed run_one_test producing
    outcomes in order. Return the exit code."""
    from pathlib import Path
    import json

    root = tmp_path / "unit"
    skill_dir = root / "skill-a"
    skill_dir.mkdir(parents=True)
    (skill_dir / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
    )
    for i, _ in enumerate(outcomes):
        (skill_dir / f"t{i}.json").write_text(json.dumps({
            "test": {"id": f"ut_a_{i:03d}", "skill": "skill-a", "name": "n",
                      "type": "positive", "description": "x", "tags": []},
            "input": {"user_message": "m", "scenario": None},
            "judge_context": [],
        }), encoding="utf-8")

    # Stub auth + run_one_test + write_run_log.
    from harness.auth import AuthConfig
    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    _stub_anthropic_ok(monkeypatch)
    counter = {"n": 0}

    def fake_run(spec, **kwargs):
        outcome = outcomes[counter["n"]]
        counter["n"] += 1
        return _stub_log(spec.id, spec.skill, outcome,
                          aborted_reason="max_turns" if outcome == "aborted_exec"
                                        else "not_runnable" if outcome == "aborted_nr"
                                        else "unmatched_tool_call" if outcome == "aborted_umc"
                                        else None)

    def fake_write(log, *, runlogs_root, filename, **kwargs):
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}", encoding="utf-8")
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
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
    )
    for i in range(5):
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
    _stub_anthropic_ok(monkeypatch)
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

    def fake_write(log, *, runlogs_root, filename, **kwargs):
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}", encoding="utf-8")
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
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
    )
    # 8 tests, $5 cap, one $2 outlier first then $0.10 each.
    for i in range(8):
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
    _stub_anthropic_ok(monkeypatch)
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

    def fake_write(log, *, runlogs_root, filename, **kwargs):
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}", encoding="utf-8")
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
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
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
    _stub_anthropic_ok(monkeypatch)
    counter = {"n": 0}

    def fake_run(spec, **kwargs):
        counter["n"] += 1
        time.sleep(0.05)
        return {
            "test_id": spec.id, "skill": spec.skill, "outcome": "pass",
            "runs": [{"aborted_reason": None}],
            "totals": {"total_cost_usd": 0.0},
        }

    def fake_write(log, *, runlogs_root, filename, **kwargs):
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}", encoding="utf-8")
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
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
    )
    import json
    (skill_dir / "t1.json").write_text(json.dumps({
        "test": {"id": "ut_a_001", "skill": "skill-a", "name": "n",
                  "type": "positive", "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": None},
        "judge_context": [],
    }), encoding="utf-8")
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
    # detail is None on the flag path (no RAM reasoning to explain).
    assert run_tests._resolve_concurrency(8) == (8, "flag", None)
    assert run_tests._resolve_concurrency(1) == (1, "flag", None)
    assert run_tests._resolve_concurrency(16) == (16, "flag", None)


def test_resolve_concurrency_auto_is_bounded():
    # With no flag, the auto value stays within [floor, cap] regardless of
    # the host's RAM.
    value, source, detail = run_tests._resolve_concurrency(None)
    assert source == "auto"
    assert 1 <= value <= run_tests._MAX_AUTO_CONCURRENCY
    assert detail is not None


def test_resolve_concurrency_zero_or_negative_falls_back_to_auto():
    # argparse can't stop a user passing 0/-1; treat it as "use the default".
    for bad in (0, -4):
        value, source, detail = run_tests._resolve_concurrency(bad)
        assert source == "auto"
        assert value >= 1 and detail is not None


@pytest.mark.parametrize(
    "ram_gb, expected",
    [
        (1.0, 1),    # int(1//2)=0 -> floored to 1, never 0
        (2.0, 1),    # a 2 GiB box gets ONE slot, not the old floor of 4 (#1026)
        (4.0, 2),    # the box from the issue: measurement (2) now wins
        (6.0, 3),
        (8.0, 4),
        (16.0, 8),   # cap
        (32.0, 8),   # int(32//2)=16 -> capped at 8
    ],
)
def test_resolve_concurrency_honors_measured_ram(monkeypatch, ram_gb, expected):
    # The RAM measurement drives the slot count; the floor only forbids 0 and
    # must NOT clamp a low-RAM box upward (that was the #1026 bug).
    monkeypatch.setattr(run_tests, "_total_ram_gb", lambda: ram_gb)
    value, source, detail = run_tests._resolve_concurrency(None)
    assert (value, source) == (expected, "auto")
    assert detail is not None and "GiB RAM" in detail


def test_resolve_concurrency_undetectable_ram_runs_serial(monkeypatch):
    # When RAM can't be measured we can't rule out a tiny box -> run serially,
    # NOT the old fallback of 4.
    monkeypatch.setattr(run_tests, "_total_ram_gb", lambda: None)
    value, source, detail = run_tests._resolve_concurrency(None)
    assert value == run_tests._FALLBACK_CONCURRENCY == 1
    assert source == "auto"
    assert detail is not None  # explains the fallback in the startup line


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
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
    )
    n = 6
    for i in range(n):
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
    _stub_anthropic_ok(monkeypatch)

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

    def fake_write(log, *, runlogs_root, filename, **kwargs):
        captured_logs.append(log)
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}", encoding="utf-8")
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
    (skill_dir / f"{test_id}.json").write_text(json.dumps(body), encoding="utf-8")


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
            "# x\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
        )
        for tid in ids:
            _write_minimal_test(sdir, tid, skill)

    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    _stub_anthropic_ok(monkeypatch)

    def fake_run(spec, **kwargs):
        return {
            "test_id": spec.id, "skill": spec.skill, "outcome": "pass",
            "runs": [{"aborted_reason": None}],
            "totals": {"total_cost_usd": 0.01, "duration_ms": 1.0},
        }

    captured_logs: list[dict] = []

    def fake_write(log, *, runlogs_root, filename, **kwargs):
        captured_logs.append(log)
        out = Path(runlogs_root) / "unit" / log["skill"] / filename
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("{}", encoding="utf-8")
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
        "# x\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
    )
    # Selection order is light, heavy, medium; LPT should run heavy->medium->light.
    _write_minimal_test(sdir, "ut_a_000_light", "skill-a")  # default 300
    _write_minimal_test(sdir, "ut_a_001_heavy", "skill-a", execution={"max_wall_clock_seconds": 1200})
    _write_minimal_test(sdir, "ut_a_002_medium", "skill-a", execution={"max_wall_clock_seconds": 600})

    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    _stub_anthropic_ok(monkeypatch)

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
        lambda log, *, runlogs_root, filename, **kwargs: Path(runlogs_root),
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
    (d / f"v1_{timestamp}.json").write_text(json.dumps(env), encoding="utf-8")


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
        "# x\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n", encoding="utf-8"
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
    _stub_anthropic_ok(monkeypatch)
    seen: list[str] = []

    def fake_run(spec, **kwargs):
        seen.append(spec.id)
        return {"test_id": spec.id, "skill": spec.skill, "outcome": "pass",
                "runs": [{"aborted_reason": None}],
                "totals": {"total_cost_usd": 0.01, "duration_ms": 1.0}}

    monkeypatch.setattr(run_tests, "run_one_test", fake_run)
    monkeypatch.setattr(run_tests, "write_run_log",
                        lambda log, *, runlogs_root, filename, **kwargs: Path(runlogs_root))
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
    _stub_anthropic_ok(monkeypatch)

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


# --- Judge preflight -------------------------------------------------------


def _preflight_tree(tmp_path, types: list[str]) -> Path:
    """A skill dir whose tests have the given `type` values."""
    import json
    root = tmp_path / "unit"
    skill_dir = root / "skill-a"
    skill_dir.mkdir(parents=True)
    (skill_dir / "rubric.md").write_text(
        "# skill-a\n\n## Dim1\n\n- **pass:** ok\n- **partial:** mid\n- **fail:** no\n",
        encoding="utf-8",
    )
    for i, t in enumerate(types):
        body = {
            "test": {"id": f"ut_a_{i:03d}", "skill": "skill-a", "name": "n",
                     "type": t, "description": "x", "tags": []},
            "input": {"user_message": "m", "scenario": None},
            "judge_context": [],
        }
        if t == "negative":
            body["negative"] = {"correct_skill": [], "explanation": "why"}
        (skill_dir / f"t{i}.json").write_text(json.dumps(body), encoding="utf-8")
    return root


def _stub_keyless_auth(monkeypatch):
    from harness.auth import AuthConfig
    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="subscription", api_key=None, detail="stub"),
    )


def test_preflight_aborts_when_judge_key_missing(tmp_path, monkeypatch, capsys):
    """No API key + any positive test must exit 2 before running anything —
    a positive test cannot pass without judge dimensions, so the run would
    burn the whole suite and then fail every one of them."""
    root = _preflight_tree(tmp_path, ["positive", "positive", "negative"])
    _stub_keyless_auth(monkeypatch)
    ran = {"n": 0}
    monkeypatch.setattr(run_tests, "run_one_test",
                        lambda *a, **k: ran.__setitem__("n", ran["n"] + 1))

    rc = run_tests.main(["--skill", "skill-a", "--tests-dir", str(root)])

    assert rc == 2
    assert ran["n"] == 0, "preflight must abort before any test executes"
    err = capsys.readouterr().err
    assert "Judge preflight failed" in err
    assert "2 of 3" in err
    assert "make worktree-link" in err


def test_preflight_allows_negative_only_selection(tmp_path, monkeypatch, capsys):
    """Negative tests are graded on routing, so a keyless run of only negative
    tests is still meaningful — warn, don't abort."""
    root = _preflight_tree(tmp_path, ["negative"])
    _stub_keyless_auth(monkeypatch)
    monkeypatch.setattr(run_tests, "run_one_test",
                        lambda spec, **k: _stub_log(spec.id, spec.skill, "pass"))
    monkeypatch.setattr(run_tests, "write_run_log",
                        lambda log, *, runlogs_root, filename, **kwargs: Path(runlogs_root) / filename)
    monkeypatch.setattr(
        run_tests, "write_partial_runlog",
        lambda log, *, runlogs_root, skill, timestamp:
            Path(runlogs_root) / f".partial_{timestamp}.json",
    )
    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()

    rc = run_tests.main([
        "--skill", "skill-a", "--tests-dir", str(root), "--runlogs-root", str(runlogs),
    ])

    assert rc == 0
    assert "no ANTHROPIC_API_KEY" in capsys.readouterr().err


def test_preflight_override_flag_proceeds(tmp_path, monkeypatch):
    """--allow-missing-judge is the deliberate escape hatch."""
    root = _preflight_tree(tmp_path, ["positive"])
    _stub_keyless_auth(monkeypatch)
    monkeypatch.setattr(run_tests, "run_one_test",
                        lambda spec, **k: _stub_log(spec.id, spec.skill, "pass"))
    monkeypatch.setattr(run_tests, "write_run_log",
                        lambda log, *, runlogs_root, filename, **kwargs: Path(runlogs_root) / filename)
    monkeypatch.setattr(
        run_tests, "write_partial_runlog",
        lambda log, *, runlogs_root, skill, timestamp:
            Path(runlogs_root) / f".partial_{timestamp}.json",
    )
    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()

    rc = run_tests.main([
        "--skill", "skill-a", "--allow-missing-judge",
        "--tests-dir", str(root), "--runlogs-root", str(runlogs),
    ])

    assert rc == 0


def _stub_keyed_auth(monkeypatch, key="sk-test-key"):
    from harness.auth import AuthConfig
    monkeypatch.setattr(
        run_tests, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="subscription", api_key=key, detail="stub"),
    )


def _stub_anthropic_error(monkeypatch, exc_cls, status_code=None):
    """Monkeypatch ``anthropic.Anthropic`` so ``messages.create`` raises *exc_cls*.

    For ``APIConnectionError`` (no HTTP response), pass *status_code* as None.
    For every other ``APIStatusError`` subclass, pass the HTTP status code.
    """
    import anthropic
    import httpx

    if issubclass(exc_cls, anthropic.APIConnectionError):
        exc = exc_cls(
            request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"),
        )
    else:
        exc = exc_cls(
            message="test error",
            response=httpx.Response(
                status_code,
                request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"),
            ),
            body=None,
        )

    class _FakeMessages:
        def create(self, **kwargs):
            raise exc

    class _FakeClient:
        def __init__(self, **kwargs):
            self.messages = _FakeMessages()

    monkeypatch.setattr(anthropic, "Anthropic", _FakeClient)


def _stub_run_through(monkeypatch, tmp_path):
    """Wire up stubs so the suite runs past the preflight into test execution."""
    monkeypatch.setattr(run_tests, "run_one_test",
                        lambda spec, **k: _stub_log(spec.id, spec.skill, "pass"))
    monkeypatch.setattr(run_tests, "write_run_log",
                        lambda log, *, runlogs_root, filename, on_prune=None: Path(runlogs_root) / filename)
    monkeypatch.setattr(
        run_tests, "write_partial_runlog",
        lambda log, *, runlogs_root, skill, timestamp:
            Path(runlogs_root) / f".partial_{timestamp}.json",
    )
    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    return runlogs


def test_preflight_aborts_when_judge_key_invalid(tmp_path, monkeypatch, capsys):
    """A present-but-invalid API key (401) must exit 2 before running anything."""
    import anthropic

    root = _preflight_tree(tmp_path, ["positive", "negative"])
    _stub_keyed_auth(monkeypatch, key="sk-bad-key")
    _stub_anthropic_error(monkeypatch, anthropic.AuthenticationError, 401)
    ran = {"n": 0}
    monkeypatch.setattr(run_tests, "run_one_test",
                        lambda *a, **k: ran.__setitem__("n", ran["n"] + 1))

    rc = run_tests.main(["--skill", "skill-a", "--tests-dir", str(root)])

    assert rc == 2
    assert ran["n"] == 0, "preflight must abort before any test executes"
    assert "rejected it (401)" in capsys.readouterr().err


def test_preflight_aborts_on_403(tmp_path, monkeypatch, capsys):
    """A key with insufficient permissions (403) must also abort."""
    import anthropic

    root = _preflight_tree(tmp_path, ["positive"])
    _stub_keyed_auth(monkeypatch, key="sk-wrong-scope")
    _stub_anthropic_error(monkeypatch, anthropic.PermissionDeniedError, 403)
    ran = {"n": 0}
    monkeypatch.setattr(run_tests, "run_one_test",
                        lambda *a, **k: ran.__setitem__("n", ran["n"] + 1))

    rc = run_tests.main(["--skill", "skill-a", "--tests-dir", str(root)])

    assert rc == 2
    assert ran["n"] == 0
    assert "rejected it (403)" in capsys.readouterr().err


def test_preflight_passes_on_transient_529(tmp_path, monkeypatch):
    """A transient 529 (overloaded) should let the suite proceed."""
    import anthropic

    root = _preflight_tree(tmp_path, ["positive"])
    _stub_keyed_auth(monkeypatch)
    _stub_anthropic_error(monkeypatch, anthropic.OverloadedError, 529)
    runlogs = _stub_run_through(monkeypatch, tmp_path)

    rc = run_tests.main([
        "--skill", "skill-a", "--tests-dir", str(root), "--runlogs-root", str(runlogs),
    ])

    assert rc == 0


def test_preflight_passes_on_transient_429(tmp_path, monkeypatch):
    """A transient 429 (rate limit) should let the suite proceed."""
    import anthropic

    root = _preflight_tree(tmp_path, ["positive"])
    _stub_keyed_auth(monkeypatch)
    _stub_anthropic_error(monkeypatch, anthropic.RateLimitError, 429)
    runlogs = _stub_run_through(monkeypatch, tmp_path)

    rc = run_tests.main([
        "--skill", "skill-a", "--tests-dir", str(root), "--runlogs-root", str(runlogs),
    ])

    assert rc == 0


def test_preflight_passes_on_connection_error(tmp_path, monkeypatch):
    """A connection error (DNS, timeout) should let the suite proceed."""
    import anthropic

    root = _preflight_tree(tmp_path, ["positive"])
    _stub_keyed_auth(monkeypatch)
    _stub_anthropic_error(monkeypatch, anthropic.APIConnectionError)
    runlogs = _stub_run_through(monkeypatch, tmp_path)

    rc = run_tests.main([
        "--skill", "skill-a", "--tests-dir", str(root), "--runlogs-root", str(runlogs),
    ])

    assert rc == 0


def test_preflight_passes_on_unexpected_status(tmp_path, monkeypatch):
    """An unexpected status (e.g. 400 bad request from a deprecated model)
    is not a key problem — let the suite proceed."""
    import anthropic

    root = _preflight_tree(tmp_path, ["positive"])
    _stub_keyed_auth(monkeypatch)
    _stub_anthropic_error(monkeypatch, anthropic.BadRequestError, 400)
    runlogs = _stub_run_through(monkeypatch, tmp_path)

    rc = run_tests.main([
        "--skill", "skill-a", "--tests-dir", str(root), "--runlogs-root", str(runlogs),
    ])

    assert rc == 0


def test_preflight_invalid_key_bypassed_by_flag(tmp_path, monkeypatch):
    """--allow-missing-judge bypasses the key-validity check too."""
    import anthropic

    root = _preflight_tree(tmp_path, ["positive"])
    _stub_keyed_auth(monkeypatch, key="sk-bad-key")
    _stub_anthropic_error(monkeypatch, anthropic.AuthenticationError, 401)
    runlogs = _stub_run_through(monkeypatch, tmp_path)

    rc = run_tests.main([
        "--skill", "skill-a", "--allow-missing-judge",
        "--tests-dir", str(root), "--runlogs-root", str(runlogs),
    ])

    assert rc == 0


def test_preflight_skips_check_for_negative_only(tmp_path, monkeypatch):
    """A bad key with only negative tests should not trigger the liveness
    check — negative tests don't need the judge."""
    import anthropic

    root = _preflight_tree(tmp_path, ["negative", "negative"])
    _stub_keyed_auth(monkeypatch, key="sk-bad-key")
    _stub_anthropic_error(monkeypatch, anthropic.AuthenticationError, 401)
    runlogs = _stub_run_through(monkeypatch, tmp_path)

    rc = run_tests.main([
        "--skill", "skill-a", "--tests-dir", str(root), "--runlogs-root", str(runlogs),
    ])

    assert rc == 0


# --- judge-rule-violation summary (#1401, #1406) -------------------------
#
# `_extract_dimensions` records a warning when the judge breaks one of its
# own prompt rules — an invented rubric dimension (#1361/#1401), or a Tool
# Arguments score on a run that made no MCP calls (#1406). Those land in
# the run log's output.warnings and, before this, nowhere a human reads.


def _row(test_id, *kinds):
    return {
        "test_id": test_id,
        "skill": "search-records",
        "outcome": "pass",
        "judge_warning_kinds": list(kinds),
    }


def test_summary_tallies_judge_warnings(capsys):
    run_tests._print_summary([
        _row("ut_a_001", "dropped_unknown_rubric_dimension"),
        _row("ut_a_002", "coerced_tool_arguments_to_na"),
        _row("ut_a_003", "dropped_unknown_rubric_dimension"),
        _row("ut_a_004"),
    ])
    out = capsys.readouterr().out
    assert "Judge rule violations (3 test-kind pair(s), 2 kind(s)):" in out
    assert "dropped_unknown_rubric_dimension: 2 — ut_a_001, ut_a_003" in out
    assert "coerced_tool_arguments_to_na: 1 — ut_a_002" in out
    # The clean test must not appear in the tally section.
    tally = out.split("Judge rule violations")[1]
    assert "ut_a_004" not in tally


def test_summary_silent_when_no_judge_warnings(capsys):
    """The common case. A header printed on every clean run trains people
    to skip the section, which defeats the point of printing it."""
    run_tests._print_summary([_row("ut_a_001"), _row("ut_a_002")])
    out = capsys.readouterr().out
    assert "ut_a_001" in out          # the normal outcome table still prints
    assert "Judge rule violations" not in out


def test_summary_survives_rows_without_the_key(capsys):
    """Defensive: a row built by an older path has no
    `judge_warning_kinds`. Printing the summary must not be the thing that
    crashes a finished run."""
    run_tests._print_summary([
        {"test_id": "ut_a_001", "skill": "s", "outcome": "pass"},
    ])
    assert "Judge rule violations" not in capsys.readouterr().out


def test_summary_reads_warnings_off_the_real_entry(tmp_path, monkeypatch, capsys):
    """End-to-end through main(): a judge warning on the ENTRY must reach
    the printed tally.

    The three tests above call `_print_summary` with a hand-built row, so
    they all still pass if the row-building loop stops reading
    `runs[].output.warnings` — verified by mutation. This is the one that
    covers that hop, which is the half that actually breaks.
    """
    root = _preflight_tree(tmp_path, ["positive"])
    _stub_keyless_auth(monkeypatch)

    def _entry_with_warning(spec, **k):
        entry = _stub_log(spec.id, spec.skill, "pass")
        entry["runs"][0]["output"] = {
            "warnings": [
                {"kind": "coerced_tool_arguments_to_na",
                 "advisory": "scored 3 on a run with zero MCP calls",
                 "name": "Tool Arguments", "score": 3, "rationale": "..."},
            ]
        }
        return entry

    monkeypatch.setattr(run_tests, "run_one_test", _entry_with_warning)
    monkeypatch.setattr(run_tests, "write_run_log",
                        lambda log, *, runlogs_root, filename, **kwargs:
                            Path(runlogs_root) / filename)
    monkeypatch.setattr(
        run_tests, "write_partial_runlog",
        lambda log, *, runlogs_root, skill, timestamp:
            Path(runlogs_root) / f".partial_{timestamp}.json",
    )
    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()

    rc = run_tests.main([
        "--skill", "skill-a", "--allow-missing-judge",
        "--tests-dir", str(root), "--runlogs-root", str(runlogs),
    ])

    out = capsys.readouterr().out
    assert rc == 0
    assert "Judge rule violations (1 test-kind pair(s), 1 kind(s)):" in out
    assert "coerced_tool_arguments_to_na: 1 — ut_a_000" in out


def test_summary_ignores_non_judge_warning_kinds():
    """`output.warnings` is a shared list. orchestrator._build_warnings also
    puts `unread_skill_call`, `missing_tool_usage_dimension` and
    `uncovered_tool_call` in it — none of which is the judge misbehaving.
    Tallying those under a "Judge rule violations" header would report a
    routine unmatched tool call as a judge fault."""
    assert "unread_skill_call" not in run_tests._JUDGE_WARNING_KINDS
    assert "missing_tool_usage_dimension" not in run_tests._JUDGE_WARNING_KINDS
    assert "uncovered_tool_call" not in run_tests._JUDGE_WARNING_KINDS
    # And every kind judge.py actually emits IS in the set, or it prints
    # nowhere — which is the state this whole section exists to end.
    from pathlib import Path as _P
    src = (_P(__file__).resolve().parents[2] / "harness/judge.py").read_text(
        encoding="utf-8"
    )
    import re as _re
    emitted = set(_re.findall(r'"kind": "([a-z_]+)"', src))
    assert emitted <= run_tests._JUDGE_WARNING_KINDS, (
        f"judge.py emits warning kind(s) the summary will never print: "
        f"{sorted(emitted - run_tests._JUDGE_WARNING_KINDS)}"
    )


def test_summary_count_matches_the_names_it_shows(capsys):
    """One test tripping the same kind twice is one test, not two. The
    headline counted occurrences while the list deduped, so it read as two
    and showed one name, with no '+N more' to explain the gap."""
    run_tests._print_summary([
        {"test_id": "ut_x_001", "skill": "s", "outcome": "pass",
         "judge_warning_kinds": ["dropped_unknown_rubric_dimension"] * 2},
    ])
    out = capsys.readouterr().out
    line = next(l for l in out.splitlines() if "dropped_unknown" in l)
    count = int(line.split(":")[1].split("—")[0].strip())
    names = [n.strip() for n in line.split("—")[1].split("(+")[0].split(",")]
    assert count == len(names) == 1, line
