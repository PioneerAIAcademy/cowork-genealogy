"""Unit tests for scripts/check_runlogs.py — rule 3 robustness.

Focus: a hand-written / stale-tool annotation that omits the required
correction keys (notably the deprecated run_index/dimension/source shape)
must produce a clean, blocking error — not an opaque KeyError crash.
"""

from __future__ import annotations

import importlib.util
import json
import pytest
from datetime import date, timedelta
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


def _corrections_for(
    test_ids: list[str], *, comment: str | None = "read it", score: int = 3
) -> list[dict]:
    """`score` defaults to a confirmed pass (3 -> 3), which is comment-exempt.
    Pass score=2 for a cell the comment rule still applies to."""
    return [
        {
            "test_id": tid,
            "dimension_source": "base",
            "dimension_name": name,
            "llm_score": score,
            "corrected_score": score,
            "comment": comment,
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
    without a warning a run with nothing gradeable passes silently.

    The message says "no reviewable dimensions": an aborted run, or one whose
    judge raised. A validator-failing run is not in this class any more — its
    graded scores reach `review_dimensions` and rule 3 requires them (next
    test) — so the wording must not name validators as a cause."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    log = _multi_test_log(3, review_sample={"tests": ["ut_x_000"], "cursor": [], "seed": 0})
    log["tests"].append(
        {"test_id": "ut_x_aborted", "outcome_summary": {"aggregated_dimensions": []}}
    )
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", _corrections_for(["ut_x_000"]))
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 0
    out = capsys.readouterr().out
    assert "no reviewable dimensions" in out
    assert "ut_x_aborted" in out


def _validator_failed_test(test_id: str = "ut_x_vf") -> dict:
    """As the harness writes a test whose only run failed a validator: `fail`,
    aggregate empty by ruling (#2057), the judge's rows in `review_dimensions`."""
    return {
        "test_id": test_id,
        "outcome": "fail",
        "outcome_summary": {
            "aggregated_dimensions": [],
            "review_dimensions": [
                {"source": "base", "name": "Correctness"},
                {"source": "base", "name": "Completeness"},
            ],
        },
    }


def test_rule3_requires_a_validator_failing_tests_review_dimensions(tmp_path, capsys):
    """The gap this closes: rule 3 iterated `aggregated_dimensions`, which is
    empty for a validator-failing test, so a sampled test that FAILED demanded
    zero corrections and CI stayed green on an annotation that never mentioned
    it. 4 of the 7 non-passing tests on one record-extraction run."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = ["ut_x_000", "ut_x_vf"]
    log = _multi_test_log(3, review_sample={"tests": sampled, "cursor": [], "seed": 0})
    log["tests"].append(_validator_failed_test())

    # Annotated the clean test only — what every annotator did before the fix.
    partial = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", _corrections_for(["ut_x_000"]))
    assert check_runlogs.rule3_completeness("init-project", log, partial, skill_dir) == 1
    out = capsys.readouterr().out
    assert "unreviewed" in out and "ut_x_vf" in out
    assert "no reviewable dimensions" not in out, "it is reviewable — that warning is for aborts"

    full = _write_ann(skill_dir, "v2_2026-06-24_00-00-00.json", _corrections_for(sampled))
    assert check_runlogs.rule3_completeness("init-project", log, full, skill_dir) == 0


def test_rule3_honours_a_sample_of_only_validator_failing_tests(tmp_path, capsys):
    """The fail-closed guard keys on the same accessor. A sample naming only a
    validator-failing test used to read as "only ungraded tests" and fall back
    to the every-dimension rule; it is a real sample and must be enforced as
    one — blocking on ITS unreviewed rows, not on the whole log's."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    log = _multi_test_log(2, review_sample={"tests": ["ut_x_vf"], "cursor": [], "seed": 0})
    log["tests"].append(_validator_failed_test())
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", corrections=[])
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 1
    out = capsys.readouterr().out
    assert "would require nothing" not in out
    assert "ut_x_vf" in out
    assert "ut_x_000" not in out, "unsampled tests owe nothing"


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


def test_formerly_exempt_skill_now_gated(tmp_path, monkeypatch, capsys):
    """research gained a trigger corpus (#1494) and was removed from
    RUNLOG_GATE_EXEMPT_SKILLS. Touching its SKILL.md now fails the gate
    like any non-exempt skill without committed run logs."""
    assert "research" not in check_runlogs.RUNLOG_GATE_EXEMPT_SKILLS
    _patch_diffs(monkeypatch, ["packages/engine/plugin/skills/research/SKILL.md"])
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", tmp_path)
    rc = check_runlogs.main()
    assert rc == 1
    assert "research" in capsys.readouterr().out


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


def _stage_runlog_dir(tmp_path, monkeypatch, skill="present-skill", candidates=()):
    """Point RUNLOGS_DIR at a tmp tree and populate `<skill>/` with the given
    candidate run-log filenames. Rule 7 recomputes the prunable set from the
    names on disk, so a skill whose deletions must read as a legitimate prune
    needs its surviving newer candidates staged here. Returns the skill's dir."""
    runlogs = tmp_path / "runlogs-unit"
    d = runlogs / skill
    d.mkdir(parents=True)
    for name in candidates:
        (d / name).write_text("{}", encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", runlogs)
    return d


def _five_newer_candidates() -> list[str]:
    """Five v1 candidates all newer than 2026-06-01, so a deleted 2026-06-01
    pair falls outside the keep-newest-5 window and reads as a real prune."""
    return [f"v1_2026-07-0{i}_00-00-00.json" for i in range(1, 6)]


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
    or prune sweep fails every skill on drift it did not cause.

    The deleted pair must read as a real prune under rule 7, so the five newer
    candidates that survive it are staged on disk (before rule 7 this test left
    RUNLOGS_DIR empty and the lone deletion recomputed to an empty prunable set,
    which rule 7 correctly flags)."""
    _make_present_skill(tmp_path, monkeypatch)
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=_five_newer_candidates())
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
    """A prune drops an annotation ALONGSIDE its run log; that stays green.

    The premise this test carried before rule 7 — deleting a lone `.ann.json`
    with no run-log deletion — is now exactly the destroy-grading shape rule 7
    flags (see the next test). A real prune deletes the pair, and only when the
    keep-newest-5 window has moved past it: the five newer candidates that
    survive are staged so the deleted 2026-06-01 pair recomputes as prunable."""
    _make_present_skill(tmp_path, monkeypatch)
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=_five_newer_candidates())
    pruned = [
        "eval/runlogs/unit/present-skill/v1_2026-06-01_00-00-00.json",
        "eval/runlogs/unit/present-skill/v1_2026-06-01_00-00-00.ann.json",
    ]
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: list(pruned))
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: list(pruned))

    rc = check_runlogs.main()
    assert rc == 0
    assert "no run logs" not in capsys.readouterr().out


# --- Rule 7: deletion of grading / run logs beyond the prune rule ----------
#
# The keep-newest-K set is recomputed from filenames (prunable_candidates over
# head ∪ deleted candidates), so no frozen baseline is needed. Broken two ways
# below: drop the recompute and a hand-deletion passes; drop --no-renames (its
# own argv test) and a rename-masked prune never reaches the rule. Green
# variants — legit prune, promotion, deleted skill — prove the other direction.


def test_rule7_lone_annotation_deletion_blocks(monkeypatch, capsys, tmp_path):
    """The #2737 core: deleting an `.ann.json` while its run log survives at
    head destroys committed grading with no prune to justify it — must block."""
    _make_present_skill(tmp_path, monkeypatch)
    # The run log survives on disk; only its annotation is deleted.
    _stage_runlog_dir(
        tmp_path, monkeypatch, candidates=["v1_2026-07-01_00-00-00.json"]
    )
    ann = "eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.ann.json"
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: [ann])
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: [ann])
    rc = check_runlogs.main()
    assert rc == 1
    out = capsys.readouterr().out
    assert "still present" in out
    assert "v1_2026-07-01_00-00-00.ann.json" in out


def test_rule7_2579_shape_blocks(monkeypatch, capsys, tmp_path):
    """The #2579 incident: a candidate `.json` + `.ann.json` pair deleted while
    only 4 candidates remain on disk (keep is 5), so the recomputed prunable set
    is empty and the deletion is a hand-deletion, not a prune."""
    _make_present_skill(tmp_path, monkeypatch)
    _stage_runlog_dir(
        tmp_path,
        monkeypatch,
        candidates=[f"v1_2026-09-0{i}_00-00-00.json" for i in range(4, 8)],  # 4 left
    )
    pruned = [
        "eval/runlogs/unit/present-skill/v1_2026-09-03_11-42-59.json",
        "eval/runlogs/unit/present-skill/v1_2026-09-03_11-42-59.ann.json",
    ]
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: list(pruned))
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: list(pruned))
    rc = check_runlogs.main()
    assert rc == 1
    out = capsys.readouterr().out
    assert "not a keep-newest-5 prune" in out
    assert "v1_2026-09-03_11-42-59.json" in out


def test_rule7_genuine_prune_passes(monkeypatch, capsys, tmp_path):
    """The oldest candidate beyond the newest 5 deleted with its annotation is a
    real prune and stays green — the direction a break-the-repo proof can't show."""
    _make_present_skill(tmp_path, monkeypatch)
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=_five_newer_candidates())
    pruned = [
        "eval/runlogs/unit/present-skill/v1_2026-06-01_00-00-00.json",
        "eval/runlogs/unit/present-skill/v1_2026-06-01_00-00-00.ann.json",
    ]
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: list(pruned))
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: list(pruned))
    rc = check_runlogs.main()
    assert rc == 0
    assert "All runlog rules satisfied" in capsys.readouterr().out


