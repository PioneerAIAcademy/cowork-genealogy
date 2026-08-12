"""Unit tests for scripts/check_runlogs.py — rule 3 robustness.

Focus: a hand-written / stale-tool annotation that omits the required
correction keys (notably the deprecated run_index/dimension/source shape)
must produce a clean, blocking error — not an opaque KeyError crash.
"""

from __future__ import annotations

import importlib.util
import json
import re
import subprocess
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "check_runlogs",
    Path(__file__).resolve().parents[2] / "scripts" / "check_runlogs.py",
)
check_runlogs = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check_runlogs)

# check_runlogs puts the harness dir on sys.path, so this import must follow it.
from harness.snapshot import build_snapshot  # noqa: E402


@pytest.fixture(autouse=True)
def _no_live_pr_listing(monkeypatch):
    """Keep rule 5 off the network in every test in this file.

    `GITHUB_REPOSITORY` is set inside Actions, so without this the eval-harness
    test job would have every `main()` test shell out to `gh pr list` — slow,
    flaky, and it would leak other PRs' titles into assertions about this PR's
    output. Unset, rule 5 takes its GITHUB_REPOSITORY-missing skip path, whose
    notice names no skill. Rule 5's own tests below inject a listing instead.
    """
    monkeypatch.delenv("GITHUB_REPOSITORY", raising=False)
    monkeypatch.delenv("PR_NUMBER", raising=False)



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


def _patch_diffs(monkeypatch, paths: list[str], *, deleted: list[str] | None = None) -> None:
    """Point the three git-diff views at a fixed change set: `git_diff_changes`
    (AR view, rule 1) sees every path as an add; `git_diff_touched_paths`
    (any-status view, touched-skill detection) sees the same paths;
    `git_diff_deleted_paths` sees `deleted` (default none)."""
    monkeypatch.setattr(
        check_runlogs, "git_diff_changes", lambda: [("A", p) for p in paths]
    )
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: list(paths))
    monkeypatch.setattr(
        check_runlogs, "git_diff_deleted_paths", lambda: list(deleted or [])
    )


def test_exempt_orchestrator_skill_passes(monkeypatch, capsys):
    """Touching an exempt skill's body (no unit suite by design) must not
    fail with 'no run logs' — the per-skill rules are skipped for it."""
    assert "research" in check_runlogs.RUNLOG_GATE_EXEMPT_SKILLS
    _patch_diffs(monkeypatch, ["packages/engine/plugin/skills/research/SKILL.md"])
    rc = check_runlogs.main()
    assert rc == 0
    assert "research" not in capsys.readouterr().out


def _make_present_skill(tmp_path, monkeypatch, name: str = "present-skill"):
    """Stage a skills tree containing <name> (dir exists on disk, so the
    deleted-skill skip does not apply) and point the checker at it. The
    real RUNLOGS_DIR has no dir for <name>, so rules 2+3 fail with
    'no run logs'."""
    skills = tmp_path / "skills"
    d = skills / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\nname: {name}\n---\nbody\n", encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", skills)
    return f"packages/engine/plugin/skills/{name}/SKILL.md"


def test_non_exempt_skill_without_runlogs_still_fails(monkeypatch, capsys, tmp_path):
    """The gate still bites for a non-exempt skill with no runlog dir — proof
    the exemption didn't widen into a blanket pass."""
    path = _make_present_skill(tmp_path, monkeypatch)
    _patch_diffs(monkeypatch, [path])
    rc = check_runlogs.main()
    assert rc == 1
    assert "no run logs" in capsys.readouterr().out


def test_modified_skill_file_marks_skill_touched(monkeypatch, capsys, tmp_path):
    """A *modified* (status M) skill file must gate rules 2 + 3 — the
    touched-skill detection uses the any-status view, not rule 1's AR view."""
    path = _make_present_skill(tmp_path, monkeypatch)
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: [path])
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: [])
    rc = check_runlogs.main()
    assert rc == 1
    assert "no run logs" in capsys.readouterr().out


