"""Unit tests for e2e.orchestrator — fixture loading, workspace assembly.

The async _run_agent function spawns the SDK + real MCP server; that
path is covered by an e2e suite run, not these unit tests.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from claude_agent_sdk import ToolResultBlock

from e2e.orchestrator import (
    apply_tool_result,
    check_guardrail_compliance,
    PROVIDED_DOCS_DIRNAME,
    FixtureCaps,
    _accumulate_usage,
    _fallback_usage,
    _render_user_message,
    _RUNLOG_MAX_CHARS,
    _RUNLOG_VERBATIM_MAX,
    _summarize_tool_response,
    _timeline_tool_label,
    build_workspace,
    load_fixture,
    load_seed_person_ids,
    PERSON_EVIDENCE_DENY_REPEAT_LIMIT,
    PERSON_EVIDENCE_DENY_TOTAL_LIMIT,
    person_evidence_deny_decision,
    person_evidence_provenance_gap,
    provided_documents,
)


class _FakeAssistantMessage:
    """Stand-in for the SDK's AssistantMessage — only the two fields the
    usage accumulator reads."""

    def __init__(self, message_id, usage):
        self.message_id = message_id
        self.usage = usage


def _make_fixture_dir(tmp_path: Path, *, caps: dict | None = None) -> Path:
    fixture_dir = tmp_path / "test-fixture"
    fixture_dir.mkdir()
    fixture_json = {
        "id": "test-fixture",
        "name": "Test fixture",
        "source_pid": "ABCD-123",
        "captured": "2026-05-26",
        "researcher_question": "Who were John's parents?",
        "tags": {"question_type": "parents", "era": "1850s", "geography": "US-VA"},
        "model": {"agent": "claude-sonnet-4-6", "judge": "claude-haiku-4-5-20251001"},
    }
    if caps is not None:
        fixture_json["caps"] = caps
    (fixture_dir / "fixture.json").write_text(json.dumps(fixture_json), encoding="utf-8")
    (fixture_dir / "starting-research.json").write_text(
        json.dumps({"project": {"objective": "Find John's parents"}}), encoding="utf-8"
    )
    (fixture_dir / "starting-tree.gedcomx.json").write_text(json.dumps({"persons": []}), encoding="utf-8")
    (fixture_dir / "expected-findings.json").write_text(
        json.dumps({"findings": [{"id": "f1", "description": "...", "required": True}]}), encoding="utf-8"
    )
    return fixture_dir


def test_load_fixture_reads_all_required_fields(tmp_path: Path):
    fixture_dir = _make_fixture_dir(tmp_path)
    fixture = load_fixture(fixture_dir)
    assert fixture.id == "test-fixture"
    assert fixture.researcher_question == "Who were John's parents?"
    assert fixture.tags["question_type"] == "parents"
    assert fixture.agent_model == "claude-sonnet-4-6"
    assert fixture.judge_model == "claude-haiku-4-5-20251001"
    assert fixture.expected_findings["findings"][0]["id"] == "f1"
    assert fixture.starting_research_path.exists()
    assert fixture.starting_tree_path.exists()


def test_load_fixture_applies_default_caps_when_missing(tmp_path: Path):
    fixture_dir = _make_fixture_dir(tmp_path, caps=None)
    fixture = load_fixture(fixture_dir)
    assert fixture.caps == FixtureCaps()  # all defaults


def test_load_fixture_uses_explicit_caps(tmp_path: Path):
    fixture_dir = _make_fixture_dir(
        tmp_path,
        caps={
            "wall_clock_seconds": 60,
            "inactivity_seconds": 30,
            "tool_calls": 5,
            "max_turns": 10,
            "max_cost_usd": 0.5,
        },
    )
    fixture = load_fixture(fixture_dir)
    assert fixture.caps.wall_clock_seconds == 60
    assert fixture.caps.inactivity_seconds == 30
    assert fixture.caps.tool_calls == 5
    assert fixture.caps.max_turns == 10
    assert fixture.caps.max_cost_usd == 0.5


def test_load_fixture_missing_fixture_json_raises(tmp_path: Path):
    fixture_dir = tmp_path / "empty"
    fixture_dir.mkdir()
    with pytest.raises(FileNotFoundError):
        load_fixture(fixture_dir)


def test_build_workspace_copies_starting_state(tmp_path: Path):
    fixture_dir = _make_fixture_dir(tmp_path)
    fixture = load_fixture(fixture_dir)

    # Fake skills dir with one skill
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    (skills_dir / "fake-skill").mkdir()
    (skills_dir / "fake-skill" / "SKILL.md").write_text("---\nname: fake\n---\nbody", encoding="utf-8")

    workspace = tmp_path / "ws"
    workspace.mkdir()
    build_workspace(fixture, workspace, skills_dir)

    assert (workspace / "research.json").exists()
    assert (workspace / "tree.gedcomx.json").exists()
    assert (workspace / ".claude" / "skills" / "fake-skill" / "SKILL.md").exists()


def test_build_workspace_never_copies_the_answer_into_the_workspace(tmp_path: Path):
    """`build_workspace` must keep copying by explicit filename.

    A fixture directory holds two files that ARE the answer:
    `expected-findings.json`, and — on Path 1/2 — the committed
    `unstripped-tree.gedcomx.json` that `strip` derives the starting tree
    from. Neither may reach the agent. Today that holds because the copy
    list is two `shutil.copy` calls naming their targets; the moment someone
    "simplifies" it into a `copytree`, every e2e fixture silently starts
    handing the agent its own answer key and every run passes.
    """
    fixture_dir = _make_fixture_dir(tmp_path)
    (fixture_dir / "unstripped-tree.gedcomx.json").write_text(
        json.dumps({"persons": [{"id": "ABCD-123"}]}), encoding="utf-8"
    )
    fixture = load_fixture(fixture_dir)

    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()

    workspace = tmp_path / "ws"
    workspace.mkdir()
    build_workspace(fixture, workspace, skills_dir)

    leaked = {p.name for p in workspace.rglob("*")} & {
        "expected-findings.json",
        "unstripped-tree.gedcomx.json",
        "fixture.json",
    }
    assert leaked == set()


def test_build_workspace_stages_plugin_agents(tmp_path: Path):
    """Plugin subagents are staged into .claude/agents/ so /research can
    delegate to the real gps-mentor instead of an improvised subagent."""
    fixture_dir = _make_fixture_dir(tmp_path)
    fixture = load_fixture(fixture_dir)

    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "gps-mentor.md").write_text(
        "---\nname: gps-mentor\n---\nbody", encoding="utf-8"
    )

    workspace = tmp_path / "ws"
    workspace.mkdir()
    build_workspace(fixture, workspace, skills_dir, agents_dir=agents_dir)

    staged = workspace / ".claude" / "agents" / "gps-mentor.md"
    assert staged.exists()
    assert "name: gps-mentor" in staged.read_text(encoding="utf-8")


def test_build_workspace_writes_project_effort_level(tmp_path: Path):
    """effort_level writes a project-level setting the CLI honors (env var doesn't)."""
    fixture = load_fixture(_make_fixture_dir(tmp_path))
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    workspace = tmp_path / "ws"
    workspace.mkdir()
    build_workspace(fixture, workspace, skills_dir, effort_level="medium")

    settings = workspace / ".claude" / "settings.json"
    assert settings.exists()
    assert json.loads(settings.read_text(encoding="utf-8")) == {"effortLevel": "medium"}


def test_build_workspace_no_settings_when_effort_level_unset(tmp_path: Path):
    """Default (None) writes no settings.json — preserves the CLI default effort."""
    fixture = load_fixture(_make_fixture_dir(tmp_path))
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    workspace = tmp_path / "ws"
    workspace.mkdir()
    build_workspace(fixture, workspace, skills_dir)

    assert not (workspace / ".claude" / "settings.json").exists()


def test_agent_model_override_rewrites_staged_subagent_pin(tmp_path: Path):
    """--agent-model rewrites each staged subagent's `model:` frontmatter."""
    fixture = load_fixture(_make_fixture_dir(tmp_path))
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "record-extractor.md").write_text(
        "---\nname: record-extractor\nmodel: claude-sonnet-5\ntools: []\n---\nbody",
        encoding="utf-8",
    )
    workspace = tmp_path / "ws"
    workspace.mkdir()
    build_workspace(
        fixture, workspace, skills_dir, agents_dir=agents_dir,
        agent_model="claude-sonnet-4-6",
    )

    staged = (workspace / ".claude" / "agents" / "record-extractor.md").read_text(encoding="utf-8")
    assert "model: claude-sonnet-4-6" in staged
    assert "claude-sonnet-5" not in staged


