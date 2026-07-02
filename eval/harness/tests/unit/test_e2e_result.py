"""Unit tests for e2e.result — result schema and artifact writing."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from e2e.result import (
    E2eResult,
    is_committable_run,
    runlog_prefix,
    timestamp_slug,
    write_result_files,
)


def test_timestamp_slug_is_filesystem_safe():
    t = datetime(2026, 5, 26, 14, 30, 45, tzinfo=timezone.utc)
    slug = timestamp_slug(t)
    assert slug == "2026-05-26_14-30-45"
    # No characters that would need shell escaping
    assert all(c.isalnum() or c in "-_" for c in slug)


def test_write_result_files_creates_all_four_artifacts(tmp_path: Path):
    runlog_dir = tmp_path / "runlogs" / "smith-parents-1850"
    result = E2eResult(
        test_id="smith-parents-1850",
        captured_at="2026-05-26_14-30-45",
        verdict="pass",
        stop_reason="completed",
        judge_output={"verdict": "pass", "recall_required": 1.0},
        usage={"total_cost_usd": 3.40},
        tool_calls=[{"tool": "mcp__genealogy__tree_read", "args": {}, "response_summary": "..."}],
        tags={"question_type": "parents"},
    )
    paths = write_result_files(
        result=result,
        runlog_dir=runlog_dir,
        transcript="# transcript\n",
        final_tree={"persons": [{"id": "p1"}]},
        final_research={"project": {"status": "completed"}},
        timestamp="2026-05-26_14-30-45",
    )

    assert paths["result"].exists()
    assert paths["transcript"].exists()
    assert paths["tree"].exists()
    assert paths["research"].exists()

    # Result is valid JSON with expected fields
    payload = json.loads(paths["result"].read_text(encoding="utf-8"))
    assert payload["test_id"] == "smith-parents-1850"
    assert payload["verdict"] == "pass"
    assert payload["stop_reason"] == "completed"
    assert payload["tags"]["question_type"] == "parents"
    assert payload["tool_calls"][0]["tool"] == "mcp__genealogy__tree_read"


def test_write_result_files_handles_missing_tree_and_research(tmp_path: Path):
    """If the agent crashed before producing tree/research, we still get
    the result+transcript files."""
    runlog_dir = tmp_path / "runlogs" / "crashed-test"
    result = E2eResult(
        test_id="crashed-test",
        captured_at="2026-05-26_14-30-45",
        verdict="skipped",
        stop_reason="error",
        error="boom",
    )
    paths = write_result_files(
        result=result,
        runlog_dir=runlog_dir,
        transcript="",
        final_tree=None,
        final_research=None,
        timestamp="2026-05-26_14-30-45",
    )
    assert paths["result"].exists()
    assert paths["transcript"].exists()
    assert not paths["tree"].exists()
    assert not paths["research"].exists()


def test_is_committable_run_graded_verdicts():
    for v in ("pass", "partial", "fail"):
        assert is_committable_run(v) is True
    for v in ("skipped", "aborted", ""):
        assert is_committable_run(v) is False


def test_runlog_prefix_graded_vs_scratch():
    assert runlog_prefix("pass") == "run-"
    assert runlog_prefix("partial") == "run-"
    assert runlog_prefix("fail") == "run-"
    assert runlog_prefix("skipped") == "scratch_"


def test_passing_run_uses_committable_run_prefix(tmp_path: Path):
    result = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict="pass", stop_reason="completed",
    )
    paths = write_result_files(
        result=result, runlog_dir=tmp_path, transcript="",
        final_tree=None, final_research=None, timestamp="2026-05-26_14-30-45",
    )
    assert paths["result"].name == "run-2026-05-26_14-30-45.json"
    assert paths["result"].exists()


def test_gradeable_non_pass_run_uses_committable_run_prefix(tmp_path: Path):
    """partial and fail produced a tree, so they commit as run-<ts>.* (retained
    signal, and gradeable) — not scratch."""
    for verdict in ("partial", "fail"):
        result = E2eResult(
            test_id="t", captured_at="2026-05-26_14-30-45",
            verdict=verdict, stop_reason="natural_end",
        )
        paths = write_result_files(
            result=result, runlog_dir=tmp_path, transcript="",
            final_tree=None, final_research=None, timestamp="2026-05-26_14-30-45",
        )
        assert paths["result"].name == "run-2026-05-26_14-30-45.json", verdict


def test_skipped_run_uses_gitignored_scratch_prefix(tmp_path: Path):
    """A skipped run (judge never ran, no tree to grade) is named scratch_* so
    .gitignore keeps it out of version control."""
    result = E2eResult(
        test_id="t", captured_at="2026-05-26_14-30-45",
        verdict="skipped", stop_reason="error",
    )
    paths = write_result_files(
        result=result, runlog_dir=tmp_path, transcript="",
        final_tree=None, final_research=None, timestamp="2026-05-26_14-30-45",
    )
    assert paths["result"].name == "scratch_2026-05-26_14-30-45.json"
    assert paths["transcript"].name == "scratch_2026-05-26_14-30-45.transcript.md"


def test_write_result_files_creates_runlog_dir(tmp_path: Path):
    """The runlog_dir is created if it doesn't exist (parents=True)."""
    runlog_dir = tmp_path / "deeply" / "nested" / "runlogs" / "id"
    assert not runlog_dir.exists()
    result = E2eResult(
        test_id="id",
        captured_at="2026-05-26_14-30-45",
        verdict="pass",
        stop_reason="completed",
    )
    write_result_files(
        result=result,
        runlog_dir=runlog_dir,
        transcript="",
        final_tree=None,
        final_research=None,
    )
    assert runlog_dir.is_dir()