def test_runlog_modify_or_delete_does_not_touch_skill(monkeypatch, capsys, tmp_path):
    """Rewriting or pruning a committed run log is housekeeping, not evidence.
    A run log is not an input to its own snapshot, so a non-AR change under
    eval/runlogs/unit/<skill>/ must not gate rules 2 + 3 — otherwise a rehash
    or prune sweep fails every skill on drift it did not cause."""
    _make_present_skill(tmp_path, monkeypatch)
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    pruned = [
        "eval/runlogs/unit/present-skill/v1_2026-06-01_00-00-00.json",
        "eval/runlogs/unit/present-skill/v1_2026-06-01_00-00-00.ann.json",
    ]
    monkeypatch.setattr(
        check_runlogs,
        "git_diff_touched_paths",
        # modified in place (rehash) + deleted (prune, annotation included)
        lambda: ["eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json", *pruned],
    )
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: pruned)
    rc = check_runlogs.main()
    assert rc == 0
    assert "no run logs" not in capsys.readouterr().out


def test_added_runlog_still_marks_skill_touched(monkeypatch, capsys, tmp_path):
    """The narrowing above must not widen into a blanket pass: *adding* a run
    log is still evidence about a skill and still gates rules 2 + 3."""
    _make_present_skill(tmp_path, monkeypatch)
    _patch_diffs(
        monkeypatch,
        ["eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json"],
    )
    rc = check_runlogs.main()
    assert rc == 1
    assert "no run logs" in capsys.readouterr().out


# --- Deleted-skill skip (skill dir AND test dir both absent) ---------------


def test_deleted_skill_skips_gate(monkeypatch, capsys, tmp_path):
    """A PR that deletes a skill entirely — skill dir and unit-test dir both
    absent from the working tree — must not hard-fail rules 2/3 for it:
    there is no suite left to re-run. (The assertion-classification
    deletion, 2026-07-11.)"""
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", tmp_path / "tests-unit")
    _patch_diffs(
        monkeypatch,
        [
            "packages/engine/plugin/skills/gone-skill/SKILL.md",
            "eval/tests/unit/gone-skill/rubric.md",
            "eval/tests/unit/gone-skill/some-test.json",
        ],
    )
    rc = check_runlogs.main()
    assert rc == 0
    assert "All runlog rules satisfied" in capsys.readouterr().out


def test_half_deleted_skill_still_gated(monkeypatch, capsys, tmp_path):
    """A skill whose test dir survives (only the skill dir was removed) is an
    inconsistent state the gate must surface, not skip."""
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", tmp_path / "skills")
    tests_unit = tmp_path / "tests-unit"
    (tests_unit / "half-gone").mkdir(parents=True)
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", tests_unit)
    _patch_diffs(
        monkeypatch, ["packages/engine/plugin/skills/half-gone/SKILL.md"]
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
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: [])
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


# --- git_diff_touched_paths uses a 3-dot (merge-base) diff -----------------


def test_touched_paths_uses_three_dot_diff(monkeypatch):
    """Touched-skill detection must scope to the PR's own commits via a 3-dot
    `base...head` refspec, so a branch merely behind main doesn't inherit
    phantom touched skills from main-only additions appearing as deletions."""
    monkeypatch.setenv("BASE_SHA", "base123")
    monkeypatch.setenv("HEAD_SHA", "head456")
    captured: dict = {}

    def fake_check_output(cmd, *args, **kwargs):
        captured["cmd"] = cmd
        return "M\tpackages/engine/plugin/skills/foo/SKILL.md\n"

    monkeypatch.setattr(check_runlogs.subprocess, "check_output", fake_check_output)
    paths = check_runlogs.git_diff_touched_paths()
    assert paths == ["packages/engine/plugin/skills/foo/SKILL.md"]
    # The two SHAs are combined into one 3-dot arg, not passed as separate
    # 2-dot operands (which would re-introduce the phantom-deletion bug).
    assert "base123...head456" in captured["cmd"]
    assert "base123" not in captured["cmd"]
    assert "head456" not in captured["cmd"]


# --- Rule 4: unique test ids ----------------------------------------------


