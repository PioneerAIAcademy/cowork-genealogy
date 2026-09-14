"""Tests for subagent transcript capture into the e2e runlog.

The record-extractor freeze: a subagent calls `project_context` once, then emits
a single thinking-only turn that hits `stop_reason=max_tokens` with no tool call.
These tests pin the summarizer that surfaces that shape in the committed runlog,
plus the cache-discovery walk.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from e2e.subagent_capture import (
    collect_subagents,
    sdk_cache_dir,
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


def _key(workspace: Path) -> str:
    from claude_agent_sdk import project_key_for_directory

    return project_key_for_directory(workspace)


def _seed_cache(home: Path, workspace: Path) -> Path:
    """Build the cache dir the SDK would actually write for `workspace`.

    The key is the sanitized **full realpath**, not the leaf — hardcoding
    `-tmp-<leaf>` produces a directory nothing will ever look for.
    """
    from claude_agent_sdk import project_key_for_directory

    slug_dir = home / ".claude" / "projects" / project_key_for_directory(workspace)
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
    return slug_dir


# The bug this file exists to pin (#2468): tempfile's suffix alphabet contains
# `_`, Claude Code's slug turns `_` into `-`, and the old `endswith(leaf)` match
# therefore missed ~20% of runs. Every leaf below carries an underscore; the
# original case did not, which is why it never caught this.
@pytest.mark.parametrize(
    "leaf",
    [
        "e2e-frederick-8fu_3bbk",  # underscore in the random suffix
        "e2e_frederick-8fu_3bbk",  # and in the fixture id too
        "e2e-frederick-8f_3b_bk",  # two underscores
    ],
)
def test_collect_subagents_matches_when_the_leaf_has_an_underscore(
    tmp_path: Path, monkeypatch, leaf: str
):
    home = tmp_path / "home"
    workspace = tmp_path / leaf
    _seed_cache(home, workspace)
    monkeypatch.setattr(Path, "home", lambda: home)

    summaries, status = collect_subagents(workspace)
    assert len(summaries) == 1, f"capture missed the cache dir for leaf {leaf!r}"
    assert status == "captured"


def test_sdk_key_really_rewrites_the_underscore(tmp_path: Path):
    """Pin the transform itself.

    The fixtures above build their cache dir with the same function under test,
    so they would stay green if the SDK stopped rewriting `_`. This asserts the
    rewrite directly, so that change fails loudly here instead.
    """
    from claude_agent_sdk import project_key_for_directory

    ws = tmp_path / "e2e-frederick-8fu_3bbk"
    assert "8fu_3bbk" in ws.name
    assert "8fu-3bbk" in project_key_for_directory(ws)


def test_collect_subagents_ignores_a_near_miss_directory(tmp_path: Path, monkeypatch):
    """A different run's cache must not be picked up.

    Trivial under an exact lookup — this is the regression guard if anyone
    reintroduces a scan.
    """
    home = tmp_path / "home"
    _seed_cache(home, tmp_path / "e2e-frederick-8fu_3bbk")
    monkeypatch.setattr(Path, "home", lambda: home)

    assert collect_subagents(tmp_path / "e2e-frederick-8fuX3bbk") == ([], "no_cache_dir")


def test_sdk_cache_dir_is_none_when_projects_missing(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "nonexistent")
    assert sdk_cache_dir(tmp_path / "e2e-x") is None


def test_collect_subagents_walks_the_ephemeral_cache(tmp_path: Path, monkeypatch):
    # Fake the ~/.claude/projects cache with the real nested layout:
    #   projects/<sanitized-full-realpath>/<uuid>/subagents/agent-*.jsonl
    home = tmp_path / "home"
    workspace = tmp_path / "e2e-frederick-abc123"
    slug_dir = home / ".claude" / "projects" / _key(workspace)
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

    summaries, status = collect_subagents(workspace)
    assert status == "captured"
    assert len(summaries) == 1
    assert summaries[0]["agent_type"] == "record-extractor"
    assert summaries[0]["runaway_thinking"] is True
    assert summaries[0]["transcript"] == "agent-1.jsonl"


def test_collect_subagents_empty_when_no_cache(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "nonexistent")
    assert collect_subagents(tmp_path / "e2e-x") == ([], "no_cache_dir")


def test_status_distinguishes_a_resolved_dir_with_no_usable_transcript(
    tmp_path: Path, monkeypatch
):
    """The value that `[]` used to hide.

    The directory resolves and holds an `agent-*.jsonl`, but it is unparseable —
    the run-killed-mid-generation shape. Before #2468 this was indistinguishable
    from "no subagents ran".
    """
    home = tmp_path / "home"
    workspace = tmp_path / "e2e-frederick-8fu_3bbk"
    subagents = (
        home / ".claude" / "projects" / _key(workspace) / "session-uuid" / "subagents"
    )
    subagents.mkdir(parents=True)
    (subagents / "agent-1.jsonl").write_text("not json at all\n", encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: home)

    assert collect_subagents(workspace) == ([], "matched_no_transcripts")
