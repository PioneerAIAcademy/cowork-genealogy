"""Unit tests for scripts/check_runlogs.py — rule 3 robustness.

Focus: a hand-written / stale-tool annotation that omits the required
correction keys (notably the deprecated run_index/dimension/source shape)
must produce a clean, blocking error — not an opaque KeyError crash.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "check_runlogs",
    Path(__file__).resolve().parents[2] / "scripts" / "check_runlogs.py",
)
check_runlogs = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check_runlogs)

# check_runlogs' import inserts the harness dir on sys.path, so these resolve.
from harness.snapshot import build_snapshot, normalize  # noqa: E402


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


# --- Sampled rule 3 -----------------------------------------------------


def _multi_test_log(n: int = 20, review_sample: dict | None = None) -> dict:
    log = {
        "tests": [
            {
                "test_id": f"ut_x_{i:03d}",
                "outcome_summary": {
                    "aggregated_dimensions": [
                        {"source": "base", "name": "Correctness"},
                        {"source": "base", "name": "Completeness"},
                    ]
                },
            }
            for i in range(n)
        ]
    }
    if review_sample is not None:
        log["review_sample"] = review_sample
    return log


def _corrections_for(test_ids: list[str]) -> list[dict]:
    return [
        {
            "test_id": tid,
            "dimension_source": "base",
            "dimension_name": name,
            "llm_score": 3,
            "corrected_score": 3,
        }
        for tid in test_ids
        for name in ("Correctness", "Completeness")
    ]


def test_rule3_accepts_sampled_annotation(tmp_path):
    """A 20-test run log whose annotation covers only the 5 sampled tests
    passes. Under the old every-dimension rule this was 40 unreviewed cells."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = [f"ut_x_{i:03d}" for i in range(5)]
    log = _multi_test_log(20, review_sample={"tests": sampled, "cursor": sampled, "seed": 0})
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", _corrections_for(sampled))
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 0


def test_rule3_still_blocks_an_unreviewed_sampled_test(tmp_path, capsys):
    """Sampling narrows WHICH tests are required, not whether they are."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = [f"ut_x_{i:03d}" for i in range(5)]
    log = _multi_test_log(20, review_sample={"tests": sampled, "cursor": sampled, "seed": 0})
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", _corrections_for(sampled[:-1]))
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 1
    assert "unreviewed" in capsys.readouterr().out


def test_rule3_unchanged_without_review_sample(tmp_path):
    """Back-compat, and the reason this change is retroactively safe: every one
    of the 109 committed annotations predates `review_sample`, so they must keep
    the every-dimension rule. Must pass before AND after the change."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    every = [f"ut_x_{i:03d}" for i in range(20)]
    log = _multi_test_log(20)  # no review_sample
    partial = _write_ann(
        skill_dir, "v1_2026-06-24_00-00-00.json", _corrections_for(every[:5])
    )
    assert check_runlogs.rule3_completeness("init-project", log, partial, skill_dir) == 1

    full = _write_ann(skill_dir, "v2_2026-06-24_00-00-00.json", _corrections_for(every))
    assert check_runlogs.rule3_completeness("init-project", log, full, skill_dir) == 0