def test_rule7_promotion_passes(monkeypatch, tmp_path):
    """Promoting a candidate to a release is a rename read as delete(candidate) +
    add(v{N}.json) under --no-renames. The added release exempts the deleted
    candidate of the same version — even when it was the only candidate.

    Exercises `rule7_deletions` directly: through `main()` the added `v2.json`
    would (correctly) trip rules 2/3/6 for its own missing annotation, a
    different contract than the deletion guard under test."""
    _make_present_skill(tmp_path, monkeypatch)  # skill dir exists → not skipped
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=["v2.json"])  # only the release left
    deleted = {
        "eval/runlogs/unit/present-skill/v2_2026-07-01_00-00-00.json",
        "eval/runlogs/unit/present-skill/v2_2026-07-01_00-00-00.ann.json",
    }
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v2.json"]}) == 0
    # Without the promotion the same deletion is a within-K hand-deletion and
    # blocks — proof the exemption, not the deleted-skill skip, is what passes it.
    assert check_runlogs.rule7_deletions(deleted, {}) == 1


def test_rule7_deleted_released_log_blocks(monkeypatch, capsys, tmp_path):
    """A released `v{N}.json` is canonical and never prunable — deleting it (or
    its annotation) must block."""
    _make_present_skill(tmp_path, monkeypatch)
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=["v2_2026-07-01_00-00-00.json"])
    pruned = [
        "eval/runlogs/unit/present-skill/v1.json",
        "eval/runlogs/unit/present-skill/v1.ann.json",
    ]
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: list(pruned))
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: list(pruned))
    rc = check_runlogs.main()
    assert rc == 1
    out = capsys.readouterr().out
    assert "canonical" in out
    assert "v1.json" in out


