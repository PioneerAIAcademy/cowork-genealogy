"""Tests for harness.workspace — per-test temp dirs and file snapshots."""

import json
from pathlib import Path

import pytest

from harness.workspace import (
    InvalidScenarioError,
    build_workspace,
    snapshot_files,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
PLUGIN_SKILLS = REPO_ROOT / "packages/engine/plugin/skills"
SCENARIOS = REPO_ROOT / "eval/fixtures/scenarios"


def test_stateless_workspace_has_no_research_json(tmp_path):
    ws = build_workspace(
        scenario_name=None,
        scenarios_dir=SCENARIOS,
        skills_dir=PLUGIN_SKILLS,
        target_dir=tmp_path,
    )
    assert ws == tmp_path
    assert not (ws / "research.json").exists()
    assert not (ws / "tree.gedcomx.json").exists()
    # Skills always copied
    assert (ws / ".claude/skills/search-wikipedia/SKILL.md").exists()


def test_scenario_workspace_copies_files(tmp_path):
    ws = build_workspace(
        scenario_name="mid-research-flynn",
        scenarios_dir=SCENARIOS,
        skills_dir=PLUGIN_SKILLS,
        target_dir=tmp_path,
    )
    assert (ws / "research.json").exists()
    assert (ws / "tree.gedcomx.json").exists()
    # All skills present
    assert (ws / ".claude/skills/conflict-resolution/SKILL.md").exists()


def test_scenario_workspace_copies_results_sidecars(tmp_path):
    """A scenario's results/ subtree (search-result sidecars) must reach
    the workspace so skills under test can resolve log_entry.results_ref."""
    scenarios = tmp_path / "scenarios"
    scen = scenarios / "with-sidecars"
    (scen / "results").mkdir(parents=True)
    (scen / "research.json").write_text(json.dumps({"log": []}))
    (scen / "tree.gedcomx.json").write_text(json.dumps({"persons": []}))
    (scen / "results" / "log_001.json").write_text(
        json.dumps({"log_id": "log_001", "payload": {"results": []}}))
    target = tmp_path / "ws"
    target.mkdir()
    ws = build_workspace(
        scenario_name="with-sidecars",
        scenarios_dir=scenarios,
        skills_dir=PLUGIN_SKILLS,
        target_dir=target,
    )
    sidecar = ws / "results" / "log_001.json"
    assert sidecar.exists()
    assert json.loads(sidecar.read_text(encoding="utf-8"))["log_id"] == "log_001"


def test_missing_scenario_raises(tmp_path):
    with pytest.raises(InvalidScenarioError):
        build_workspace(
            scenario_name="does-not-exist",
            scenarios_dir=SCENARIOS,
            skills_dir=PLUGIN_SKILLS,
            target_dir=tmp_path,
        )


def test_snapshot_captures_json_files(tmp_path):
    (tmp_path / "research.json").write_text(json.dumps({"x": 1}))
    (tmp_path / "tree.gedcomx.json").write_text(json.dumps({"persons": []}))
    (tmp_path / "other.txt").write_text("hello")

    snap = snapshot_files(tmp_path)
    assert snap["research_json"] == {"x": 1}
    assert snap["tree_gedcomx_json"] == {"persons": []}
    # other files captured as raw
    assert "other.txt" in snap["files"]
    assert snap["files"]["other.txt"] == "hello"


def test_snapshot_returns_none_for_missing_json(tmp_path):
    snap = snapshot_files(tmp_path)
    assert snap["research_json"] is None
    assert snap["tree_gedcomx_json"] is None
    assert snap["files"] == {}


def test_snapshot_ignores_dot_claude_directory(tmp_path):
    (tmp_path / ".claude").mkdir()
    (tmp_path / ".claude" / "skills").mkdir()
    (tmp_path / ".claude" / "skills" / "foo.md").write_text("skill content")
    (tmp_path / "notes.md").write_text("notes content")

    snap = snapshot_files(tmp_path)
    # .claude/ is the harness's own scaffolding — must not pollute the diff
    assert all(not p.startswith(".claude") for p in snap["files"])
    assert snap["files"]["notes.md"] == "notes content"


def test_snapshot_handles_subdirectories(tmp_path):
    nested = tmp_path / "subdir"
    nested.mkdir()
    (nested / "file.md").write_text("nested content")
    snap = snapshot_files(tmp_path)
    assert snap["files"]["subdir/file.md"] == "nested content"


def test_cleanup_session_store_removes_matching_entry(tmp_path, monkeypatch):
    from harness import workspace as ws

    fake_session_root = tmp_path / "sessions"
    fake_session_root.mkdir()
    monkeypatch.setattr(ws, "_SESSION_STORE_ROOT", fake_session_root)

    # Drop a stub session entry that matches the SDK's key for our workspace.
    from claude_agent_sdk import project_key_for_directory
    workspace = tmp_path / "ws"
    workspace.mkdir()
    key = project_key_for_directory(str(workspace))
    target = fake_session_root / key
    target.mkdir()
    (target / "session.json").write_text("{}")

    ws.cleanup_session_store(workspace)
    assert not target.exists()


def test_cleanup_session_store_noop_when_missing(tmp_path, monkeypatch):
    from harness import workspace as ws
    fake_session_root = tmp_path / "sessions"
    fake_session_root.mkdir()
    monkeypatch.setattr(ws, "_SESSION_STORE_ROOT", fake_session_root)
    # No matching entry — must not raise.
    ws.cleanup_session_store(tmp_path / "nonexistent")


def test_workspace_isolated_per_call(tmp_path):
    ws1 = tmp_path / "a"
    ws2 = tmp_path / "b"
    ws1.mkdir()
    ws2.mkdir()
    build_workspace(None, SCENARIOS, PLUGIN_SKILLS, target_dir=ws1)
    build_workspace(None, SCENARIOS, PLUGIN_SKILLS, target_dir=ws2)
    # Both have skills, neither has the other's state.
    assert (ws1 / ".claude/skills/search-wikipedia").exists()
    assert (ws2 / ".claude/skills/search-wikipedia").exists()
    (ws1 / "marker.txt").write_text("a")
    assert not (ws2 / "marker.txt").exists()
