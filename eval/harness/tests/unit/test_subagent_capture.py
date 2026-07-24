"""Tests for subagent transcript capture into the e2e runlog.

The record-extractor freeze: a subagent calls `project_context` once, then emits
a single thinking-only turn that hits `stop_reason=max_tokens` with no tool call.
These tests pin the summarizer that surfaces that shape in the committed runlog,
plus the cache-discovery walk.
"""

from __future__ import annotations

import json
from pathlib import Path

from e2e.subagent_capture import (
    collect_subagents,
    is_runaway_turn,
    parse_jsonl,
    summarize_transcript,
    summarize_turn,
)


def _assistant(stop_reason, output_tokens, blocks):
    """Build one raw SDK assistant record with the given content blocks."""
    return {
        "type": "assistant",
        "message": {
            "role": "assistant",
            "stop_reason": stop_reason,
            "usage": {"output_tokens": output_tokens},
            "content": blocks,
        },
    }


def _thinking():
    return {"type": "thinking", "thinking": "", "signature": "x" * 100}


def _tool_use(name):
    return {"type": "tool_use", "name": name, "input": {}}


# The two real turns from the frozen record-extractor run (shapes only).
_PROJECT_CONTEXT_TURN = _assistant("tool_use", 112, [_tool_use("mcp__genealogy__project_context")])
_RUNAWAY_TURN = _assistant("max_tokens", 32000, [_thinking()])


def test_is_runaway_turn_true_for_thinking_only_max_tokens():
    turn = summarize_turn(_RUNAWAY_TURN["message"])
    assert is_runaway_turn(turn) is True
    assert turn["blocks"] == ["thinking"]
    assert turn.get("runaway") is True


def test_is_runaway_turn_false_when_tool_call_present():
    # A turn that hits max_tokens but still emitted a tool call is not a freeze.
    turn = summarize_turn(_assistant("max_tokens", 32000, [_thinking(), _tool_use("mcp__genealogy__tree_edit")])["message"])
    assert is_runaway_turn(turn) is False


def test_is_runaway_turn_false_for_normal_thinking_turn():
    # Thinking that ends cleanly (end_turn / tool_use) is normal, not runaway.
    turn = summarize_turn(_assistant("end_turn", 200, [_thinking(), {"type": "text", "text": "done"}])["message"])
    assert is_runaway_turn(turn) is False


def test_bare_tool_name_in_block_label():
    turn = summarize_turn(_PROJECT_CONTEXT_TURN["message"])
    assert turn["blocks"] == ["tool_use:project_context"]


def test_summarize_transcript_flags_runaway():
    records = [
        {"type": "user", "message": {"role": "user", "content": []}},
        _PROJECT_CONTEXT_TURN,
        {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result"}]}},
        _RUNAWAY_TURN,
    ]
    summary = summarize_transcript(records, meta={"agentType": "record-extractor", "description": "Extract"})
    assert summary["agent_type"] == "record-extractor"
    assert summary["runaway_thinking"] is True
    assert summary["hit_output_cap"] is True
    assert summary["max_output_tokens"] == 32000
    assert summary["num_assistant_turns"] == 2  # user turns excluded


def test_summarize_transcript_healthy_run_not_flagged():
    records = [
        _PROJECT_CONTEXT_TURN,
        _assistant("tool_use", 150, [_thinking(), _tool_use("mcp__genealogy__record_read")]),
        _assistant("tool_use", 400, [_tool_use("mcp__genealogy__research_append")]),
        _assistant("end_turn", 80, [{"type": "text", "text": "Extracted 5 assertions."}]),
    ]
    summary = summarize_transcript(records)
    assert summary["runaway_thinking"] is False
    assert summary["hit_output_cap"] is False
    assert summary["num_assistant_turns"] == 4


def test_parse_jsonl_skips_blank_and_truncated_lines(tmp_path: Path):
    # A run killed mid-generation can leave a truncated final line.
    p = tmp_path / "agent-x.jsonl"
    good = json.dumps(_PROJECT_CONTEXT_TURN)
    p.write_text(good + "\n\n" + '{"type": "assistant", "message": {"rol', encoding="utf-8")
    records = parse_jsonl(p)
    assert len(records) == 1
    assert records[0]["message"]["stop_reason"] == "tool_use"


def test_collect_subagents_walks_the_ephemeral_cache(tmp_path: Path, monkeypatch):
    # Fake the ~/.claude/projects cache with the real nested layout:
    #   projects/<slug-ending-in-workspace-leaf>/<uuid>/subagents/agent-*.jsonl
    home = tmp_path / "home"
    workspace = tmp_path / "e2e-frederick-abc123"  # the leaf that appears in the slug
    slug_dir = home / ".claude" / "projects" / f"-tmp-{workspace.name}"
    subagents = slug_dir / "session-uuid" / "subagents"
    subagents.mkdir(parents=True)
    (subagents / "agent-1.jsonl").write_text(
        "\n".join(json.dumps(r) for r in [_PROJECT_CONTEXT_TURN, _RUNAWAY_TURN]),
        encoding="utf-8",
    )
    (subagents / "agent-1.meta.json").write_text(
        json.dumps({"agentType": "record-extractor", "description": "Extract"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(Path, "home", lambda: home)

    summaries = collect_subagents(workspace)
    assert len(summaries) == 1
    assert summaries[0]["agent_type"] == "record-extractor"
    assert summaries[0]["runaway_thinking"] is True
    assert summaries[0]["transcript"] == "agent-1.jsonl"


def test_collect_subagents_empty_when_no_cache(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "nonexistent")
    assert collect_subagents(tmp_path / "e2e-x") == []