def test_agent_model_none_leaves_subagent_pin_intact(tmp_path: Path):
    """Default (None) copies the agent verbatim — its own pin is kept."""
    fixture = load_fixture(_make_fixture_dir(tmp_path))
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "record-extractor.md").write_text(
        "---\nname: record-extractor\nmodel: claude-sonnet-5\n---\nbody", encoding="utf-8"
    )
    workspace = tmp_path / "ws"
    workspace.mkdir()
    build_workspace(fixture, workspace, skills_dir, agents_dir=agents_dir)

    staged = (workspace / ".claude" / "agents" / "record-extractor.md").read_text(encoding="utf-8")
    assert "model: claude-sonnet-5" in staged


def test_override_agent_model_inserts_pin_when_absent():
    from e2e.orchestrator import _override_agent_model

    out = _override_agent_model("---\nname: x\n---\nbody", "claude-sonnet-4-6")
    assert "model: claude-sonnet-4-6" in out
    # unchanged when there is no frontmatter to pin into
    assert _override_agent_model("no frontmatter", "claude-sonnet-4-6") == "no frontmatter"


def test_build_workspace_default_agents_dir_includes_gps_mentor(tmp_path: Path):
    """The default agents_dir points at the real plugin agents/, so the
    shipped gps-mentor agent lands in the workspace with no extra wiring."""
    fixture_dir = _make_fixture_dir(tmp_path)
    fixture = load_fixture(fixture_dir)
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    workspace = tmp_path / "ws"
    workspace.mkdir()
    build_workspace(fixture, workspace, skills_dir)
    assert (workspace / ".claude" / "agents" / "gps-mentor.md").exists()


