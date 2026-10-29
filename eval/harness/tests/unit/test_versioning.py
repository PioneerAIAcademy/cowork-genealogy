"""Tests for harness.versioning — filename classification + next-version logic."""

import subprocess
from pathlib import Path

import pytest

from harness.versioning import (
    Classification,
    ann_filename_for,
    classify,
    classify_ann,
    is_releasable_invocation,
    landed_order,
    latest_full_skill_runlog,
    newest_full_skill_runlog,
    next_filename_for,
    prunable_candidates,
    scan_versions,
)


# ---- classify ------------------------------------------------------------


def test_classify_released():
    assert classify("v3.json") == Classification("released", 3, None)
    assert classify("v12.json") == Classification("released", 12, None)


def test_classify_candidate():
    assert classify("v3_2026-05-18_10-30-00.json") == Classification(
        "candidate", 3, "2026-05-18_10-30-00"
    )


def test_classify_scratch():
    assert classify("scratch_2026-05-18_10-30-00.json") == Classification(
        "scratch", None, "2026-05-18_10-30-00"
    )


def test_classify_other():
    assert classify("foo.json").kind == "other"
    assert classify("v3.ann.json").kind == "other"  # ann uses classify_ann
    assert classify("v3_bad-timestamp.json").kind == "other"


def test_classify_ann():
    assert classify_ann("v3.ann.json").kind == "released"
    assert classify_ann("v3_2026-05-18_10-30-00.ann.json").kind == "candidate"
    assert classify_ann("scratch_2026-05-18_10-30-00.ann.json").kind == "scratch"


# ---- ann_filename_for ----------------------------------------------------


def test_ann_filename_for():
    assert ann_filename_for("v3.json") == "v3.ann.json"
    assert ann_filename_for("v3_2026-05-18_10-30-00.json") == "v3_2026-05-18_10-30-00.ann.json"
    assert ann_filename_for("scratch_2026-05-18_10-30-00.json") == "scratch_2026-05-18_10-30-00.ann.json"


def test_ann_filename_for_rejects_non_json():
    with pytest.raises(ValueError):
        ann_filename_for("v3.txt")


# ---- is_releasable_invocation -------------------------------------------


def test_is_releasable_skill_no_tag():
    assert is_releasable_invocation(mode="skill", has_tag_filter=False) is True


def test_is_releasable_skill_with_tag():
    """Tag-filtered runs aren't full skill runs."""
    assert is_releasable_invocation(mode="skill", has_tag_filter=True) is False


def test_is_releasable_test_mode():
    assert is_releasable_invocation(mode="test", has_tag_filter=False) is False


def test_is_releasable_rejects_unknown_mode():
    """Unknown modes raise rather than silently returning False — a new
    CLI mode has to be wired in explicitly."""
    with pytest.raises(ValueError, match="unknown invocation mode"):
        is_releasable_invocation(mode="all", has_tag_filter=False)


def test_is_releasable_tag_mode():
    assert is_releasable_invocation(mode="tag", has_tag_filter=True) is False


def test_is_releasable_multi_run_is_scratch():
    """A --runs-per-test N (N>1) run is a scratch run, never releasable
    (issue #2816), even on the otherwise-releasable --skill path."""
    assert (
        is_releasable_invocation(mode="skill", has_tag_filter=False, runs_per_test=3)
        is False
    )


@pytest.mark.parametrize(
    "mode, has_tag_filter",
    [("skill", False), ("skill", True), ("test", False), ("tag", True)],
)
def test_is_releasable_tool_search_off_is_scratch(mode, has_tag_filter):
    """`--no-tool-search` is an experiment, so it is never a candidate — even on
    the otherwise-releasable --skill path."""
    assert (
        is_releasable_invocation(
            mode=mode, has_tag_filter=has_tag_filter, tool_search=False
        )
        is False
    )


def test_is_releasable_single_run_default_unchanged():
    """runs_per_test=1 (the default) leaves --skill releasable — the flag
    omitted behaves exactly as before."""
    assert (
        is_releasable_invocation(mode="skill", has_tag_filter=False, runs_per_test=1)
        is True
    )


# ---- scan_versions -------------------------------------------------------


def test_scan_versions_empty_directory(tmp_path: Path):
    assert scan_versions(tmp_path) == (0, 0)


def test_scan_versions_missing_directory(tmp_path: Path):
    assert scan_versions(tmp_path / "nope") == (0, 0)


def test_scan_versions_finds_released_and_candidate(tmp_path: Path):
    (tmp_path / "v1.json").write_text("{}", encoding="utf-8")
    (tmp_path / "v2.json").write_text("{}", encoding="utf-8")
    (tmp_path / "v3_2026-05-18_10-30-00.json").write_text("{}", encoding="utf-8")
    (tmp_path / "scratch_2026-05-18_09-00-00.json").write_text("{}", encoding="utf-8")  # Ignored
    assert scan_versions(tmp_path) == (2, 3)


def test_scan_versions_higher_candidate_wins(tmp_path: Path):
    (tmp_path / "v3.json").write_text("{}", encoding="utf-8")
    (tmp_path / "v5_2026-05-18_10-30-00.json").write_text("{}", encoding="utf-8")
    assert scan_versions(tmp_path) == (3, 5)


