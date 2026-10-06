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


# ---------------------------------------------------------------------------
# Per-subagent token accounting (#2582).
#
# The trap these pin: Claude Code writes one record per content BLOCK, and every
# one repeats its message's totals. Measured 2026-10-02 over 52 local subagent
# transcripts (1,660 distinct message ids), a naive sum overstates cache reads
# 2.000x and cache writes 2.390x while output moves only 1.018x — because a
# message's first record carries a start-of-message output snapshot, not a
# repeated final count.
# ---------------------------------------------------------------------------


def _usage_record(message_id, *, output_tokens, cache_read, role="assistant"):
    return {
        "message": {
            "role": role,
            "id": message_id,
            "stop_reason": "end_turn",
            "content": [{"type": "text"}],
            "usage": {
                "input_tokens": 1,
                "output_tokens": output_tokens,
                "cache_read_input_tokens": cache_read,
                "cache_creation_input_tokens": 10,
            },
        }
    }


def test_subagent_usage_counts_each_message_once_not_each_record():
    """The issue's own acceptance fixture: 150 and 20,000, never 151 and 40,000."""
    records = [
        _usage_record("msg_a", output_tokens=1, cache_read=20_000),
        _usage_record("msg_a", output_tokens=150, cache_read=20_000),
    ]
    summary = summarize_transcript(records)

    assert summary["usage"]["output_tokens"] == 150
    assert summary["usage"]["cache_read_input_tokens"] == 20_000
    # Not the naive sum, which is the whole point.
    assert summary["usage"]["output_tokens"] != 151
    assert summary["usage"]["cache_read_input_tokens"] != 40_000
    # `turns[]` is untouched: the runaway readers and `max_output_tokens` need
    # one entry per record, so the dedup lives in `usage` alone.
    assert len(summary["turns"]) == 2


def test_subagent_usage_sums_across_distinct_messages():
    """Deduping must not collapse genuinely different messages."""
    records = [
        _usage_record("msg_a", output_tokens=100, cache_read=5),
        _usage_record("msg_b", output_tokens=200, cache_read=7),
    ]
    assert summarize_transcript(records)["usage"]["output_tokens"] == 300


def test_subagent_usage_counts_an_id_less_record_once_rather_than_dropping_it():
    """Those tokens were really spent; two id-less records are two messages."""
    records = [
        _usage_record(None, output_tokens=11, cache_read=1),
        _usage_record(None, output_tokens=13, cache_read=1),
    ]
    assert summarize_transcript(records)["usage"]["output_tokens"] == 24


def test_subagent_usage_skips_non_assistant_records():
    """Without the role filter each user record would eat an `__anon_` slot."""
    records = [
        _usage_record("msg_a", output_tokens=100, cache_read=5),
        _usage_record("msg_u", output_tokens=999, cache_read=999, role="user"),
    ]
    assert summarize_transcript(records)["usage"]["output_tokens"] == 100


@pytest.mark.parametrize("degenerate", ["n/a", [], 42, None])
def test_subagent_usage_never_raises_on_a_non_dict_usage(degenerate):
    """The one shape that can raise — and it would cost a paid run its whole log.

    `collect_subagents` did not guard the summarize loop; `parse_jsonl` admits
    arbitrary JSON objects, so a `message.usage` of `"n/a"` reached `.get` and
    threw an AttributeError straight out of a function whose docstring promises
    it never raises.
    """
    records = [{"message": {"role": "assistant", "id": "m", "usage": degenerate}}]
    assert summarize_transcript(records)["usage"]["output_tokens"] == 0


def test_subagent_usage_coerces_a_non_numeric_field_to_zero_not_an_error():
    records = [
        {
            "message": {
                "role": "assistant",
                "id": "m",
                "usage": {"output_tokens": "150", "cache_read_input_tokens": None},
            }
        }
    ]
    usage = summarize_transcript(records)["usage"]
    assert usage == {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
    }


def test_subagent_usage_last_write_wins_only_among_records_carrying_a_usage_dict():
    """A trailing record with no usage must not zero a real figure.

    Measured over 52 transcripts / 1,660 ids: zero instances today, which is
    exactly why it is pinned — the shape is cheap to regress into.
    """
    records = [
        _usage_record("msg_a", output_tokens=150, cache_read=20_000),
        {"message": {"role": "assistant", "id": "msg_a", "content": []}},
    ]
    assert summarize_transcript(records)["usage"]["output_tokens"] == 150