def test_build_workspace_renames_starting_files(tmp_path: Path):
    """starting-research.json → research.json (so the agent sees the
    name it expects)."""
    fixture_dir = _make_fixture_dir(tmp_path)
    fixture = load_fixture(fixture_dir)
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()

    workspace = tmp_path / "ws"
    workspace.mkdir()
    build_workspace(fixture, workspace, skills_dir)

    parsed = json.loads((workspace / "research.json").read_text(encoding="utf-8"))
    assert parsed["project"]["objective"] == "Find John's parents"


def test_render_user_message_includes_autonomous_flag(tmp_path: Path):
    fixture_dir = _make_fixture_dir(tmp_path)
    fixture = load_fixture(fixture_dir)
    msg = _render_user_message(fixture)
    assert msg.startswith("/research --autonomous ")
    assert "Who were John's parents?" in msg


# --- provided-documents (bundled external evidence) ------------------

def _add_provided_doc(fixture_dir: Path, name: str, content: bytes = b"%PDF-1.4 fake"):
    d = fixture_dir / PROVIDED_DOCS_DIRNAME
    d.mkdir(exist_ok=True)
    (d / name).write_bytes(content)


def test_provided_documents_empty_when_none(tmp_path: Path):
    fixture = load_fixture(_make_fixture_dir(tmp_path))
    assert provided_documents(fixture) == []


def test_provided_documents_lists_bundled_files(tmp_path: Path):
    fixture_dir = _make_fixture_dir(tmp_path)
    _add_provided_doc(fixture_dir, "findagrave-quass.pdf")
    _add_provided_doc(fixture_dir, "ancestry-death-cert.pdf")
    fixture = load_fixture(fixture_dir)
    names = [p.name for p in provided_documents(fixture)]
    assert names == ["ancestry-death-cert.pdf", "findagrave-quass.pdf"]  # sorted


def test_build_workspace_copies_provided_docs_to_root(tmp_path: Path):
    fixture_dir = _make_fixture_dir(tmp_path)
    _add_provided_doc(fixture_dir, "findagrave-quass.pdf")
    fixture = load_fixture(fixture_dir)
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    workspace = tmp_path / "ws"
    workspace.mkdir()
    build_workspace(fixture, workspace, skills_dir)
    # Lands at the workspace root, where an uploaded PDF would.
    assert (workspace / "findagrave-quass.pdf").exists()


def test_user_message_names_provided_docs(tmp_path: Path):
    fixture_dir = _make_fixture_dir(tmp_path)
    _add_provided_doc(fixture_dir, "findagrave-quass.pdf")
    fixture = load_fixture(fixture_dir)
    msg = _render_user_message(fixture)
    assert "findagrave-quass.pdf" in msg
    assert msg.startswith("/research --autonomous ")


def test_user_message_unchanged_without_provided_docs(tmp_path: Path):
    fixture = load_fixture(_make_fixture_dir(tmp_path))
    msg = _render_user_message(fixture)
    assert "Pre-provided" not in msg


def test_summarize_tool_response_short_string():
    assert _summarize_tool_response("hello") == "hello"


def test_summarize_tool_response_dict_is_json():
    out = _summarize_tool_response({"records": [1, 2, 3]})
    assert '"records"' in out


def test_summarize_tool_response_truncates_long_content():
    long = "x" * 2000
    out = _summarize_tool_response(long)
    # The bound is now the judge tier's explicit marker rather than a bare "...",
    # so a reader can tell a summary from a real response and knows what was lost.
    assert "[truncated by harness" in out
    assert "full length 2000 chars" in out
    # TWO-SIDED, deliberately. This asserted only `len(out) <= 500` at first,
    # which a *smaller* bound also satisfies — so it passed while a 200-char
    # string bound quietly cut 112 of the 284 tool results in
    # run-2026-07-31_13-02-13 below what the old 497-char head-truncation kept.
    # Replacing it with a bare floor then had the mirror-image hole: nothing
    # bounded the constants from ABOVE, so `_RUNLOG_STRING_MAX` could go to 50,000
    # and the whole suite still passed, in a module that justifies both numbers by
    # "this lands in a run log that is committed to git". Pin both ends.
    assert 497 <= out.count("x") <= 600


def test_summarize_tool_response_keeps_keys_after_a_huge_results_array():
    """The #1073 regression: head-truncation hid every field after `results`.

    `record_search` puts its largest field early, so a head bound dropped
    `ranked` from all 46 calls in run-2026-07-31_13-02-13. Summarizing by key
    means a trailing field survives no matter how much data precedes it.
    """
    response = {
        "totalMatches": 900,
        "rankingSkipped": "No `subjectId`, so match-score ranking ... did not run.",
        "results": [{"recordId": f"ark:/61903/1:1:{i:06d}", "filler": "y" * 400} for i in range(200)],
        "jurisdictionHints": {"searchedPlace": "Hill County, Texas"},
    }
    out = _summarize_tool_response(response)
    assert "rankingSkipped" in out
    # The point of the change: a field serialized AFTER the big array survives.
    assert "jurisdictionHints" in out
    assert "Hill County, Texas" in out


