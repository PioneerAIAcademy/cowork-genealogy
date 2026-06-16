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
    _render_user_message,
    _summarize_tool_response,
    build_workspace,
    load_fixture,
    provided_documents,
)


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


def test_tier_defaults_to_smoke_in_tags(tmp_path: Path):
    """A fixture that doesn't declare a tier is `smoke` — it hasn't earned
    `benchmark`. The tier rides in tags so the roll-up groups by it."""
    fixture_dir = _make_fixture_dir(tmp_path)  # helper writes no tier
    fixture = load_fixture(fixture_dir)
    assert fixture.tags["tier"] == "smoke"


def test_explicit_benchmark_tier_is_read(tmp_path: Path):
    fixture_dir = _make_fixture_dir(tmp_path)
    data = json.loads((fixture_dir / "fixture.json").read_text())
    data["tier"] = "benchmark"
    (fixture_dir / "fixture.json").write_text(json.dumps(data))
    fixture = load_fixture(fixture_dir)
    assert fixture.tags["tier"] == "benchmark"


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

    parsed = json.loads((workspace / "research.json").read_text())
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
