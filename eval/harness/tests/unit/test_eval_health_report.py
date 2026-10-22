"""`make eval-health` (issue #3733), over planted run logs."""

import json
import subprocess

import pytest

import eval_health_report as ehr


def _plant(root, skill, first_runs, *, test_id="ut_x_001", retries=None, start=0, name=None):
    """One committed log per entry of `first_runs`, each holding `test_id` whose
    first run has that outcome. `retries` appends later runs to every entry."""
    d = root / skill
    d.mkdir(parents=True, exist_ok=True)
    for i, outcome in enumerate(first_runs, start=start):
        ts = f"2026-10-{1 + i // 24:02d}_{i % 24:02d}-00-00"
        dims = [{"source": "rubric", "name": "Framing", "score": 2 if outcome == "partial" else 3}]
        runs = [{"outcome": outcome, "judge": {"dimensions": dims}}]
        runs += [{"outcome": o} for o in (retries or [])]
        log = {"timestamp": ts, "tests": [{"test_id": test_id, "runs": runs}]}
        (d / (name or f"v1_{ts}.json")).write_text(json.dumps(log), encoding="utf-8")


def _report(root, *extra):
    return ehr.main(["--runlogs-dir", str(root), "--no-issues", *extra])


@pytest.mark.parametrize("n, k", [(5, 2), (6, 2), (10, 2), (11, 3), (12, 3), (20, 3)])
def test_fail_threshold(n, k):
    assert ehr.fail_threshold(n) == k


@pytest.mark.parametrize(
    "fails, n, listed",
    [(3, 20, True), (2, 20, False), (2, 6, True), (1, 6, False), (2, 12, False), (2, 4, False)],
)
def test_below_the_bar(tmp_path, capsys, fails, n, listed):
    _plant(tmp_path, "skill-a", ["fail"] * fails + ["pass"] * (n - fails))
    assert _report(tmp_path) == 0
    out = capsys.readouterr().out
    below = out.split("BELOW THE BAR")[1].split("CONSISTENTLY PARTIAL")[0]
    assert ("ut_x_001" in below) is listed


def test_fails_only_in_retries_do_not_count(tmp_path, capsys):
    _plant(tmp_path, "skill-a", ["pass"] * 20, retries=["fail", "fail"])
    _report(tmp_path)
    assert "BELOW THE BAR (0)" in capsys.readouterr().out


@pytest.mark.parametrize("partials, listed", [(10, True), (9, False)])
def test_consistently_partial(tmp_path, capsys, partials, listed):
    _plant(tmp_path, "skill-a", ["partial"] * partials + ["pass"] * (20 - partials))
    _report(tmp_path)
    out = capsys.readouterr().out
    section = out.split("CONSISTENTLY PARTIAL")[1]
    assert ("ut_x_001" in section) is listed
    if listed:
        assert "Framing (10)" in section


def test_window_keeps_the_newest_logs(tmp_path, capsys):
    _plant(tmp_path, "skill-a", ["fail"] * 4 + ["pass"] * 20)
    _report(tmp_path)
    assert "BELOW THE BAR (0)" in capsys.readouterr().out
    assert ehr.fail_threshold(24) == 4
    _report(tmp_path, "--window", "24")
    assert "BELOW THE BAR (1)" in capsys.readouterr().out


def test_released_log_without_a_filename_timestamp_and_a_duplicate(tmp_path):
    """A released `v2.json` carries no timestamp in its name, and the same run can
    sit beside its candidate: order by the envelope and count it once."""
    _plant(tmp_path, "skill-a", ["pass"] * 5)
    _plant(tmp_path, "skill-a", ["fail"], start=5, name="v2.json")
    _plant(tmp_path, "skill-a", ["fail"], start=5, name="v2_2026-10-01_05-00-00.json")
    logs = ehr.load_logs(tmp_path / "skill-a")
    assert len(logs) == 6
    assert logs[-1]["tests"][0]["runs"][0]["outcome"] == "fail"


def test_logs_order_by_envelope_timestamp_not_filename(tmp_path):
    """`v10.json` sorts before `v2_…` by name but is the newest run."""
    _plant(tmp_path, "skill-a", ["pass"] * 5, name=None)
    _plant(tmp_path, "skill-a", ["fail"], start=5, name="v10.json")
    logs = ehr.load_logs(tmp_path / "skill-a")
    assert [lg["tests"][0]["runs"][0]["outcome"] for lg in logs][-1] == "fail"


def test_every_suite_by_default_and_unknown_suite_exits_2(tmp_path, capsys):
    _plant(tmp_path, "skill-a", ["pass"] * 5)
    _plant(tmp_path, "skill-b", ["pass"] * 5)
    _report(tmp_path)
    out = capsys.readouterr().out
    assert "skill-a" in out and "skill-b" in out
    assert _report(tmp_path, "--skill", "nope") == 2


def test_a_gh_failure_still_prints_the_report(tmp_path, capsys, monkeypatch):
    _plant(tmp_path, "skill-a", ["fail"] * 3 + ["pass"] * 17)

    def boom(*a, **k):
        raise subprocess.CalledProcessError(1, "gh")

    monkeypatch.setattr(ehr.subprocess, "run", boom)
    assert ehr.main(["--runlogs-dir", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "Open issues: unavailable" in out
    assert "ut_x_001" in out


def test_a_retired_suite_is_skipped(tmp_path, capsys):
    """A suite with run logs but no `eval/tests/unit/<skill>/` dir was retired."""
    runlogs = tmp_path / "eval" / "runlogs" / "unit"
    (tmp_path / "eval" / "tests" / "unit" / "skill-live").mkdir(parents=True)
    _plant(runlogs, "skill-live", ["pass"] * 5)
    _plant(runlogs, "skill-gone", ["fail"] * 5)
    _report(runlogs)
    out = capsys.readouterr().out
    assert "BELOW THE BAR (0)" in out
    assert "Retired suites skipped (run logs, no tests): skill-gone." in out