def test_summarize_tool_response_unwraps_an_mcp_text_block():
    """MCP results wrap the whole document in a text block, hiding its keys.

    Two things this has to get right, both of which an earlier version got wrong:

    The payload must exceed the verbatim-passthrough threshold, or
    `_summarize_tool_response` returns at its `len(raw) <= 500` early exit and
    `_unwrap_mcp_text_blocks` never runs at all — leaving the mechanism the whole
    `record_search` legibility fix depends on with zero coverage.

    And the assertion must be on the UNESCAPED key (`'"rankingSkipped"'`, with
    quotes). The bare substring `rankingSkipped` is present either way, inside the
    escaped `"text": "{\\"rankingSkipped\\": …}"` wrapper, so asserting on it
    cannot tell an unwrapped document from a wrapped one.
    """
    inner = json.dumps(
        {
            "totalMatches": 0,
            "rankingSkipped": "No `subjectId`, so ranking did not run. " + "pad " * 150,
        }
    )
    wrapped = [{"type": "text", "text": inner}]
    assert len(json.dumps(wrapped)) > 500, "fixture must clear the verbatim exit"

    out = _summarize_tool_response(wrapped)

    # Unescaped keys: only reachable if the inner document was actually parsed.
    assert '"rankingSkipped"' in out
    assert '"totalMatches"' in out
    # And the escaped wrapper is gone.
    assert '\\"rankingSkipped\\"' not in out


def test_summarize_tool_response_passes_through_non_json_text():
    """The unwrap's "anything that does not parse is left alone" branch.

    The fixture must clear _RUNLOG_VERBATIM_MAX or this test pins nothing: under
    it, `_summarize_tool_response` returns at its verbatim early exit and the
    unwrap never runs. That is how the first version of this test survived every
    mutation of the module, including replacing the unwrap with the identity.
    """
    body = "not json at all, " + "prose " * 120
    wrapped = [{"type": "text", "text": body}]
    assert len(json.dumps(wrapped)) > 500, "fixture must clear the verbatim exit"

    out = _summarize_tool_response(wrapped)

    assert "not json at all" in out
    # Still a text block, not a parsed document: the wrapper survives.
    assert '"type"' in out and '"text"' in out


def test_summarize_tool_response_does_not_coerce_json_scalars():
    """A tool result of "1" or "true" must stay the string the tool returned.

    Only reachable above the verbatim threshold, which is why it needs padding —
    a short scalar never reaches the unwrap at all.
    """
    for scalar, wrong in (("1" * 600, 1), ("true" + " " * 600, True)):
        wrapped = [{"type": "text", "text": scalar}]
        assert len(json.dumps(wrapped)) > 500
        out = _summarize_tool_response(wrapped)
        # The digits/word survive as text; no bare JSON value replaced them.
        assert '"text"' in out, f"{wrong!r} case lost its text block"


def test_unwrap_survives_a_pathologically_nested_json_string():
    """The unwrap's own RecursionError arm, which `json.loads` is what raises.

    Distinct from the `json.dumps` arm below: this one goes through the PARSE
    path, so a test that only nests a Python object never reaches it.
    """
    inner = "[" * 20_000 + "]" * 20_000
    wrapped = [{"type": "text", "text": inner}]
    assert len(json.dumps(wrapped)) > 500

    out = _summarize_tool_response(wrapped)  # must not raise
    assert isinstance(out, str)
    assert out


def test_summarize_tool_response_survives_pathological_nesting():
    """RecursionError must not escape and abort a run.

    Note the fallback cannot be `repr()`: repr recurses too, so on this input it
    raises identically and the guard becomes a no-op. That was the first version.
    """
    deep: list = []
    node: list = deep
    for _ in range(20_000):
        child: list = []
        node.append(child)
        node = child

    out = _summarize_tool_response(deep)  # must not raise
    assert isinstance(out, str)
    assert out


def test_summarize_tool_response_never_emits_a_shorter_capture():
    """The invariant that makes this change safe to land.

    A key-preserving summary can be SHORTER than a 500-char head cut on a long
    list of small items, which is how the first cut of this change silently
    narrowed 91 of 284 real tool results. Whatever the summarizer decides, the
    output is never shorter than head-truncating would have produced.

    Note precisely what this is: a **length** floor, not a content guarantee. A
    payload can clear it on one wide key while a sampled list drops entries the
    old head cut happened to include. Measured across all 1544 tool results in the
    six committed jimmie-jewel-neal runs, zero do — but the property asserted here
    is the length one, and the docstring says so rather than implying more.
    """
    shapes = [
        # long list of small items — samples to 3, so the summary is short
        {"ok": True, "results": [{"entryId": f"pe_{i:03d}"} for i in range(40)]},
        # long flat list of scalars
        list(range(500)),
        # one long string
        "x" * 5000,
        # many short keys
        {f"k{i}": f"v{i}" for i in range(200)},
        # nested
        {"a": {"b": {"c": [{"d": "e" * 50} for _ in range(30)]}}},
    ]
    for shape in shapes:
        raw = shape if isinstance(shape, str) else json.dumps(shape)
        head = raw if len(raw) <= 500 else raw[:497] + "..."
        out = _summarize_tool_response(shape)
        assert len(out) >= len(head), (
            f"regressed on {type(shape).__name__}: {len(out)} < {len(head)}"
        )


def test_summarize_tool_response_keeps_a_short_response_verbatim():
    """Anything the old bound captured whole is still captured whole."""
    shape = {"ok": True, "results": [{"entryId": f"pe_{i:03d}"} for i in range(8)]}
    raw = json.dumps(shape)
    assert len(raw) <= 500, "fixture must sit under the verbatim threshold"
    assert _summarize_tool_response(shape) == raw
    # No sampling marker, because nothing was sampled.
    assert "_summary_truncated" not in _summarize_tool_response(shape)


