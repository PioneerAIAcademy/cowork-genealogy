"""Unit tests for e2e.scratch — throwaway /research workspace setup."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import e2e.scratch as scratch_mod
from e2e.scratch import main, setup_scratch


def _make_fixture(fixtures_root, slug):
    d = fixtures_root / slug
    d.mkdir(parents=True)
    (d / "fixture.json").write_text(
        json.dumps({"id": slug, "researcher_question": "When did X die?"}),
        encoding="utf-8",
    )
    (d / "starting-research.json").write_text(
        json.dumps({"project": {"objective": "When did X die?"}}), encoding="utf-8"
    )
    (d / "starting-tree.gedcomx.json").write_text(
        json.dumps({"persons": []}), encoding="utf-8"
    )
    (d / "expected-findings.json").write_text(
        json.dumps({"findings": []}), encoding="utf-8"
    )


def _make_skills(skills_dir):
    s = skills_dir / "research"
    s.mkdir(parents=True)
    (s / "SKILL.md").write_text("# research\n", encoding="utf-8")


def test_setup_seeds_state_and_skills(tmp_path):
    fixtures = tmp_path / "fixtures"
    skills = tmp_path / "skills"
    scratch = tmp_path / "scratch"
    server = tmp_path / "build" / "index.js"
    server.parent.mkdir(parents=True)
    server.write_text("// built server", encoding="utf-8")
    _make_fixture(fixtures, "x-died")
    _make_skills(skills)

    target, question = setup_scratch(
        slug="x-died",
        scratch_dir=scratch,
        fixtures_root=fixtures,
        skills_dir=skills,
        mcp_server_entry=server,
    )

    assert question == "When did X die?"
    # Starting state copied to the live filenames the agent reads
    assert (target / "research.json").exists()
    assert (target / "tree.gedcomx.json").exists()
    # Skills copied into .claude/skills/ (copied, not symlinked)
    research_skill = target / ".claude" / "skills" / "research" / "SKILL.md"
    assert research_skill.exists()
    assert not research_skill.is_symlink()


def test_setup_writes_mcp_config_with_absolute_server_path(tmp_path):
    """The scratch session must have ALL the genealogy MCP tools — that
    means a .mcp.json wiring the built server by absolute path (the dir is
    outside the repo, so a relative path wouldn't resolve)."""
    fixtures = tmp_path / "fixtures"
    skills = tmp_path / "skills"
    scratch = tmp_path / "scratch"
    server = tmp_path / "build" / "index.js"
    server.parent.mkdir(parents=True)
    server.write_text("// built server", encoding="utf-8")
    _make_fixture(fixtures, "x-died")
    _make_skills(skills)

    target, _ = setup_scratch(
        slug="x-died", scratch_dir=scratch, fixtures_root=fixtures,
        skills_dir=skills, mcp_server_entry=server,
    )

    cfg = json.loads((target / ".mcp.json").read_text(encoding="utf-8"))
    genealogy = cfg["mcpServers"]["genealogy"]
    assert genealogy["type"] == "stdio"
    assert genealogy["command"] == "node"
    arg = genealogy["args"][0]
    assert Path(arg).is_absolute()
    assert arg == str(server.resolve())


def test_missing_fixture_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        setup_scratch(
            slug="nope",
            scratch_dir=tmp_path / "scratch",
            fixtures_root=tmp_path / "fixtures",
            skills_dir=tmp_path / "skills",
        )


def test_rerun_refreshes_existing_dir(tmp_path):
    """A scratch dir is throwaway — re-running just refreshes it (no flag)."""
    fixtures = tmp_path / "fixtures"
    skills = tmp_path / "skills"
    scratch = tmp_path / "scratch"
    _make_fixture(fixtures, "x-died")
    _make_skills(skills)
    setup_scratch(slug="x-died", scratch_dir=scratch, fixtures_root=fixtures, skills_dir=skills)
    # Drop a stray file; the refresh should wipe it.
    stray = scratch / "x-died" / "stray.txt"
    stray.write_text("x", encoding="utf-8")
    setup_scratch(slug="x-died", scratch_dir=scratch, fixtures_root=fixtures, skills_dir=skills)
    assert not stray.exists()


def _full_setup(tmp_path):
    """A complete fixture + skills + built-server layout for main() tests."""
    fixtures = tmp_path / "fixtures"
    skills = tmp_path / "skills"
    server = tmp_path / "build" / "index.js"
    server.parent.mkdir(parents=True)
    server.write_text("// built", encoding="utf-8")
    _make_fixture(fixtures, "x-died")
    _make_skills(skills)
    return fixtures, skills, server


def test_launch_chdirs_and_execs_claude(tmp_path, monkeypatch):
    fixtures, skills, server = _full_setup(tmp_path)
    scratch = tmp_path / "scratch"
    calls = {}
    monkeypatch.setattr(scratch_mod.shutil, "which", lambda _: "/usr/bin/claude")
    monkeypatch.setattr(scratch_mod.os, "chdir", lambda p: calls.setdefault("chdir", p))

    def _fake_exec(path, argv):
        calls["exec"] = (path, argv)
        raise SystemExit(0)  # execvp would replace the process; simulate that

    monkeypatch.setattr(scratch_mod.os, "execvp", _fake_exec)

    with pytest.raises(SystemExit):
        main([
            "--test", "x-died", "--dir", str(scratch),
            "--fixtures-root", str(fixtures), "--skills-dir", str(skills),
            "--mcp-server-entry", str(server), "--launch",
        ])

    assert str(calls["chdir"]).endswith("scratch/x-died")
    assert calls["exec"] == ("/usr/bin/claude", ["/usr/bin/claude"])


def test_launch_without_claude_on_path_errors(tmp_path, monkeypatch, capsys):
    fixtures, skills, server = _full_setup(tmp_path)
    scratch = tmp_path / "scratch"
    monkeypatch.setattr(scratch_mod.shutil, "which", lambda _: None)
    rc = main([
        "--test", "x-died", "--dir", str(scratch),
        "--fixtures-root", str(fixtures), "--skills-dir", str(skills),
        "--mcp-server-entry", str(server), "--launch",
    ])
    assert rc == 2
    assert "not on PATH" in capsys.readouterr().err


def test_no_launch_prints_cd_and_returns_zero(tmp_path, capsys):
    fixtures, skills, server = _full_setup(tmp_path)
    scratch = tmp_path / "scratch"
    rc = main([
        "--test", "x-died", "--dir", str(scratch),
        "--fixtures-root", str(fixtures), "--skills-dir", str(skills),
        "--mcp-server-entry", str(server),
    ])
    assert rc == 0
    out = capsys.readouterr().out
    assert "cd " in out and "claude" in out