def _write_test_file(skill_dir: Path, filename: str, test_id: str) -> None:
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / filename).write_text(
        json.dumps({"test": {"id": test_id, "skill": skill_dir.name}}),
        encoding="utf-8",
    )


def test_rule4_unique_ids_pass(tmp_path):
    root = tmp_path / "unit"
    _write_test_file(root / "locality-guide", "a.json", "ut_locality_guide_001")
    _write_test_file(root / "locality-guide", "b.json", "ut_locality_guide_002")
    _write_test_file(root / "check-warnings", "c.json", "ut_check_warnings_001")
    assert check_runlogs.rule4_unique_test_ids(root) == 0


def test_rule4_duplicate_id_blocks(tmp_path, capsys):
    """Two files sharing an id must fail with both paths named."""
    root = tmp_path / "unit"
    _write_test_file(root / "locality-guide", "descriptive-name.json", "ut_locality_guide_002")
    _write_test_file(root / "locality-guide", "ut_locality_guide_002.json", "ut_locality_guide_002")
    assert check_runlogs.rule4_unique_test_ids(root) == 1
    out = capsys.readouterr().out
    assert "::error" in out
    assert "descriptive-name.json" in out
    assert "ut_locality_guide_002.json" in out


def test_rule4_ignores_malformed_json(tmp_path):
    """A corrupt test file is the loader's problem; rule 4 skips it rather
    than crashing the whole gate."""
    root = tmp_path / "unit"
    _write_test_file(root / "locality-guide", "ok.json", "ut_locality_guide_001")
    (root / "locality-guide" / "broken.json").write_text("{not json", encoding="utf-8")
    assert check_runlogs.rule4_unique_test_ids(root) == 0


def test_rule4_runs_only_when_tests_touched(monkeypatch, capsys, tmp_path):
    """A PR that touches no test file skips the corpus scan entirely."""
    root = tmp_path / "unit"
    _write_test_file(root / "locality-guide", "a.json", "dup")
    _write_test_file(root / "locality-guide", "b.json", "dup")
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", root)

    # Skill-only change: rule 4 never runs, so the duplicate goes unreported.
    path = _make_present_skill(tmp_path, monkeypatch)
    _patch_diffs(monkeypatch, [path])
    check_runlogs.main()
    assert "test id `dup`" not in capsys.readouterr().out

    # Touching a test file turns the scan on and the duplicate blocks.
    _patch_diffs(monkeypatch, ["eval/tests/unit/locality-guide/b.json"])
    check_runlogs.main()
    out = capsys.readouterr().out
    assert "::error" in out
    assert "test id `dup`" in out


def test_edited_annotation_still_gates_rule3(monkeypatch, capsys, tmp_path):
    """RUNLOG_PATH_RE matches `.ann.json` too, so the run-log narrowing must
    not swallow annotation EDITS — walking a grade back from complete to
    partial has to keep facing rule 3. Only a pruned (deleted) annotation is
    housekeeping."""
    _make_present_skill(tmp_path, monkeypatch)
    ann = "eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.ann.json"
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: [ann])
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: [])

    rc = check_runlogs.main()
    assert rc == 1
    assert "no run logs" in capsys.readouterr().out


def test_deleted_annotation_does_not_gate(monkeypatch, capsys, tmp_path):
    """The prune deletes an annotation with its run log; that must stay green."""
    _make_present_skill(tmp_path, monkeypatch)
    ann = "eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.ann.json"
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: [ann])
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: [ann])

    rc = check_runlogs.main()
    assert rc == 0
    assert "no run logs" not in capsys.readouterr().out


# --- Rule 2 against a schema_version 3 (digest) snapshot -------------------