def test_summarize_tool_response_honours_the_overall_cap():
    """The 4000-char backstop, which 11 of 1544 real tool results reach.

    Untested until now, which is how a "backstop" quietly becomes decorative. The
    shape is a dict of many wide keys: `_summarize_response` preserves every key
    (that is the point), so key COUNT is the one axis the per-string bound and the
    list sampling do not constrain.

    Asserted against the CONSTANT, not the literal 4000. With the literal, the
    module comment's "`_RUNLOG_MAX_CHARS` must stay ABOVE `_RUNLOG_VERBATIM_MAX`"
    was documented and unenforced: drop the cap to 300 and the never-shorter floor
    hands back a 500-char head cut, which satisfies `len(out) <= 4000` and ends in
    "..." — green test, defeated cap. Against the constant it fails.
    """
    assert _RUNLOG_MAX_CHARS > _RUNLOG_VERBATIM_MAX, (
        "the never-shorter floor silently defeats the cap when they invert"
    )
    shape = {f"key_{i:04d}": "v" * 120 for i in range(200)}
    out = _summarize_tool_response(shape)
    assert len(out) <= _RUNLOG_MAX_CHARS
    assert out.endswith("...")


# --- timeline tool labeling ---------------------------------------------------
# Regression cover for the per-skill wall-clock gap: usage.timeline carried
# elapsed time + message kind but no tool identity, so a Skill-phase
# breakdown could only be reconstructed from the raw session.jsonl (gitignored,
# not reliably present for other contributors' PRs). _timeline_tool_label is
# what timeline.append now calls to tag each entry.


def test_timeline_tool_label_skill_call_names_the_skill():
    assert _timeline_tool_label("Skill", {"skill": "person-evidence"}) == "Skill:person-evidence"


def test_timeline_tool_label_skill_call_missing_skill_arg():
    assert _timeline_tool_label("Skill", {}) == "Skill:?"
    assert _timeline_tool_label("Skill", None) == "Skill:?"


def test_timeline_tool_label_mcp_tool_strips_prefix():
    assert _timeline_tool_label("mcp__genealogy__record_search", {}) == "record_search"


def test_timeline_tool_label_non_mcp_tool_passthrough():
    assert _timeline_tool_label("Read", {"file_path": "x"}) == "Read"


# --- streamed-usage fallback -------------------------------------------------
# Regression cover for the timeout blind spot: every `timeout` run in the
# corpus landed with no turns, duration or tokens because the SDK's
# ResultMessage never arrived. See _fallback_usage.


def test_accumulate_usage_sums_distinct_messages():
    acc: dict = {}
    _accumulate_usage(acc, _FakeAssistantMessage("msg_a", {
        "input_tokens": 3,
        "output_tokens": 274,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 21404,
    }))
    _accumulate_usage(acc, _FakeAssistantMessage("msg_b", {
        "input_tokens": 1,
        "output_tokens": 110,
        "cache_read_input_tokens": 21404,
        "cache_creation_input_tokens": 320,
    }))
    usage = _fallback_usage(acc, 1000)
    assert usage["assistant_messages"] == 2
    assert usage["usage"]["output_tokens"] == 384
    assert usage["usage"]["cache_creation_input_tokens"] == 21724


def test_accumulate_usage_deduplicates_repeated_message_id():
    """The regression that made the first cut of this fallback wrong: the SDK
    re-emits one assistant message per content block, each copy carrying the
    same cumulative usage. Summing on arrival multiplied the totals ~3x."""
    acc: dict = {}
    for _ in range(4):
        _accumulate_usage(acc, _FakeAssistantMessage("msg_same", {"output_tokens": 376}))
    usage = _fallback_usage(acc, 1000)
    assert usage["assistant_messages"] == 1
    assert usage["usage"]["output_tokens"] == 376


def test_accumulate_usage_keeps_anonymous_messages_distinct():
    acc: dict = {}
    _accumulate_usage(acc, _FakeAssistantMessage(None, {"output_tokens": 5}))
    _accumulate_usage(acc, _FakeAssistantMessage(None, {"output_tokens": 7}))
    usage = _fallback_usage(acc, 1000)
    assert usage["assistant_messages"] == 2
    assert usage["usage"]["output_tokens"] == 12


def test_accumulate_usage_tolerates_missing_and_malformed_usage():
    acc: dict = {}
    _accumulate_usage(acc, _FakeAssistantMessage("msg_a", None))
    _accumulate_usage(
        acc, _FakeAssistantMessage("msg_b", {"output_tokens": None, "input_tokens": "lots"})
    )
    usage = _fallback_usage(acc, 1000)
    assert usage["assistant_messages"] == 2
    assert usage["usage"]["output_tokens"] == 0
    assert usage["usage"]["input_tokens"] == 0


def test_fallback_usage_reports_duration_and_message_count():
    acc: dict = {}
    for i in range(42):
        _accumulate_usage(acc, _FakeAssistantMessage(f"msg_{i}", {"output_tokens": 100}))
    usage = _fallback_usage(acc, 900_000)
    assert usage["duration_ms"] == 900_000
    assert usage["assistant_messages"] == 42
    assert usage["usage"]["output_tokens"] == 4200
    assert usage["is_error"] is True


