"""Unit tests for e2e.stop_checker — JSON reads + stop_reason derivation."""

from __future__ import annotations

import json
from pathlib import Path

from e2e.stop_checker import (
    derive_stop_reason,
    project_completed,
    read_research_json,
    read_tree_json,
    should_continue_run,
)


def test_read_research_json_returns_none_when_missing(tmp_path: Path):
    assert read_research_json(tmp_path) is None


def test_read_research_json_returns_none_on_invalid_json(tmp_path: Path):
    (tmp_path / "research.json").write_text("{not valid")
    assert read_research_json(tmp_path) is None


def test_read_research_json_parses_valid(tmp_path: Path):
    (tmp_path / "research.json").write_text(json.dumps({"project": {"status": "in_progress"}}))
    parsed = read_research_json(tmp_path)
    assert parsed == {"project": {"status": "in_progress"}}


def test_read_tree_json_returns_none_when_missing(tmp_path: Path):
    assert read_tree_json(tmp_path) is None


def test_read_tree_json_parses_valid(tmp_path: Path):
    (tmp_path / "tree.gedcomx.json").write_text(json.dumps({"persons": []}))
    parsed = read_tree_json(tmp_path)
    assert parsed == {"persons": []}


def test_project_completed_true_when_status_completed():
    assert project_completed({"project": {"status": "completed"}}) is True


def test_project_completed_false_when_in_progress():
    assert project_completed({"project": {"status": "in_progress"}}) is False


def test_project_completed_false_on_none():
    assert project_completed(None) is False


def test_project_completed_false_on_missing_project_field():
    assert project_completed({}) is False


def test_derive_stop_reason_timeout_beats_completed():
    """A wall-clock cap that fires AFTER the agent set status=completed
    still reports as `timeout` — caps win over status."""
    assert (
        derive_stop_reason(
            sdk_aborted_reason="max_wall_clock_seconds",
            research={"project": {"status": "completed"}},
        )
        == "timeout"
    )


def test_derive_stop_reason_tool_cap():
    assert (
        derive_stop_reason(sdk_aborted_reason="max_tool_calls", research=None)
        == "tool_cap"
    )


def test_derive_stop_reason_max_turns():
    assert (
        derive_stop_reason(sdk_aborted_reason="max_turns", research=None)
        == "max_turns"
    )


def test_derive_stop_reason_cost_cap():
    assert (
        derive_stop_reason(sdk_aborted_reason="cost_cap", research=None)
        == "cost_cap"
    )


def test_derive_stop_reason_cost_cap_beats_completed():
    """A cost cap that fires after the agent set status=completed still
    reports as `cost_cap` — caps win over status (same rule as timeout)."""
    assert (
        derive_stop_reason(
            sdk_aborted_reason="cost_cap",
            research={"project": {"status": "completed"}},
        )
        == "cost_cap"
    )


def test_derive_stop_reason_inactivity():
    assert (
        derive_stop_reason(sdk_aborted_reason="sdk_stream_silence", research=None)
        == "inactivity"
    )


def test_derive_stop_reason_error():
    assert (
        derive_stop_reason(sdk_aborted_reason="error", research=None)
        == "error"
    )


def test_derive_stop_reason_completed_when_no_abort_and_status_set():
    assert (
        derive_stop_reason(
            sdk_aborted_reason=None,
            research={"project": {"status": "completed"}},
        )
        == "completed"
    )


def test_derive_stop_reason_natural_end_when_no_abort_and_incomplete():
    assert (
        derive_stop_reason(
            sdk_aborted_reason=None,
            research={"project": {"status": "in_progress"}},
        )
        == "natural_end"
    )


# --- should_continue_run (continue-nudge decision) -------------------

_INCOMPLETE = {"project": {"status": "in_progress"}}
_DONE = {"project": {"status": "completed"}}


def test_should_continue_blocks_when_unfinished_and_progressing():
    """Unfinished project, budget left, and tool calls made since the last
    nudge → veto the stop and nudge onward."""
    assert should_continue_run(
        research=_INCOMPLETE, nudges_used=1, max_nudges=5,
        tool_count=12, tool_count_at_last_nudge=8,
    ) is True


def test_should_continue_allows_when_completed():
    assert should_continue_run(
        research=_DONE, nudges_used=0, max_nudges=5,
        tool_count=20, tool_count_at_last_nudge=-1,
    ) is False


def test_should_continue_allows_when_nudge_budget_spent():
    assert should_continue_run(
        research=_INCOMPLETE, nudges_used=5, max_nudges=5,
        tool_count=30, tool_count_at_last_nudge=10,
    ) is False


def test_should_continue_allows_when_no_progress_since_last_nudge():
    """A prior nudge produced no tool call → another won't help; let the run
    end and fail rather than nudge a stuck agent forever."""
    assert should_continue_run(
        research=_INCOMPLETE, nudges_used=2, max_nudges=5,
        tool_count=15, tool_count_at_last_nudge=15,
    ) is False


def test_should_continue_blocks_first_nudge_even_with_equal_counts():
    """The no-progress guard only applies after the first nudge — the very
    first voluntary yield is always eligible."""
    assert should_continue_run(
        research=_INCOMPLETE, nudges_used=0, max_nudges=5,
        tool_count=5, tool_count_at_last_nudge=-1,
    ) is True
