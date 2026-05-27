"""Tests for harness.versioning — filename classification + next-version logic."""

from pathlib import Path

import pytest

from harness.versioning import (
    Classification,
    ann_filename_for,
    classify,
    classify_ann,
    is_releasable_invocation,
    next_filename_for,
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


# ---- scan_versions -------------------------------------------------------


def test_scan_versions_empty_directory(tmp_path: Path):
    assert scan_versions(tmp_path) == (0, 0)


def test_scan_versions_missing_directory(tmp_path: Path):
    assert scan_versions(tmp_path / "nope") == (0, 0)


def test_scan_versions_finds_released_and_candidate(tmp_path: Path):
    (tmp_path / "v1.json").write_text("{}")
    (tmp_path / "v2.json").write_text("{}")
    (tmp_path / "v3_2026-05-18_10-30-00.json").write_text("{}")
    (tmp_path / "scratch_2026-05-18_09-00-00.json").write_text("{}")  # Ignored
    assert scan_versions(tmp_path) == (2, 3)


def test_scan_versions_higher_candidate_wins(tmp_path: Path):
    (tmp_path / "v3.json").write_text("{}")
    (tmp_path / "v5_2026-05-18_10-30-00.json").write_text("{}")
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
    (tmp_path / "v1.json").write_text("{}")
    (tmp_path / "v2_2026-05-17_12-00-00.json").write_text("{}")
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
    (tmp_path / "v3.json").write_text("{}")
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