def test_fallback_usage_nulls_the_fields_it_cannot_honestly_reconstruct():
    """Cost spans several models; num_turns has different semantics from the
    assistant-message count and feeds latency_report's tokens-per-turn. Both
    stay null rather than shipping a plausible-but-wrong number."""
    usage = _fallback_usage({}, 1000)
    assert usage["total_cost_usd"] is None
    assert usage["num_turns"] is None
    assert usage["duration_api_ms"] is None


# --- check_guardrail_compliance (issue #972) --------------------------------


def test_check_guardrail_compliance_is_empty_for_a_clean_run():
    assert check_guardrail_compliance([], {}, {}, starting_tree={"persons": []}) == []


def test_check_guardrail_compliance_aggregates_all_three_checks():
    """One call, three non-windowed §4.4 arms. The `mentor` arm below reads
    only research.json, which is why compliance is a real result even on a
    run that produced no tree."""
    research = {
        "questions": [{"id": "q1", "status": "resolved"}],
        "proof_summaries": [{"id": "ps1", "question_id": "q1"}],
        "exhaustive_declaration": {"declared": True},
    }
    violations = check_guardrail_compliance([], research, None)
    # The gps-mentor arm reads only research.json...
    assert any("proof-critique" in v for v in violations)
    # ...and the proof-conclusion arm fires from the same call.
    assert any("proof-conclusion" in v for v in violations)


# --- load_seed_person_ids (issue #963 seed read; fail-open) ------------------


def test_load_seed_person_ids_reads_person_ids(tmp_path: Path):
    """A person entry with no usable string `id` is DROPPED, not admitted as
    None — the ids this set is compared against are always strings, so a None
    member could never match and would only make the `set[str]` annotation
    false."""
    p = tmp_path / "starting-tree.gedcomx.json"
    p.write_text(
        json.dumps(
            {"persons": [{"id": "A1"}, {"id": "B2"}, {"not_a_dict": True}, {"id": 7}]}
        ),
        encoding="utf-8",
    )
    assert load_seed_person_ids(p) == {"A1", "B2"}


def test_load_seed_person_ids_missing_file_fails_open_with_warning(tmp_path: Path, capsys):
    """A read failure returns None (the check fails open) and prints a
    diagnosable stderr warning — not an empty set (which would log a shadow
    entry for every legitimate seed-person link) and not a crash."""
    missing = tmp_path / "does-not-exist.json"
    assert load_seed_person_ids(missing) is None
    err = capsys.readouterr().err
    assert "could not read seed tree" in err
    assert "same_person check DISABLED" in err


def test_load_seed_person_ids_malformed_json_fails_open(tmp_path: Path, capsys):
    p = tmp_path / "starting-tree.gedcomx.json"
    p.write_text("{ not valid json", encoding="utf-8")
    assert load_seed_person_ids(p) is None
    assert "could not read seed tree" in capsys.readouterr().err


def test_load_fixture_points_seed_read_at_the_immutable_fixture_file(tmp_path: Path):
    """The path load_fixture wires in is the committed fixture input, so
    load_seed_person_ids reads the run's true starting state — never the
    workspace copy the run later mutates."""
    fixture_dir = _make_fixture_dir(tmp_path)
    fixture = load_fixture(fixture_dir)
    assert fixture.starting_tree_path == fixture_dir / "starting-tree.gedcomx.json"
    assert fixture.starting_tree_path.exists()


# --- person_evidence_provenance_gap (issue #963 shadow-mode check) -----------


def _pe_append(person_id):
    return {"section": "person_evidence", "op": "append", "entry": {"person_id": person_id}}


def _same_person(pid1, pid2):
    return {"tool": "mcp__genealogy__same_person", "args": {"primaryId1": pid1, "primaryId2": pid2}}


def test_provenance_gap_flags_new_unscored_person():
    gap = person_evidence_provenance_gap(
        "mcp__genealogy__research_append",
        _pe_append("I1"),
        tool_calls=[],
        starting_person_ids=set(),
    )
    assert gap is not None
    assert "I1" in gap
    assert "same_person" in gap


def test_provenance_gap_clean_when_same_person_already_in_tool_calls():
    """The only state that clears the check: a same_person for this identity is
    already visible in `tool_calls`. There is deliberately no pending/in-flight
    escape hatch — the AssistantMessage branch appends one entry object to
    `tool_calls` AND stores it in `pending_tool_uses`, so the latter is always a
    subset and consulting it could never add an id."""
    gap = person_evidence_provenance_gap(
        "mcp__genealogy__research_append",
        _pe_append("I1"),
        tool_calls=[_same_person("I1", "p_9")],
        starting_person_ids=set(),
    )
    assert gap is None


def test_provenance_gap_ignores_errored_same_person():
    """#1255/#1289 made the orchestrator populate `is_error`, so a FAILED
    same_person no longer counts as scoring the identity."""
    errored = _same_person("I1", "p_9") | {"is_error": True}
    gap = person_evidence_provenance_gap(
        "mcp__genealogy__research_append",
        _pe_append("I1"),
        tool_calls=[errored],
        starting_person_ids=set(),
    )
    assert gap is not None
    assert "I1" in gap