def test_rule3_warns_on_zero_dimension_tests(tmp_path, capsys):
    """An ungraded test asks nothing of rule 3 and is dropped from sampling, so
    without a warning a run with nothing gradeable passes silently."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    log = _multi_test_log(3, review_sample={"tests": ["ut_x_000"], "cursor": [], "seed": 0})
    log["tests"].append(
        {"test_id": "ut_x_aborted", "outcome_summary": {"aggregated_dimensions": []}}
    )
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", _corrections_for(["ut_x_000"]))
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 0
    out = capsys.readouterr().out
    assert "no graded dimensions" in out
    assert "ut_x_aborted" in out


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


# --- Shared-fixture → referencing-skill mapping (#1094) ---------------------


def _make_tests_tree(tmp_path):
    """Two skills' unit-test dirs: one references a scenario + an mcp fixture,
    one references neither."""
    tests = tmp_path / "tests"
    a = tests / "uses-fixture"
    a.mkdir(parents=True)
    (a / "t.json").write_text(
        json.dumps(
            {
                "test": {"id": "ut_uf_001"},
                "input": {"scenario": "shared-scn"},
                "mcp_fixtures": ["shared-mcp"],
            }
        ),
        encoding="utf-8",
    )
    b = tests / "no-fixture"
    b.mkdir(parents=True)
    (b / "t.json").write_text(
        json.dumps({"test": {"id": "ut_nf_001"}, "input": {}, "mcp_fixtures": []}),
        encoding="utf-8",
    )
    return tests


def test_skills_referencing_fixtures_maps_by_ref(tmp_path):
    """A scenario resolves by directory name; an mcp fixture resolves by bare
    name (no `.json`) — the two traps the resolution must get right."""
    tests = _make_tests_tree(tmp_path)
    mapping = check_runlogs.skills_referencing_fixtures(tests)
    assert mapping == {
        ("scenarios", "shared-scn"): {"uses-fixture"},
        ("mcp", "shared-mcp"): {"uses-fixture"},
    }


_SCN_REL = "eval/fixtures/scenarios/shared-scn/research.json"
_MCP_REL = "eval/fixtures/mcp/shared-mcp.json"


def _setup_repo(tmp_path, monkeypatch, *, runlog_matches_disk, with_runlog=True):
    """Build a tmp repo — the `uses-fixture` skill's tests reference a scenario
    and an mcp fixture, both present on disk, and (when `with_runlog`) a
    full-skill run log whose snapshot embeds BOTH — and point check_runlogs'
    globals at it. `runlog_matches_disk` controls whether the embedded copies
    equal the on-disk fixtures (active → silent) or differ (stale → warn).

    This drives the real `rule2_fixture_touched` snapshot diff, unlike a setup
    that leaves RUNLOGS_DIR on the real repo (which would pass via the
    unrelated 'no run logs' branch without ever exercising the arm)."""
    repo = tmp_path / "repo"
    for rel, blob in (
        ("eval/tests/unit/uses-fixture/t.json",
         {"test": {"id": "ut_uf_001"},
          "input": {"scenario": "shared-scn"},
          "mcp_fixtures": ["shared-mcp"]}),
        ("eval/tests/unit/no-fixture/t.json",
         {"test": {"id": "ut_nf_001"}, "input": {}, "mcp_fixtures": []}),
    ):
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_text(json.dumps(blob), encoding="utf-8")

    for rel in (_SCN_REL, _MCP_REL):
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_text('{"disk": true}', encoding="utf-8")

    runlogs_unit = repo / "eval/runlogs/unit"
    runlogs_unit.mkdir(parents=True, exist_ok=True)
    if with_runlog:
        def _snap(rel):
            disk = (repo / rel).read_bytes()
            return normalize(rel, disk if runlog_matches_disk else b'{"embedded": "old"}')

        rl_dir = runlogs_unit / "uses-fixture"
        rl_dir.mkdir()
        (rl_dir / "v1.json").write_text(
            json.dumps({"snapshot": {_SCN_REL: _snap(_SCN_REL), _MCP_REL: _snap(_MCP_REL)}}),
            encoding="utf-8",
        )

    monkeypatch.setattr(check_runlogs, "REPO_ROOT", repo)
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", runlogs_unit)
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", repo / "eval/tests/unit")
    return repo


def test_touched_scenario_warns_when_runlog_stale(monkeypatch, capsys, tmp_path):
    """Editing eval/fixtures/scenarios/<name>/ warns for every skill whose tests
    reference <name> and whose run log embeds a now-stale copy — WARN-ONLY
    (rc 0), unlike a skill/agent edit which blocks. Named acceptance test: it
    fails today because the fixture arm does not exist."""
    _setup_repo(tmp_path, monkeypatch, runlog_matches_disk=False)
    _patch_diffs(monkeypatch, [_SCN_REL])
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 0  # warn-only: never blocks
    assert "::warning::" in out
    assert "uses-fixture" in out  # referencing skill surfaced
    assert "v1.json" in out  # exercised rule2_fixture_touched, not the no-runlog branch
    assert _SCN_REL in out  # the changed fixture is named
    assert "no-fixture" not in out  # non-referencing skill untouched
    assert _MCP_REL not in out  # scoping: the un-changed (but also stale) fixture is NOT attributed


def test_touched_mcp_fixture_warns_when_runlog_stale(monkeypatch, capsys, tmp_path):
    """Same via eval/fixtures/mcp/<name>.json — the bare-name (`.json`-stripped)
    reference must resolve, and only the changed fixture is attributed."""
    _setup_repo(tmp_path, monkeypatch, runlog_matches_disk=False)
    _patch_diffs(monkeypatch, [_MCP_REL])
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 0
    assert "::warning::" in out
    assert "uses-fixture" in out
    assert "v1.json" in out
    assert _MCP_REL in out
    assert _SCN_REL not in out  # scoping: scenario not attributed to an mcp edit
    assert "no-fixture" not in out


def test_touched_fixture_active_runlog_no_warning(monkeypatch, capsys, tmp_path):
    """When the run log already matches the changed fixture (active), the arm
    stays silent — guards against inverting `if not fixture_diffs: return`."""
    _setup_repo(tmp_path, monkeypatch, runlog_matches_disk=True)
    _patch_diffs(monkeypatch, [_SCN_REL])
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 0
    assert "uses-fixture" not in out
    assert "All runlog rules satisfied" in out


def test_touched_fixture_missing_runlog_warns(monkeypatch, capsys, tmp_path):
    """A referenced fixture whose skill has no run log still warns (nothing to
    re-diff), and stays warn-only (rc 0)."""
    _setup_repo(tmp_path, monkeypatch, runlog_matches_disk=False, with_runlog=False)
    _patch_diffs(monkeypatch, [_SCN_REL])
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 0
    assert "::warning::" in out
    assert "uses-fixture" in out
    assert "no run logs" in out


def test_touched_fixture_without_references_warns_nobody(monkeypatch, capsys, tmp_path):
    """A changed fixture no test references surfaces no skill and stays green."""
    _setup_repo(tmp_path, monkeypatch, runlog_matches_disk=False)
    _patch_diffs(monkeypatch, ["eval/fixtures/mcp/nobody-references-this.json"])
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 0
    assert "uses-fixture" not in out
    assert "All runlog rules satisfied" in out


def test_exempt_skill_with_unit_suite_is_not_suppressed(monkeypatch, capsys, tmp_path):
    """The exemption is keyed on directory existence, not name (#1094 review):
    a skill in RUNLOG_GATE_EXEMPT_SKILLS that HAS gained an eval/tests/unit/
    dir is no longer exempt, so a fixture edit still warns for it. Guards
    against regressing to the name-keyed `-= RUNLOG_GATE_EXEMPT_SKILLS`."""
    _setup_repo(tmp_path, monkeypatch, runlog_matches_disk=False)
    # `uses-fixture` has a unit-test dir in the tmp repo; naming it exempt must
    # NOT silence it, because the exemption only applies to suiteless skills.
    monkeypatch.setattr(
        check_runlogs, "RUNLOG_GATE_EXEMPT_SKILLS", frozenset({"uses-fixture"})
    )
    _patch_diffs(monkeypatch, [_SCN_REL])
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 0
    assert "::warning::" in out
    assert "uses-fixture" in out  # suited exempt skill is still warned


def test_exempt_suiteless_skill_is_dropped(monkeypatch, capsys, tmp_path):
    """The converse: a truly suiteless exempt skill contributes no unit-test
    references (skills_referencing_fixtures never sees it) and never warns —
    the exemption's intended case still holds."""
    _setup_repo(tmp_path, monkeypatch, runlog_matches_disk=False)
    monkeypatch.setattr(
        check_runlogs, "RUNLOG_GATE_EXEMPT_SKILLS", frozenset({"no-such-suiteless"})
    )
    _patch_diffs(monkeypatch, [_SCN_REL])
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 0
    assert "no-such-suiteless" not in out
    # `uses-fixture` is not exempt here, so it still warns as usual.
    assert "uses-fixture" in out


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
