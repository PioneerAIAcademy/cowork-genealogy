"""Unit tests for scripts/check_runlogs.py — rule 3 robustness.

Focus: a hand-written / stale-tool annotation that omits the required
correction keys (notably the deprecated run_index/dimension/source shape)
must produce a clean, blocking error — not an opaque KeyError crash.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "check_runlogs",
    Path(__file__).resolve().parents[2] / "scripts" / "check_runlogs.py",
)
check_runlogs = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check_runlogs)


def _log_with_one_dimension() -> dict:
    """A minimal run-log dict with a single (test, dimension) to review."""
    return {
        "tests": [
            {
                "test_id": "ut_x_001",
                "outcome_summary": {
                    "aggregated_dimensions": [
                        {"source": "base", "name": "Correctness"},
                    ]
                },
            }
        ]
    }


def _write_ann(skill_dir: Path, runlog_filename: str, corrections: list[dict]) -> str:
    """Write a .ann.json sibling for the given run-log filename; return the
    run-log filename rule3_completeness expects."""
    ann_name = runlog_filename.removesuffix(".json") + ".ann.json"
    (skill_dir / ann_name).write_text(
        json.dumps({"run_log": runlog_filename, "annotator": "t", "corrections": corrections}),
        encoding="utf-8",
    )
    return runlog_filename


def test_rule3_deprecated_shape_fails_cleanly(tmp_path, capsys):
    """The legacy run_index/dimension/source shape (no dimension_source) must
    block with a reviewable message instead of raising KeyError."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    fn = _write_ann(
        skill_dir,
        "v1_2026-06-24_00-00-00.json",
        corrections=[
            # deprecated per-run shape — what Claude emits if asked to hand-write
            {
                "test_id": "ut_x_001",
                "run_index": 0,
                "dimension": "Correctness",
                "source": "base",
                "llm_score": 3,
                "corrected_score": 3,
            }
        ],
    )
    # Must not raise; must return a failure (1) and emit an actionable error.
    rc = check_runlogs.rule3_completeness("init-project", _log_with_one_dimension(), fn, skill_dir)
    assert rc == 1
    err = capsys.readouterr().out
    assert "missing required keys" in err
    assert "CRUD UI" in err


def test_rule3_complete_current_shape_passes(tmp_path):
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    fn = _write_ann(
        skill_dir,
        "v1_2026-06-24_00-00-00.json",
        corrections=[
            {
                "test_id": "ut_x_001",
                "dimension_source": "base",
                "dimension_name": "Correctness",
                "llm_score": 3,
                "corrected_score": 3,
            }
        ],
    )
    rc = check_runlogs.rule3_completeness("init-project", _log_with_one_dimension(), fn, skill_dir)
    assert rc == 0


