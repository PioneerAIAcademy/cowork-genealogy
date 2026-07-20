"""Unit tests for e2e.orchestrator — fixture loading, workspace assembly.

The async _run_agent function spawns the SDK + real MCP server; that
path is covered by an e2e suite run, not these unit tests.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from e2e.orchestrator import (
    PROVIDED_DOCS_DIRNAME,
    FixtureCaps,
    _accumulate_usage,
    _fallback_usage,
    _render_user_message,
    _summarize_tool_response,
    build_workspace,
    load_fixture,
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
    (fixture_dir / "fixture.json").write_text(json.dumps(fixture_json))
    (fixture_dir / "starting-research.json").write_text(
        json.dumps({"project": {"objective": "Find John's parents"}})
    )
    (fixture_dir / "starting-tree.gedcomx.json").write_text(json.dumps({"persons": []}))
    (fixture_dir / "expected-findings.json").write_text(
        json.dumps({"findings": [{"id": "f1", "description": "...", "required": True}]})
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
    (skills_dir / "fake-skill" / "SKILL.md").write_text("---\nname: fake\n---\nbody")

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
    assert len(out) <= 500
    assert out.endswith("...")


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