def test_rule2_passes_on_hash_snapshot_when_disk_matches(tmp_path, monkeypatch, capsys):
    """The gate itself, exercised on the shape the harness now writes.

    The cosmetic-skip tests above all use a deliberately-missing path, so none
    of them reaches the comparison at all. Without this, a `build_snapshot`
    emitting digests while `diff_snapshot_vs_disk` still compared raw bytes
    would have blocked *every* skill in CI and the unit suite would have stayed
    green — the failure mode that motivated writing it.
    """
    monkeypatch.delenv("COSMETIC_SKIP", raising=False)
    skill_md = tmp_path / "packages/engine/plugin/skills/s1/SKILL.md"
    skill_md.parent.mkdir(parents=True)
    skill_md.write_text("---\nname: s1\n---\nbody\n", encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "REPO_ROOT", tmp_path)

    log = {"snapshot": build_snapshot(skill="s1", repo_root=tmp_path)}
    assert log["snapshot"], "fixture built no snapshot — the test would pass vacuously"
    assert all(re.fullmatch(r"[a-f0-9]{64}", v) for v in log["snapshot"].values())

    assert check_runlogs.rule2_active("s1", log, "v1.json") == 0

    capsys.readouterr()  # drop anything emitted by the passing call above
    skill_md.write_text("---\nname: s1\n---\nEDITED\n", encoding="utf-8")
    assert check_runlogs.rule2_active("s1", log, "v1.json") == 1
    out = capsys.readouterr().out
    assert "NOT active" in out
    assert "SKILL.md" in out  # names the drifted path, not just the count


def test_rule2_tolerates_a_cosmetic_test_edit_under_hashing(tmp_path, monkeypatch):
    """`normalize()` runs BEFORE hashing, so stripping test.{name,description,
    tags} still makes a cosmetic edit a no-op.

    Undocumented invariant otherwise: hashing the raw bytes instead would turn
    every rename of a test's display name into a forced paid re-run, and
    nothing else in the suite composes build_snapshot with rule 2.
    """
    monkeypatch.delenv("COSMETIC_SKIP", raising=False)
    (tmp_path / "packages/engine/plugin/skills/s1").mkdir(parents=True)
    tests_dir = tmp_path / "eval/tests/unit/s1"
    tests_dir.mkdir(parents=True)
    body = {
        "test": {"id": "ut_1", "skill": "s1", "name": "original",
                 "description": "d", "tags": ["a"], "type": "positive"},
        "input": {"user_message": "m"},
    }
    (tests_dir / "ut_1.json").write_text(json.dumps(body), encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "REPO_ROOT", tmp_path)

    log = {"snapshot": build_snapshot(skill="s1", repo_root=tmp_path)}

    body["test"]["name"] = "RENAMED"
    body["test"]["tags"] = ["z"]
    (tests_dir / "ut_1.json").write_text(json.dumps(body), encoding="utf-8")
    assert check_runlogs.rule2_active("s1", log, "v1.json") == 0

    body["input"]["user_message"] = "SUBSTANTIVE"
    (tests_dir / "ut_1.json").write_text(json.dumps(body), encoding="utf-8")
    assert check_runlogs.rule2_active("s1", log, "v1.json") == 1


# --- The shared path → skill-snapshot keying -------------------------------

_AGENT_MAP = {"record-extractor": {"record-extraction"}}


def test_snapshot_skills_keys_all_three_snapshot_classes():
    """Skill body, unit-test dir, and a referenced plugin agent (fanned out)."""
    assert check_runlogs.snapshot_skills_for_paths(
        [
            "packages/engine/plugin/skills/init-project/SKILL.md",
            "eval/tests/unit/timeline/rubric.md",
            "packages/engine/plugin/agents/record-extractor.md",
        ],
        _AGENT_MAP,
    ) == {"init-project", "timeline", "record-extraction"}


def test_snapshot_skills_ignores_runlogs_and_unrelated_paths():
    """A run log is not an input to its own snapshot, so changing one changes
    no snapshot. Neither does an engine/docs path."""
    assert (
        check_runlogs.snapshot_skills_for_paths(
            [
                "eval/runlogs/unit/init-project/v3_2026-08-01_00-00-00.json",
                "eval/runlogs/unit/init-project/v3_2026-08-01_00-00-00.ann.json",
                "packages/engine/mcp-server/src/tools/record-read.ts",
                "docs/architecture.md",
                "eval/fixtures/mcp/some-fixture.json",
            ],
            _AGENT_MAP,
        )
        == set()
    )