def test_rule7_deleted_skill_skips(monkeypatch, capsys, tmp_path):
    """A wholly-deleted skill (skill dir AND test dir absent) has nothing left to
    protect — rule 7 skips it, the same skip rules 2 + 3 apply."""
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", tmp_path / "tests-unit")
    _stage_runlog_dir(tmp_path, monkeypatch, skill="gone-skill", candidates=[])
    pruned = [
        "eval/runlogs/unit/gone-skill/v1.json",
        "eval/runlogs/unit/gone-skill/v1.ann.json",
    ]
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: list(pruned))
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: list(pruned))
    rc = check_runlogs.main()
    assert rc == 0
    assert "All runlog rules satisfied" in capsys.readouterr().out


def test_rule7_deleted_paths_passes_no_renames(monkeypatch):
    """git_diff_deleted_paths must pass --no-renames, or a prune's delete+add
    pair is read as a rename and --diff-filter=D omits the deletion entirely —
    rule 7 (and rule 3's deleted-annotation arm) would then never see it."""
    monkeypatch.setenv("BASE_SHA", "base123")
    monkeypatch.setenv("HEAD_SHA", "head456")
    captured: dict = {}

    def fake_check_output(cmd, *args, **kwargs):
        captured["cmd"] = cmd
        return "eval/runlogs/unit/s/v1_2026-06-01_00-00-00.json\n"

    monkeypatch.setattr(check_runlogs.subprocess, "check_output", fake_check_output)
    paths = check_runlogs.git_diff_deleted_paths()
    assert paths == ["eval/runlogs/unit/s/v1_2026-06-01_00-00-00.json"]
    assert "--no-renames" in captured["cmd"]
    assert "base123...head456" in captured["cmd"]


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


