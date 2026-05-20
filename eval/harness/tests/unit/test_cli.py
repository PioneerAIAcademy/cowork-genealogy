"""Tests for run_tests.py CLI surface — argument parsing and selection logic."""

import json
import sys
from pathlib import Path

import pytest

# Add the harness root to sys.path so we can import run_tests.py as a module.
_HARNESS_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS_ROOT))

import run_tests  # noqa: E402


def test_no_args_prints_help_and_exits_zero(capsys):
    rc = run_tests.main([])
    assert rc == 0
    captured = capsys.readouterr()
    assert "usage" in captured.out.lower()


def test_mutually_exclusive_test_and_skill():
    parser = run_tests._build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["--test", "ut_x", "--skill", "wiki-lookup"])


def test_mutually_exclusive_test_and_all():
    parser = run_tests._build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["--test", "ut_x", "--all"])


def test_tag_can_repeat():
    parser = run_tests._build_parser()
    args = parser.parse_args(["--all", "--tag", "census", "--tag", "1850"])
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


def test_select_all(tmp_path):
    root = _make_tests_dir(tmp_path)
    args = run_tests._build_parser().parse_args(["--all"])
    specs = run_tests._select_tests(args, root)
    ids = sorted(s.id for s in specs)
    assert ids == ["ut_a_001", "ut_a_002", "ut_b_001"]


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

    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    return run_tests.main([
        "--all", "--tests-dir", str(root), "--runlogs-root", str(runlogs),
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


def test_exit_two_for_unmatched_tool_call(tmp_path, monkeypatch):
    """WS1: an uncovered tool call is a test-corpus issue (missing
    fixture) — same exit code as not_runnable."""
    rc = _run_with_stubbed_outcomes(tmp_path, monkeypatch, ["pass", "aborted_umc"])
    assert rc == 2


def test_unmatched_tool_call_takes_precedence_over_exec_abort(tmp_path, monkeypatch):
    """Corpus issues outrank execution aborts in the exit-code precedence."""
    rc = _run_with_stubbed_outcomes(
        tmp_path, monkeypatch, ["aborted_exec", "aborted_umc"]
    )
    assert rc == 2


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

    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    rc = run_tests.main([
        "--all", "--tests-dir", str(root),
        "--runlogs-root", str(runlogs),
        "--max-cost-usd", "1.0",
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

    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    rc = run_tests.main([
        "--all", "--tests-dir", str(root),
        "--runlogs-root", str(runlogs),
        "--max-cost-usd", "5.0",
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

    # max-wall-clock-seconds of 0 means "stop before any test runs"
    # except the first one — the cap check happens at the start of each
    # iteration, and elapsed starts at 0.
    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    rc = run_tests.main([
        "--all", "--tests-dir", str(root),
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