# ---- next_filename_for ---------------------------------------------------


def test_next_filename_first_run_starts_at_v1(tmp_path: Path):
    filename, version = next_filename_for(
        skill_runlog_dir=tmp_path,
        releasable=True,
        timestamp="2026-05-18_10-30-00",
    )
    assert filename == "v1_2026-05-18_10-30-00.json"
    assert version == 1


def test_next_filename_continues_candidate_line(tmp_path: Path):
    """When candidate v2 exists and released is v1, next iteration stays at v2."""
    (tmp_path / "v1.json").write_text("{}", encoding="utf-8")
    (tmp_path / "v2_2026-05-17_12-00-00.json").write_text("{}", encoding="utf-8")
    filename, version = next_filename_for(
        skill_runlog_dir=tmp_path,
        releasable=True,
        timestamp="2026-05-18_10-30-00",
    )
    assert filename == "v2_2026-05-18_10-30-00.json"
    assert version == 2


def test_next_filename_bumps_after_release(tmp_path: Path):
    """When highest released == highest candidate (no candidate above release),
    next bumps to a new version line."""
    (tmp_path / "v3.json").write_text("{}", encoding="utf-8")
    filename, version = next_filename_for(
        skill_runlog_dir=tmp_path,
        releasable=True,
        timestamp="2026-05-18_10-30-00",
    )
    assert filename == "v4_2026-05-18_10-30-00.json"
    assert version == 4


def test_next_filename_scratch(tmp_path: Path):
    """Non-releasable invocations get a scratch_ prefix, no version."""
    filename, version = next_filename_for(
        skill_runlog_dir=tmp_path,
        releasable=False,
        timestamp="2026-05-18_10-30-00",
    )
    assert filename == "scratch_2026-05-18_10-30-00.json"
    assert version is None


# ---- prunable_candidates (retention, GitHub issue #985) -------------------


def test_prunable_keeps_the_newest_k_candidates():
    names = [
        "v1_2026-07-01_00-00-00.json",
        "v1_2026-07-02_00-00-00.json",
        "v1_2026-07-03_00-00-00.json",
        "v1_2026-07-04_00-00-00.json",
    ]
    assert prunable_candidates(names, keep=2) == [
        "v1_2026-07-01_00-00-00.json",
        "v1_2026-07-02_00-00-00.json",
    ]


def test_prunable_orders_by_version_then_timestamp():
    """A v2 candidate is newer than any v1, regardless of timestamp."""
    names = [
        "v2_2026-07-01_00-00-00.json",
        "v1_2026-07-09_00-00-00.json",
    ]
    assert prunable_candidates(names, keep=1) == ["v1_2026-07-09_00-00-00.json"]


def test_prunable_never_returns_released():
    """Released v{N}.json are the blessed canonical versions — kept forever."""
    names = ["v1.json", "v2.json", "v3_2026-07-01_00-00-00.json"]
    assert prunable_candidates(names, keep=1) == []


def test_prunable_ignores_scratch_and_unknown():
    names = [
        "scratch_2026-07-01_00-00-00.json",
        ".partial_2026-07-01_00-00-00.json",
        "notes.txt",
        "v1_2026-07-01_00-00-00.json",
    ]
    assert prunable_candidates(names, keep=1) == []


def test_prunable_ignores_annotation_siblings():
    """`.ann.json` files are deleted alongside their run log, not counted as
    candidates in their own right — otherwise every log counts twice."""
    names = [
        "v1_2026-07-01_00-00-00.json",
        "v1_2026-07-01_00-00-00.ann.json",
        "v1_2026-07-02_00-00-00.json",
        "v1_2026-07-02_00-00-00.ann.json",
    ]
    assert prunable_candidates(names, keep=2) == []


def test_prunable_below_k_returns_nothing():
    assert prunable_candidates(["v1_2026-07-01_00-00-00.json"], keep=5) == []


def test_prunable_rejects_keep_zero():
    """keep=0 would delete a skill's only run log and break check_runlogs
    rule 2 on the next edit to that skill."""
    with pytest.raises(ValueError):
        prunable_candidates(["v1_2026-07-01_00-00-00.json"], keep=0)


# ---- newest_full_skill_runlog -----------------------------------------------


def _newest(logs: dict[str, dict]) -> str | None:
    got = newest_full_skill_runlog(logs, logs.__getitem__)
    return got[0] if got else None


def test_newest_prefers_a_candidate_run_after_the_newest_release():
    logs = {
        "v1.json": {"timestamp": "2026-10-01_00-00-00"},
        "v2_2026-10-02_00-00-00.json": {},
        "v2_2026-10-03_00-00-00.json": {},
    }
    assert _newest(logs) == "v2_2026-10-03_00-00-00.json"


def test_newest_prefers_a_release_run_after_its_leftover_candidate():
    """A candidate left beside the release of its own version line ran earlier."""
    logs = {
        "v3.json": {"timestamp": "2026-10-10_00-00-00"},
        "v3_2026-10-05_00-00-00.json": {},
    }
    assert _newest(logs) == "v3.json"