def test_rule2_tolerates_a_cosmetic_name_description_edit(tmp_path, monkeypatch):
    """`normalize()` runs BEFORE hashing, so stripping test.{name,description}
    still makes a cosmetic edit a no-op.

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

    # Name and description are cosmetic — changing them should not invalidate.
    body["test"]["name"] = "RENAMED"
    body["test"]["description"] = "NEW description"
    (tests_dir / "ut_1.json").write_text(json.dumps(body), encoding="utf-8")
    assert check_runlogs.rule2_active("s1", log, "v1.json") == 0

    body["input"]["user_message"] = "SUBSTANTIVE"
    (tests_dir / "ut_1.json").write_text(json.dumps(body), encoding="utf-8")
    assert check_runlogs.rule2_active("s1", log, "v1.json") == 1


def test_rule2_treats_tag_edit_as_substantive(tmp_path, monkeypatch):
    """Tags select validators and change outcome computation (issue #2694).

    A tag edit must invalidate the snapshot — unlike name/description, tags
    are NOT cosmetic.
    """
    monkeypatch.delenv("COSMETIC_SKIP", raising=False)
    (tmp_path / "packages/engine/plugin/skills/s1").mkdir(parents=True)
    tests_dir = tmp_path / "eval/tests/unit/s1"
    tests_dir.mkdir(parents=True)
    body = {
        "test": {"id": "ut_1", "skill": "s1", "name": "n",
                 "description": "d", "tags": ["a"], "type": "positive"},
        "input": {"user_message": "m"},
    }
    (tests_dir / "ut_1.json").write_text(json.dumps(body), encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "REPO_ROOT", tmp_path)

    log = {"snapshot": build_snapshot(skill="s1", repo_root=tmp_path)}

    # Changing tags must invalidate the snapshot (returns 1).
    body["test"]["tags"] = ["z"]
    (tests_dir / "ut_1.json").write_text(json.dumps(body), encoding="utf-8")
    assert check_runlogs.rule2_active("s1", log, "v1.json") == 1


def test_rule3_ignores_an_empty_review_sample(tmp_path, capsys):
    """`{"tests": []}` must not switch the blocking rule off. This field is
    committed in the same PR it gates, so anything untrustworthy falls back to
    the every-dimension rule rather than being believed."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    log = _multi_test_log(3, review_sample={"tests": [], "cursor": [], "seed": 0})
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", corrections=[])
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 1
    out = capsys.readouterr().out
    assert "is empty" in out
    assert "unreviewed" in out


def test_rule3_ignores_a_review_sample_naming_unknown_tests(tmp_path, capsys):
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    log = _multi_test_log(3, review_sample={"tests": ["ut_nope"], "cursor": [], "seed": 0})
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", corrections=[])
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 1
    assert "not in this run log" in capsys.readouterr().out


def test_rule3_ignores_a_sample_of_only_ungraded_tests(tmp_path, capsys):
    """A sample naming only zero-dimension tests would require nothing."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    log = _multi_test_log(2, review_sample={"tests": ["ut_x_aborted"], "cursor": [], "seed": 0})
    log["tests"].append(
        {"test_id": "ut_x_aborted", "outcome_summary": {"aggregated_dimensions": []}}
    )
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", corrections=[])
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 1
    assert "would require nothing" in capsys.readouterr().out


def test_rule3_rejects_sampled_correction_without_comment(tmp_path, capsys):
    """Sampling only pays off if the remaining cells are read. 91.4% of the
    corpus this replaces was confirmed with no comment written at all."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = ["ut_x_000", "ut_x_001"]
    log = _multi_test_log(20, review_sample={"tests": sampled, "cursor": sampled, "seed": 0})
    fn = _write_ann(
        skill_dir,
        "v1_2026-06-24_00-00-00.json",
        _corrections_for(sampled, comment=None, score=2),
    )
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 1
    out = capsys.readouterr().out
    assert "no comment" in out


def test_rule3_rejects_a_whitespace_only_comment(tmp_path, capsys):
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = ["ut_x_000"]
    log = _multi_test_log(20, review_sample={"tests": sampled, "cursor": sampled, "seed": 0})
    fn = _write_ann(
        skill_dir,
        "v1_2026-06-24_00-00-00.json",
        _corrections_for(sampled, comment="   ", score=2),
    )
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 1
    assert "no comment" in capsys.readouterr().out


def test_rule3_does_not_require_comments_without_a_review_sample(tmp_path):
    """Every committed annotation predates both sampling and this rule; a
    comment mandate applied to them would redden 109 files retroactively."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    every = [f"ut_x_{i:03d}" for i in range(3)]
    log = _multi_test_log(3)  # no review_sample
    fn = _write_ann(
        skill_dir, "v1_2026-06-24_00-00-00.json", _corrections_for(every, comment=None)
    )
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 0


def test_rule3_ignores_a_missing_comment_on_an_unsampled_test(tmp_path):
    """Nothing is asked of an unsampled test, so a stray correction there is a
    bonus, not a debt."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = ["ut_x_000"]
    log = _multi_test_log(20, review_sample={"tests": sampled, "cursor": sampled, "seed": 0})
    corrections = _corrections_for(sampled) + _corrections_for(["ut_x_009"], comment=None)
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", corrections)
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 0


def test_rule3_reports_missing_dimensions_and_missing_comments_together(tmp_path, capsys):
    """Reporting only the first sends the author round a second CI cycle."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = ["ut_x_000", "ut_x_001"]
    log = _multi_test_log(20, review_sample={"tests": sampled, "cursor": sampled, "seed": 0})
    # ut_x_000 reviewed but uncommented; ut_x_001 not reviewed at all.
    fn = _write_ann(
        skill_dir,
        "v1_2026-06-24_00-00-00.json",
        _corrections_for(["ut_x_000"], comment=None, score=2),
    )
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 1
    out = capsys.readouterr().out
    assert "no comment" in out
    assert "unreviewed" in out


def test_rule3_exempts_a_confirmed_pass_from_the_comment_rule(tmp_path):
    """89.4% of corrections are 3 -> 3. Requiring a sentence there spends ~26 of
    every ~29 on the cells least likely to carry anything."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = ["ut_x_000"]
    log = _multi_test_log(20, review_sample={"tests": sampled, "cursor": sampled, "seed": 0})
    fn = _write_ann(
        skill_dir, "v1_2026-06-24_00-00-00.json", _corrections_for(sampled, comment=None)
    )
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 0


def test_rule3_still_requires_a_comment_on_an_overridden_pass(tmp_path, capsys):
    """3 -> 2 is not a confirmed pass; the annotator has to say what they saw."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = ["ut_x_000"]
    log = _multi_test_log(20, review_sample={"tests": sampled, "cursor": sampled, "seed": 0})
    corr = _corrections_for(sampled, comment=None)
    corr[0]["corrected_score"] = 2
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", corr)
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 1
    assert "no comment" in capsys.readouterr().out


def test_rule3_exempts_a_confirmed_na_from_the_comment_rule(tmp_path):
    """null -> null is the same shape as 3 -> 3: the judge said the dimension
    never applied and the reviewer agrees. 700 such cells exist, 91% silent."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = ["ut_x_000"]
    log = _multi_test_log(20, review_sample={"tests": sampled, "cursor": sampled, "seed": 0})
    corr = _corrections_for(sampled, comment=None)
    for c in corr:
        c["llm_score"] = None
        c["corrected_score"] = None
    fn = _write_ann(skill_dir, "v1_2026-06-24_00-00-00.json", corr)
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 0


def test_rule3_still_requires_a_comment_on_a_confirmed_partial(tmp_path, capsys):
    """Agreeing that something went wrong is exactly when to say what."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = ["ut_x_000"]
    log = _multi_test_log(20, review_sample={"tests": sampled, "cursor": sampled, "seed": 0})
    fn = _write_ann(
        skill_dir,
        "v1_2026-06-24_00-00-00.json",
        _corrections_for(sampled, comment=None, score=2),
    )
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir) == 1
    assert "no comment" in capsys.readouterr().out


# --- rule 6: the outcome gate ---------------------------------------------------
#
# Zero reds, not zero new reds (lead ruling 2026-09-22). No carry list, no
# review-by date, no per-entry exemption. Direct unit calls, because the shapes
# worth pinning are per-test; the main() wiring is covered further down.


def _t(test_id, outcomes, *, expected="pass"):
    return {
        "test_id": test_id,
        "expected_outcome": expected,
        "runs": [{"outcome": o} for o in outcomes],
    }


def _rule6(tests, closed=None, markers=None):
    return check_runlogs.rule6_outcomes(
        "s", {"tests": tests}, "v1.json", closed, markers
    )


def test_rule6_blocks_a_fail(capsys):
    assert _rule6([_t("ut_s_1", ["fail"])]) == 1
    assert "may not carry a red" in capsys.readouterr().out


def test_rule6_blocks_an_abort(capsys):
    assert _rule6([_t("ut_s_1", ["pass", "aborted"])]) == 1
    assert "resolved to `aborted`" in capsys.readouterr().out


def test_rule6_blocks_a_red_that_predates_the_pr(capsys):
    """The whole point of the 2026-09-22 reversal: there is no "already red"
    exemption, so an old red and a new one are the same failure."""
    assert _rule6([_t("ut_s_1", ["fail"]), _t("ut_s_2", ["fail"])]) == 2


def test_rule6_does_not_block_a_partial(capsys):
    assert _rule6([_t("ut_s_1", ["partial"])]) == 0


def test_rule6_uses_the_modal_aggregate_not_any_run(capsys):
    """[pass, fail, pass] is a passing test. Blocking on "any run failed" would be
    a second definition, and stricter than the runner's."""
    assert _rule6([_t("ut_s_1", ["pass", "fail", "pass"])]) == 0


def test_rule6_suppressed_fail_does_not_block(capsys):
    assert _rule6([_t("ut_s_1", ["fail"], expected="xfail")]) == 0


def test_rule6_suppressed_abort_blocks(capsys):
    """A marker declares a known FAILURE; an abort is an ungraded run."""
    assert _rule6([_t("ut_s_1", ["aborted"], expected="xfail")]) == 1
    assert "but ABORTED" in capsys.readouterr().out


def test_rule6_suppressed_pass_warns_but_does_not_block(capsys):
    assert _rule6([_t("ut_s_1", ["pass"], expected="xfail")]) == 0
    assert "but PASSED" in capsys.readouterr().out


def test_rule6_names_a_closed_owner_on_a_stale_marker(capsys):
    """A marker whose removal condition cites a closed issue can never be met.
    Three of the five live markers are in that state."""
    assert _rule6([_t("ut_s_1", ["pass"], expected="xfail")],
                  closed={2173}, markers={"ut_s_1": 2173}) == 0
    assert "issue #2173, which is CLOSED" in capsys.readouterr().out


def test_rule6_a_test_with_no_runs_blocks(capsys):
    """Schema forbids it, so this is a hand-edit guard — it must not resolve to
    green by falling through."""
    assert _rule6([{"test_id": "ut_s_1", "expected_outcome": "pass", "runs": []}]) == 1
    assert "has no runs" in capsys.readouterr().out


@pytest.mark.parametrize(
    "runs",
    [
        [{}],
        [{"outcome": None}],
        [{"outcome": "FAIL"}],
        [{"outcome": "failed"}],
        [{"outcome": "pass"}, {"outcome": "skipped"}],
    ],
    ids=["missing", "null", "uppercase", "misspelled", "one-bad-of-two"],
)
def test_rule6_blocks_an_outcome_outside_the_schema_enum(runs, capsys):
    entry = {"test_id": "ut_s_1", "expected_outcome": "pass", "runs": runs}
    assert check_runlogs.rule6_outcomes("s", {"tests": [entry]}, "v1.json") == 1
    assert "outside the schema's" in capsys.readouterr().out


def test_rule6_accepts_every_value_the_schema_allows(capsys):
    """The other direction — the guard must not reject a legitimate enum member."""
    for outcome in ("pass", "partial"):
        assert _rule6([_t(f"ut_s_{outcome}", [outcome])]) == 0


def test_rule6_an_all_suppressed_log_is_allowed(capsys):
    assert _rule6([_t("ut_s_1", ["fail"], expected="xfail"),
                   _t("ut_s_2", ["fail"], expected="xfail")]) == 0


def test_rule6_an_empty_tests_array_is_allowed():
    """`run_tests.py` exits 0 on an empty row set, so blocking here would be a
    second definition. Rules 1 and 3 own "a PR must carry a real run log"."""
    assert _rule6([]) == 0


# --- marker owners, read from the committed test corpus --------------------------


def test_marker_owners_reads_the_issue_out_of_an_xfail_reason(tmp_path):
    d = tmp_path / "some-skill"
    d.mkdir()
    (d / "t.json").write_text(json.dumps({"test": {
        "id": "ut_x_1", "expected_outcome": "xfail",
        "xfail_reason": "Remove this marker once #2173 lands.",
    }}), encoding="utf-8")
    assert check_runlogs.marker_owners(tmp_path) == {"ut_x_1": 2173}


def test_marker_owners_ignores_unmarked_tests_and_reasonless_markers(tmp_path):
    d = tmp_path / "some-skill"
    d.mkdir()
    (d / "a.json").write_text(json.dumps({"test": {
        "id": "ut_x_1", "expected_outcome": "pass",
        "xfail_reason": "mentions #999 but is not a marker"}}), encoding="utf-8")
    (d / "b.json").write_text(json.dumps({"test": {
        "id": "ut_x_2", "expected_outcome": "xfail",
        "xfail_reason": "no issue cited, so nothing to check"}}), encoding="utf-8")
    assert check_runlogs.marker_owners(tmp_path) == {}


def test_marker_owners_survives_an_unreadable_file(tmp_path):
    """It scans the whole corpus, so one bad file must not take the gate down."""
    d = tmp_path / "some-skill"
    d.mkdir()
    (d / "bad.json").write_text("{ not json", encoding="utf-8")
    (d / "good.json").write_text(json.dumps({"test": {
        "id": "ut_x_1", "expected_outcome": "xfail",
        "xfail_reason": "owned by #2030"}}), encoding="utf-8")
    assert check_runlogs.marker_owners(tmp_path) == {"ut_x_1": 2030}


def _clean_log(test_id="ut_ip_1", outcome="pass"):
    return {
        "snapshot": {},
        "tests": [{"test_id": test_id, "expected_outcome": "pass",
                   "runs": [{"outcome": outcome}]}],
    }


def _setup_versioned_skill(tmp_path, monkeypatch, skill="init-project"):
    """A released `v1.json` beside candidates — the shape `init-project` has on
    main, and the one `latest_full_skill_runlog` resolves backwards."""
    runlogs = tmp_path / "runlogs"
    skill_dir = runlogs / skill
    skill_dir.mkdir(parents=True)
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", runlogs)
    (tmp_path / "skills" / skill).mkdir(parents=True)
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", tmp_path / "skills")
    (tmp_path / "tests" / skill).mkdir(parents=True)
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", tmp_path / "tests")
    return skill_dir


def test_rule6_grades_the_added_log_not_the_released_one(tmp_path, monkeypatch, capsys):
    """`latest_full_skill_runlog` returns ANY released `v{N}.json` in preference to
    every candidate, whatever the date. So a PR adding a red candidate beside a
    clean released log would be read as clean if rule 6 used that resolution.
    It reads the log the PR ADDED instead."""
    skill_dir = _setup_versioned_skill(tmp_path, monkeypatch)
    (skill_dir / "v1.json").write_text(json.dumps(_clean_log()), encoding="utf-8")
    _write_ann(skill_dir, "v1.json", [])
    added = "v2_2026-09-22_09-00-00.json"
    (skill_dir / added).write_text(
        json.dumps(_clean_log("ut_ip_2", "fail")), encoding="utf-8"
    )
    _write_ann(skill_dir, added, [])
    _patch_diffs(monkeypatch, [f"eval/runlogs/unit/init-project/{added}"])

    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 1
    assert "ut_ip_2" in out and "resolved to `fail`" in out


def test_rule6_does_not_grade_the_baseline_on_an_annotation_only_pr(
    tmp_path, monkeypatch, capsys
):
    """An annotation-only PR adds no run log, so it is not accountable for the
    committed baseline's reds. Without this, a red skill could satisfy neither
    rule 3 nor rule 6 and its annotations could never land."""
    skill_dir = _setup_versioned_skill(tmp_path, monkeypatch)
    (skill_dir / "v1.json").write_text(
        json.dumps(_clean_log("ut_ip_9", "fail")), encoding="utf-8"
    )
    _write_ann(skill_dir, "v1.json", [])
    _patch_diffs(monkeypatch, ["eval/runlogs/unit/init-project/v1.ann.json"])

    check_runlogs.main()
    assert "resolved to `fail`" not in capsys.readouterr().out


def test_rule6_grades_every_added_log_when_a_pr_adds_two(tmp_path, monkeypatch, capsys):
    """Rule 1 caps RELEASED logs at one per skill and never short-circuits main(),
    so two added candidates reach rule 6 — any red in any of them blocks."""
    skill_dir = _setup_versioned_skill(tmp_path, monkeypatch)
    for name, tid, outcome in (
        ("v1_2026-09-22_08-00-00.json", "ut_ip_a", "pass"),
        ("v1_2026-09-22_09-00-00.json", "ut_ip_b", "fail"),
    ):
        (skill_dir / name).write_text(json.dumps(_clean_log(tid, outcome)), encoding="utf-8")
        _write_ann(skill_dir, name, [])
    _patch_diffs(
        monkeypatch,
        [f"eval/runlogs/unit/init-project/v1_2026-09-22_08-00-00.json",
         f"eval/runlogs/unit/init-project/v1_2026-09-22_09-00-00.json"],
    )

    rc = check_runlogs.main()
    out = capsys.readouterr().out
    # NOT just `"ut_ip_b" in out` -- rule 3 also names it (empty corrections), so that
    # alone stays green under a `break` that grades only the first added log.
    assert rc == 1
    assert "`ut_ip_b` resolved to `fail`" in out


def test_rule6_ignores_an_added_ann_json_and_a_scratch_log(tmp_path, monkeypatch, capsys):
    """`added_runlog_paths` holds every added path — `.ann.json` siblings included,
    because RUNLOG_PATH_RE matches anything ending `.json`. Parsing one as a run log
    would crash the gate. `classify()` is what actually excludes both an annotation
    and a `scratch_` log; assert the OUTCOME (nothing graded) rather than trusting
    either guard, since a bare `main()` call with no assertion passes even with rule
    6 deleted."""
    skill_dir = _setup_versioned_skill(tmp_path, monkeypatch)
    (skill_dir / "v1.json").write_text(json.dumps(_clean_log()), encoding="utf-8")
    _write_ann(skill_dir, "v1.json", [])
    scratch = "scratch_2026-09-22_09-00-00.json"
    (skill_dir / scratch).write_text(
        json.dumps(_clean_log("ut_ip_scratch", "fail")), encoding="utf-8"
    )
    _patch_diffs(monkeypatch, [
        "eval/runlogs/unit/init-project/v1.ann.json",
        f"eval/runlogs/unit/init-project/{scratch}",
    ])

    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert "rule 6: graded 0 added run log(s)" in out
    assert "ut_ip_scratch" not in out
    assert rc == 0


# --- rule 6: shapes that used to fall through as green ---------------------------
#
# The `has no runs` guard was added for hand-edited logs; four adjacent hand-edit
# shapes walked straight past it, because an unrecognized string aggregates to
# itself and matches neither "fail" nor "pass". CLAUDE.md names this exact pattern:
# "each made the tool exit 0 having done nothing, past a guard added beside it."


@pytest.mark.parametrize(
    "runs",
    [
        [{}],                        # entry missing `outcome` entirely
        [{"outcome": None}],
        [{"outcome": "FAIL"}],       # right word, wrong case
        [{"outcome": "failed"}],     # near-miss spelling
        [{"outcome": "pass"}, {"outcome": "skipped"}],
    ],
    ids=["missing", "null", "uppercase", "misspelled", "one-bad-of-two"],
)
def test_rule6_blocks_an_outcome_outside_the_schema_enum(runs, capsys):
    entry = {"test_id": "ut_s_1", "expected_outcome": "pass", "runs": runs}
    assert check_runlogs.rule6_outcomes("s", {"tests": [entry]}, "v1.json", {}) == 1
    assert "outside the schema's" in capsys.readouterr().out


def test_rule6_accepts_every_value_the_schema_allows(capsys):
    """The other direction — the guard must not reject a legitimate enum member."""
    for outcome in ("pass", "partial"):
        assert _rule6([_t(f"ut_s_{outcome}", [outcome])]) == 0


def test_rule5_names_an_unparseable_annotation_outside_the_repo(tmp_path, monkeypatch, capsys):
    """Direct regression test for rule 5's path handling. It used to call
    `relative_to(REPO_ROOT)` unguarded, so pointing RUNLOGS_DIR at a tmp dir raised
    ValueError instead of reporting the bad file — which is why rule 5 had no
    main()-level test at all. Named after rule 5 so a reverter sees the right rule
    fail."""
    skill_dir = tmp_path / "runlogs" / "some-skill"
    skill_dir.mkdir(parents=True)
    (skill_dir / "v1.ann.json").write_text("{ broken", encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", tmp_path / "runlogs")

    assert check_runlogs.rule5_annotations_parse(tmp_path / "runlogs") == 1
    assert "v1.ann.json" in capsys.readouterr().out


# --- An agent's OWN agent-keyed suite (issue #1253) ------------------------


def test_touched_agent_gates_its_own_agent_keyed_suite(monkeypatch, capsys, tmp_path):
    """An agent with its own suite and no SKILL.md anywhere referencing it must
    still be gated by an edit to its body.

    `skills_referencing_agents` can only reach suites that have a SKILL.md to
    scan. Before this rule, editing agents/gps-mentor.md gated only the skills
    that happen to name it (`research`) and never the suite that grades it, so
    the suite's run log stayed active against prose that had changed.
    """
    skills = _make_skills_tree(tmp_path)  # references spike-echo, not gps-mentor
    tests_unit = tmp_path / "tests-unit"
    (tests_unit / "gps-mentor").mkdir(parents=True)
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", skills)
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", tests_unit)
    _patch_diffs(monkeypatch, ["packages/engine/plugin/agents/gps-mentor.md"])
    rc = check_runlogs.main()
    assert rc == 1
    out = capsys.readouterr().out
    assert "gps-mentor" in out  # gated by its own name, with no referencing skill
    assert "uses-agent" not in out


def test_touched_agent_with_no_suite_is_untouched_by_the_identity_rule(
    monkeypatch, capsys, tmp_path
):
    """Keyed on directory existence, so an agent with no suite of its own
    (image-reader, record-extractor today) stays ungated until one lands —
    and arms itself when it does, with no constant to remember to edit."""
    skills = _make_skills_tree(tmp_path)
    tests_unit = tmp_path / "tests-unit"
    tests_unit.mkdir()
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", skills)
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", tests_unit)
    _patch_diffs(monkeypatch, ["packages/engine/plugin/agents/image-reader.md"])
    rc = check_runlogs.main()
    assert rc == 0
    assert "All runlog rules satisfied" in capsys.readouterr().out


# --- Rule 8: annotation header integrity -----------------------------------


def _make_ann(runlogs_dir: Path, skill: str, corrections: list[dict]) -> None:
    """Write a unit .ann.json under ``runlogs_dir/<skill>/``."""
    skill_dir = runlogs_dir / skill
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "v1_2026-01-01_00-00-00.ann.json").write_text(
        json.dumps(
            {"run_log": "v1_2026-01-01_00-00-00.json", "annotator": "t", "corrections": corrections}
        ),
        encoding="utf-8",
    )


def _correction(
    corrected_score: int | None, comment: str | None, *, test_id: str = "ut_x_001"
) -> dict:
    return {
        "test_id": test_id,
        "dimension_source": "base",
        "dimension_name": "Correctness",
        "llm_score": 1,
        "corrected_score": corrected_score,
        "comment": comment,
    }


def test_rule8_multi_header_blocks(tmp_path, capsys):
    """Arm 1: more than one LLM→Junior header in a single comment blocks."""
    _make_ann(tmp_path, "s", [
        _correction(3, "LLM: 1 → Junior: 1\nsome text\nLLM: 1 → Junior: 3"),
    ])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 1
    assert "2 LLM→Junior headers" in capsys.readouterr().out


def test_rule8_disagreeing_header_blocks(tmp_path, capsys):
    """Arm 2: header says Junior: 1 but corrected_score is 3."""
    _make_ann(tmp_path, "s", [
        _correction(3, "LLM: 1 → Junior: 1\nActual reasoning here"),
    ])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 1
    assert "header says Junior: 1" in capsys.readouterr().out


def test_rule8_na_on_numeric_blocks(tmp_path, capsys):
    """Arm 2: header says Junior: N/A but corrected_score is 2."""
    _make_ann(tmp_path, "s", [
        _correction(2, "LLM: 3 → Junior: N/A"),
    ])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 1
    assert "header says Junior: N/A" in capsys.readouterr().out


def test_rule8_numeric_on_null_blocks(tmp_path, capsys):
    """Arm 2: header says Junior: 3 but corrected_score is null."""
    _make_ann(tmp_path, "s", [
        _correction(None, "LLM: 1 → Junior: 3"),
    ])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 1
    assert "header says Junior: 3" in capsys.readouterr().out


def test_rule8_stale_header_after_override_blocks(tmp_path, capsys):
    """Arm 2: score was changed to 2 after the header was pasted (still says 1)."""
    _make_ann(tmp_path, "s", [
        _correction(2, "LLM: 3 → Junior: 1\nChanged my mind, partial pass"),
    ])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 1
    assert "header says Junior: 1" in capsys.readouterr().out


def test_rule8_ascii_arrow_blocks(tmp_path, capsys):
    """Arm 2: ASCII ``->`` variant with a disagreeing score."""
    _make_ann(tmp_path, "s", [
        _correction(3, "LLM: 1 -> Junior: 1"),
    ])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 1
    assert "header says Junior: 1" in capsys.readouterr().out


def test_rule8_agreeing_header_passes(tmp_path):
    """A header that agrees with corrected_score is fine."""
    _make_ann(tmp_path, "s", [
        _correction(3, "LLM: 1 → Junior: 3\nOverride rationale"),
    ])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 0


def test_rule8_prose_junior_passes(tmp_path):
    """Prose containing 'Junior: 3 of the 5 checks' is not a header."""
    _make_ann(tmp_path, "s", [
        _correction(1, "Junior: 3 of the 5 checks were skipped"),
    ])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 0


def test_rule8_cross_test_reference_passes(tmp_path):
    """A comment mentioning another test id is legitimate."""
    _make_ann(tmp_path, "s", [
        _correction(2, "See ut_citation_002 for the same pattern"),
    ])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 0


def test_rule8_na_on_na_passes(tmp_path):
    """N/A entry with N/A header agrees."""
    _make_ann(tmp_path, "s", [
        _correction(None, "LLM: N/A → Junior: N/A"),
    ])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 0


def test_rule8_no_header_passes(tmp_path):
    """A comment with no header at all is always fine."""
    _make_ann(tmp_path, "s", [
        _correction(2, "This is a plain comment with no pasted block"),
    ])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 0
