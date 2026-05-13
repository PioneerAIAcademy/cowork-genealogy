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
        "additional_criteria": [],
    }))
    (skill_a / "t2.json").write_text(json.dumps({
        "test": {"id": "ut_a_002", "skill": "skill-a", "name": "n2", "type": "positive",
                  "description": "x", "tags": ["census"]},
        "input": {"user_message": "m", "scenario": None},
        "additional_criteria": [],
    }))
    (skill_b / "t3.json").write_text(json.dumps({
        "test": {"id": "ut_b_001", "skill": "skill-b", "name": "n3", "type": "positive",
                  "description": "x", "tags": ["probate"]},
        "input": {"user_message": "m", "scenario": None},
        "additional_criteria": [],
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
    """Return a minimal run-log-shaped dict for exit-code logic tests."""
    return {
        "test_id": test_id,
        "skill": skill,
        "outcome": outcome,
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
            "additional_criteria": [],
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
                                        else None)

    def fake_write(log, runlogs_root):
        # Normalize the synthetic "aborted_exec"/"aborted_nr" to "aborted" for
        # the log row, but keep the path returning a real Path.
        if log["outcome"] in ("aborted_exec", "aborted_nr"):
            log["outcome"] = "aborted"
        out = Path(runlogs_root) / f"{log['test_id']}.json"
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
            "additional_criteria": [],
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

    def fake_write(log, runlogs_root):
        out = Path(runlogs_root) / f"{log['test_id']}.json"
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
            "additional_criteria": [],
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

    def fake_write(log, runlogs_root):
        out = Path(runlogs_root) / f"{log['test_id']}.json"
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
        "additional_criteria": [],
    }))
    rc = run_tests.main(["--skill", "skill-nope", "--tests-dir", str(root)])
    assert rc == 2


def test_unknown_test_id_returns_empty(tmp_path):
    root = _make_tests_dir(tmp_path)
    args = run_tests._build_parser().parse_args(["--test", "ut_nope"])
    specs = run_tests._select_tests(args, root)
    assert specs == []
