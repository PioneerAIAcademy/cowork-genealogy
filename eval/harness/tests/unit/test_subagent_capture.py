"""Tests for subagent transcript capture into the e2e runlog.

The record-extractor freeze: a subagent calls `project_context` once, then emits
a single thinking-only turn that hits `stop_reason=max_tokens` with no tool call.
These tests pin the summarizer that surfaces that shape in the committed runlog,
plus the cache-discovery walk.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from pathlib import Path

import pytest

from e2e.subagent_capture import (
    collect_subagents,
    sdk_cache_dir,
    is_runaway_turn,
    pair_tool_calls,
    parse_jsonl,
    summarize_transcript,
    summarize_turn,
    transcript_agent_id,
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


@pytest.fixture
def shortspace():
    """A SHORT base dir for every test that seeds a fake SDK cache.

    The SDK key embeds the sanitized FULL path, so seeding under pytest's
    `tmp_path` writes that path twice — once as the parent and once inside the
    key — which reaches ~289 characters and trips Windows' 260-char MAX_PATH.
    The seed then dies with an opaque `FileNotFoundError` before any assertion
    runs, so the tests that prove this fix could not run on the one platform
    whose 8.3 short names motivated the lookup in the first place.
    """
    base = Path(tempfile.mkdtemp(prefix="sc"))
    yield base
    shutil.rmtree(base, ignore_errors=True)


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
    shortspace: Path, monkeypatch, leaf: str
):
    home = shortspace / "home"
    workspace = shortspace / leaf
    _seed_cache(home, workspace)
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

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


def test_collect_subagents_ignores_a_near_miss_directory(shortspace: Path, monkeypatch):
    """A different run's cache must not be picked up.

    Note this does NOT guard against a reintroduced scan — the underscore
    params above are what do that. This pins that a near-miss leaf is not
    treated as a hit.
    """
    home = shortspace / "home"
    _seed_cache(home, shortspace / "e2e-frederick-8fu_3bbk")
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    assert collect_subagents(shortspace / "e2e-frederick-8fuX3bbk") == ([], "no_cache_dir")


def test_sdk_cache_dir_is_none_when_projects_missing(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "nonexistent")
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    assert sdk_cache_dir(tmp_path / "e2e-x") is None


def test_collect_subagents_walks_the_ephemeral_cache(shortspace: Path, monkeypatch):
    # Fake the ~/.claude/projects cache with the real nested layout:
    #   projects/<sanitized-full-realpath>/<uuid>/subagents/agent-*.jsonl
    home = shortspace / "home"
    workspace = shortspace / "e2e-frederick-abc123"
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
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    summaries, status = collect_subagents(workspace)
    assert status == "captured"
    assert len(summaries) == 1
    assert summaries[0]["agent_type"] == "record-extractor"
    assert summaries[0]["runaway_thinking"] is True
    assert summaries[0]["transcript"] == "agent-1.jsonl"


def test_collect_subagents_empty_when_no_cache(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "nonexistent")
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    assert collect_subagents(tmp_path / "e2e-x") == ([], "no_cache_dir")


def test_status_distinguishes_a_resolved_dir_with_no_usable_transcript(
    shortspace: Path, monkeypatch
):
    """The value that `[]` used to hide.

    The directory resolves and holds an `agent-*.jsonl`, but it is unparseable —
    the run-killed-mid-generation shape. Before #2468 this was indistinguishable
    from "no subagents ran".
    """
    home = shortspace / "home"
    workspace = shortspace / "e2e-frederick-8fu_3bbk"
    subagents = (
        home / ".claude" / "projects" / _key(workspace) / "session-uuid" / "subagents"
    )
    subagents.mkdir(parents=True)
    (subagents / "agent-1.jsonl").write_text("not json at all\n", encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    assert collect_subagents(workspace) == ([], "matched_no_transcripts")


def test_find_session_transcript_matches_when_the_leaf_has_an_underscore(
    shortspace: Path, monkeypatch
):
    """The mirror of the capture case, for the run's own session JSONL.

    Without this, the whole second lookup site can be reverted to the old
    `endswith` scan with the entire suite green — which is how it shipped.
    """
    from e2e.orchestrator import _find_session_transcript

    home = shortspace / "home"
    workspace = shortspace / "e2e-frederick-8fu_3bbk"
    slug_dir = home / ".claude" / "projects" / _key(workspace)
    slug_dir.mkdir(parents=True)
    (slug_dir / "session-uuid.jsonl").write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    found = _find_session_transcript(workspace)
    assert found is not None, "session transcript lookup missed the cache dir"
    assert found.name == "session-uuid.jsonl"


def test_status_is_error_when_the_lookup_itself_fails(tmp_path: Path, monkeypatch):
    """`error` must be reachable, and must not be reported as `no_cache_dir`.

    A broken lookup reported as "no subagent ran" is the exact ambiguity this
    status exists to remove.

    Drives the REAL import, not a stubbed `sdk_cache_dir` — stubbing the helper
    leaves the swallow this pins invisible, which is how the first version of
    this test passed while proving nothing.
    """
    import sys

    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)
    assert collect_subagents(tmp_path / "e2e-x") == ([], "error")


def test_cache_dir_honours_claude_config_dir(shortspace: Path, monkeypatch):
    """The operator's shell can move the cache; the SDK subprocess inherits it.

    Hardcoding ~/.claude makes every run on such a machine report
    `no_cache_dir` — a silent 100% miss, the same shape as the bug this fixes.
    """
    config = shortspace / "elsewhere"
    workspace = shortspace / "e2e-frederick-8fu_3bbk"
    (config / "projects" / _key(workspace)).mkdir(parents=True)
    monkeypatch.setattr(Path, "home", lambda: shortspace / "home-with-no-cache")
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(config))

    assert sdk_cache_dir(workspace) is not None


@pytest.mark.skipif(
    os.name == "nt", reason="symlink creation needs a privilege on Windows"
)
def test_cache_dir_found_when_the_cli_keyed_on_an_unresolved_spelling(
    tmp_path: Path, monkeypatch
):
    """The CLI slugs the cwd IT resolved, not the one it was handed.

    Windows is the live case: committed run logs key on
    `C--Users-KWESIA-1-…` while the home in the same string is
    `C:\\Users\\KWESI ASANTE`, so the CLI never expanded the 8.3 short name.
    Python's realpath does, so a resolved-only key misses every time — three
    operators, nine logs, all of which capture fine under a leaf match.

    Reproduced here with a symlink, which is the same divergence on a platform
    CI can actually run. Seeds the cache under the LITERAL spelling and asserts
    we still find it.
    """
    real = tmp_path / "real"
    real.mkdir()
    (tmp_path / "link").symlink_to(real)
    workspace = tmp_path / "link" / "e2e-frederick-abc12345"
    workspace.mkdir()
    config = tmp_path / "cfg"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(config))

    literal_key = re.sub(r"[^A-Za-z0-9]", "-", str(workspace))
    assert literal_key != _key(workspace), "symlink did not produce a divergence"
    correct = config / "projects" / literal_key
    correct.mkdir(parents=True)
    # Without a decoy the leaf backstop answers this too, and the literal
    # candidate could be deleted with the test still green.
    decoy = config / "projects" / ("-aaa-stale-" + re.sub(r"[^A-Za-z0-9]", "-", workspace.name))
    decoy.mkdir(parents=True)
    assert decoy.name < correct.name, "decoy must sort first to exercise the scan"

    assert sdk_cache_dir(workspace) == correct


def test_an_exact_key_wins_over_a_decoy_that_also_ends_with_the_leaf(
    shortspace: Path, monkeypatch
):
    """Resolution is by key; the leaf is only the backstop.

    Every realistic key ends with the workspace leaf, so the backstop alone
    answers every other case in this file - and answers this one wrong. A stale
    cache dir from an earlier run of the same scenario under a different parent
    ends with the same leaf, and `iterdir` order decides which one a leaf-only
    lookup returns. Without this, dropping both whole-path candidates leaves the
    suite green and the harness silently back on leaf matching (#2468).
    """
    workspace = shortspace / "e2e-frederick-8fu_3bbk"
    workspace.mkdir()
    config = shortspace / "cfg"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(config))
    projects = config / "projects"

    correct = projects / _key(workspace)
    # Sorts before the real key, so a leaf-only scan returns it instead.
    decoy = projects / ("-aaa-stale-" + re.sub(r"[^A-Za-z0-9]", "-", workspace.name))
    correct.mkdir(parents=True)
    decoy.mkdir(parents=True)
    assert decoy.name < correct.name, "decoy must sort first to exercise the scan"

    assert sdk_cache_dir(workspace) == correct


@pytest.mark.skipif(
    os.name == "nt", reason="symlink creation needs a privilege on Windows"
)
def test_the_resolved_key_wins_when_it_is_the_only_correct_spelling(
    tmp_path: Path, monkeypatch
):
    """The mirror of the unresolved-spelling case: here the CLI DID resolve.

    macOS `/var` vs `/private/var` is the live shape. The literal spelling
    misses, so only `project_key_for_directory` can land it - and with a decoy
    present the leaf backstop lands on the wrong directory rather than none,
    which is the failure an `is not None` assertion cannot see.
    """
    real = tmp_path / "real"
    real.mkdir()
    (tmp_path / "link").symlink_to(real)
    workspace = tmp_path / "link" / "e2e-frederick-8fu_3bbk"
    workspace.mkdir()
    config = tmp_path / "cfg"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(config))
    projects = config / "projects"

    literal_key = re.sub(r"[^A-Za-z0-9]", "-", str(workspace))
    assert literal_key != _key(workspace), "symlink did not produce a divergence"

    correct = projects / _key(workspace)
    decoy = projects / ("-aaa-stale-" + re.sub(r"[^A-Za-z0-9]", "-", workspace.name))
    correct.mkdir(parents=True)
    decoy.mkdir(parents=True)
    assert decoy.name < correct.name, "decoy must sort first to exercise the scan"

    assert sdk_cache_dir(workspace) == correct


def test_cache_dir_falls_back_to_the_leaf_when_no_whole_path_key_matches(
    tmp_path: Path, monkeypatch
):
    """The backstop the issue actually asked for.

    A leaf match cannot care how the parent directories were spelled, which is
    why it survives cases neither whole-path key covers.
    """
    workspace = tmp_path / "e2e-frederick-8fu_3bbk"
    config = tmp_path / "cfg"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(config))
    # A parent spelling neither candidate key can produce.
    (config / "projects" / "-somewhere-else-entirely-e2e-frederick-8fu-3bbk").mkdir(
        parents=True
    )

    assert sdk_cache_dir(workspace) is not None


# ---------------------------------------------------------------------------
# #3045 — background subagents' tool calls are backfilled into `tool_calls` from
# their transcript, since they never reach the parent message stream.
# ---------------------------------------------------------------------------


def _tool_use_block(tuid, name, args=None):
    return {"type": "tool_use", "id": tuid, "name": name, "input": args or {}}


def _tool_result_block(tuid, text, is_error=False):
    return {
        "type": "tool_result",
        "tool_use_id": tuid,
        "content": [{"type": "text", "text": text}],
        "is_error": is_error,
    }


def _assistant_rec(blocks):
    return {"type": "assistant", "message": {"role": "assistant", "content": blocks}}


def _user_rec(blocks):
    return {"type": "user", "message": {"role": "user", "content": blocks}}


def test_transcript_agent_id_derives_id_from_filename():
    assert transcript_agent_id(Path("/x/subagents/agent-a1b2c3.jsonl")) == "a1b2c3"


@pytest.mark.parametrize(
    "name",
    ["session-uuid.jsonl", "agent-.jsonl", "notagent-123.jsonl"],
)
def test_transcript_agent_id_none_for_non_agent_names(name: str):
    assert transcript_agent_id(Path(name)) is None


def test_pair_tool_calls_matches_result_to_its_tool_use():
    records = [
        _assistant_rec([_tool_use_block("tu1", "mcp__genealogy__record_read", {"id": "R1"})]),
        _user_rec([_tool_result_block("tu1", '{"ok": true}')]),
    ]
    pairs = pair_tool_calls(records)
    assert len(pairs) == 1
    assert pairs[0]["tool"] == "mcp__genealogy__record_read"  # full name, not bare-ified
    assert pairs[0]["args"] == {"id": "R1"}
    assert pairs[0]["content"] == [{"type": "text", "text": '{"ok": true}'}]
    assert pairs[0]["is_error"] is False


def test_pair_tool_calls_unmatched_tool_use_keeps_none():
    # A run killed mid-call leaves a tool_use with no matching tool_result.
    pairs = pair_tool_calls([_assistant_rec([_tool_use_block("tu9", "Read")])])
    assert len(pairs) == 1
    assert pairs[0]["content"] is None
    assert pairs[0]["is_error"] is False


def test_pair_tool_calls_tolerates_non_object_records_and_content():
    records = [
        "a string",  # not a dict
        {"type": "assistant", "message": {"content": "not a list"}},
        _assistant_rec([{"type": "thinking"}, _tool_use_block("tu1", "Glob")]),
    ]
    pairs = pair_tool_calls(records)  # must not raise
    assert len(pairs) == 1
    assert pairs[0]["tool"] == "Glob"


def _async_launch_entry(agent_id: str) -> dict:
    """An `Agent` result announcing a background spawn — what gates the backfill."""
    return {
        "tool": "Agent",
        "args": {},
        "response_summary": f"Async agent launched successfully. agentId: {agent_id}",
    }


def _seed_transcript(home: Path, workspace: Path, agent_id: str, records, meta=None):
    """Seed one `agent-<agent_id>.jsonl` (+ optional meta) in the SDK cache."""
    subagents = (
        home / ".claude" / "projects" / _key(workspace) / "session-uuid" / "subagents"
    )
    subagents.mkdir(parents=True, exist_ok=True)
    (subagents / f"agent-{agent_id}.jsonl").write_text(
        "\n".join(json.dumps(r) for r in records), encoding="utf-8"
    )
    if meta is not None:
        (subagents / f"agent-{agent_id}.meta.json").write_text(
            json.dumps(meta), encoding="utf-8"
        )


def test_backfill_appends_a_background_agents_three_calls(shortspace: Path, monkeypatch):
    """Acceptance 1: a background transcript with 3 calls -> 3 entries with its id.

    Calls the function directly, so it does not cover the call site in
    `run_e2e_test` — removing that call leaves this test green. Break the backfill
    itself (e.g. `pair_tool_calls -> []`) and the three entries never appear.
    """
    from e2e.orchestrator import backfill_background_tool_calls

    home = shortspace / "home"
    workspace = shortspace / "e2e-frederick-abc123"
    records = []
    for i in range(3):
        records.append(_assistant_rec([_tool_use_block(f"tu{i}", "mcp__genealogy__image_read", {"n": i})]))
        records.append(_user_rec([_tool_result_block(f"tu{i}", f'{{"page": {i}}}')]))
    _seed_transcript(home, workspace, "bg777", records, meta={"agentType": "search-images"})
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    # The log must announce bg777 as a background spawn, or nothing is backfilled.
    tool_calls: list[dict] = [_async_launch_entry("bg777")]
    backfill_background_tool_calls(workspace, tool_calls)

    backfilled = [tc for tc in tool_calls if tc.get("agent_id") == "bg777"]
    assert len(backfilled) == 3
    for i, entry in enumerate(backfilled):
        assert entry["agent_type"] == "search-images"
        assert entry["tool"] == "mcp__genealogy__image_read"
        assert entry["args"] == {"n": i}
        # Full entry shape, same keys a synchronous call gets.
        assert set(entry) == {
            "tool", "args", "response_summary", "is_error", "result_chars",
            "agent_id", "agent_type",
        }
        assert isinstance(entry["result_chars"], int)
        assert entry["is_error"] is False


def test_backfill_only_touches_announced_background_agents(shortspace: Path, monkeypatch):
    """A synchronous agent whose stream entries carry no `agent_id` is NOT backfilled.

    Two real shapes leave a synchronous agent's entry without an `agent_id`: its
    result never arrived (cap/timeout mid-call), or its call was to a nonexistent
    tool and was refused before the hook ran (error result, `agent_id: None`).
    Either way the id is absent from `existing`, so dedup-by-`agent_id` alone would
    re-add the agent's calls from its transcript. Gating on the "Async agent
    launched" announcement is what prevents that. This test fails under a
    pure-`existing` dedup.
    """
    from e2e.orchestrator import backfill_background_tool_calls

    home = shortspace / "home"
    records = [
        _assistant_rec([_tool_use_block("tu1", "mcp__genealogy__record_read", {"id": "R"})]),
        _user_rec([_tool_result_block("tu1", "{}")]),
    ]

    # (a) mid-call: the agent's stream entry has no result and no agent_id.
    ws_a = shortspace / "e2e-sync-noresult-aaa111"
    _seed_transcript(home, ws_a, "sync99", records, meta={"agentType": "record-extractor"})
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    tc_a = [{"tool": "mcp__genealogy__record_read", "args": {"id": "R"}, "response_summary": None}]
    backfill_background_tool_calls(ws_a, tc_a)
    assert tc_a == [{"tool": "mcp__genealogy__record_read", "args": {"id": "R"}, "response_summary": None}]

    # (b) nonexistent-tool: the result arrived with agent_id None, is_error True.
    ws_b = shortspace / "e2e-sync-errored-bbb222"
    _seed_transcript(home, ws_b, "sync88", records, meta={"agentType": "record-extractor"})
    tc_b = [{"tool": "mcp__genealogy__nope", "args": {}, "is_error": True, "agent_id": None}]
    backfill_background_tool_calls(ws_b, tc_b)
    assert tc_b == [{"tool": "mcp__genealogy__nope", "args": {}, "is_error": True, "agent_id": None}]


def test_backfill_shape_matches_production_summary_helpers(shortspace: Path, monkeypatch):
    """The backfilled summary/length must be what the main stream would have produced.

    Uses `image_transcribe`, whose `transcription` key is summary-exempt, so the
    call must pass `tool_name` to `_summarize_tool_response` exactly as the main
    stream does — omitting it truncates the transcription at ~500 chars. The
    assertion against the real helper WITH `tool_name` fails if the backfill drops
    it, and the whole-text assertion shows the field is not truncated.
    """
    from e2e.orchestrator import (
        _raw_result_chars,
        _summarize_tool_response,
        backfill_background_tool_calls,
    )

    home = shortspace / "home"
    workspace = shortspace / "e2e-frederick-abc124"
    long_text = "LINE " * 400  # > 500 chars; would be truncated without the exemption
    doc = json.dumps({"transcription": long_text, "pageUrl": "x"})
    content = [{"type": "text", "text": doc}]
    records = [
        _assistant_rec([_tool_use_block("tu1", "mcp__genealogy__image_transcribe", {})]),
        {"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "tu1", "content": content, "is_error": False},
        ]}},
    ]
    _seed_transcript(home, workspace, "bg1", records, meta={"agentType": "search-images"})
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    tool_calls: list[dict] = [_async_launch_entry("bg1")]
    backfill_background_tool_calls(workspace, tool_calls)
    entry = next(tc for tc in tool_calls if tc.get("agent_id") == "bg1")
    tool = "mcp__genealogy__image_transcribe"
    assert entry["response_summary"] == _summarize_tool_response(content, tool_name=tool)
    assert entry["result_chars"] == _raw_result_chars(content)
    # The exempt transcription survives whole — proof tool_name reached the summarizer.
    assert long_text.strip() in entry["response_summary"]


def test_backfill_does_not_double_count_a_synchronous_agent(shortspace: Path, monkeypatch):
    """Acceptance 2 (the other direction): an agent already in the stream is skipped.

    The dedup predicate is `agent_id` presence in the existing list — asserted
    directly, not merely inferred from an unchanged count.
    """
    from e2e.orchestrator import backfill_background_tool_calls

    home = shortspace / "home"
    workspace = shortspace / "e2e-frederick-abc125"
    _seed_transcript(
        home, workspace, "sync42",
        [_assistant_rec([_tool_use_block("tu1", "mcp__genealogy__record_read")]),
         _user_rec([_tool_result_block("tu1", "{}")])],
        meta={"agentType": "record-extractor"},
    )
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    # The stream already captured this agent's one call, keyed by its agent_id.
    existing = {"tool": "mcp__genealogy__record_read", "args": {}, "agent_id": "sync42"}
    tool_calls = [existing]
    assert any(tc.get("agent_id") == "sync42" for tc in tool_calls)  # dedup predicate holds

    backfill_background_tool_calls(workspace, tool_calls)
    assert tool_calls == [existing]  # nothing appended, no duplicate


def test_backfill_never_raises_on_a_truncated_transcript(shortspace: Path, monkeypatch):
    """Acceptance 3: an unparseable transcript leaves tool_calls unchanged, no exception."""
    from e2e.orchestrator import backfill_background_tool_calls

    home = shortspace / "home"
    workspace = shortspace / "e2e-frederick-abc126"
    subagents = (
        home / ".claude" / "projects" / _key(workspace) / "session-uuid" / "subagents"
    )
    subagents.mkdir(parents=True)
    (subagents / "agent-bad.jsonl").write_text("not json at all\n", encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    # Announce "bad" as background so the backfill actually tries to parse its
    # (unparseable) transcript — otherwise the announcement gate skips it first.
    tool_calls: list[dict] = [_async_launch_entry("bad")]
    backfill_background_tool_calls(workspace, tool_calls)  # must not raise
    assert tool_calls == [_async_launch_entry("bad")]


def test_backfill_no_cache_dir_leaves_tool_calls_unchanged(tmp_path: Path, monkeypatch):
    from e2e.orchestrator import backfill_background_tool_calls

    monkeypatch.setattr(Path, "home", lambda: tmp_path / "nonexistent")
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    tool_calls = [{"tool": "x", "agent_id": None}]
    backfill_background_tool_calls(tmp_path / "e2e-x", tool_calls)
    assert tool_calls == [{"tool": "x", "agent_id": None}]


def _seed_raw(tmp_path: Path, monkeypatch, jsonl: bytes, meta: bytes | None = None):
    """Cache holding one transcript written as raw bytes."""
    workspace = tmp_path / "e2e-x-abc12345"
    workspace.mkdir()
    config = tmp_path / "cfg"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(config))
    sub = config / "projects" / _key(workspace) / "s" / "subagents"
    sub.mkdir(parents=True)
    (sub / "agent-1.jsonl").write_bytes(jsonl)
    if meta is not None:
        (sub / "agent-1.meta.json").write_bytes(meta)
    return workspace


_GOOD_TURN = (
    b'{"type":"assistant","message":{"content":[],"stop_reason":"end_turn"}}\n'
)


@pytest.mark.parametrize(
    ("name", "jsonl", "meta", "expected"),
    [
        ("json_but_not_an_object", b'"a string"\n', None, "matched_no_transcripts"),
        ("meta_is_not_a_dict", _GOOD_TURN, b"[1,2]", "captured"),
        # `read_text(encoding="utf-8")` raises rather than replacing, so the
        # meta catch must name UnicodeDecodeError - dropping it left the
        # suite green while a cp1252 meta file crashed the whole capture.
        ("meta_is_invalid_utf8", _GOOD_TURN, b'{"agentType": "\xff\xfe"}', "captured"),
        ("truncated_utf8_tail", _GOOD_TURN + b"\xe2\x82", None, "captured"),
        ("healthy_control", _GOOD_TURN, None, "captured"),
    ],
)
def test_a_malformed_transcript_is_recorded_not_raised(
    shortspace: Path, monkeypatch, name: str, jsonl: bytes, meta: bytes | None, expected: str
):
    """Capture must never raise — it runs before the run log is written.

    `collect_subagents` is called outside any try, so anything raised here costs
    a completed, paid run its entire log. The truncated-UTF-8 case is the
    run-killed-mid-generation shape this module's docstring already claimed to
    tolerate and did not: `read_text`'s guard catches only `OSError`.
    """
    workspace = _seed_raw(shortspace, monkeypatch, jsonl, meta)
    _, status = collect_subagents(workspace)
    assert status == expected
