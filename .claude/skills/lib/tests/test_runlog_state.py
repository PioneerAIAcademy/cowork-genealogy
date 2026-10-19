"""Tests for /audit-board's runlog_state.py.

The bug these exist for: the paid-run tax table read each suite through
`check_runlogs.latest_full_skill_runlog`, which prefers any released v{N}.json over
every candidate. A suite whose released log was stale but whose newer candidate was
active read as stale and idle since the release date — on 2026-10-18 that was 7 of
32 suites (init-project read 9 idle days instead of 3). They owe a promotion, not a
paid run.

Run: eval/harness/.venv/bin/pytest .claude/skills/lib/tests/test_runlog_state.py -q
"""

import json
import os
import sys
from datetime import date

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "..", "audit-board"))

import runlog_state  # noqa: E402

TODAY = date(2026, 10, 18)


def _repo(tmp_path):
    (tmp_path / "skill.md").write_text("current\n", encoding="utf-8")
    suite = tmp_path / "eval" / "runlogs" / "unit" / "demo"
    suite.mkdir(parents=True)
    return tmp_path, suite


def _log(suite, name, timestamp, active, repo):
    # An empty snapshot is always active; a snapshot holding a hash that no longer
    # matches skill.md is stale. Build the active hash with the harness's own
    # snapshot code so the test cannot drift from what the script compares against.
    from harness.snapshot import hash_file

    digest = hash_file("skill.md", repo / "skill.md")
    snapshot = {"skill.md": digest if active else "0" * 64}
    with open(suite / name, "w", encoding="utf-8") as f:
        json.dump({"timestamp": timestamp, "snapshot": snapshot}, f)


def test_active_candidate_newer_than_stale_release_is_promote(tmp_path):
    repo, suite = _repo(tmp_path)
    _log(suite, "v17.json", "2026-10-09_20-13-20", False, repo)
    _log(suite, "v18_2026-10-15_05-35-20.json", "2026-10-15_05-35-20", True, repo)
    row = runlog_state.suite_state(suite, repo, TODAY)
    assert row["newest"] == "v18_2026-10-15_05-35-20.json"
    assert row["idle_days"] == 3
    assert row["state"] == "promote"
    assert row["promote"] == "v18_2026-10-15_05-35-20.json"


def test_nothing_active_is_stale(tmp_path):
    repo, suite = _repo(tmp_path)
    _log(suite, "v1.json", "2026-10-01_00-00-00", False, repo)
    _log(suite, "v2_2026-10-10_00-00-00.json", "2026-10-10_00-00-00", False, repo)
    row = runlog_state.suite_state(suite, repo, TODAY)
    assert row["state"] == "stale"
    assert row["newest"] == "v2_2026-10-10_00-00-00.json"
    assert row["idle_days"] == 8


def test_active_release_is_active(tmp_path):
    repo, suite = _repo(tmp_path)
    _log(suite, "v1_2026-10-01_00-00-00.json", "2026-10-01_00-00-00", False, repo)
    _log(suite, "v1.json", "2026-10-02_00-00-00", True, repo)
    row = runlog_state.suite_state(suite, repo, TODAY)
    assert row["state"] == "active"
    assert row["promote"] is None


def test_active_candidate_with_no_release_is_active(tmp_path):
    repo, suite = _repo(tmp_path)
    _log(suite, "v1_2026-10-12_00-00-00.json", "2026-10-12_00-00-00", True, repo)
    assert runlog_state.suite_state(suite, repo, TODAY)["state"] == "active"


def test_older_active_log_is_not_stale(tmp_path):
    repo, suite = _repo(tmp_path)
    _log(suite, "v3.json", "2026-10-05_00-00-00", True, repo)
    _log(suite, "v4_2026-10-14_00-00-00.json", "2026-10-14_00-00-00", False, repo)
    row = runlog_state.suite_state(suite, repo, TODAY)
    assert row["state"] == "active"
    assert row["newest"] == "v4_2026-10-14_00-00-00.json"


def test_scratch_and_annotations_are_ignored(tmp_path):
    repo, suite = _repo(tmp_path)
    _log(suite, "v1.json", "2026-10-01_00-00-00", False, repo)
    _log(suite, "scratch_2026-10-17_00-00-00.json", "2026-10-17_00-00-00", True, repo)
    (suite / "v1.ann.json").write_text("{}", encoding="utf-8")
    row = runlog_state.suite_state(suite, repo, TODAY)
    assert row["newest"] == "v1.json"
    assert row["state"] == "stale"


def test_no_releasable_log_returns_none(tmp_path):
    repo, suite = _repo(tmp_path)
    _log(suite, "scratch_2026-10-17_00-00-00.json", "2026-10-17_00-00-00", True, repo)
    assert runlog_state.suite_state(suite, repo, TODAY) is None