def test_snapshot_skills_agent_without_referencing_skill_yields_nothing():
    assert (
        check_runlogs.snapshot_skills_for_paths(
            ["packages/engine/plugin/agents/unreferenced.md"], _AGENT_MAP
        )
        == set()
    )


# --- Rule 5: another open PR on the same skill snapshot ---------------------


def _pr(number: int, paths: list[str], *, title: str = "some PR", draft: bool = False):
    """One entry in the shape `gh pr list --json number,title,isDraft,files`
    returns — note `files[].path`, the GraphQL field name."""
    return {
        "number": number,
        "title": title,
        "isDraft": draft,
        "files": [{"path": p} for p in paths],
    }


def _fake_listing(monkeypatch, prs: list[dict], *, me: str = "9999") -> None:
    monkeypatch.setenv("GITHUB_REPOSITORY", "PioneerAIAcademy/cowork-genealogy")
    monkeypatch.setenv("PR_NUMBER", me)
    monkeypatch.setattr(check_runlogs, "_list_open_prs", lambda repo: (list(prs), None))


def _fake_gh(monkeypatch, *, stdout="", stderr="", returncode=0, exc=None) -> None:
    """Replace the `gh pr list` subprocess so `_list_open_prs` runs for real."""

    def run(cmd, *args, **kwargs):
        if exc is not None:
            raise exc
        return subprocess.CompletedProcess(cmd, returncode, stdout, stderr)

    monkeypatch.setattr(check_runlogs.subprocess, "run", run)


def test_rule5_warns_on_a_shared_skill_snapshot(monkeypatch, capsys):
    """The core case: PR #1577 and PR #1523 both change init-project's snapshot."""
    _fake_listing(
        monkeypatch,
        [
            _pr(1577, ["packages/engine/plugin/skills/init-project/SKILL.md"],
                title="question-selection + init-project"),
            _pr(1523, ["eval/tests/unit/init-project/rubric.md"],
                title="Triage check_rubric_tool_drift warnings"),
            _pr(1414, ["packages/engine/plugin/skills/locality-guide/SKILL.md"]),
        ],
        me="1600",
    )
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "::warning" in out
    assert "skill `init-project`" in out
    assert "PR #1577" in out and "PR #1523" in out
    assert "PR #1414" not in out  # a different skill is not a collision
    assert "eval-skill SKILL=init-project" in out  # names the cost
    assert "Warn-only" in out


def test_rule5_clean_result_says_how_many_prs_it_checked(monkeypatch, capsys):
    """Clean must be distinguishable from skipped, and carry the count that
    makes a vacuous pass visible."""
    _fake_listing(
        monkeypatch, [_pr(1414, ["packages/engine/plugin/skills/locality-guide/SKILL.md"])]
    )
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "::warning" not in out
    assert "no other open PR changes the eval snapshot of init-project" in out
    assert "1 other open PR(s) checked" in out
    assert "SKIPPED" not in out


def test_rule5_excludes_the_pr_it_is_running_on(monkeypatch, capsys):
    """Without this the PR collides with itself on every run."""
    mine = _pr(1600, ["packages/engine/plugin/skills/init-project/SKILL.md"])
    _fake_listing(monkeypatch, [mine], me="1600")
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "::warning" not in out
    assert "0 other open PR(s) checked" in out


def test_rule5_reports_nothing_when_this_pr_changes_no_snapshot(monkeypatch, capsys):
    _fake_listing(
        monkeypatch, [_pr(1577, ["packages/engine/plugin/skills/init-project/SKILL.md"])]
    )
    check_runlogs.rule5_concurrent_snapshot_prs(set(), _AGENT_MAP)
    out = capsys.readouterr().out
    assert "::warning" not in out
    assert "nothing to compare" in out


def test_rule5_draft_pr_is_reported_and_labelled(monkeypatch, capsys):
    """Drafts are reported rather than filtered — a draft's author is exactly
    who benefits from hearing about the collision — but they are marked, so the
    reader can judge the urgency."""
    _fake_listing(
        monkeypatch,
        [_pr(1577, ["packages/engine/plugin/skills/init-project/SKILL.md"], draft=True)],
    )
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "PR #1577 (draft)" in out