def test_rule3_missing_dimension_still_reported(tmp_path, capsys):
    """A well-formed but incomplete annotation (a dimension never reviewed)
    still blocks via the normal completeness path."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", corrections=[])
    rc = check_runlogs.rule3_completeness("init-project", _log_with_one_dimension(), fn, skill_dir)
    assert rc == 1
    assert "unreviewed" in capsys.readouterr().out


# --- Rule 2 cosmetic-skip escape hatch -----------------------------------

# A snapshot entry pointing at a path that does not exist under REPO_ROOT
# guarantees diff_snapshot_vs_disk reports a mismatch (missing-on-disk), so
# rule 2 has something to either block on or bypass.
_INACTIVE_LOG = {"snapshot": {"eval/__no_such_cosmetic_test__/x.md": "expected\n"}}


def test_rule2_blocks_without_cosmetic_skip(monkeypatch, capsys):
    monkeypatch.delenv("COSMETIC_SKIP", raising=False)
    rc = check_runlogs.rule2_active("demo", _INACTIVE_LOG, "v1.json")
    assert rc == 1
    out = capsys.readouterr().out
    assert "NOT active" in out
    assert "eval-cosmetic-skip" in out  # tells the senior the escape hatch exists


def test_rule2_bypassed_with_cosmetic_skip(monkeypatch, capsys):
    monkeypatch.setenv("COSMETIC_SKIP", "1")
    rc = check_runlogs.rule2_active("demo", _INACTIVE_LOG, "v1.json")
    assert rc == 0
    out = capsys.readouterr().out
    assert "::warning" in out and "eval-cosmetic-skip" in out


def test_rule2_skip_zero_does_not_bypass(monkeypatch, capsys):
    """Only COSMETIC_SKIP == '1' bypasses; '0' (label absent) still blocks."""
    monkeypatch.setenv("COSMETIC_SKIP", "0")
    rc = check_runlogs.rule2_active("demo", _INACTIVE_LOG, "v1.json")
    assert rc == 1
    assert "NOT active" in capsys.readouterr().out


# --- Orchestrator-skill exemption (RUNLOG_GATE_EXEMPT_SKILLS) --------------


def _patch_diffs(monkeypatch, paths: list[str]) -> None:
    """Point both git-diff views at a fixed change set: `git_diff_changes`
    (AR view, rule 1) sees every path as an add; `git_diff_touched_paths`
    (any-status view, touched-skill detection) sees the same paths."""
    monkeypatch.setattr(
        check_runlogs, "git_diff_changes", lambda: [("A", p) for p in paths]
    )
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: list(paths))


def test_exempt_orchestrator_skill_passes(monkeypatch, capsys):
    """Touching an exempt skill's body (no unit suite by design) must not
    fail with 'no run logs' — the per-skill rules are skipped for it."""
    assert "research" in check_runlogs.RUNLOG_GATE_EXEMPT_SKILLS
    _patch_diffs(monkeypatch, ["packages/engine/plugin/skills/research/SKILL.md"])
    rc = check_runlogs.main()
    assert rc == 0
    assert "research" not in capsys.readouterr().out


def test_non_exempt_skill_without_runlogs_still_fails(monkeypatch, capsys):
    """The gate still bites for a non-exempt skill with no runlog dir — proof
    the exemption didn't widen into a blanket pass."""
    _patch_diffs(
        monkeypatch, ["packages/engine/plugin/skills/__no_such_skill__/SKILL.md"]
    )
    rc = check_runlogs.main()
    assert rc == 1
    assert "no run logs" in capsys.readouterr().out


def test_modified_skill_file_marks_skill_touched(monkeypatch, capsys):
    """A *modified* (status M) skill file must gate rules 2 + 3 — the
    touched-skill detection uses the any-status view, not rule 1's AR view."""
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(
        check_runlogs,
        "git_diff_touched_paths",
        lambda: ["packages/engine/plugin/skills/__no_such_skill__/SKILL.md"],
    )
    rc = check_runlogs.main()
    assert rc == 1
    assert "no run logs" in capsys.readouterr().out


# --- Plugin-agent → referencing-skill mapping ------------------------------


def _make_skills_tree(tmp_path):
    """Two skills: one delegates to @plugin:spike-echo, one doesn't."""
    skills = tmp_path / "skills"
    a = skills / "uses-agent"
    a.mkdir(parents=True)
    (a / "SKILL.md").write_text(
        "---\nname: uses-agent\n---\nDelegate via `@plugin:spike-echo`.\n",
        encoding="utf-8",
    )
    b = skills / "no-agent"
    b.mkdir(parents=True)
    (b / "SKILL.md").write_text(
        "---\nname: no-agent\n---\nNo delegation here.\n", encoding="utf-8"
    )
    return skills


def test_skills_referencing_agents_maps_by_ref(tmp_path):
    skills = _make_skills_tree(tmp_path)
    mapping = check_runlogs.skills_referencing_agents(skills)
    assert mapping == {"spike-echo": {"uses-agent"}}


def test_touched_agent_gates_referencing_skill(monkeypatch, capsys, tmp_path):
    """Editing packages/engine/plugin/agents/<name>.md must gate every skill
    whose SKILL.md references @plugin:<name>, exactly like a skill-dir edit."""
    skills = _make_skills_tree(tmp_path)
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", skills)
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(
        check_runlogs,
        "git_diff_touched_paths",
        lambda: ["packages/engine/plugin/agents/spike-echo.md"],
    )
    rc = check_runlogs.main()
    assert rc == 1
    out = capsys.readouterr().out
    assert "uses-agent" in out  # gated like a skill edit (no run logs → fail)
    assert "no-agent" not in out  # non-referencing skill untouched


def test_touched_agent_without_references_gates_nothing(monkeypatch, capsys, tmp_path):
    skills = _make_skills_tree(tmp_path)
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", skills)
    _patch_diffs(monkeypatch, ["packages/engine/plugin/agents/unreferenced.md"])
    rc = check_runlogs.main()
    assert rc == 0
    assert "All runlog rules satisfied" in capsys.readouterr().out