def test_newest_reads_only_the_highest_release():
    logs = {
        "v1.json": {"timestamp": "2026-10-20_00-00-00"},
        "v2.json": {"timestamp": "2026-10-10_00-00-00"},
        "v2_2026-10-15_00-00-00.json": {},
    }
    assert _newest(logs) == "v2_2026-10-15_00-00-00.json"


def test_newest_release_wins_a_tie_and_without_a_timestamp():
    assert _newest({"v2.json": {"timestamp": "2026-10-15_00-00-00"},
                    "v2_2026-10-15_00-00-00.json": {}}) == "v2.json"
    assert _newest({"v2.json": {}, "v2_2026-10-15_00-00-00.json": {}}) == "v2.json"
    assert _newest({"v2.json": {}}) == "v2.json"


def test_newest_orders_version_lines_by_version_without_reading_timestamps():
    """A candidate line above the release started after it; one below, before."""
    assert _newest({"v2.json": {"timestamp": "2026-12-01_00-00-00"},
                    "v3_2026-10-15_00-00-00.json": {}}) == "v3_2026-10-15_00-00-00.json"
    assert _newest({"v2.json": {"timestamp": "2026-01-01_00-00-00"},
                    "v1_2026-10-15_00-00-00.json": {}}) == "v2.json"


def test_newest_ignores_scratch_annotations_and_other_files():
    logs = {
        "v1.json": {"timestamp": "2026-10-01_00-00-00"},
        "v1.ann.json": {},
        "scratch_2026-10-30_00-00-00.json": {},
        "README.md": {},
    }
    assert _newest(logs) == "v1.json"
    assert _newest({"README.md": {}}) is None


# ---- landing order ------------------------------------------------------------
#
# Two PRs that run one suite can merge in the opposite order to the one they ran in
# (timeline, 2026-10-29: #4017's re-run `v1_..._16-30-05` merged after #3812's
# `v1_..._19-24-55`). The log that merged last is the one CI checked against the
# tree that followed, so it is the latest.

RAN_FIRST = "v1_2026-10-23_16-30-05.json"
RAN_LAST = "v1_2026-10-23_19-24-55.json"


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=repo, check=True, capture_output=True, text=True, encoding="utf-8",
    )


def _commit_log(repo: Path, name: str) -> None:
    (repo / "logs" / name).write_text("{}", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", name)


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "logs").mkdir()
    _git(tmp_path, "init", "-q", "-b", "main")
    _commit_log(tmp_path, ".gitkeep")
    return tmp_path


def test_the_log_that_landed_last_wins_over_the_one_that_ran_last(repo):
    _commit_log(repo, RAN_LAST)
    _commit_log(repo, RAN_FIRST)
    logs = repo / "logs"
    assert latest_full_skill_runlog(logs)[0] == RAN_LAST
    assert latest_full_skill_runlog(logs, "main")[0] == RAN_FIRST


def test_a_merged_branch_lands_at_its_merge_commit(repo):
    """First-parent: the branch's own commit predates main's, but its log reached
    main when the branch merged."""
    _git(repo, "checkout", "-q", "-b", "pr")
    _commit_log(repo, RAN_FIRST)
    _git(repo, "checkout", "-q", "main")
    _commit_log(repo, RAN_LAST)
    _git(repo, "merge", "-q", "--no-ff", "-m", "merge pr", "pr")
    assert latest_full_skill_runlog(repo / "logs", "main")[0] == RAN_FIRST


def test_a_log_the_ref_never_added_is_newer_than_every_landed_one(repo):
    """A log a PR adds is not on the base yet; it lands last when the PR merges."""
    _commit_log(repo, RAN_LAST)
    (repo / "logs" / RAN_FIRST).write_text("{}", encoding="utf-8")
    assert latest_full_skill_runlog(repo / "logs", "main")[0] == RAN_FIRST


def test_a_log_promoted_by_rename_lands_at_the_rename(repo):
    _commit_log(repo, "v2_2026-10-01_00-00-00.json")
    _commit_log(repo, "v2_2026-10-05_00-00-00.json")
    _git(repo, "mv", "logs/v2_2026-10-01_00-00-00.json", "logs/v2.json")
    _git(repo, "commit", "-m", "release")
    assert landed_order(repo / "logs", "main")["v2.json"] == 4
    assert latest_full_skill_runlog(repo / "logs", "main")[0] == "v2.json"


def test_no_git_answer_falls_back_to_run_time(tmp_path):
    for name in (RAN_FIRST, RAN_LAST):
        (tmp_path / name).write_text("{}", encoding="utf-8")
    assert landed_order(tmp_path, "main") is None
    assert latest_full_skill_runlog(tmp_path, "main")[0] == RAN_LAST


def test_an_unknown_ref_falls_back_to_run_time(repo):
    _commit_log(repo, RAN_LAST)
    _commit_log(repo, RAN_FIRST)
    assert landed_order(repo / "logs", "no-such-ref") is None
    assert latest_full_skill_runlog(repo / "logs", "no-such-ref")[0] == RAN_LAST