def test_rule5_agent_edit_in_another_pr_collides(monkeypatch, capsys):
    """The `@plugin:<agent>` fan-out crosses PRs: an agent edit over there is a
    snapshot change to every skill referencing it over here."""
    _fake_listing(
        monkeypatch, [_pr(1523, ["packages/engine/plugin/agents/record-extractor.md"])]
    )
    check_runlogs.rule5_concurrent_snapshot_prs({"record-extraction"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "::warning" in out
    assert "skill `record-extraction`" in out


def test_rule5_other_prs_runlog_only_change_is_not_a_collision(monkeypatch, capsys):
    """A PR that only adds/edits a run log changes no snapshot, so it cannot
    invalidate anyone. Keeping this out is what stops the check firing on every
    re-run PR."""
    _fake_listing(
        monkeypatch,
        [_pr(1578, ["eval/runlogs/unit/init-project/v3_2026-08-01_00-00-00.ann.json"])],
    )
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    assert "::warning" not in capsys.readouterr().out


def test_rule5_exempt_skill_is_reported_without_a_paid_run_claim(monkeypatch, capsys):
    """`forget-and-rederive` has no unit suite, so the collision is real but the
    re-run cost is not. The message must not claim a run that does not exist."""
    assert "forget-and-rederive" in check_runlogs.RUNLOG_GATE_EXEMPT_SKILLS
    _fake_listing(
        monkeypatch,
        [_pr(1575, ["packages/engine/plugin/skills/forget-and-rederive/SKILL.md"])],
    )
    check_runlogs.rule5_concurrent_snapshot_prs({"forget-and-rederive"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "::warning" in out
    assert "no unit suite, so no paid run is at stake" in out
    assert "eval-skill SKILL=forget-and-rederive" not in out


# --- Rule 5 degradation: SKIPPED must never read as CLEAN -------------------


def test_rule5_skipped_when_repo_is_unset(monkeypatch, capsys):
    monkeypatch.delenv("GITHUB_REPOSITORY", raising=False)
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "::notice" in out
    assert "SKIPPED" in out
    assert "not a clean result" in out
    assert "::warning" not in out


def test_rule5_skipped_when_pr_number_is_unset(monkeypatch, capsys):
    """Without PR_NUMBER the check cannot exclude itself, so it must skip
    rather than warn about a collision with itself."""
    monkeypatch.setenv("GITHUB_REPOSITORY", "PioneerAIAcademy/cowork-genealogy")
    monkeypatch.delenv("PR_NUMBER", raising=False)
    monkeypatch.setattr(
        check_runlogs,
        "_list_open_prs",
        lambda repo: (
            [_pr(1600, ["packages/engine/plugin/skills/init-project/SKILL.md"])],
            None,
        ),
    )
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "SKIPPED" in out and "PR_NUMBER" in out
    assert "::warning" not in out


def test_rule5_skipped_when_the_listing_fails(monkeypatch, capsys):
    """The fork/rate-limit/no-gh path. Must name the skills so the reviewer can
    check by hand, and must not read as clean."""
    monkeypatch.setenv("GITHUB_REPOSITORY", "PioneerAIAcademy/cowork-genealogy")
    monkeypatch.setenv("PR_NUMBER", "1600")
    _fake_gh(monkeypatch, returncode=1, stderr="gh: Resource not accessible\n")
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "::notice" in out
    assert "SKIPPED" in out
    assert "Resource not accessible" in out
    assert "not a clean result" in out
    assert "`init-project`" in out
    assert "::warning" not in out


def test_rule5_skipped_when_gh_is_missing(monkeypatch, capsys):
    monkeypatch.setenv("GITHUB_REPOSITORY", "PioneerAIAcademy/cowork-genealogy")
    monkeypatch.setenv("PR_NUMBER", "1600")
    _fake_gh(monkeypatch, exc=FileNotFoundError("no gh on PATH"))
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "SKIPPED" in out and "FileNotFoundError" in out
    assert "::warning" not in out


def test_rule5_skipped_when_the_files_field_is_renamed(monkeypatch, capsys):
    """The silent-pass mode this guard exists for: keying on `files[].path`
    while the API returns REST's `filename` yields an empty path list for every
    PR, which would otherwise report CLEAN forever."""
    monkeypatch.setenv("GITHUB_REPOSITORY", "PioneerAIAcademy/cowork-genealogy")
    monkeypatch.setenv("PR_NUMBER", "1600")
    rest_shape = json.dumps(
        [
            {
                "number": 1577,
                "title": "t",
                "isDraft": False,
                "files": [
                    {"filename": "packages/engine/plugin/skills/init-project/SKILL.md"}
                ],
            }
        ]
    )
    _fake_gh(monkeypatch, stdout=rest_shape)
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "SKIPPED" in out
    assert "no `path` key on any of them" in out
    assert "::warning" not in out


def test_rule5_skipped_when_the_files_field_is_absent(monkeypatch, capsys):
    monkeypatch.setenv("GITHUB_REPOSITORY", "PioneerAIAcademy/cowork-genealogy")
    monkeypatch.setenv("PR_NUMBER", "1600")
    _fake_gh(
        monkeypatch,
        stdout=json.dumps([{"number": 1577, "title": "t", "isDraft": False}]),
    )
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "SKIPPED" in out
    assert "`files` field did not come back" in out


def test_rule5_skipped_on_an_empty_listing(monkeypatch, capsys):
    """This PR is itself open, so zero open PRs means the listing saw nothing —
    not that nobody else has a PR."""
    monkeypatch.setenv("GITHUB_REPOSITORY", "PioneerAIAcademy/cowork-genealogy")
    monkeypatch.setenv("PR_NUMBER", "1600")
    _fake_gh(monkeypatch, stdout="[]")
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    assert "no open PRs at all" in capsys.readouterr().out


def test_rule5_skipped_on_unparseable_json(monkeypatch, capsys):
    monkeypatch.setenv("GITHUB_REPOSITORY", "PioneerAIAcademy/cowork-genealogy")
    monkeypatch.setenv("PR_NUMBER", "1600")
    _fake_gh(monkeypatch, stdout="not json at all")
    check_runlogs.rule5_concurrent_snapshot_prs({"init-project"}, _AGENT_MAP)
    out = capsys.readouterr().out
    assert "SKIPPED" in out and "unparseable JSON" in out


def test_list_open_prs_reads_the_graphql_path_field(monkeypatch):
    """Pins the `--json` selection and the returned shape together, so a change
    to one without the other fails here instead of degrading to a silent pass."""
    monkeypatch.setenv("GITHUB_REPOSITORY", "PioneerAIAcademy/cowork-genealogy")
    captured: dict = {}

    def run(cmd, *args, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(
            cmd, 0, json.dumps([_pr(1, ["eval/tests/unit/timeline/rubric.md"])]), ""
        )

    monkeypatch.setattr(check_runlogs.subprocess, "run", run)
    prs, error = check_runlogs._list_open_prs("PioneerAIAcademy/cowork-genealogy")
    assert error is None
    assert check_runlogs._pr_paths(prs[0]) == ["eval/tests/unit/timeline/rubric.md"]
    assert "number,title,isDraft,files" in captured["cmd"]
    # Titles carry em-dashes; a bare text=True would decode them with the
    # platform default (cp1252 on the team's Windows boxes).
    assert captured["kwargs"]["encoding"] == "utf-8"


# --- Rule 5 is warn-only: it must never move the exit code -----------------


def test_rule5_collision_does_not_fail_the_gate(monkeypatch, capsys, tmp_path):
    """A PR that deletes a skill entirely passes rules 1-4 (nothing left to
    re-run). Adding a rule-5 collision on top must keep it green."""
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", tmp_path / "tests-unit")
    _patch_diffs(monkeypatch, ["packages/engine/plugin/skills/gone-skill/SKILL.md"])
    _fake_listing(
        monkeypatch,
        [_pr(1577, ["packages/engine/plugin/skills/gone-skill/rubric.md"])],
        me="1600",
    )
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 0
    assert "::warning" in out and "skill `gone-skill`" in out
    assert "All runlog rules satisfied" in out