def test_provenance_gap_clean_for_seed_person_link():
    gap = person_evidence_provenance_gap(
        "mcp__genealogy__research_append",
        _pe_append("KN19-Q19"),
        tool_calls=[],
        starting_person_ids={"KN19-Q19"},  # pre-existing seed person
    )
    assert gap is None


def test_provenance_gap_none_for_non_research_append():
    gap = person_evidence_provenance_gap(
        "mcp__genealogy__materialize_facts",
        _pe_append("I1"),
        tool_calls=[],
        starting_person_ids=set(),
    )
    assert gap is None


def test_provenance_gap_caps_id_list_with_plus_more():
    """A large batch can't produce an enormous recorded detail string."""
    ops = {"ops": [_pe_append(f"I{i}") for i in range(15)]}
    reason = person_evidence_provenance_gap(
        "mcp__genealogy__research_append",
        ops,
        tool_calls=[],
        starting_person_ids=set(),
    )
    assert reason is not None
    assert "+5 more" in reason  # 15 new ids, first 10 shown
    assert "I14" not in reason  # the tail is elided, not listed


def test_provenance_gap_reason_names_the_satisfiable_call_shape():
    """Issue #1231 prereq 2. The pre-#1231 text said the identity "should be
    scored before it is asserted", which the agent believes it did — 100 of 103
    corpus runs that link a new person would have been denied by a reason they
    could not act on. The cause is an id mismatch: `tree_edit` mints local ids
    (`I1`) and rejects caller-supplied ones, while `same_person` scores
    `primaryId1`/`primaryId2` inside the caller's own gedcomx documents. So the
    reason has to name the one call shape that satisfies the gate, and — because
    a PreToolUse deny is all-or-nothing on a batch whose median is 17 ops — say
    that the whole batch was rejected."""
    reason = person_evidence_provenance_gap(
        "mcp__genealogy__research_append",
        _pe_append("I1"),
        tool_calls=[],
        starting_person_ids=set(),
    )
    assert reason is not None
    # the satisfiable shape, named explicitly
    assert "gedcomx2" in reason
    assert "primaryId2" in reason
    # the whole batch is lost, not just the flagged op
    assert "entire batch" in reason
    # the documented escape when no score is obtainable at all
    assert "rationale" in reason


def test_provenance_gap_reason_offers_no_escape_for_a_locally_minted_id():
    """The reason must NOT tell the agent a locally-minted id is unscorable.

    person-evidence/SKILL.md says such an id returns a degenerate score to treat
    as "no score available" (2026-07-02). That is stale: the match-engine
    mint-hardening (2026-07-07) made an ARK-less focus person score on document
    content. Probed live — dev/probe-same-person-local-id.ts — the tree focus
    with its ARK removed scores 0.9999484 against a 0.999967 control, identical
    across two runs despite a fresh random mint each call.

    So an escape for that case would hand the agent a documented reason to skip
    the one call this gate exists to require. The only escape offered is the real
    one: no record persona to compare against."""
    reason = person_evidence_provenance_gap(
        "mcp__genealogy__research_append",
        _pe_append("I1"),
        tool_calls=[],
        starting_person_ids=set(),
    )
    assert reason is not None
    assert "degenerate" not in reason.lower()
    assert "unresolvable stub" not in reason.lower()
    # the surviving escape is still stated
    assert "record_persona_id" in reason


# --- person_evidence_deny_decision (issue #1231 prereq 3: deny + loop valve) --


def _deny_state():
    """Fresh per-run valve state, in the hook's own mutable-counter idiom."""
    return {}, {"n": 0}


def test_deny_decision_is_inert_in_shadow_mode():
    """The default. Nothing is denied and neither counter moves, so a shadow run
    behaves exactly as it did before #1231."""
    repeat_counts, denied_total = _deny_state()
    outcome, payload = person_evidence_deny_decision(
        "reason text",
        {"I1"},
        mode="shadow",
        repeat_counts=repeat_counts,
        denied_total=denied_total,
    )
    assert outcome == "shadow"
    assert payload is None
    assert repeat_counts == {}
    assert denied_total["n"] == 0


def test_deny_decision_denies_in_deny_mode_carrying_the_reason():
    repeat_counts, denied_total = _deny_state()
    outcome, payload = person_evidence_deny_decision(
        "score I1 first",
        {"I1"},
        mode="deny",
        repeat_counts=repeat_counts,
        denied_total=denied_total,
    )
    assert outcome == "denied"
    hook_out = payload["hookSpecificOutput"]
    assert hook_out["hookEventName"] == "PreToolUse"
    assert hook_out["permissionDecision"] == "deny"
    assert "score I1 first" in hook_out["permissionDecisionReason"]
    assert denied_total["n"] == 1


def test_deny_decision_releases_after_the_per_key_limit():
    """The valve. A denied research_append costs no budget (the deny returns
    above `tool_call_count`), and `activity_count` increments unconditionally so
    the no-progress watchdog reads a deny loop as progress — so without this the
    only stop is max_turns / the 2h wall clock, which is the failure mode prereq
    3 exists to prevent. Releasing hands termination back to the tool_calls cap."""
    repeat_counts, denied_total = _deny_state()
    outcomes = [
        person_evidence_deny_decision(
            "r", {"I1"}, mode="deny", repeat_counts=repeat_counts, denied_total=denied_total
        )[0]
        for _ in range(PERSON_EVIDENCE_DENY_REPEAT_LIMIT + 1)
    ]
    assert outcomes[:-1] == ["denied"] * PERSON_EVIDENCE_DENY_REPEAT_LIMIT
    assert outcomes[-1] == "released"


