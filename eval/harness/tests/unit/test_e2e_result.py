"""Unit tests for e2e.result — result schema and artifact writing."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from e2e.result import E2eResult, timestamp_slug, write_result_files


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
    payload = json.loads(paths["result"].read_text())
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