def test_subagent_usage_is_all_zeros_not_absent_when_nothing_carried_usage():
    """Captured-and-spent-nothing is a different claim from capture-failed.

    The run-level `subagent_capture_status` carries the second one. A summary
    written before this field existed has no `usage` key at all, and the merge
    treats that as unknown.
    """
    summary = summarize_transcript([{"message": {"role": "assistant", "content": []}}])
    assert summary["usage"] == {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
    }


# ---------------------------------------------------------------------------
# Per-helper peak window, compactions and model (T1.3,
# docs/plan/cost-latency-10x.md §7: "verify before assuming Haiku is safe inside
# an agent"). `usage` above is a SUM — what the helper spent. The peak is a MAX —
# the tallest single pile it read, i.e. how close it came to the compaction line.
# Two helpers can spend the same and differ completely on that.
# ---------------------------------------------------------------------------


def _window_record(message_id, *, window, model="claude-sonnet-4-6", block="text"):
    """One block-record of a message whose read window totals `window` tokens."""
    return {
        "type": "assistant",
        "message": {
            "role": "assistant",
            "id": message_id,
            "model": model,
            "stop_reason": "end_turn",
            "content": [{"type": block}],
            "usage": {
                "input_tokens": 3,
                "output_tokens": 50,
                "cache_read_input_tokens": window - 3 - 100,
                "cache_creation_input_tokens": 100,
            },
        },
    }


def _boundary(meta):
    return {"type": "system", "subtype": "compact_boundary", "compactMetadata": meta}


def test_peak_window_is_the_max_message_not_the_sum():
    """20k, 35k, 52k read across three messages → the peak is 52,000, not 107,000.

    Each message is repeated across three block records, the shape Claude Code
    writes; a max is unmoved by the repeats, and the test pins that it stays so.
    """
    records = []
    for mid, window in (("m1", 20_000), ("m2", 35_000), ("m3", 52_000)):
        for block in ("thinking", "text", "tool_use"):
            records.append(_window_record(mid, window=window, block=block))
    summary = summarize_transcript(records)
    assert summary["peak_window_tokens"] == 52_000
    assert summary["peak_window_tokens"] != 107_000


def test_peak_window_excludes_output_tokens():
    summary = summarize_transcript([_window_record("m1", window=40_000)])
    assert summary["peak_window_tokens"] == 40_000  # not 40,050


def test_peak_window_is_zero_when_no_message_carries_usage():
    summary = summarize_transcript([{"message": {"role": "assistant", "content": []}}])
    assert summary["peak_window_tokens"] == 0


def test_a_helper_that_never_compacted_has_an_empty_list():
    summary = summarize_transcript([_window_record("m1", window=40_000)])
    assert summary["compactions"] == []


def test_a_compaction_is_recorded_with_its_real_figures():
    records = [
        _window_record("m1", window=160_000),
        _boundary({"trigger": "auto", "preTokens": 167_201, "postTokens": 14_299}),
        _window_record("m2", window=20_000),
    ]
    summary = summarize_transcript(records)
    assert summary["compactions"] == [
        {"trigger": "auto", "pre_tokens": 167_201, "post_tokens": 14_299}
    ]
    # The peak saturates before the squeeze; the count is the signal.
    assert summary["peak_window_tokens"] == 160_000


def test_a_missing_post_tokens_is_unknown_not_zero():
    """`postTokens` is optional in the CLI; 0 would read as "squeezed to nothing"."""
    summary = summarize_transcript([_boundary({"trigger": "auto", "preTokens": 167_000})])
    assert summary["compactions"] == [
        {"trigger": "auto", "pre_tokens": 167_000, "post_tokens": None}
    ]