def test_deny_decision_per_key_limit_is_per_id_set():
    """A different id set gets its own budget — otherwise one wedged person
    would suppress a genuine gate on an unrelated one."""
    repeat_counts, denied_total = _deny_state()
    for _ in range(PERSON_EVIDENCE_DENY_REPEAT_LIMIT + 1):
        person_evidence_deny_decision(
            "r", {"I1"}, mode="deny", repeat_counts=repeat_counts, denied_total=denied_total
        )
    outcome, _ = person_evidence_deny_decision(
        "r", {"I2"}, mode="deny", repeat_counts=repeat_counts, denied_total=denied_total
    )
    assert outcome == "denied"


def test_deny_decision_releases_at_the_run_total_limit():
    """The per-key counter alone is unbounded: a batch differing by one op, or a
    freshly minted I2/I3, mints a new key and buys another full per-key budget.
    The run-global cap is what actually bounds the free denials."""
    repeat_counts, denied_total = _deny_state()
    outcomes = [
        person_evidence_deny_decision(
            "r", {f"I{i}"}, mode="deny", repeat_counts=repeat_counts, denied_total=denied_total
        )[0]
        for i in range(PERSON_EVIDENCE_DENY_TOTAL_LIMIT + 1)
    ]
    assert outcomes.count("denied") == PERSON_EVIDENCE_DENY_TOTAL_LIMIT
    assert outcomes[-1] == "released"


def test_deny_decision_treats_an_unknown_mode_as_shadow():
    """A hook must never raise — an exception here fails a tool call the agent
    was entitled to make (CLAUDE.md, "Plugin hooks"). Fail open."""
    repeat_counts, denied_total = _deny_state()
    outcome, payload = person_evidence_deny_decision(
        "r", {"I1"}, mode="typo", repeat_counts=repeat_counts, denied_total=denied_total
    )
    assert outcome == "shadow"
    assert payload is None


# --- apply_tool_result (the #999 producer fix) -------------------------------
# Before #999 the orchestrator set only `response_summary` on a `tool_calls`
# entry and never `is_error`, so skill_invocation.py's
# `entry.get("is_error") is True` gates were dead. These assert the producer now
# populates `is_error` — a gap the consumer tests in test_skill_invocation.py
# can't catch, because they fabricate `is_error` on the entry themselves.


def test_apply_tool_result_marks_a_failed_call():
    entry = {"tool": "Skill", "args": {"skill": "proof-conclusion"}, "response_summary": None}
    block = ToolResultBlock(tool_use_id="tu_1", content="boom", is_error=True)
    apply_tool_result(entry, block, "boom")
    assert entry["is_error"] is True
    assert entry["response_summary"] == "boom"


def test_apply_tool_result_normalizes_none_success_to_false():
    # A successful call: the SDK omits is_error, so it defaults to None (not
    # False). The gates match on `is True` and the field must be a clean bool,
    # so the producer normalizes None -> False.
    entry = {"tool": "Skill", "args": {"skill": "proof-conclusion"}, "response_summary": None}
    block = ToolResultBlock(tool_use_id="tu_1", content="ok")  # is_error defaults to None
    apply_tool_result(entry, block, "ok")
    assert entry["is_error"] is False


def test_apply_tool_result_false_stays_false():
    entry = {"tool": "mcp__genealogy__research_append", "args": {}, "response_summary": None}
    block = ToolResultBlock(tool_use_id="tu_1", content="ok", is_error=False)
    apply_tool_result(entry, block, "ok")
    assert entry["is_error"] is False
# --- #941: the mcp_unavailable abort contract -------------------------
#
# `_run_agent`'s detectors are not reachable from a unit test (see this file's
# module docstring — that path needs a live SDK), which is why the decision
# logic lives in pure functions in e2e.mcp_health and is tested in
# test_e2e_mcp_health.py. What IS testable here is the contract between the
# orchestrator and run_e2e: the exception type they agree on.


def test_mcp_unavailable_error_is_exported_and_is_a_runtime_error():
    from e2e.orchestrator import McpUnavailableError

    assert issubclass(McpUnavailableError, RuntimeError)


def test_run_e2e_imports_the_same_exception_class():
    """run_e2e's handler must catch the class the orchestrator raises — if these
    ever diverge, an environment failure would fall through to the generic
    handler and be reported as a harness ERROR."""
    from e2e.orchestrator import McpUnavailableError
    from e2e.run_e2e import McpUnavailableError as ImportedByRunner

    assert ImportedByRunner is McpUnavailableError


def test_mcp_unavailable_error_carries_the_operator_message():
    """run_e2e prints the exception verbatim, so the guidance must live in it."""
    from e2e.mcp_health import unavailable_message
    from e2e.orchestrator import McpUnavailableError

    text = str(McpUnavailableError(unavailable_message(None)))
    assert "RE-RUN" in text
    assert "re-research" in text