@pytest.mark.parametrize(
    "meta",
    [None, "a string", [1, 2], {"trigger": 7, "preTokens": "x", "postTokens": True}],
)
def test_a_malformed_compaction_still_counts_and_never_raises(meta):
    """The squeeze happened, so it is an entry — with unknowns, never a raise."""
    record = {"type": "system", "subtype": "compact_boundary"}
    if meta is not None:
        record["compactMetadata"] = meta
    summary = summarize_transcript([record])
    assert summary["compactions"] == [
        {"trigger": None, "pre_tokens": None, "post_tokens": None}
    ]


def test_the_word_compact_boundary_inside_a_message_is_not_a_compaction():
    """A helper that reads code mentioning the marker has not been squeezed."""
    records = [
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": '"subtype": "compact_boundary"'}],
            },
        },
        {"type": "user", "subtype": "compact_boundary"},
    ]
    assert summarize_transcript(records)["compactions"] == []


def test_models_are_the_distinct_ids_in_first_seen_order():
    records = [
        _window_record("m1", window=1_000, model="claude-sonnet-4-6"),
        _window_record("m2", window=1_000, model="claude-haiku-4-5-20251001"),
        _window_record("m3", window=1_000, model="claude-sonnet-4-6"),
    ]
    assert summarize_transcript(records)["models"] == [
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001",
    ]


@pytest.mark.parametrize("model", ["<synthetic>", None, 7, ""])
def test_models_skip_placeholders_and_non_strings(model):
    records = [
        _window_record("m1", window=1_000, model="claude-sonnet-4-6"),
        _window_record("m2", window=1_000, model=model),
    ]
    assert summarize_transcript(records)["models"] == ["claude-sonnet-4-6"]


def test_collect_subagents_carries_the_new_fields_into_the_runlog_shape(
    shortspace: Path, monkeypatch
):
    """The last step before `E2eResult.subagents`: what the run log will hold."""
    home = shortspace / "home"
    workspace = shortspace / "e2e-frederick-abc123"
    subagents = home / ".claude" / "projects" / _key(workspace) / "session-uuid" / "subagents"
    subagents.mkdir(parents=True)
    records = [
        _window_record("m1", window=90_000),
        _boundary({"trigger": "auto", "preTokens": 167_000, "postTokens": 12_000}),
        _window_record("m2", window=30_000),
    ]
    (subagents / "agent-1.jsonl").write_text(
        "\n".join(json.dumps(r) for r in records), encoding="utf-8"
    )
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    summaries, status = collect_subagents(workspace)
    assert status == "captured"
    assert summaries[0]["peak_window_tokens"] == 90_000
    assert len(summaries[0]["compactions"]) == 1
    assert summaries[0]["models"] == ["claude-sonnet-4-6"]


# ---------------------------------------------------------------------------
# The main thread's own meter (unit harness, routed tests run their skill here).
# ---------------------------------------------------------------------------


def test_collect_main_thread_reads_the_parent_session_and_skips_sidechains(
    shortspace: Path, monkeypatch
):
    from e2e.subagent_capture import collect_main_thread

    home = shortspace / "home"
    workspace = shortspace / "eval-ut-abc123"
    cache = home / ".claude" / "projects" / _key(workspace)
    (cache / "session-uuid" / "subagents").mkdir(parents=True)
    main_records = [
        _window_record("m1", window=60_000),
        _boundary({"trigger": "auto", "preTokens": 167_000, "postTokens": 9_000}),
        _window_record("m2", window=20_000),
        dict(_window_record("s1", window=190_000), isSidechain=True),
    ]
    (cache / "session-uuid.jsonl").write_text(
        "\n".join(json.dumps(r) for r in main_records), encoding="utf-8"
    )
    # A subagent transcript one level down must never be read as the main thread.
    (cache / "session-uuid" / "subagents" / "agent-1.jsonl").write_text(
        json.dumps(_window_record("x", window=150_000)), encoding="utf-8"
    )
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    main = collect_main_thread(workspace)
    assert main == {
        "peak_window_tokens": 60_000,
        "compactions": [{"trigger": "auto", "pre_tokens": 167_000, "post_tokens": 9_000}],
        "models": ["claude-sonnet-4-6"],
    }


def test_collect_main_thread_is_none_not_zero_when_nothing_is_found(tmp_path: Path, monkeypatch):
    from e2e.subagent_capture import collect_main_thread

    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    assert collect_main_thread(tmp_path / "nowhere") is None
