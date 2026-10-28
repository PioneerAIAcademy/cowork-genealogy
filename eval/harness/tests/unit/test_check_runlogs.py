"""Unit tests for scripts/check_runlogs.py — rule 3 robustness.

Focus: a hand-written / stale-tool annotation that omits the required
correction keys (notably the deprecated run_index/dimension/source shape)
must produce a clean, blocking error — not an opaque KeyError crash.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess

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
    monkeypatch.delenv("COSMETIC_SKIP_LABELS", raising=False)
    rc = check_runlogs.rule2_active("demo", _INACTIVE_LOG, "v1.json")
    assert rc == 1
    out = capsys.readouterr().out
    assert "NOT active" in out
    # Tells the senior the exact per-skill label, and how to create it.
    assert "`eval-cosmetic-skip:demo`" in out
    assert "gh label create eval-cosmetic-skip:demo" in out
    assert "waives nothing" not in out


def test_rule2_error_names_the_blocked_skills_own_label(monkeypatch, capsys):
    monkeypatch.delenv("COSMETIC_SKIP_LABELS", raising=False)
    check_runlogs.rule2_active("research-plan", _INACTIVE_LOG, "v1.json")
    out = capsys.readouterr().out
    assert "`eval-cosmetic-skip:research-plan`" in out
    assert "eval-cosmetic-skip:demo" not in out


def test_rule2_other_namespaced_label_naming_the_skill_does_not_waive(monkeypatch, capsys):
    """Only the eval-cosmetic-skip: namespace waives; `cluster:demo` or a bare
    `demo` label must not."""
    monkeypatch.setenv("COSMETIC_SKIP_LABELS", "demo\ncluster:demo")
    rc = check_runlogs.rule2_active("demo", _INACTIVE_LOG, "v1.json")
    assert rc == 1
    assert "NOT active" in capsys.readouterr().out


def test_rule2_bypassed_by_its_own_skill_label(monkeypatch, capsys):
    monkeypatch.setenv("COSMETIC_SKIP_LABELS", "developer\neval-cosmetic-skip:demo\n")
    rc = check_runlogs.rule2_active("demo", _INACTIVE_LOG, "v1.json")
    assert rc == 0
    out = capsys.readouterr().out
    assert "::warning" in out and "`eval-cosmetic-skip:demo`" in out


def test_rule2_label_for_one_skill_does_not_waive_another(monkeypatch, capsys):
    """The waiver is per skill. The legacy PR-wide COSMETIC_SKIP=1 is set too,
    so this fails against the old code, which waived every touched skill."""
    monkeypatch.setenv("COSMETIC_SKIP", "1")
    monkeypatch.setenv("COSMETIC_SKIP_LABELS", "eval-cosmetic-skip:other")
    rc = check_runlogs.rule2_active("demo", _INACTIVE_LOG, "v1.json")
    assert rc == 1
    assert "NOT active" in capsys.readouterr().out


def test_rule2_label_for_a_longer_skill_name_does_not_waive_its_prefix(monkeypatch, capsys):
    """`research` is a prefix of `research-plan`; the match must be exact."""
    monkeypatch.setenv("COSMETIC_SKIP_LABELS", "eval-cosmetic-skip:demo-two")
    rc = check_runlogs.rule2_active("demo", _INACTIVE_LOG, "v1.json")
    assert rc == 1
    assert "NOT active" in capsys.readouterr().out


def test_rule2_bare_label_waives_nothing(monkeypatch, capsys):
    monkeypatch.setenv("COSMETIC_SKIP_LABELS", "eval-cosmetic-skip")
    rc = check_runlogs.rule2_active("demo", _INACTIVE_LOG, "v1.json")
    assert rc == 1
    out = capsys.readouterr().out
    assert "`eval-cosmetic-skip:demo`" in out
    assert "waives nothing" in out


def test_rule2_label_list_tolerates_crlf_and_padding(monkeypatch):
    monkeypatch.setenv("COSMETIC_SKIP_LABELS", "  developer \r\n eval-cosmetic-skip:demo \r\n\r\n")
    assert check_runlogs.rule2_active("demo", _INACTIVE_LOG, "v1.json") == 0


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


def _write_released(tmp_path, name, *, version, timestamp, skill="present-skill"):
    """Write a released `v{N}.json` carrying the envelope `timestamp` that
    `release.ts` preserves ("`timestamp` is kept", release.ts:5). Rule 7 reads it
    to reconstruct the candidate filename the promotion consumed."""
    import json as _json
    d = tmp_path / "runlogs-unit" / skill
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(
        _json.dumps({"version": version, "timestamp": timestamp, "released": True}),
        encoding="utf-8",
    )
    return d / name


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
    # Rule 2f's own message. Rule 2c also grades a fixture-touched suite now, and
    # on this log (no `instrument`) it rightly warns "no instrument recorded".
    assert "a shared fixture this PR changed" not in out
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


def test_rule7_same_pr_run_and_release_passes(monkeypatch, tmp_path):
    """A PR that WRITES a candidate and RELEASES it in the same branch must not
    have the harness's own prune flagged.

    The documented flow (`docs/plan/eval-runlog-versioning.md` C3) is: the junior
    runs and grades, the senior clicks Release and pushes to the SAME branch. The
    write prunes the oldest candidate and prints "commit the deletions"; the
    release then renames `v{N}_<ts>.json` to `v{N}.json`.

    That promoted candidate is in neither set rule 7 unions: it is not a candidate
    at head (it is a release now) and it was never deleted (it was renamed inside
    the PR, so the net three-dot diff shows only the add). The union loses a
    member, and at keep=5 `prunable_candidates` of 5 names returns nothing, so the
    harness's own prune reads as a hand-deletion. Measured on PRs #3235 and #3286:
    eight restores in one day, which is why `record-extraction` and `timeline`
    carry 6 committed candidates where the cap is 5.
    """
    _make_present_skill(tmp_path, monkeypatch)
    # Head: the four surviving older candidates, plus the release just promoted.
    # The promoted candidate's own file is GONE from head under that name.
    survivors = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*survivors, "v9.json"])
    _write_released(tmp_path, "v9.json", version=9, timestamp="2026-08-01_00-00-00")
    # The harness pruned the oldest when it wrote the v9 candidate.
    deleted = {
        "eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json",
        "eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.ann.json",
    }
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v9.json"]}) == 0


@pytest.mark.parametrize(
    "timestamp",
    ["not-a-timestamp", "../../../etc/passwd", "2026-08-01_00-00-00.json"],
)
def test_rule7_a_malformed_timestamp_widens_nothing(monkeypatch, tmp_path, timestamp):
    """A malformed `timestamp` must not widen the prunable set.

    Note the mechanism, because the name is easy to misread: the bad value IS
    synthesized into a name and the union DOES receive it. What saves this is
    downstream, in `prunable_candidates`, which drops any name it cannot parse as
    a candidate. Nothing here rejects it. Only a WELL-FORMED timestamp can move
    the arithmetic, which is why the version-keyed skip, not name validation, is
    the guard that matters."""
    _make_present_skill(tmp_path, monkeypatch)
    survivors = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*survivors, "v9.json"])
    _write_released(tmp_path, "v9.json", version=9, timestamp=timestamp)
    deleted = {"eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json"}
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v9.json"]}) == 1


def test_rule7_promotion_synthesis_survives_a_corrupt_release(monkeypatch, tmp_path):
    """An unreadable or non-JSON release must not raise: the guard falls back to
    today's arithmetic rather than crashing the whole check."""
    _make_present_skill(tmp_path, monkeypatch)
    survivors = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    d = _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*survivors, "v9.json"])
    (d / "v9.json").write_text("{not json", encoding="utf-8")
    deleted = {"eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json"}
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v9.json"]}) == 1


def test_rule7_over_deletion_still_blocks_in_a_release_pr(monkeypatch, tmp_path):
    """The other direction: counting the promoted candidate must not wave through
    a SECOND deletion that the prune rule does not reach.

    With the promoted candidate counted the reconstructed dir holds 6, so exactly
    one name is prunable. A hand-deletion of a second, newer candidate alongside
    it must still flag, or the fix would have bought a free slot per release."""
    _make_present_skill(tmp_path, monkeypatch)
    survivors = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(3, 6)]
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*survivors, "v9.json"])
    _write_released(tmp_path, "v9.json", version=9, timestamp="2026-08-01_00-00-00")
    deleted = {
        "eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json",   # the real prune
        "eval/runlogs/unit/present-skill/v1_2026-07-02_00-00-00.json",   # one too many
    }
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v9.json"]}) == 1


def test_rule7_a_drifted_release_timestamp_buys_no_prunable_slot(monkeypatch, tmp_path):
    """A release whose envelope `timestamp` does not match the candidate filename
    it replaced must NOT widen the prunable set.

    This is the regression a blind review found in the first draft of the fix.
    That draft deduped on the synthesized string, so a one-second drift produced a
    PHANTOM sixth member: the union gained a slot and a hand-deletion of a
    within-keep candidate was accepted, which the old arithmetic correctly blocked.
    The guard is version-keyed now: a release whose version already appears among
    the deletions synthesizes nothing, because its rename is the deletion.

    `release.ts:5` promises the timestamp is kept, but nothing tests that promise,
    so this must not depend on it."""
    _make_present_skill(tmp_path, monkeypatch)
    survivors = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*survivors, "v9.json"])
    # envelope drifts one second from the candidate filename below
    _write_released(tmp_path, "v9.json", version=9, timestamp="2026-08-01_00-00-01")
    deleted = {
        "eval/runlogs/unit/present-skill/v9_2026-08-01_00-00-00.json",  # the real rename
        "eval/runlogs/unit/present-skill/v1_2026-07-02_00-00-00.json",  # a hand-deletion
    }
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v9.json"]}) == 1


def test_rule7_a_release_whose_version_was_deleted_gets_no_synthesis(
    monkeypatch, tmp_path
):
    """The version-keyed skip from the other side: a release whose version is
    among the deletions gets no synthesis at all, however its envelope reads.

    This does NOT show that a fabricated release is caught in general. One whose
    version is absent from the deletions is not covered by this skip and does buy
    a slot at the keep boundary; see the PR body's residual-hole note."""
    _make_present_skill(tmp_path, monkeypatch)
    survivors = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*survivors, "v9.json"])
    _write_released(tmp_path, "v9.json", version=9, timestamp="2099-01-01_00-00-00")
    deleted = {
        "eval/runlogs/unit/present-skill/v9_2026-08-01_00-00-00.json",
        "eval/runlogs/unit/present-skill/v1_2026-07-02_00-00-00.json",
    }
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v9.json"]}) == 1


def test_rule7_a_second_run_after_the_release_buys_no_free_deletion(
    monkeypatch, tmp_path
):
    """run -> release -> run again must not authorise a second deletion.

    The blocking hole a blind review found in the first fix. The second write
    prunes NOTHING, because the release left the directory at 4; but crediting the
    promoted candidate on top of the newly written one describes a directory that
    never existed, makes two deletions prunable where the harness pruned once, and
    waves through a hand-deletion of committed grading.

    The precondition is ordinary, not adversarial: edit the skill, run, senior
    releases, review comments arrive, edit again, run again -- and rule 2 FORCES
    that second run once the body changes."""
    _make_present_skill(tmp_path, monkeypatch)
    head = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(3, 6)]
    _stage_runlog_dir(
        tmp_path, monkeypatch,
        candidates=[*head, "v10_2026-08-02_00-00-00.json", "v9.json"],
    )
    _write_released(tmp_path, "v9.json", version=9, timestamp="2026-08-01_00-00-00")
    deleted = {
        "eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json",  # the one real prune
        "eval/runlogs/unit/present-skill/v1_2026-07-02_00-00-00.json",  # a hand-deletion
    }
    added = {"present-skill": ["v9.json", "v10_2026-08-02_00-00-00.json"]}
    assert check_runlogs.rule7_deletions(deleted, added) == 1


def test_rule7_synthesis_ignores_a_release_whose_envelope_is_not_an_object(
    monkeypatch, tmp_path
):
    """A JSON array or scalar is valid JSON and has no envelope. The guard must
    skip it rather than raise: `rule7_deletions` is unit-tested directly, so its
    docstring is the contract even where `main()` would crash earlier."""
    _make_present_skill(tmp_path, monkeypatch)
    survivors = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    d = _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*survivors, "v9.json"])
    (d / "v9.json").write_text("[1, 2, 3]", encoding="utf-8")
    deleted = {"eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json"}
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v9.json"]}) == 1


def test_rule7_synthesis_is_released_only_not_any_added_candidate(
    monkeypatch, tmp_path
):
    """Only an added RELEASE may synthesize. If an added candidate could too, the
    widening would be one slot per added candidate rather than one per PR, which
    rule 1 does not bound.

    The added name is a SCRATCH log, deliberately. An added candidate returns at
    the bail-out above and never reaches the released-only filter, so a candidate
    here would make this test pass for the wrong reason -- which it did until
    clack391 caught it on #3306.

    Stated plainly, because the fixed test still does not prove what its name
    says: a scratch log is excluded by its None VERSION, not by its kind. The
    `kind == "released()"` check is unreachable-by-difference given the bail-out,
    and the code comment there says so. This pins the OUTCOME -- a non-release
    added name synthesizes nothing -- which is the part that matters."""
    names = check_runlogs._promoted_candidate_names(
        tmp_path, ["scratch_2026-08-01_00-00-00.json"], set()
    )
    assert names == set()


@pytest.mark.parametrize("timestamp", [None, 123, {"a": 1}, []])
def test_rule7_a_non_string_timestamp_does_not_raise(monkeypatch, tmp_path, timestamp):
    """The `isinstance(ts, str)` guard had no test: deleting it left all tests
    green, while a `null` timestamp would raise AttributeError and crash the whole
    check. A released log is author-written, so a non-string here is reachable."""
    _make_present_skill(tmp_path, monkeypatch)
    survivors = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*survivors, "v9.json"])
    _write_released(tmp_path, "v9.json", version=9, timestamp=timestamp)
    deleted = {"eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json"}
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v9.json"]}) == 1


def test_rule7_two_releases_in_one_pr_synthesize_nothing(monkeypatch, tmp_path):
    """run -> release -> run -> release must not credit two emptied slots.

    Measured before this guard: 0 errors here against 2 on main, so rule 7's own
    answer was wrong even though `rule1_max_one_released` fails the PR anyway.
    Rule 7 should be right without leaning on another rule's verdict."""
    _make_present_skill(tmp_path, monkeypatch)
    head = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(3, 6)]
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*head, "v9.json", "v10.json"])
    _write_released(tmp_path, "v9.json", version=9, timestamp="2026-08-01_00-00-00")
    _write_released(tmp_path, "v10.json", version=10, timestamp="2026-08-02_00-00-00")
    deleted = {
        "eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json",
        "eval/runlogs/unit/present-skill/v1_2026-07-02_00-00-00.json",
    }
    added = {"present-skill": ["v9.json", "v10.json"]}
    assert check_runlogs.rule7_deletions(deleted, added) == 2


def test_rule7_version_skip_and_mains_version_exemption_compose(monkeypatch, tmp_path):
    """The path where synthesis is SKIPPED and main's version exemption carries
    the deletion: a same-PR release whose pruned candidate shares its version.
    Neither mechanism alone is obviously sufficient, so pin that they compose."""
    _make_present_skill(tmp_path, monkeypatch)
    survivors = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*survivors, "v9.json"])
    _write_released(tmp_path, "v9.json", version=9, timestamp="2026-08-01_00-00-00")
    deleted = {"eval/runlogs/unit/present-skill/v9_2026-08-01_00-00-00.json"}
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v9.json"]}) == 0


def test_rule7_a_release_with_no_matching_deletion_buys_one_slot(monkeypatch, tmp_path):
    """KNOWN, BOUNDED HOLE — characterized, not fixed.

    A released log whose version is absent from the deletions is indistinguishable
    from a real promotion by filename alone, so it synthesizes a phantom candidate
    and widens the union by one. At the keep boundary that authorises exactly ONE
    deletion (the oldest) which main blocks. Bound: one, and only the oldest.

    Not closed by requiring the synthesized name to exist in branch history: a
    junior who runs and releases in a single commit never committed the candidate,
    so that check reinstates the very false positive this PR removes. Rules 2 and 3
    independently scrutinize a hand-added release (active snapshot, full
    annotation).

    If this starts failing, the hole was closed or widened — either way, read the
    diff rather than updating the expectation."""
    _make_present_skill(tmp_path, monkeypatch)
    head = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*head, "v9.json"])
    _write_released(tmp_path, "v9.json", version=9, timestamp="2026-08-01_00-00-00")
    deleted = {"eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json"}
    added = {"present-skill": ["v9.json"]}
    assert check_runlogs.rule7_deletions(deleted, added) == 0

    # the bound: a SECOND hand-deletion is not bought by the same phantom
    deleted.add("eval/runlogs/unit/present-skill/v1_2026-07-02_00-00-00.json")
    assert check_runlogs.rule7_deletions(deleted, added) == 1


@pytest.mark.parametrize("timestamp", ["  2026-08-01_00-00-00", "2026-08-01_00-00-00  "])
def test_rule7_a_padded_timestamp_buys_no_slot(monkeypatch, tmp_path, timestamp):
    """Padding inside a real timestamp is corruption, and the name is NOT repaired.

    Trimming it would synthesize a filename the release flow never wrote. Left
    alone it does not parse as a candidate, `prunable_candidates` drops it, and the
    deletion blocks -- fail closed. Deleting the `.strip()` this pins left all 140
    tests green (clack391, #3306)."""
    _make_present_skill(tmp_path, monkeypatch)
    survivors = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*survivors, "v9.json"])
    _write_released(tmp_path, "v9.json", version=9, timestamp=timestamp)
    deleted = {"eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json"}
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v9.json"]}) == 1


def test_rule7_an_unreadable_release_buys_no_slot(monkeypatch, tmp_path):
    """The OSError arm of the `except (OSError, ValueError)`. Narrowing it to
    ValueError alone left all 140 tests green: a released log the PR added but
    which is absent from the tree raises OSError, and an uncaught one would crash
    the whole check rather than decline the synthesis (clack391, #3306)."""
    _make_present_skill(tmp_path, monkeypatch)
    survivors = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    # staged WITHOUT v9.json, so reading it raises rather than parsing
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=survivors)
    deleted = {"eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json"}
    assert check_runlogs.rule7_deletions(deleted, {"present-skill": ["v9.json"]}) == 1


def test_rule7_reads_head_candidates_from_the_prs_own_tree(monkeypatch, tmp_path):
    """CI checks out the MERGE commit, so the working tree carries candidates only
    MAIN wrote. They pad the union, and a WITHIN-keep hand-deletion the PR's own tree
    flags is accepted off that scan -- measured by clack391 on #3306 as main 1 error
    against 0 here.

    The PR's own tree holds three candidates and releases one; main contributed two
    more. Off the merge tree the union reaches 7, so the two oldest are prunable and
    the hand-deletion of `07-03` lands inside them. Off the PR's own three it reaches
    5, nothing is prunable, and the deletion is what it is."""
    _make_present_skill(tmp_path, monkeypatch)
    mine_at_head = ["v1_2026-07-02_00-00-00.json",
                    "v1_2026-07-04_00-00-00.json",
                    "v1_2026-07-05_00-00-00.json"]
    only_main = ["v1_2026-09-01_00-00-00.json", "v1_2026-09-02_00-00-00.json"]
    _stage_runlog_dir(
        tmp_path, monkeypatch, candidates=[*mine_at_head, *only_main, "v9.json"]
    )
    _write_released(tmp_path, "v9.json", version=9, timestamp="2026-08-01_00-00-00")
    # a candidate in the middle of the PR's own set, not its oldest
    deleted = {"eval/runlogs/unit/present-skill/v1_2026-07-03_00-00-00.json"}
    added = {"present-skill": ["v9.json"]}

    assert check_runlogs.rule7_deletions(deleted, added) == 0, "the merge tree's view"
    assert (
        check_runlogs.rule7_deletions(
            deleted, added, head_listing={"present-skill": set(mine_at_head)}
        )
        == 1
    ), "the PR's own view"


def test_rule7_a_legitimate_release_still_passes_under_the_head_listing(
    monkeypatch, tmp_path
):
    """The other direction, which breaking the repo cannot test: the listing must not
    turn a REAL same-PR run-and-release prune into a failure."""
    _make_present_skill(tmp_path, monkeypatch)
    mine = [f"v1_2026-07-0{i}_00-00-00.json" for i in range(2, 6)]
    _stage_runlog_dir(tmp_path, monkeypatch, candidates=[*mine, "v9.json"])
    _write_released(tmp_path, "v9.json", version=9, timestamp="2026-08-01_00-00-00")
    deleted = {"eval/runlogs/unit/present-skill/v1_2026-07-01_00-00-00.json"}
    assert (
        check_runlogs.rule7_deletions(
            deleted, {"present-skill": ["v9.json"]}, head_listing={"present-skill": set(mine)}
        )
        == 0
    )


def test_head_candidates_by_skill_is_none_without_a_head_sha(monkeypatch):
    """No HEAD_SHA (every local run and every test) falls back to the directory
    scan, which is correct there because the working tree IS the PR's tree.

    Asserts git is never INVOKED, not merely that the result is None: deleting the
    guard makes `git ls-tree` run against a bogus rev, which fails, which the
    fail-open arm turns back into None -- so a return-value assertion passes with
    the guard removed and proves nothing."""
    monkeypatch.delenv("HEAD_SHA", raising=False)
    called: list[object] = []

    def _never(*a, **k):
        called.append(a)
        raise AssertionError("git must not run without a HEAD_SHA")

    monkeypatch.setattr(check_runlogs.subprocess, "check_output", _never)
    assert check_runlogs.head_candidates_by_skill() is None
    assert called == []


def test_head_candidates_by_skill_falls_back_when_git_fails(monkeypatch):
    """Fail OPEN. A listing we cannot read is not a reason to crash the check and
    leave every later rule ungraded."""
    monkeypatch.setenv("HEAD_SHA", "deadbeef")

    def _boom(*a, **k):
        raise subprocess.CalledProcessError(128, "git")

    monkeypatch.setattr(check_runlogs.subprocess, "check_output", _boom)
    assert check_runlogs.head_candidates_by_skill() is None


def test_head_candidates_by_skill_keeps_only_candidates(monkeypatch):
    """Released logs, annotations and scratch logs are not candidates and must not
    enter the union through this door."""
    monkeypatch.setenv("HEAD_SHA", "deadbeef")
    monkeypatch.setattr(
        check_runlogs.subprocess,
        "check_output",
        lambda *a, **k: (
            "eval/runlogs/unit/alpha/v1_2026-07-01_00-00-00.json\n"
            "eval/runlogs/unit/alpha/v1_2026-07-01_00-00-00.ann.json\n"
            "eval/runlogs/unit/alpha/v2.json\n"
            "eval/runlogs/unit/alpha/scratch_2026-07-01_00-00-00.json\n"
            "eval/runlogs/unit/beta/v3_2026-08-01_00-00-00.json\n"
        ),
    )
    assert check_runlogs.head_candidates_by_skill() == {
        "alpha": {"v1_2026-07-01_00-00-00.json"},
        "beta": {"v3_2026-08-01_00-00-00.json"},
    }


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
    monkeypatch.delenv("COSMETIC_SKIP_LABELS", raising=False)
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
    monkeypatch.delenv("COSMETIC_SKIP_LABELS", raising=False)
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
    monkeypatch.delenv("COSMETIC_SKIP_LABELS", raising=False)
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


def _rule6(tests):
    return check_runlogs.rule6_outcomes("s", {"tests": tests}, "v1.json")


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


def test_rule6_passes_a_test_that_passed_its_three_fail_retries(capsys):
    """The shapes the harness's fail-retries write (issue #3733) need no rule
    change: three passing retries outvote the failure, one failed retry does not."""
    assert _rule6([_t("ut_s_1", ["fail", "pass", "pass", "pass"])]) == 0
    assert _rule6([_t("ut_s_1", ["fail", "pass", "fail"])]) == 1
    assert _rule6([_t("ut_s_1", ["fail", "pass", "pass", "fail"])]) == 1


def test_rule6_an_xfail_marker_no_longer_suppresses_a_fail(capsys):
    """Lead, 2026-10-06: "We no longer allow xfail." A marked fail is red."""
    assert _rule6([_t("ut_s_1", ["fail"], expected="xfail")]) == 1
    assert "may not carry a red" in capsys.readouterr().out


def test_rule6_a_marked_test_that_passes_is_clean(capsys):
    assert _rule6([_t("ut_s_1", ["pass"], expected="xfail")]) == 0
    assert capsys.readouterr().out == ""


def test_rule6_a_test_with_no_runs_blocks(capsys):
    """Schema forbids it, so this is a hand-edit guard — it must not resolve to
    green by falling through."""
    assert _rule6([{"test_id": "ut_s_1", "expected_outcome": "pass", "runs": []}]) == 1
    assert "has no runs" in capsys.readouterr().out


def test_rule6_an_empty_tests_array_is_allowed():
    """`run_tests.py` exits 0 on an empty row set, so blocking here would be a
    second definition. Rules 1 and 3 own "a PR must carry a real run log"."""
    assert _rule6([]) == 0


# --- rule 9: aggregate outcome enum, corpus-wide (#2842) -------------------------


def _write_runlog(dir_path, filename, outcomes):
    """Write a minimal committed-shaped run log with the given aggregate
    ``tests[].outcome`` values."""
    d = dir_path / "some-skill"
    d.mkdir(parents=True, exist_ok=True)
    tests = [{"test_id": f"ut_s_{i}", "outcome": o} for i, o in enumerate(outcomes)]
    (d / filename).write_text(json.dumps({"tests": tests}), encoding="utf-8")


@pytest.mark.parametrize("retired", ["xfail", "xpass"])
def test_rule9_blocks_a_retired_aggregate_outcome(tmp_path, retired, capsys):
    """The straggler class: a committed run log whose aggregate `outcome` is a
    retired value. Rule 6 cannot see it — it reads per-run outcomes and only on
    PR-added logs — so this corpus-wide rule is what catches one landed by merge.
    Break the enum narrowing (put xfail/xpass back on `_RUN_OUTCOMES`) and this
    goes green: the falsifiability check."""
    _write_runlog(tmp_path, "v1.json", ["pass", retired])
    assert check_runlogs.rule9_outcome_enum(tmp_path) == 1
    out = capsys.readouterr().out
    assert retired in out and "v1.json" in out


def test_rule9_accepts_every_value_the_schema_allows(tmp_path):
    """The other direction — a log of legitimate aggregates must pass."""
    _write_runlog(tmp_path, "v1.json", ["pass", "partial", "fail", "aborted"])
    assert check_runlogs.rule9_outcome_enum(tmp_path) == 0


def test_rule9_skips_scratch_and_annotation_files(tmp_path, capsys):
    """A retired value in a scratch log (gitignored, never committed) or inside an
    `.ann.json` (a different shape) must NOT trip the rule — the reach guard, so
    the check cannot be dodged by mislabelling and cannot false-flag an annotation."""
    _write_runlog(tmp_path, "scratch_2026-09-28_10-00-00.json", ["xfail"])
    d = tmp_path / "some-skill"
    (d / "v1.ann.json").write_text(
        json.dumps({"corrections": [{"outcome": "xpass"}]}), encoding="utf-8"
    )
    assert check_runlogs.rule9_outcome_enum(tmp_path) == 0
    assert capsys.readouterr().out == ""


# --- marker owners, read from the committed test corpus --------------------------


def _write_test(dir_, name, test):
    dir_.mkdir(parents=True, exist_ok=True)
    (dir_ / name).write_text(json.dumps({"test": test}), encoding="utf-8")


def test_rule10_blocks_a_touched_skill_that_carries_a_marker(tmp_path, capsys, monkeypatch):
    monkeypatch.delenv("COSMETIC_SKIP_LABELS", raising=False)
    _write_test(tmp_path, "a.json", {"id": "ut_x_1", "expected_outcome": "xfail",
                                     "xfail_reason": "owned by #2030"})
    _write_test(tmp_path, "b.json", {"id": "ut_x_2"})
    assert check_runlogs.rule10_no_xfail_markers("x", tmp_path) == 1
    out = capsys.readouterr().out
    assert "ut_x_1" in out and "ut_x_2" not in out


def test_rule10_finds_a_marker_in_a_nested_dir(tmp_path, capsys, monkeypatch):
    monkeypatch.delenv("COSMETIC_SKIP_LABELS", raising=False)
    _write_test(tmp_path / "sub", "a.json", {"id": "ut_x_1", "expected_outcome": "xfail"})
    assert check_runlogs.rule10_no_xfail_markers("x", tmp_path) == 1


@pytest.mark.parametrize(
    "test",
    [{"id": "ut_x_1"}, {"id": "ut_x_1", "expected_outcome": "pass"}],
    ids=["no-field", "explicit-pass"],
)
def test_rule10_accepts_an_unmarked_suite(tmp_path, test, monkeypatch):
    monkeypatch.delenv("COSMETIC_SKIP_LABELS", raising=False)
    _write_test(tmp_path, "a.json", test)
    assert check_runlogs.rule10_no_xfail_markers("x", tmp_path) == 0


def test_rule10_accepts_a_missing_suite_dir_and_unreadable_files(tmp_path, monkeypatch):
    monkeypatch.delenv("COSMETIC_SKIP_LABELS", raising=False)
    assert check_runlogs.rule10_no_xfail_markers("x", tmp_path / "absent") == 0
    tmp_path.joinpath("bad.json").write_text("{not json", encoding="utf-8")
    tmp_path.joinpath("list.json").write_text("[]", encoding="utf-8")
    assert check_runlogs.rule10_no_xfail_markers("x", tmp_path) == 0


def test_rule10_only_warns_under_the_skills_cosmetic_skip_label(tmp_path, capsys, monkeypatch):
    _write_test(tmp_path, "a.json", {"id": "ut_x_1", "expected_outcome": "xfail"})
    monkeypatch.setenv("COSMETIC_SKIP_LABELS", "eval-cosmetic-skip:x")
    assert check_runlogs.rule10_no_xfail_markers("x", tmp_path) == 0
    assert "::warning" in capsys.readouterr().out
    monkeypatch.setenv("COSMETIC_SKIP_LABELS", "eval-cosmetic-skip:other")
    assert check_runlogs.rule10_no_xfail_markers("x", tmp_path) == 1


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


# --- Rules 2, 2b and 3 grade the run log the PR adds (#3272) ---------------------
#
# `latest_full_skill_runlog` prefers ANY released `v{N}.json` over every candidate, so
# when main released a log newer than the PR's own candidate, rules 2 and 3 graded main's
# release and the PR's own run was checked by nothing. These build that shape with a
# snapshot that names a file really on disk: `_clean_log`'s empty snapshot can never be
# stale, so a test on it would never reach rule 2's comparison.

_TRACKED_REL = "packages/engine/plugin/skills/init-project/SKILL.md"
_RUNLOGS_REL = "eval/runlogs/unit/init-project"
_STALE_JUDGE = "0" * 64


def _setup_graded_skill(tmp_path, monkeypatch):
    """`_setup_versioned_skill` plus a tmp repo that really holds the one file the run
    logs snapshot, so rule 2's `diff_snapshot_vs_disk` runs for real. The judge prompt
    is a tmp file too, so rule 2b's comparison never depends on the repo's."""
    skill_dir = _setup_versioned_skill(tmp_path, monkeypatch)
    repo = tmp_path / "repo"
    (repo / _TRACKED_REL).parent.mkdir(parents=True)
    (repo / _TRACKED_REL).write_text("disk body\n", encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "REPO_ROOT", repo)
    judge = tmp_path / "judge-prompt.md"
    judge.write_text("judge prompt\n", encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "JUDGE_PROMPT_PATH", judge)
    monkeypatch.delenv("COSMETIC_SKIP_LABELS", raising=False)
    return skill_dir


def _put_runlog(skill_dir, name, *, active, annotated=True, **extra):
    """Write a clean run log whose snapshot of the tracked file matches disk (`active`)
    or predates it, with an empty `.ann.json` unless `annotated` is False. The log has
    no review dimensions, so an empty annotation is a complete one."""
    body = b"disk body\n" if active else b"older body\n"
    log = {**_clean_log(), "snapshot": {_TRACKED_REL: normalize(_TRACKED_REL, body)}, **extra}
    (skill_dir / name).write_text(json.dumps(log), encoding="utf-8")
    if annotated:
        _write_ann(skill_dir, name, [])


def _pr_adds(monkeypatch, *names):
    _patch_diffs(monkeypatch, [f"{_RUNLOGS_REL}/{name}" for name in names])


def _only_line(out, needle):
    """The one output line holding `needle`. A message and its detail lines are
    separate lines, so asserting on the returned line pins that a file name and a
    wording belong to the SAME message."""
    lines = [line for line in out.splitlines() if needle in line]
    assert len(lines) == 1, f"expected one line holding {needle!r}, got {lines}"
    return lines[0]


def _violations(out):
    """The rule-violation count `main()` prints, so a test can say WHICH rules failed
    by how many, not just that something did."""
    m = re.search(r"^(\d+) rule violation\(s\)\.", out, re.M)
    return int(m.group(1)) if m else 0


def test_rules_2_and_2b_grade_the_candidate_the_pr_adds_not_a_newer_release(
    tmp_path, monkeypatch, capsys
):
    """A PR whose candidate predates its merge with main, while main's newer released log
    matches the merged tree. Rule 2 must name the candidate and call it stale. Graded
    through `latest_full_skill_runlog` it reads the release, which is active, and passes."""
    skill_dir = _setup_graded_skill(tmp_path, monkeypatch)
    _put_runlog(skill_dir, "v3.json", active=True)
    added = "v2_2026-10-08_10-00-00.json"
    _put_runlog(skill_dir, added, active=False, judge_prompt_hash=_STALE_JUDGE)
    _pr_adds(monkeypatch, added)

    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 1
    assert _violations(out) == 1  # the candidate is annotated, so rule 2 alone fails
    not_active = _only_line(out, "NOT active")
    assert f"`{added}`" in not_active and "the run log this PR adds" in not_active
    stale_judge = _only_line(out, "older judge prompt")
    assert f"`{added}`" in stale_judge and "the run log this PR adds" in stale_judge
    assert "v3.json" not in out


def test_rule3_grades_the_annotation_of_the_candidate_the_pr_adds(
    tmp_path, monkeypatch, capsys
):
    """The same shape with the candidate active but unannotated. Main's release is
    annotated, so graded through `latest_full_skill_runlog` rule 3 finds a complete
    annotation and passes."""
    skill_dir = _setup_graded_skill(tmp_path, monkeypatch)
    _put_runlog(skill_dir, "v3.json", active=True)
    added = "v2_2026-10-08_10-00-00.json"
    _put_runlog(skill_dir, added, active=True, annotated=False)
    _pr_adds(monkeypatch, added)

    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 1
    assert _violations(out) == 1  # the candidate is active, so rule 3 alone fails
    missing = _only_line(out, "has no annotation file")
    assert f"`{added}`" in missing and "the run log this PR adds" in missing


def test_a_pr_that_adds_two_candidates_is_graded_on_the_newer_one(
    tmp_path, monkeypatch, capsys
):
    """Rule 1 does not bound candidates, so a PR can ship several iterations, and the
    newest is the run it ships. The older one here is stale and unannotated and must not
    block (rule 6 still grades both). Versions 9 and 10 on purpose: as strings "v9_"
    sorts after "v10_", so a sort on the name would pick the stale one. The stale judge
    hash makes rule 2b's warning name the log that was graded, so a gate that graded
    nothing cannot pass for this."""
    skill_dir = _setup_graded_skill(tmp_path, monkeypatch)
    older, newer = "v9_2026-10-08_09-00-00.json", "v10_2026-10-08_10-00-00.json"
    _put_runlog(skill_dir, older, active=False, annotated=False, judge_prompt_hash=_STALE_JUDGE)
    _put_runlog(skill_dir, newer, active=True, judge_prompt_hash=_STALE_JUDGE)
    _pr_adds(monkeypatch, older, newer)

    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 0
    assert f"`{newer}`" in _only_line(out, "older judge prompt")
    assert "rule 6: graded 2 added run log(s)" in out


def test_a_pr_that_adds_no_run_log_is_still_graded_on_the_latest_on_disk(
    tmp_path, monkeypatch, capsys
):
    """SKILL.md-only, annotation-only and cosmetic-skip PRs add no run log, and resolve
    exactly as before: a released log beats every candidate whatever its version, so the
    stale `v3.json` is graded and the newer active candidate beside it is not."""
    skill_dir = _setup_graded_skill(tmp_path, monkeypatch)
    _put_runlog(skill_dir, "v3.json", active=False)
    candidate = "v4_2026-10-08_10-00-00.json"
    _put_runlog(skill_dir, candidate, active=True)
    _patch_diffs(monkeypatch, [_TRACKED_REL])

    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 1
    assert _violations(out) == 1
    not_active = _only_line(out, "NOT active")
    assert "`v3.json`" in not_active
    assert "the latest full-skill run log on disk" in not_active
    assert candidate not in out


def test_a_pr_that_adds_no_run_log_passes_on_an_active_latest_on_disk(
    tmp_path, monkeypatch, capsys
):
    """The green half of the test above. The stale judge hash makes rule 2b's warning
    name the log that was graded, so a gate that graded nothing cannot pass for this."""
    skill_dir = _setup_graded_skill(tmp_path, monkeypatch)
    _put_runlog(skill_dir, "v3.json", active=True, judge_prompt_hash=_STALE_JUDGE)
    _patch_diffs(monkeypatch, [_TRACKED_REL])

    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 0
    stale_judge = _only_line(out, "older judge prompt")
    assert "`v3.json`" in stale_judge
    assert "the latest full-skill run log on disk" in stale_judge


def test_a_released_log_the_pr_adds_outranks_the_candidates_it_adds_beside_it(
    tmp_path, monkeypatch, capsys
):
    """The candidate -> release rename arrives as an add, next to the candidates that led
    to it, and the release is what the PR ships. Both candidates are active and annotated,
    so only grading the stale release can fail this PR: rc alone proves it was graded."""
    skill_dir = _setup_graded_skill(tmp_path, monkeypatch)
    candidates = ["v3_2026-10-07_09-00-00.json", "v3_2026-10-07_10-00-00.json"]
    _put_runlog(skill_dir, "v4.json", active=False)
    for name in candidates:
        _put_runlog(skill_dir, name, active=True)
    _pr_adds(monkeypatch, "v4.json", *candidates)

    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 1
    assert _violations(out) == 1
    not_active = _only_line(out, "NOT active")
    assert "`v4.json`" in not_active and "the run log this PR adds" in not_active


def test_an_unreadable_added_log_is_still_reported_by_rule_6(tmp_path, monkeypatch, capsys):
    """When the log the PR adds cannot be parsed, rules 2, 2b and 3 have nothing to grade
    and skip the skill. Rule 6's loop must still run: it is the only thing that reports
    the file, so a `continue` on that path would pass a PR whose run log is a merge
    conflict. The release beside it is active and annotated, so grading it instead
    would pass too."""
    skill_dir = _setup_graded_skill(tmp_path, monkeypatch)
    _put_runlog(skill_dir, "v3.json", active=True)
    added = "v2_2026-10-08_10-00-00.json"
    (skill_dir / added).write_text(
        "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> main\n", encoding="utf-8"
    )
    _write_ann(skill_dir, added, [])
    _pr_adds(monkeypatch, added)

    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 1
    assert _violations(out) == 1
    assert f"`{added}`" in _only_line(out, "is not readable JSON")


def test_every_message_that_names_the_graded_log_says_why_it_was_graded(
    tmp_path, monkeypatch, capsys
):
    """The `main()` tests above reach rule 2's error, rule 2b's warning and rule 3's
    missing-file error. These are the other messages that name the graded log or its
    annotation: rule 2's cosmetic-skip warning; rule 3's unreadable and malformed
    annotation errors, its no-reviewable-dimensions warning, its two untrusted
    `review_sample` warnings, and its comment and completeness errors."""
    why = "the run log this PR adds"
    monkeypatch.setenv("COSMETIC_SKIP_LABELS", "eval-cosmetic-skip:demo")
    assert check_runlogs.rule2_active("demo", _INACTIVE_LOG, "v2.json", graded=why) == 0
    waived = _only_line(capsys.readouterr().out, "bypasses rule 2")
    assert "`v2.json`" in waived and why in waived

    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    sampled = ["ut_x_000", "ut_x_001"]
    log = _multi_test_log(20, review_sample={"tests": sampled, "cursor": sampled, "seed": 0})
    # ut_x_000 reviewed but uncommented; ut_x_001 not reviewed at all.
    fn = _write_ann(
        skill_dir,
        "v2_2026-10-08_10-00-00.json",
        _corrections_for(["ut_x_000"], comment=None, score=2),
    )
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir, graded=why) == 1
    out = capsys.readouterr().out
    for needle in ("with no comment", "is incomplete"):
        line = _only_line(out, needle)
        assert "`v2_2026-10-08_10-00-00.ann.json`" in line and why in line

    unreadable = "v3_2026-10-08_10-00-00.json"
    (skill_dir / "v3_2026-10-08_10-00-00.ann.json").write_text("{not json", encoding="utf-8")
    assert check_runlogs.rule3_completeness(
        "init-project", log, unreadable, skill_dir, graded=why
    ) == 1
    line = _only_line(capsys.readouterr().out, "is not valid JSON")
    assert "`v3_2026-10-08_10-00-00.ann.json`" in line and why in line

    fn = _write_ann(skill_dir, "v4_2026-10-08_10-00-00.json", [{"test_id": "ut_x_000"}])
    assert check_runlogs.rule3_completeness("init-project", log, fn, skill_dir, graded=why) == 1
    line = _only_line(capsys.readouterr().out, "missing required keys")
    assert "`v4_2026-10-08_10-00-00.ann.json`" in line and why in line

    aborted = {"test_id": "ut_x_aborted", "outcome_summary": {"aggregated_dimensions": []}}
    with_aborted = _multi_test_log(2, review_sample={"tests": ["ut_x_000"], "cursor": [], "seed": 0})
    with_aborted["tests"].append(aborted)
    fn = _write_ann(skill_dir, "v5_2026-10-08_10-00-00.json", _corrections_for(["ut_x_000"]))
    check_runlogs.rule3_completeness("init-project", with_aborted, fn, skill_dir, graded=why)
    line = _only_line(capsys.readouterr().out, "no reviewable dimensions")
    assert "`v5_2026-10-08_10-00-00.json`" in line and why in line

    empty_sample = _multi_test_log(2, review_sample={"tests": [], "cursor": [], "seed": 0})
    fn = _write_ann(skill_dir, "v6_2026-10-08_10-00-00.json", [])
    check_runlogs.rule3_completeness("init-project", empty_sample, fn, skill_dir, graded=why)
    line = _only_line(capsys.readouterr().out, "is empty")
    assert "`v6_2026-10-08_10-00-00.json`" in line and why in line

    ungraded_sample = _multi_test_log(
        2, review_sample={"tests": ["ut_x_aborted"], "cursor": [], "seed": 0}
    )
    ungraded_sample["tests"].append(aborted)
    fn = _write_ann(skill_dir, "v7_2026-10-08_10-00-00.json", [])
    check_runlogs.rule3_completeness("init-project", ungraded_sample, fn, skill_dir, graded=why)
    line = _only_line(capsys.readouterr().out, "would require nothing")
    assert "`v7_2026-10-08_10-00-00.json`" in line and why in line


def test_pr_added_runlog_picks_the_run_the_pr_ships(tmp_path):
    """The helper on its own: released beats any candidate, then the newest candidate by
    (version, timestamp) with the version compared as a number, and a name with no file
    on disk is dropped rather than returned for the caller to fail on."""
    skill_dir = tmp_path / "init-project"
    skill_dir.mkdir()
    candidates = [
        "v9_2026-10-08_09-00-00.json",
        "v10_2026-10-01_09-00-00.json",
        "v10_2026-10-02_09-00-00.json",
    ]
    for name in ("v3.json", "v4.json", *candidates):
        (skill_dir / name).write_text("{}", encoding="utf-8")
    ghost = "v11_2026-10-09_09-00-00.json"  # added per the diff, absent from disk
    pick = check_runlogs.pr_added_runlog

    assert pick(skill_dir, ["v3.json", *candidates]) == "v3.json"
    assert pick(skill_dir, ["v3.json", "v4.json"]) == "v4.json"
    assert pick(skill_dir, candidates) == "v10_2026-10-02_09-00-00.json"
    assert pick(skill_dir, [*candidates, ghost]) == "v10_2026-10-02_09-00-00.json"
    assert pick(skill_dir, [ghost]) is None
    assert pick(skill_dir, []) is None


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
    assert check_runlogs.rule6_outcomes("s", {"tests": [entry]}, "v1.json") == 1
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
    # RUNLOGS_DIR is isolated too, and must be: this test names a REAL agent,
    # so left pointing at the repo it reads whatever run logs gps-mentor
    # happens to have. It passed originally only because that directory did
    # not exist yet and "touched" surfaced as a no-run-logs error; the moment
    # the suite gained an active, annotated run log the same rule returned 0
    # and the assertion collapsed. The observable being asserted is that the
    # agent edit marks its own suite TOUCHED, which an empty runlogs root
    # surfaces regardless of corpus state.
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", tmp_path / "runlogs")
    (tmp_path / "runlogs").mkdir()
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
    (image-reader and record-extractor, both retired with their suites) stays
    ungated until one lands — and arms itself when it does, with no constant to
    remember to edit."""
    skills = _make_skills_tree(tmp_path)
    tests_unit = tmp_path / "tests-unit"
    tests_unit.mkdir()
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", skills)
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", tests_unit)
    # Isolated for the same reason as its sibling above, even though this one
    # asserts rc == 0: a real agent name plus the repo runlogs root is how the
    # sibling came to pass for a reason it was not testing.
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", tmp_path / "runlogs")
    (tmp_path / "runlogs").mkdir()
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


def test_rule8_top_level_list_does_not_crash(tmp_path):
    """A top-level [] (wrong shape) must not raise."""
    skill_dir = tmp_path / "s"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "v1_2026-01-01_00-00-00.ann.json").write_text("[]", encoding="utf-8")
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 0


def test_rule8_string_correction_does_not_crash(tmp_path):
    """A string in the corrections list must not raise."""
    _make_ann(tmp_path, "s", ["not a dict"])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 0


def test_rule8_null_correction_does_not_crash(tmp_path):
    """A null correction entry must not raise."""
    _make_ann(tmp_path, "s", [None])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 0


def test_rule8_int_comment_does_not_crash(tmp_path):
    """An int comment value must not raise."""
    _make_ann(tmp_path, "s", [{
        "test_id": "ut_x_001", "dimension_source": "base",
        "dimension_name": "Correctness", "llm_score": 1,
        "corrected_score": 3, "comment": 42,
    }])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 0


def test_rule8_list_comment_does_not_crash(tmp_path):
    """A list comment value must not raise."""
    _make_ann(tmp_path, "s", [{
        "test_id": "ut_x_001", "dimension_source": "base",
        "dimension_name": "Correctness", "llm_score": 1,
        "corrected_score": 3, "comment": ["LLM: 1 → Junior: 3"],
    }])
    assert check_runlogs.rule8_annotation_headers(tmp_path) == 0


def test_rule8_pinned_in_main(tmp_path, monkeypatch, capsys):
    """Rule 8 must be wired into main(). Removing the call leaves tests green
    without this guard — the other 11 tests call the function directly."""
    # Point RUNLOGS_DIR at a tmp dir containing a stale-header annotation.
    _make_ann(tmp_path, "s", [
        _correction(3, "LLM: 1 → Junior: 1\nStale header"),
    ])
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", tmp_path)
    # Suppress all per-skill rules by returning no changes / no touched paths.
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: [])

    rc = check_runlogs.main()
    assert rc == 1
    captured = capsys.readouterr().out
    assert "rule 8:" in captured


# --- Rule 2b (judge-prompt hash) — issue #2479 PR 1 ------------------------
#
# Rule 2b was warn-only. It now BLOCKS on a judge-prompt-only PR, with a
# warn-only fallback for a run log that is already skill-side stale (rule 2
# blocks for its own reason there; a regrade cannot satisfy an inactive log).

_ACTIVE_SNAPSHOT_LOG = {
    "snapshot": {},
    "judge_prompt_hash": "a" * 64,
}
_STALE_SNAPSHOT_LOG = {
    "snapshot": {"eval/__no_such_cosmetic_test__/x.md": "expected\n"},
    "judge_prompt_hash": "a" * 64,
}


def _stub_current_prompt_hash(monkeypatch, hex_digest: str) -> None:
    monkeypatch.setattr(
        check_runlogs,
        "hash_file",
        lambda _label, _path: hex_digest,
    )


# --- rule 2b, render half (issue #3576) ------------------------------------
# `judge_prompt_hash` covers the prompt TEMPLATE. These cover the code that
# fills its slots: a change there moved no fingerprint and left every committed
# log ACTIVE while the judge saw different text.

_ACTIVE_RENDER_LOG = {"snapshot": {}, "judge_render_hash": "a" * 64}
_STALE_RENDER_LOG = {
    "snapshot": {"eval/__no_such_cosmetic_test__/x.md": "expected\n"},
    "judge_render_hash": "a" * 64,
}
_NO_RENDER_HASH_LOG = {"snapshot": {}, "judge_prompt_hash": "a" * 64}


def _stub_current_render_hash(monkeypatch, hex_digest: str) -> None:
    monkeypatch.setattr(check_runlogs, "judge_render_hash", lambda: hex_digest)


def test_rule2b_render_blocks_when_render_code_moved(monkeypatch, capsys):
    """Hash differs + active log + a render-graph file touched → BLOCK."""
    _stub_current_render_hash(monkeypatch, "b" * 64)
    rc = check_runlogs.rule2b_judge_render(
        "demo", _ACTIVE_RENDER_LOG, "v1.json", judge_render_touched=True
    )
    assert rc == 1
    out = capsys.readouterr().out
    assert "::error" in out
    assert "`make judge-regrade`" in out
    assert "older judge render code" in out


def test_rule2b_render_passes_when_touched_but_hash_unchanged(monkeypatch, capsys):
    """The load-bearing property: the rule RECOMPUTES rather than blocking on
    "file touched". An edit to a trigger file outside the render graph leaves
    the hash alone, so it must pass — otherwise every PR touching
    orchestrator.py for any reason goes red."""
    _stub_current_render_hash(monkeypatch, "a" * 64)
    rc = check_runlogs.rule2b_judge_render(
        "demo", _ACTIVE_RENDER_LOG, "v1.json", judge_render_touched=True
    )
    assert rc == 0
    assert capsys.readouterr().out == ""


def test_rule2b_render_warns_when_log_is_already_skill_side_stale(monkeypatch, capsys):
    """Rule 2 blocks for its own reason; a regrade cannot satisfy a log that
    owes a paid `make eval-skill` run."""
    _stub_current_render_hash(monkeypatch, "b" * 64)
    rc = check_runlogs.rule2b_judge_render(
        "demo", _STALE_RENDER_LOG, "v1.json", judge_render_touched=True
    )
    assert rc == 0
    out = capsys.readouterr().out
    assert "::warning" in out
    assert "::error" not in out
    assert "cannot satisfy" in out


def test_rule2b_render_warns_when_mismatch_without_render_edit(monkeypatch, capsys):
    """A mixed-era corpus is not this PR's doing — warn, never block."""
    _stub_current_render_hash(monkeypatch, "b" * 64)
    rc = check_runlogs.rule2b_judge_render(
        "demo", _ACTIVE_RENDER_LOG, "v1.json", judge_render_touched=False
    )
    assert rc == 0
    out = capsys.readouterr().out
    assert "::warning" in out
    assert "::error" not in out


def test_rule2b_render_warns_when_log_has_no_render_hash(monkeypatch, capsys):
    """A log written before the field cannot be checked. Warn so the reviewer
    knows the PR's render change went ungraded against it — never block, which
    would owe a regrade for every log in the corpus on day one."""
    _stub_current_render_hash(monkeypatch, "b" * 64)
    rc = check_runlogs.rule2b_judge_render(
        "demo", _NO_RENDER_HASH_LOG, "v1.json", judge_render_touched=True
    )
    assert rc == 0
    out = capsys.readouterr().out
    assert "::warning" in out
    assert "::error" not in out
    assert "carries no" in out


def test_rule2b_render_silent_when_no_hash_and_nothing_touched(monkeypatch, capsys):
    """No field and no render edit — nothing to say."""
    _stub_current_render_hash(monkeypatch, "b" * 64)
    rc = check_runlogs.rule2b_judge_render(
        "demo", _NO_RENDER_HASH_LOG, "v1.json", judge_render_touched=False
    )
    assert rc == 0
    assert capsys.readouterr().out == ""


def test_rule2b_blocks_on_judge_prompt_only_pr(monkeypatch, capsys):
    """Hash mismatch + skill-side-active log + judge_prompt_edited → BLOCK."""
    _stub_current_prompt_hash(monkeypatch, "b" * 64)
    rc = check_runlogs.rule2b_judge_prompt(
        "demo", _ACTIVE_SNAPSHOT_LOG, "v1.json", judge_prompt_edited=True
    )
    assert rc == 1
    out = capsys.readouterr().out
    assert "::error" in out
    assert "`make judge-regrade`" in out
    assert "older judge prompt" in out


def test_rule2b_warns_when_log_is_already_skill_side_stale(monkeypatch, capsys):
    """2026-10-06 ruling: rule 2 blocks for its own reason; rule 2b warns.

    Proves the downgrade holds even when the PR is editing the judge prompt
    (`judge_prompt_edited=True`) — a regrade cannot satisfy a log that owes a
    `make eval-skill` run.
    """
    _stub_current_prompt_hash(monkeypatch, "b" * 64)
    rc = check_runlogs.rule2b_judge_prompt(
        "demo", _STALE_SNAPSHOT_LOG, "v1.json", judge_prompt_edited=True
    )
    assert rc == 0
    out = capsys.readouterr().out
    assert "::warning" in out
    assert "::error" not in out
    assert "cannot satisfy" in out


def test_rule2b_warns_when_mismatch_without_prompt_edit(monkeypatch, capsys):
    """Hash mismatch on a PR that did NOT edit the judge prompt is warn-only.

    A mixed-era corpus is expected across judge-prompt cadences, so the cheap
    `make judge-regrade` satisfaction path only applies when the PR itself is
    the thing moving the hash. Default `judge_prompt_edited=False` is this case.
    """
    _stub_current_prompt_hash(monkeypatch, "b" * 64)
    rc = check_runlogs.rule2b_judge_prompt(
        "demo", _ACTIVE_SNAPSHOT_LOG, "v1.json"
    )
    assert rc == 0
    out = capsys.readouterr().out
    assert "::warning" in out
    assert "::error" not in out
    assert "interpret the corrected mean cautiously" in out


def test_rule2b_passes_silently_when_hash_matches(monkeypatch, capsys):
    _stub_current_prompt_hash(monkeypatch, "a" * 64)
    rc = check_runlogs.rule2b_judge_prompt(
        "demo", _ACTIVE_SNAPSHOT_LOG, "v1.json", judge_prompt_edited=True
    )
    assert rc == 0
    assert capsys.readouterr().out == ""


def test_rule2b_passes_when_log_has_no_stored_hash(monkeypatch, capsys):
    """Older run logs predate the field; the rule is a no-op on them."""
    _stub_current_prompt_hash(monkeypatch, "a" * 64)
    rc = check_runlogs.rule2b_judge_prompt(
        "demo", {"snapshot": {}}, "v1.json", judge_prompt_edited=True
    )
    assert rc == 0
    assert capsys.readouterr().out == ""


def test_main_fires_rule2b_only_when_prompt_in_diff(monkeypatch, capsys, tmp_path):
    """Judge-prompt arm populates judge_prompt_touched_skills from RUNLOGS_DIR.

    Verifies the second direction of the lint too: a diff that does NOT touch
    `eval/harness/judge/prompt.md` leaves `judge_prompt_touched_skills` empty
    and rule 2b never fires, even if the committed logs have stale hashes.
    """
    # Seed a tmp RUNLOGS_DIR with one skill whose log has a mismatched hash.
    skill_dir = tmp_path / "demo"
    skill_dir.mkdir()
    log = {
        "schema_version": 3,
        "skill": "demo",
        "snapshot": {},
        "judge_prompt_hash": "a" * 64,
        "tests": [],
    }
    (skill_dir / "v1_2026-10-09_00-00-00.json").write_text(
        json.dumps(log), encoding="utf-8"
    )
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", tmp_path)
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: [])

    # No prompt in diff → judge_prompt_touched_skills empty → no rule 2b fire.
    _stub_current_prompt_hash(monkeypatch, "b" * 64)
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: [])
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert "`make judge-regrade`" not in out
    assert rc == 0

    # Now simulate a prompt-only PR → rule 2b fires and blocks.
    monkeypatch.setattr(
        check_runlogs,
        "git_diff_touched_paths",
        lambda: ["eval/harness/judge/prompt.md"],
    )
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert "`make judge-regrade`" in out
    assert rc == 1


# --- Rule 2c (instrument fingerprint) — issue #2479 PR 3 ---------------------
#
# Blocks on the suite-specific halves (`validators.suite`, `tools.fixture`),
# warns on the corpus-wide ones (`validators.shared`, `tools.live`,
# `live_modules`) so no change ever owes a re-run of every suite.

_H = {c: c * 64 for c in "abcdef0123456789"}


def _instr(**over):
    base = {
        "validators": {"suite": _H["a"], "shared": _H["b"]},
        "tools": {"fixture": _H["c"], "live": _H["d"]},
        "live_modules": {"research_append": _H["e"]},
    }
    for path, value in over.items():
        group, key = path.split("__")
        base[group][key] = value
    return base


def _stub_current_instrument(monkeypatch, current):
    monkeypatch.setattr(check_runlogs, "_tool_catalog", lambda: {"x": {}})
    monkeypatch.setattr(check_runlogs, "instrument_for", lambda *a, **k: current)


def test_rule2c_passes_silently_when_nothing_moved(monkeypatch, capsys):
    _stub_current_instrument(monkeypatch, _instr())
    rc = check_runlogs.rule2c_instrument("demo", {"snapshot": {}, "instrument": _instr()}, "v1.json")
    assert rc == 0
    assert capsys.readouterr().out == ""


@pytest.mark.parametrize(
    "moved, names",
    [
        ({"validators__suite": _H["0"]}, "validators.suite"),
        ({"tools__fixture": _H["0"]}, "tools.fixture"),
    ],
    ids=["suite-validator", "fixture-tool"],
)
def test_rule2c_blocks_on_a_suite_specific_change(monkeypatch, capsys, moved, names):
    _stub_current_instrument(monkeypatch, _instr(**moved))
    rc = check_runlogs.rule2c_instrument("demo", {"snapshot": {}, "instrument": _instr()}, "v1.json")
    assert rc == 1
    out = capsys.readouterr().out
    assert "::error" in out and names in out and "skill `demo`" in out
    assert "make eval-skill SKILL=demo" in out


@pytest.mark.parametrize(
    "moved, names",
    [
        ({"validators__shared": _H["0"]}, "validators.shared"),
        ({"tools__live": _H["0"]}, "tools.live"),
        ({"live_modules__research_append": _H["0"]}, "live_modules (research_append)"),
    ],
    ids=["shared-validators", "live-tool-schema", "live-module"],
)
def test_rule2c_only_warns_on_a_corpus_wide_change(monkeypatch, capsys, moved, names):
    _stub_current_instrument(monkeypatch, _instr(**moved))
    rc = check_runlogs.rule2c_instrument("demo", {"snapshot": {}, "instrument": _instr()}, "v1.json")
    assert rc == 0
    out = capsys.readouterr().out
    assert "::warning" in out and names in out
    assert "::error" not in out


def test_rule2c_warns_and_passes_on_a_log_with_no_instrument(monkeypatch, capsys):
    monkeypatch.setattr(check_runlogs, "_tool_catalog", lambda: pytest.fail("catalog read for nothing"))
    rc = check_runlogs.rule2c_instrument("demo", {"snapshot": {}}, "v1.json")
    assert rc == 0
    out = capsys.readouterr().out
    assert "::warning" in out and "no instrument recorded" in out


def test_rule2c_downgrades_only_when_rule2_itself_blocked_the_log(monkeypatch, capsys):
    _stub_current_instrument(monkeypatch, _instr(validators__suite=_H["0"]))
    rc = check_runlogs.rule2c_instrument(
        "demo", {"snapshot": {}, "instrument": _instr()}, "v1.json", rule2_blocked=True
    )
    assert rc == 0
    out = capsys.readouterr().out
    assert "::warning" in out and "::error" not in out and "Rule 2 already blocks" in out


def test_rule2c_still_blocks_a_merely_stale_log_rule2_did_not_block(monkeypatch, capsys):
    """Review finding: 20 of 32 suites are already skill-side stale on main, and
    rule 2 never runs on an instrument-arm suite. Downgrading on staleness alone
    turned the suite-specific block into a warning for most of the corpus."""
    _stub_current_instrument(monkeypatch, _instr(validators__suite=_H["0"]))
    stale = {"snapshot": {"eval/__no_such_cosmetic_test__/x.md": "expected\n"}, "instrument": _instr()}
    rc = check_runlogs.rule2c_instrument("demo", stale, "v1.json")
    assert rc == 1
    assert "::error" in capsys.readouterr().out


def test_rule2c_blocks_when_the_catalog_cannot_be_read(monkeypatch, capsys):
    def _boom():
        raise check_runlogs.CatalogUnavailable("build/tool-schemas.js does not exist")

    monkeypatch.setattr(check_runlogs, "_tool_catalog", _boom)
    rc = check_runlogs.rule2c_instrument("demo", {"snapshot": {}, "instrument": _instr()}, "v1.json")
    assert rc == 1
    out = capsys.readouterr().out
    assert "::error" in out and "tool-schemas.js" in out


@pytest.mark.parametrize(
    "paths, expected",
    [
        (["eval/harness/validators/test_universal.py"], {"demo", "convert-dates"}),
        (["eval/harness/validators/validators_lib.py"], {"demo", "convert-dates"}),
        (["eval/harness/harness/instrument.py"], {"demo", "convert-dates"}),
        (["eval/harness/harness/mock_mcp.py"], {"demo", "convert-dates"}),
        (["packages/engine/mcp-server/src/tool-schemas.ts"], {"demo", "convert-dates"}),
        (["packages/engine/mcp-server/package-lock.json"], {"demo", "convert-dates"}),
        (["eval/harness/validators/test_convert_dates.py"], {"convert-dates"}),
        (["eval/harness/validators/test_no_such_suite.py"], set()),
        (["eval/harness/e2e/orchestrator.py"], set()),
        (["packages/engine/mcp-server/tests/tools/x.test.ts"], set()),
        (["docs/specs/unit-test-spec.md"], set()),
    ],
    ids=[
        "shared-universal", "shared-lib", "instrument-module", "mock-mcp", "engine-src",
        "engine-lockfile", "suite-validator", "unknown-suite", "e2e", "engine-tests", "docs",
    ],
)
def test_instrument_touched_suites(paths, expected, monkeypatch):
    """Both directions: the fingerprint's own inputs mark every suite (so a change
    to them is graded on the PR that makes it, not the next unrelated one), and
    paths no unit run reads (must-pass 3: `eval/harness/e2e/`) mark none."""
    _base_is_head(monkeypatch)
    assert check_runlogs.instrument_touched_suites(set(paths), {"demo", "convert-dates"}) == expected


def _base_is_head(monkeypatch):
    """The merge base reads as the working tree: no import changed."""

    def show(path):
        f = check_runlogs.REPO_ROOT / path
        return f.read_text(encoding="utf-8") if f.is_file() else None

    monkeypatch.setattr(check_runlogs, "git_show_at_merge_base", show)


@pytest.mark.parametrize(
    "path",
    [
        "eval/harness/harness/dates.py",
        "eval/harness/harness/fixtures.py",
        "eval/harness/harness/__init__.py",
        "eval/harness/provenance_report.py",
    ],
    ids=["direct", "transitive", "package-init", "top-level"],
)
def test_a_module_in_the_validators_import_closure_marks_every_suite(path, monkeypatch):
    """Issue #3691: a harness module a validator imports, directly or through
    another module, can move `validators.shared`, so its edit opens rule 2c on
    every suite."""
    _base_is_head(monkeypatch)
    assert check_runlogs.instrument_touched_suites({path}, {"demo", "convert-dates"}) == {"demo", "convert-dates"}


@pytest.mark.parametrize(
    "path",
    ["eval/harness/harness/judge.py", "eval/harness/judge_report.py", "eval/harness/tests/unit/test_instrument.py"],
    ids=["judge", "top-level-outside", "harness-test"],
)
def test_a_harness_module_outside_the_closure_marks_no_suite(path, monkeypatch):
    _base_is_head(monkeypatch)
    assert check_runlogs.instrument_touched_suites({path}, {"demo", "convert-dates"}) == set()


def test_a_deleted_harness_module_marks_every_suite(monkeypatch):
    """Deleted, it is absent from the closure computed at head, though the base's
    closure may have held it."""
    _base_is_head(monkeypatch)
    assert check_runlogs.instrument_touched_suites(
        {"eval/harness/harness/no_longer_here.py"}, {"demo", "convert-dates"}
    ) == {"demo", "convert-dates"}


@pytest.mark.parametrize(
    "base_extra, head_extra, expected",
    [
        ("", "", {"convert-dates"}),
        ("", "from harness.dates import parse_date\n", {"demo", "convert-dates"}),
        ("from harness.dates import parse_date\n", "", {"demo", "convert-dates"}),
        ("import json\n", "import re\n", {"convert-dates"}),
    ],
    ids=["unchanged", "added-import", "removed-import", "stdlib-only-change"],
)
def test_a_suite_validator_whose_harness_imports_changed_marks_every_suite(
    monkeypatch, tmp_path, base_extra, head_extra, expected
):
    """Every validator file seeds the closure, so a suite file that adds or drops
    a harness import can move `shared` for every suite; one that keeps its harness
    imports moves only its own suite."""
    path = "eval/harness/validators/test_convert_dates.py"
    (tmp_path / "eval" / "harness" / "validators").mkdir(parents=True)
    (tmp_path / "eval" / "harness" / "harness").mkdir()
    (tmp_path / "eval" / "harness" / "harness" / "dates.py").write_text("def parse_date():\n    pass\n", encoding="utf-8")
    (tmp_path / path).write_text(head_extra + "def test_x():\n    assert True\n", encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(
        check_runlogs, "git_show_at_merge_base", lambda p: base_extra + "def test_x():\n    assert True\n"
    )
    assert check_runlogs.instrument_touched_suites({path}, {"demo", "convert-dates"}) == expected


@pytest.mark.parametrize(
    "base, head, expected",
    [
        (None, "from harness.dates import parse_date\n", {"demo", "convert-dates"}),
        (None, "def test_x():\n    assert True\n", {"convert-dates"}),
        ("from harness.dates import parse_date\n", None, {"demo", "convert-dates"}),
    ],
    ids=["new-file-with-harness-import", "new-file-without", "deleted-file-with-harness-import"],
)
def test_a_new_or_deleted_suite_validator_is_judged_by_its_harness_imports(monkeypatch, tmp_path, base, head, expected):
    path = "eval/harness/validators/test_convert_dates.py"
    (tmp_path / "eval" / "harness" / "validators").mkdir(parents=True)
    (tmp_path / "eval" / "harness" / "harness").mkdir()
    (tmp_path / "eval" / "harness" / "harness" / "dates.py").write_text("def parse_date():\n    pass\n", encoding="utf-8")
    if head is not None:
        (tmp_path / path).write_text(head, encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_runlogs, "git_show_at_merge_base", lambda p: base)
    assert check_runlogs.instrument_touched_suites({path}, {"demo", "convert-dates"}) == expected


def test_an_unreadable_base_opens_every_suite_and_says_so(monkeypatch, capsys):
    def unreadable(path):
        raise check_runlogs.BaseUnreadable("BASE_SHA/HEAD_SHA unset")

    monkeypatch.setattr(check_runlogs, "git_show_at_merge_base", unreadable)
    path = "eval/harness/validators/test_convert_dates.py"
    assert check_runlogs.instrument_touched_suites({path}, {"demo", "convert-dates"}) == {"demo", "convert-dates"}
    out = capsys.readouterr().out
    assert "::warning" in out and path in out


def test_git_show_at_merge_base_refuses_without_the_shas(monkeypatch):
    monkeypatch.delenv("BASE_SHA", raising=False)
    monkeypatch.delenv("HEAD_SHA", raising=False)
    with pytest.raises(check_runlogs.BaseUnreadable):
        check_runlogs.git_show_at_merge_base("eval/harness/harness/dates.py")


def test_git_show_at_merge_base_reads_the_merge_base_not_either_tip(monkeypatch, tmp_path):
    """A throwaway repo where main moved on after the branch forked: the read must
    return the fork point's content, not main's tip (BASE_SHA) or the branch's
    (HEAD_SHA) -- either would hide an import the branch changed."""

    def git(*args):
        return subprocess.check_output(["git", *args], text=True, encoding="utf-8", cwd=tmp_path).strip()

    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    target = tmp_path / "eval" / "harness" / "validators" / "test_x.py"
    target.parent.mkdir(parents=True)

    def commit(text):
        target.write_text(text, encoding="utf-8")
        git("add", "-A")
        git("commit", "-q", "-m", text)
        return git("rev-parse", "HEAD")

    fork = commit("fork\n")
    git("checkout", "-q", "-b", "branch")
    head = commit("branch\n")
    git("checkout", "-q", "main")
    base = commit("main\n")

    monkeypatch.setattr(check_runlogs, "REPO_ROOT", tmp_path)
    monkeypatch.setenv("BASE_SHA", base)
    monkeypatch.setenv("HEAD_SHA", head)
    assert fork not in (base, head)
    assert check_runlogs.git_show_at_merge_base("eval/harness/validators/test_x.py") == "fork\n"
    assert check_runlogs.git_show_at_merge_base("eval/harness/validators/never_existed.py") is None



def _seed_instrument_suite(tmp_path, monkeypatch, stored):
    skill_dir = tmp_path / "convert-dates"
    skill_dir.mkdir()
    log = {"schema_version": 3, "skill": "convert-dates", "snapshot": {}, "tests": [], "instrument": stored}
    (skill_dir / "v1_2026-10-14_00-00-00.json").write_text(json.dumps(log), encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", tmp_path)
    monkeypatch.setattr(check_runlogs, "git_diff_changes", lambda: [])
    monkeypatch.setattr(check_runlogs, "git_diff_deleted_paths", lambda: [])


def test_main_grades_a_validator_only_pr_through_rule2c(monkeypatch, capsys, tmp_path):
    """The gate used not to open at all on an instrument-only PR. A validator-only
    diff now grades that suite's log; an e2e-only diff still grades nothing."""
    _seed_instrument_suite(tmp_path, monkeypatch, _instr())
    _stub_current_instrument(monkeypatch, _instr(validators__suite=_H["0"]))

    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: ["eval/harness/e2e/orchestrator.py"])
    assert check_runlogs.main() == 0
    assert "validators.suite" not in capsys.readouterr().out

    monkeypatch.setattr(
        check_runlogs, "git_diff_touched_paths", lambda: ["eval/harness/validators/test_convert_dates.py"]
    )
    assert check_runlogs.main() == 1
    out = capsys.readouterr().out
    assert "skill `convert-dates`" in out and "validators.suite" in out


def test_main_rule2c_recomputes_for_real_and_a_moved_validator_blocks(monkeypatch, capsys, tmp_path):
    """End to end, nothing stubbed but the catalog: stamp the real fingerprint, then
    invert an assertion in a copy of the real validator and run main()."""
    from harness import instrument as instr_mod

    repo = tmp_path / "repo"
    (repo / "eval" / "harness" / "validators").mkdir(parents=True)
    real = check_runlogs.REPO_ROOT
    for name in ("test_universal.py", "validators_lib.py", "test_convert_dates.py"):
        src = real / "eval" / "harness" / "validators" / name
        (repo / "eval" / "harness" / "validators" / name).write_text(
            src.read_text(encoding="utf-8"), encoding="utf-8"
        )
    catalog = {n: {"description": n, "inputSchema": {}} for n in instr_mod.LIVE_TOOLS}
    stored = instr_mod.instrument_for("convert-dates", repo, catalog=catalog, live_called=[])
    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    _seed_instrument_suite(runlogs, monkeypatch, stored)
    monkeypatch.setattr(check_runlogs, "REPO_ROOT", repo)
    monkeypatch.setattr(check_runlogs, "_tool_catalog", lambda: catalog)
    monkeypatch.setattr(
        check_runlogs, "git_diff_touched_paths", lambda: ["eval/harness/validators/test_convert_dates.py"]
    )

    assert check_runlogs.main() == 0, capsys.readouterr().out
    capsys.readouterr()

    target = repo / "eval" / "harness" / "validators" / "test_convert_dates.py"
    target.write_text(
        target.read_text(encoding="utf-8").replace("assert not accepted", "assert accepted", 1),
        encoding="utf-8",
    )
    assert check_runlogs.main() == 1
    out = capsys.readouterr().out
    assert "skill `convert-dates`" in out and "validators.suite" in out


def test_main_rule2c_warns_when_a_harness_module_the_validators_import_moves(monkeypatch, capsys, tmp_path):
    """Issue #3691, end to end with nothing stubbed but the catalog and the base
    read: stamp the real fingerprint over copies of the real files, then change
    what `harness/dates.py` (imported by `validators_lib.py`) decides. Rule 2c
    warns on `validators.shared` and passes; a docstring-only edit stays quiet."""
    from harness import instrument as instr_mod

    repo = tmp_path / "repo"
    real = check_runlogs.REPO_ROOT
    for rel in (
        "eval/harness/validators/test_universal.py",
        "eval/harness/validators/validators_lib.py",
        "eval/harness/validators/test_convert_dates.py",
        "eval/harness/harness/dates.py",
    ):
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_text((real / rel).read_text(encoding="utf-8"), encoding="utf-8")
    catalog = {n: {"description": n, "inputSchema": {}} for n in instr_mod.LIVE_TOOLS}
    stored = instr_mod.instrument_for("convert-dates", repo, catalog=catalog, live_called=[])
    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    _seed_instrument_suite(runlogs, monkeypatch, stored)
    monkeypatch.setattr(check_runlogs, "REPO_ROOT", repo)
    monkeypatch.setattr(check_runlogs, "_tool_catalog", lambda: catalog)
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: ["eval/harness/harness/dates.py"])

    dates = repo / "eval" / "harness" / "harness" / "dates.py"
    original = dates.read_text(encoding="utf-8")
    assert '"""Pull the first embedded' in original, "premise gone: extract_year's docstring"
    dates.write_text(original.replace('"""Pull the first embedded', '"""Reworded: pull the first embedded', 1),
                     encoding="utf-8")
    assert check_runlogs.main() == 0
    assert "validators.shared" not in capsys.readouterr().out

    assert r"(1\d{3}|20\d{2})" in original, "premise gone: EMBEDDED_YEAR_RE"
    dates.write_text(original.replace(r"(1\d{3}|20\d{2})", r"(1\d{3})", 1), encoding="utf-8")
    assert check_runlogs.main() == 0
    out = capsys.readouterr().out
    assert "skill `convert-dates`" in out and "validators.shared" in out and "::warning" in out
    assert "validators.suite" not in out


@pytest.mark.parametrize(
    "labels, expect_rc",
    [
        ("eval-cosmetic-skip:demo", 0),
        ("eval-cosmetic-skip:other-skill", 1),
        ("eval-cosmetic-skip", 1),
        ("", 1),
    ],
    ids=["this-skill", "another-skill", "bare-label", "no-label"],
)
def test_the_cosmetic_skip_label_waives_rule2c_for_its_skill_only(
    monkeypatch, capsys, tmp_path, labels, expect_rc
):
    """A senior's `eval-cosmetic-skip:<skill>` waives rule 2c for that skill, as it
    does rule 2, so a typo fix in an advertised description owes no paid re-run.
    The label for another skill, the bare label, or none, still blocks -- and a
    merely stale snapshot is not a waiver (that was the round-1 review bug)."""
    stale = {}  # rule 2 stays quiet, so rule 2c alone decides
    skill_dir = tmp_path / "demo"
    skill_dir.mkdir()
    log = {"schema_version": 3, "skill": "demo", "snapshot": stale, "tests": [], "instrument": _instr()}
    (skill_dir / "v1_2026-10-14_00-00-00.json").write_text(json.dumps(log), encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", tmp_path)
    monkeypatch.setattr(check_runlogs, "PLUGIN_SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", tmp_path / "tests")
    (tmp_path / "skills" / "demo").mkdir(parents=True)
    (tmp_path / "tests" / "demo").mkdir(parents=True)
    monkeypatch.setenv("COSMETIC_SKIP_LABELS", labels)
    monkeypatch.setattr(check_runlogs, "rule3_completeness", lambda *a, **k: 0)
    _patch_diffs(monkeypatch, ["packages/engine/plugin/skills/demo/SKILL.md", "eval/harness/validators/test_demo.py"])
    _stub_current_instrument(monkeypatch, _instr(validators__suite=_H["0"]))
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == expect_rc, out
    assert "validators.suite" in out
    if expect_rc == 0:
        assert "waives rule 2c" in out
    else:
        assert "::error" in out



def test_a_non_test_validator_module_marks_every_suite(monkeypatch):
    """A suite file can import a sibling module (`extraction_validators.py`), so an
    edit there is graded on every suite; rule 2c's recompute decides which moved."""
    _base_is_head(monkeypatch)
    for path in (
        "eval/harness/validators/extraction_validators.py",
        "eval/harness/validators/conftest.py",
    ):
        assert check_runlogs.instrument_touched_suites({path}, {"demo", "convert-dates"}) == {"demo", "convert-dates"}
    assert check_runlogs.instrument_touched_suites(
        {"eval/harness/validators/test_convert_dates.py"}, {"demo", "convert-dates"}
    ) == {"convert-dates"}


def test_a_changed_shared_fixture_opens_rule2c_on_the_suites_that_use_it(monkeypatch, capsys, tmp_path):
    """A shared MCP fixture's `tool` field feeds `tools.fixture`; changing it is
    graded on the PR that makes it, not left for the next author of those suites."""
    runlogs = tmp_path / "runlogs"
    runlogs.mkdir()
    _seed_instrument_suite(runlogs, monkeypatch, _instr())
    tests = tmp_path / "tests"
    (tests / "convert-dates").mkdir(parents=True)
    (tests / "convert-dates" / "t.json").write_text(
        json.dumps({"test": {"id": "ut_convert_dates_900"}, "mcp_fixtures": ["shared-fix"]}), encoding="utf-8"
    )
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", tests)
    _stub_current_instrument(monkeypatch, _instr(tools__fixture=_H["0"]))
    monkeypatch.setattr(check_runlogs, "git_diff_touched_paths", lambda: ["eval/fixtures/mcp/shared-fix.json"])
    rc = check_runlogs.main()
    out = capsys.readouterr().out
    assert rc == 1, out
    assert "skill `convert-dates`" in out and "tools.fixture" in out


# --- #3568: a touched agent gates a suite only if its graded log can see it -----

_AGENT_REL = "packages/engine/plugin/agents/callee.md"
_CALLEE = "---\nname: callee\ndescription: Does x.\ntools:\n  - Read\n---\nbody v1\n"


def _routing_repo(tmp_path, monkeypatch, snapshot=None, *, released=True):
    """A routing suite `router` (SKILL.md naming @plugin:callee, plus a test
    directory) whose graded run log holds `snapshot` (None: no run log at all)."""
    repo = tmp_path / "repo"
    skills = repo / "packages/engine/plugin/skills"
    (skills / "router").mkdir(parents=True)
    (skills / "router" / "SKILL.md").write_text(
        "---\nname: router\n---\nDelegate via `@plugin:callee`.\n", encoding="utf-8"
    )
    (repo / _AGENT_REL).parent.mkdir(parents=True)
    (repo / _AGENT_REL).write_text(_CALLEE, encoding="utf-8")
    tests_unit = repo / "eval/tests/unit"
    (tests_unit / "router").mkdir(parents=True)
    (tests_unit / "router" / "t.json").write_text(
        json.dumps({"test": {"id": "ut_router_001"}}), encoding="utf-8"
    )
    runlogs = repo / "eval/runlogs/unit"
    runlogs.mkdir(parents=True)
    if snapshot is not None:
        (runlogs / "router").mkdir()
        name = "v1.json" if released else "v1_2026-10-21_10-00-00.json"
        (runlogs / "router" / name).write_text(json.dumps({"snapshot": snapshot}), encoding="utf-8")
    for attr, value in (
        ("REPO_ROOT", repo), ("RUNLOGS_DIR", runlogs), ("PLUGIN_SKILLS_DIR", skills),
        ("TEST_ONLY_SKILLS_DIR", repo / "eval/skills"), ("TESTS_UNIT_DIR", tests_unit),
    ):
        monkeypatch.setattr(check_runlogs, attr, value)
    return repo


def _frontmatter_digest(text):
    from harness.snapshot import hash_content

    return hash_content(
        check_runlogs.frontmatter_fingerprint_text(normalize(_AGENT_REL, text.encode("utf-8")))
    )


def _changed(value):
    def fake(agent, **_):
        return value
    return fake


def test_a_body_only_edit_to_a_frontmatter_fingerprinted_agent_gates_nothing(tmp_path, monkeypatch):
    """The point of #3568: the routing suite's graded log holds the agent's
    `#frontmatter` key and the PR left the frontmatter alone."""
    _routing_repo(tmp_path, monkeypatch, {_AGENT_REL + "#frontmatter": _frontmatter_digest(_CALLEE)})
    monkeypatch.setattr(check_runlogs, "agent_frontmatter_changed", _changed(False))
    assert check_runlogs.suites_gated_by_touched_agents({"callee"}, {}) == set()


def test_a_frontmatter_edit_gates_the_routing_suite(tmp_path, monkeypatch):
    _routing_repo(tmp_path, monkeypatch, {_AGENT_REL + "#frontmatter": _frontmatter_digest(_CALLEE)})
    monkeypatch.setattr(check_runlogs, "agent_frontmatter_changed", _changed(True))
    assert check_runlogs.suites_gated_by_touched_agents({"callee"}, {}) == {"router"}


def test_a_graded_log_holding_the_full_key_gates_on_any_edit(tmp_path, monkeypatch):
    """An opted-in agent, or any agent in a log written before #3568. The
    frontmatter comparison is not even consulted."""
    _routing_repo(tmp_path, monkeypatch, {_AGENT_REL: "0" * 64})

    def must_not_run(agent, **_):
        raise AssertionError("a full key must gate without a frontmatter comparison")

    monkeypatch.setattr(check_runlogs, "agent_frontmatter_changed", must_not_run)
    assert check_runlogs.suites_gated_by_touched_agents({"callee"}, {}) == {"router"}


def test_a_suite_with_no_graded_log_is_gated_so_rule_2_can_report_it(tmp_path, monkeypatch):
    _routing_repo(tmp_path, monkeypatch, snapshot=None)
    monkeypatch.setattr(check_runlogs, "agent_frontmatter_changed", _changed(False))
    assert check_runlogs.suites_gated_by_touched_agents({"callee"}, {}) == {"router"}


def test_a_graded_log_with_no_key_for_the_agent_is_not_gated(tmp_path, monkeypatch):
    """Rule 2 never reports a path its snapshot does not list, so gating here
    would only run the other rules on a suite the edit cannot reach."""
    _routing_repo(tmp_path, monkeypatch, {"packages/engine/plugin/skills/router/SKILL.md": "0" * 64})
    assert check_runlogs.suites_gated_by_touched_agents({"callee"}, {}) == set()


def test_the_agents_own_suite_is_gated_though_its_log_has_no_key_for_it(tmp_path, monkeypatch):
    """A skill converted to an agent keeps its suite, and that suite's graded log
    can predate the conversion (search-records' graded log was v7.json, written
    while it was still a skill, until v8). Its next run embeds the agent in full, so the edit
    reaches it: the own suite is gated whatever key form its log holds."""
    repo = _routing_repo(tmp_path, monkeypatch, {"packages/engine/plugin/skills/router/SKILL.md": "0" * 64})
    (repo / "eval/tests/unit/callee").mkdir()
    (repo / "eval/runlogs/unit/callee").mkdir()
    (repo / "eval/runlogs/unit/callee/v1.json").write_text(
        json.dumps({"snapshot": {"packages/engine/plugin/skills/callee/SKILL.md": "0" * 64}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(check_runlogs, "agent_frontmatter_changed", _changed(False))
    assert check_runlogs.suites_gated_by_touched_agents({"callee"}, {}) == {"callee"}


def test_the_log_this_pr_adds_decides_over_the_released_one(tmp_path, monkeypatch):
    """The released v1 holds the bare key, the PR's own candidate the reduced one:
    the PR is graded on the log it ships."""
    repo = _routing_repo(tmp_path, monkeypatch, {_AGENT_REL: "0" * 64})
    added = "v2_2026-10-21_10-00-00.json"
    (repo / "eval/runlogs/unit/router" / added).write_text(
        json.dumps({"snapshot": {_AGENT_REL + "#frontmatter": _frontmatter_digest(_CALLEE)}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(check_runlogs, "agent_frontmatter_changed", _changed(False))
    assert check_runlogs.suites_gated_by_touched_agents({"callee"}, {"router": [added]}) == set()


def test_main_blocks_a_description_edit_on_a_stale_routing_log(tmp_path, monkeypatch, capsys):
    """End to end: the graded log fingerprinted the old description, the PR
    changed it, so research-like suites go stale and rule 2 blocks."""
    repo = _routing_repo(
        tmp_path, monkeypatch, {_AGENT_REL + "#frontmatter": _frontmatter_digest(_CALLEE)}
    )
    (repo / _AGENT_REL).write_text(_CALLEE.replace("Does x.", "Does y."), encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "agent_frontmatter_changed", _changed(True))
    _patch_diffs(monkeypatch, [_AGENT_REL])

    rc = check_runlogs.main()

    out = capsys.readouterr().out
    assert rc == 1, out
    assert "skill `router`" in out
    assert "#frontmatter" in out


def test_main_lets_a_body_only_edit_through(tmp_path, monkeypatch, capsys):
    repo = _routing_repo(
        tmp_path, monkeypatch, {_AGENT_REL + "#frontmatter": _frontmatter_digest(_CALLEE)}
    )
    (repo / _AGENT_REL).write_text(_CALLEE.replace("body v1", "body v2"), encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "agent_frontmatter_changed", _changed(False))
    _patch_diffs(monkeypatch, [_AGENT_REL])

    rc = check_runlogs.main()

    out = capsys.readouterr().out
    assert rc == 0, out
    assert "skill `router`" not in out


def test_agent_gates_suite_reads_the_key_form():
    key = _AGENT_REL
    assert check_runlogs.agent_gates_suite("callee", None) is True
    assert check_runlogs.agent_gates_suite("callee", {key: "x"}) is True
    assert check_runlogs.agent_gates_suite("callee", {"other": "x"}) is False


# The merge-base comparison, against a REAL git repository: a monkeypatched
# helper cannot show the three-dot convention holds (the phantom it guards
# against was only ever found against real commits).


def _git(repo, *args):
    subprocess.run(
        ["git", "-c", "user.email=t@example.com", "-c", "user.name=t", *args],
        cwd=repo, check=True, capture_output=True,
    )


def _rev(repo, ref="HEAD"):
    return subprocess.run(
        ["git", "rev-parse", ref], cwd=repo, check=True, capture_output=True,
        text=True, encoding="utf-8",
    ).stdout.strip()


@pytest.fixture
def agent_git_repo(tmp_path):
    """A0 adds the agent; `main` edits its description after the fork; the PR
    branch is created from A0."""
    repo = tmp_path / "git"
    (repo / "packages/engine/plugin/agents").mkdir(parents=True)
    _git(repo, "init", "-q", "-b", "main")
    (repo / _AGENT_REL).write_text(_CALLEE, encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "A0")
    a0 = _rev(repo)
    (repo / _AGENT_REL).write_text(_CALLEE.replace("Does x.", "Does main's thing."), encoding="utf-8")
    _git(repo, "commit", "-q", "-am", "main moves the description")
    return repo, a0, _rev(repo)


def _pr_branch(repo, a0, name, edit):
    _git(repo, "checkout", "-q", "-b", name, a0)
    edit(repo / _AGENT_REL)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", name)
    return _rev(repo)


@pytest.mark.parametrize(
    ("edit", "expected"),
    [
        (lambda p: p.write_text(_CALLEE.replace("body v1", "body v2"), encoding="utf-8"), False),
        (lambda p: p.write_text(_CALLEE.replace("  - Read\n", "  - Read\n  - Write\n"), encoding="utf-8"), True),
        (lambda p: p.write_text(_CALLEE.replace("Does x.", "Does z."), encoding="utf-8"), True),
        (lambda p: p.unlink(), True),
    ],
    ids=["body-only-while-main-moved-the-description", "tools", "description", "deleted"],
)
def test_agent_frontmatter_changed_against_a_real_merge_base(agent_git_repo, monkeypatch, edit, expected):
    repo, a0, main_tip = agent_git_repo
    head = _pr_branch(repo, a0, "pr", edit)
    monkeypatch.setenv("BASE_SHA", main_tip)
    monkeypatch.setenv("HEAD_SHA", head)
    assert check_runlogs.agent_frontmatter_changed("callee", cwd=repo) is expected


def test_agent_frontmatter_changed_fails_closed_without_the_shas(monkeypatch):
    monkeypatch.delenv("BASE_SHA", raising=False)
    monkeypatch.delenv("HEAD_SHA", raising=False)
    assert check_runlogs.agent_frontmatter_changed("callee") is True


def test_agent_frontmatter_changed_fails_closed_on_a_git_error(agent_git_repo, monkeypatch):
    repo, _, main_tip = agent_git_repo
    monkeypatch.setenv("BASE_SHA", main_tip)
    monkeypatch.setenv("HEAD_SHA", "0" * 40)  # no such commit
    assert check_runlogs.agent_frontmatter_changed("callee", cwd=repo) is True


def test_every_embedded_agent_reaches_its_suite_through_the_superset():
    """Corpus property: every agent a suite's snapshot embeds (any form) is one
    whose edit the superset maps back to that suite, so no embedded agent can be
    edited with its suite left unexamined."""
    from harness.snapshot import agent_embed_forms

    referencing = check_runlogs.skills_referencing_agents(check_runlogs.PLUGIN_SKILLS_DIR)
    missed = []
    suites = [p.name for p in sorted(check_runlogs.TESTS_UNIT_DIR.iterdir()) if p.is_dir()]
    assert "research" in suites
    for suite in suites:
        for agent in agent_embed_forms(suite, check_runlogs.REPO_ROOT):
            if suite not in check_runlogs.skills_gated_by_agent(agent, referencing):
                missed.append(f"{suite} embeds {agent}")
    assert not missed, missed


def test_trigger_paths_cover_every_module_the_render_graph_reaches():
    """Finding 6: `JUDGE_RENDER_TRIGGER_PATHS` is hand-written. If the graph
    grows into a sixth module, a PR editing that module moves the hash but
    matches no trigger path, so `rule2b_judge_render` takes the
    "not this PR's doing" branch and WARNS on the PR that caused it.

    Derived from the same walk the hash uses, so this cannot drift.
    """
    from harness.judge_render import judge_render_graph_modules

    reached = judge_render_graph_modules()
    triggers = {
        "harness." + Path(p).stem for p in check_runlogs.JUDGE_RENDER_TRIGGER_PATHS
    }
    assert reached <= triggers, (
        f"render graph reaches {sorted(reached - triggers)}, which no trigger "
        f"path covers — a PR editing those would warn instead of blocking"
    )


# --- rule 6, regrade arm (issue #3576) ---------------------------------------
# Rule 6 proper grades only ADDED logs, deliberately: a prune rewrites committed
# logs and `eval/CLAUDE.md` says a modified log marks nothing touched. That held
# until `make judge-regrade` began rewriting GRADES in place. The predicate here
# is the outcome MOVING, so a prune still passes and only a new red blocks.

def _rule6_regrade(monkeypatch, tmp_path, base_outcomes, head_outcomes):
    rel = "eval/runlogs/unit/demo/v1.json"
    path = tmp_path / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"tests": [{"test_id": k, "outcome": v} for k, v in head_outcomes.items()]}),
        encoding="utf-8",
    )
    base = (
        None
        if base_outcomes is None
        else json.dumps({"tests": [{"test_id": k, "outcome": v} for k, v in base_outcomes.items()]})
    )
    monkeypatch.setattr(check_runlogs, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check_runlogs, "git_show_at_merge_base", lambda _p: base)
    return check_runlogs.rule6_regrade_outcomes("demo", rel)


def test_rule6_regrade_blocks_a_newly_red_test(monkeypatch, tmp_path, capsys):
    rc = _rule6_regrade(monkeypatch, tmp_path, {"ut_a": "pass"}, {"ut_a": "fail"})
    assert rc == 1
    out = capsys.readouterr().out
    assert "::error" in out
    assert "moved `pass` -> `fail`" in out


def test_rule6_regrade_blocks_partial_to_fail(monkeypatch, tmp_path, capsys):
    """`partial` never blocks on its own, but moving INTO fail does."""
    assert _rule6_regrade(monkeypatch, tmp_path, {"ut_a": "partial"}, {"ut_a": "fail"}) == 1


def test_rule6_regrade_passes_a_prune(monkeypatch, tmp_path, capsys):
    """The direction that must keep working: a modified log whose outcomes did
    not move is a rehash or a prune, and marks nothing touched."""
    rc = _rule6_regrade(
        monkeypatch, tmp_path, {"ut_a": "pass", "ut_b": "partial"}, {"ut_a": "pass", "ut_b": "partial"}
    )
    assert rc == 0
    assert capsys.readouterr().out == ""


def test_rule6_regrade_ignores_a_test_already_red_at_base(monkeypatch, tmp_path, capsys):
    """Not this PR's doing — it did not author the run."""
    assert _rule6_regrade(monkeypatch, tmp_path, {"ut_a": "fail"}, {"ut_a": "fail"}) == 0


def test_rule6_regrade_passes_when_the_log_is_new_at_base(monkeypatch, tmp_path, capsys):
    """Absent at the merge base — rule 6 proper grades it as an ADDED log, and
    grading it here too would double-report."""
    assert _rule6_regrade(monkeypatch, tmp_path, None, {"ut_a": "fail"}) == 0


def test_rule6_regrade_blocks_a_move_to_aborted(monkeypatch, tmp_path):
    assert _rule6_regrade(monkeypatch, tmp_path, {"ut_a": "pass"}, {"ut_a": "aborted"}) == 1
# Rule 11 (#3691 item 2): a swapped gate tag on a grade_on_invariant test.

_INVARIANTS = ("test_no_new_plan", "test_no_plan_writes_when_resolved", "test_resolved_question_not_reopened")
_RPN_TAGS = ["planning", "research-plan-no-new-plan", "no-plan-writes-when-resolved"]
_RPN_GATES = {
    "test_no_new_plan": {"research-plan-no-new-plan"},
    "test_no_plan_writes_when_resolved": {"no-plan-writes-when-resolved"},
    "test_resolved_question_not_reopened": {"no-plan-writes-when-resolved"},
    "test_stops_for_verdicts": {"stops-for-verdicts"},
    "test_activated_run_produces_response": set(),
}


def _r11_test(tags, *, explanation="the invariant is no plan writes", goi=True):
    return {
        "test": {"id": "ut_research_rpn", "skill": "research", "tags": list(tags)},
        "negative": {"grade_on_invariant": goi, "explanation": explanation},
    }


def _r11_log(*runs):
    """One test whose runs carry {validator: outcome}."""
    return {
        "tests": [
            {
                "test_id": "ut_research_rpn",
                "runs": [
                    {"validators": {"results": [{"name": n, "outcome": o} for n, o in run.items()]}}
                    for run in runs
                ],
            }
        ]
    }


_ALL_PASS = {**{n: "passed" for n in _INVARIANTS}, "test_stops_for_verdicts": "skipped",
             "test_activated_run_produces_response": "passed"}
_SWAPPED = {**{n: "skipped" for n in _INVARIANTS}, "test_stops_for_verdicts": "passed",
            "test_activated_run_produces_response": "passed"}


def _rule11(*, base_test=None, head_test=None, base_log=None, head_log=None,
            base_gates=_RPN_GATES, head_validators=None):
    return check_runlogs.rule11_swapped_gate_tags(
        "research",
        "v2_2026-10-26_00-00-00.json",
        base_log=base_log or _r11_log(_ALL_PASS),
        head_log=head_log or _r11_log(_ALL_PASS),
        base_tests={"ut_research_rpn": base_test or _r11_test(_RPN_TAGS)},
        head_tests={"ut_research_rpn": head_test or _r11_test(_RPN_TAGS)},
        base_gates=base_gates,
        head_validators=set(_RPN_GATES) if head_validators is None else head_validators,
    )


def test_rule11_renaming_a_gating_tag_in_the_test_fails(capsys):
    head = _r11_test(["planning", "research-plan-no-new-plan-v2", "no-plan-writes-when-resolved"])
    run = {**_ALL_PASS, "test_no_new_plan": "skipped"}
    assert _rule11(head_test=head, head_log=_r11_log(run)) == 1
    out = capsys.readouterr().out
    assert "::error::" in out and "`test_no_new_plan`" in out
    assert "test_no_plan_writes_when_resolved" not in out


def test_rule11_the_issue_swap_fails_naming_every_lost_validator(capsys):
    head = _r11_test(["planning", "stops-for-verdicts"])
    assert _rule11(head_test=head, head_log=_r11_log(_SWAPPED)) == 1
    out = capsys.readouterr().out
    for name in _INVARIANTS:
        assert f"`{name}`" in out
    assert "ut_research_rpn" in out


def test_rule11_validator_deleted_at_head_is_exempt():
    head = _r11_test(["planning", "stops-for-verdicts"])
    assert _rule11(
        head_test=head, head_log=_r11_log(_SWAPPED),
        head_validators=set(_RPN_GATES) - set(_INVARIANTS),
    ) == 0


def test_rule11_edited_explanation_is_exempt():
    head = _r11_test(["planning", "stops-for-verdicts"], explanation="retargeted to stops-for-verdicts")
    assert _rule11(head_test=head, head_log=_r11_log(_SWAPPED)) == 0


def test_rule11_unchanged_log_passes():
    assert _rule11() == 0


def test_rule11_an_ungated_validator_going_skipped_passes():
    run = {**_ALL_PASS, "test_activated_run_produces_response": "skipped"}
    assert _rule11(head_log=_r11_log(run)) == 0


def test_rule11_skipped_on_only_some_runs_passes():
    assert _rule11(head_log=_r11_log(_SWAPPED, _ALL_PASS)) == 0


def test_rule11_skipped_on_every_run_fails():
    head = _r11_test(["planning", "stops-for-verdicts"])
    assert _rule11(head_test=head, head_log=_r11_log(_SWAPPED, _SWAPPED)) == 1


def test_rule11_a_validator_missing_from_the_head_results_fails():
    run = {n: o for n, o in _ALL_PASS.items() if n != "test_no_new_plan"}
    assert _rule11(head_log=_r11_log(run)) == 1


def test_rule11_ignores_a_test_that_is_not_grade_on_invariant():
    head = _r11_test(["planning", "stops-for-verdicts"], goi=False)
    assert _rule11(head_test=head, head_log=_r11_log(_SWAPPED)) == 0


def test_rule11_a_validator_that_was_not_passing_at_base_is_not_owed():
    base_run = {**_ALL_PASS, **{n: "skipped" for n in _INVARIANTS}}
    head = _r11_test(["planning", "stops-for-verdicts"])
    assert _rule11(base_log=_r11_log(base_run), head_test=head, head_log=_r11_log(_SWAPPED)) == 0


def test_rule11_for_skill_warns_without_the_shas(monkeypatch, capsys):
    monkeypatch.delenv("BASE_SHA", raising=False)
    monkeypatch.delenv("HEAD_SHA", raising=False)
    assert check_runlogs.rule11_for_skill("research", "v2.json", _r11_log(_SWAPPED)) == 0
    assert "rule 11 did not run" in capsys.readouterr().out


def test_rule11_a_validator_that_passed_on_any_base_run_is_owed():
    base_runs = (_ALL_PASS, {**_ALL_PASS, **{n: "failed" for n in _INVARIANTS}})
    head = _r11_test(["planning", "stops-for-verdicts"])
    assert _rule11(base_log=_r11_log(*base_runs), head_test=head, head_log=_r11_log(_SWAPPED)) == 1


def test_rule11_aborted_head_runs_are_rule_6s_not_a_swap(capsys):
    log = _r11_log({})
    log["tests"][0]["runs"][0]["outcome"] = "aborted"
    assert _rule11(head_log=log) == 0
    assert capsys.readouterr().out == ""


def test_rule11_aborted_runs_are_ignored_beside_a_completed_one():
    log = _r11_log({}, _SWAPPED)
    log["tests"][0]["runs"][0]["outcome"] = "aborted"
    head = _r11_test(["planning", "stops-for-verdicts"])
    assert _rule11(head_test=head, head_log=log) == 1


def test_rule11_a_test_with_no_runs_is_left_to_rule_6():
    head = _r11_test(["planning", "stops-for-verdicts"])
    assert _rule11(head_test=head, head_log={"tests": [{"test_id": "ut_research_rpn", "runs": []}]}) == 0


def test_newest_full_skill_name_prefers_a_newer_candidate_over_an_older_release():
    names = ["v1.json", "v1.ann.json", "v2_2026-10-01_00-00-00.json", "v2_2026-10-02_00-00-00.json",
             "v3_scratch_x.json"]
    assert check_runlogs.newest_full_skill_name(names) == "v2_2026-10-02_00-00-00.json"
    assert check_runlogs.newest_full_skill_name(["v2.json", "v1_2026-10-02_00-00-00.json"]) == "v2.json"
    assert check_runlogs.newest_full_skill_name(["README.md"]) is None
    # At one version a candidate is the later run: releasing renames one, and
    # a candidate beside its release was run after it.
    assert check_runlogs.newest_full_skill_name(["v2.json", "v2_2026-10-03_00-00-00.json"]) == "v2_2026-10-03_00-00-00.json"


_R11_VALIDATOR = """import pytest
from shared_validators import *  # noqa: F401,F403


def test_no_new_plan(test):
    if "research-plan-no-new-plan" not in test.get("tags", []):
        pytest.skip("x")


def test_stops_for_verdicts(test):
    if "stops-for-verdicts" not in test.get("tags", []):
        pytest.skip("x")
"""

# The suite file star-imports a sibling, and `test_universal.py` runs for every
# suite: rule 11 has to read both, as the runtime does.
_R11_SHARED = """import pytest


def test_shared_gate(test):
    if "shared-gate" not in test.get("tags", []):
        pytest.skip("x")
"""

_R11_UNIVERSAL = """import pytest


def test_hand_back_names_its_owner(test):
    if "hand-back" not in test.get("tags", []):
        pytest.skip("x")
"""

_R11_BASE_TAGS = ["research-plan-no-new-plan", "hand-back", "shared-gate"]
_R11_BASE_PASSING = {
    "test_no_new_plan": "passed",
    "test_stops_for_verdicts": "skipped",
    "test_shared_gate": "passed",
    "test_hand_back_names_its_owner": "passed",
}


@pytest.fixture
def rule11_git_repo(tmp_path, monkeypatch):
    """Main holds an older released log and a newer candidate, the test with
    its gate tags, and the validators. Returns (repo, base sha, write_head)."""
    repo = tmp_path / "git"
    runlogs = repo / "eval/runlogs/unit/research"
    tests = repo / "eval/tests/unit/research"
    validators = repo / "eval/harness/validators"
    for d in (runlogs, tests, validators):
        d.mkdir(parents=True)
    _git(repo, "init", "-q", "-b", "main")
    (validators / "test_research.py").write_text(_R11_VALIDATOR, encoding="utf-8")
    (validators / "shared_validators.py").write_text(_R11_SHARED, encoding="utf-8")
    (validators / "test_universal.py").write_text(_R11_UNIVERSAL, encoding="utf-8")
    (tests / "rpn.json").write_text(json.dumps(_r11_test(_R11_BASE_TAGS)), encoding="utf-8")
    # The released v1 predates the test; only the newer candidate carries it.
    (runlogs / "v1.json").write_text(json.dumps({"tests": []}), encoding="utf-8")
    (runlogs / "v2_2026-10-01_00-00-00.json").write_text(
        json.dumps(_r11_log(_R11_BASE_PASSING)), encoding="utf-8"
    )
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "base")
    base = _rev(repo)
    monkeypatch.setattr(check_runlogs, "REPO_ROOT", repo)
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", repo / "eval/tests/unit")

    def write_head(tags, validator=_R11_VALIDATOR, test_file="rpn.json"):
        _git(repo, "checkout", "-q", "-b", "pr")
        (tests / "rpn.json").unlink()
        (tests / test_file).write_text(json.dumps(_r11_test(tags)), encoding="utf-8")
        (validators / "test_research.py").write_text(validator, encoding="utf-8")
        _git(repo, "add", "-A")
        _git(repo, "commit", "-q", "-m", "pr")
        monkeypatch.setenv("BASE_SHA", base)
        monkeypatch.setenv("HEAD_SHA", _rev(repo))

    return repo, base, write_head


def _r11_head_log(**skipped):
    """The base run with the named validators flipped to skipped."""
    return _r11_log({**_R11_BASE_PASSING, **{name: "skipped" for name in skipped}})


_R11_HEAD_LOG = "v3_2026-10-26_00-00-00.json"


@pytest.mark.parametrize(
    ("dropped_tag", "lost"),
    [
        ("research-plan-no-new-plan", "test_no_new_plan"),
        ("hand-back", "test_hand_back_names_its_owner"),
        ("shared-gate", "test_shared_gate"),
    ],
    ids=["suite-file", "test_universal", "star-imported-sibling"],
)
def test_rule11_for_skill_catches_a_dropped_tag_against_a_real_merge_base(
    rule11_git_repo, capsys, dropped_tag, lost
):
    _, _, write_head = rule11_git_repo
    write_head([t for t in _R11_BASE_TAGS if t != dropped_tag] + ["stops-for-verdicts"])
    assert check_runlogs.rule11_for_skill("research", _R11_HEAD_LOG, _r11_head_log(**{lost: 1})) == 1
    out = capsys.readouterr().out
    assert f"`{lost}`" in out
    assert out.count("(gated on") == 1


def test_rule11_for_skill_catches_a_gate_renamed_in_the_validator_only(rule11_git_repo):
    """The test keeps its tag; the PR renames the gate in the validator, so it
    skips. Only a gate map read at the merge base sees the tag that used to
    reach it."""
    _, _, write_head = rule11_git_repo
    write_head(
        _R11_BASE_TAGS,
        validator=_R11_VALIDATOR.replace('"research-plan-no-new-plan" not in', '"renamed-gate" not in'),
    )
    assert check_runlogs.rule11_for_skill("research", _R11_HEAD_LOG, _r11_head_log(test_no_new_plan=1)) == 1


def test_rule11_for_skill_passes_an_unchanged_test_against_a_real_merge_base(rule11_git_repo, capsys):
    _, _, write_head = rule11_git_repo
    write_head(_R11_BASE_TAGS + ["extra"])
    assert check_runlogs.rule11_for_skill("research", _R11_HEAD_LOG, _r11_head_log()) == 0
    assert capsys.readouterr().out == ""


def test_rule11_for_skill_exempts_a_validator_deleted_at_head(rule11_git_repo):
    _, _, write_head = rule11_git_repo
    gone = _R11_VALIDATOR.replace(
        'def test_no_new_plan(test):\n    if "research-plan-no-new-plan" not in test.get("tags", []):\n        pytest.skip("x")\n',
        "",
    )
    assert "test_no_new_plan" not in gone
    write_head([t for t in _R11_BASE_TAGS if t != "research-plan-no-new-plan"], validator=gone)
    assert check_runlogs.rule11_for_skill("research", _R11_HEAD_LOG, _r11_head_log(test_no_new_plan=1)) == 0


def test_rule11_for_skill_warns_on_a_moved_test_file(rule11_git_repo, capsys):
    _, _, write_head = rule11_git_repo
    write_head(["stops-for-verdicts"], test_file="rpn-moved.json")
    head_log = _r11_head_log(test_no_new_plan=1, test_shared_gate=1, test_hand_back_names_its_owner=1)
    assert check_runlogs.rule11_for_skill("research", _R11_HEAD_LOG, head_log) == 0
    out = capsys.readouterr().out
    assert "::warning::rule 11 did not check `ut_research_rpn`" in out and "rpn-moved.json" in out


def test_rule11_for_skill_warns_on_an_unparseable_head_validator(rule11_git_repo, monkeypatch, capsys):
    repo, _, write_head = rule11_git_repo
    write_head(["stops-for-verdicts"], validator="def (:\n")
    (repo / "eval/harness/validators/test_universal.py").write_text("def (:\n", encoding="utf-8")
    assert check_runlogs.rule11_for_skill("research", _R11_HEAD_LOG, _r11_head_log(test_no_new_plan=1)) == 0
    assert "no validator could be read" in capsys.readouterr().out


def test_rule11_for_skill_warns_on_an_unreadable_base(rule11_git_repo, monkeypatch, capsys):
    _, _, write_head = rule11_git_repo
    write_head(["stops-for-verdicts"])

    def boom(path):
        raise check_runlogs.BaseUnreadable("simulated")

    monkeypatch.setattr(check_runlogs, "git_show_at_merge_base", boom)
    assert check_runlogs.rule11_for_skill("research", "v3.json", _r11_head_log(test_no_new_plan=1)) == 0
    out = capsys.readouterr().out
    assert "::warning::rule 11 did not run" in out and "eval/runlogs/unit/research/" in out


def test_rule11_for_skill_warns_when_git_cannot_find_the_merge_base(rule11_git_repo, monkeypatch, capsys):
    """A git failure while listing the base logs is not "no logs at the base"."""
    _, _, write_head = rule11_git_repo
    write_head(["stops-for-verdicts"])
    monkeypatch.setenv("HEAD_SHA", "0" * 40)
    assert check_runlogs.rule11_for_skill("research", "v3.json", _r11_head_log(test_no_new_plan=1)) == 0
    assert "::warning::rule 11 did not run" in capsys.readouterr().out


def test_check_runlogs_imports_on_a_bare_interpreter():
    """The workflow runs this script on a bare Python with no packages, and
    rule 11's gate map must come with no `jsonschema` behind it."""
    from tests.unit.bare_python import bare

    script = Path(__file__).resolve().parents[2] / "scripts" / "check_runlogs.py"
    proc = bare(f"import runpy; runpy.run_path({str(script)!r}, run_name='not_main')")
    assert proc.returncode == 0, proc.stderr


def test_main_runs_rule11_only_on_the_log_a_pr_adds_and_its_failure_fails(tmp_path, monkeypatch):
    skill_dir = tmp_path / "research"
    skill_dir.mkdir()
    for name in ("v1.json", "v2_2026-10-26_00-00-00.json"):
        (skill_dir / name).write_text(json.dumps({"tests": []}), encoding="utf-8")
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", tmp_path)
    for rule in ("rule2_active", "rule2b_judge_prompt", "rule2c_instrument", "rule3_completeness"):
        monkeypatch.setattr(check_runlogs, rule, lambda *a, **k: 0)
    calls = []
    monkeypatch.setattr(check_runlogs, "rule11_for_skill", lambda *a: calls.append(a[:2]) or 1)

    _patch_diffs(monkeypatch, ["eval/runlogs/unit/research/v2_2026-10-26_00-00-00.json"])
    assert check_runlogs.main() == 1
    assert calls == [("research", "v2_2026-10-26_00-00-00.json")]

    calls.clear()
    _patch_diffs(monkeypatch, ["eval/tests/unit/research/handle-negative-probate-result.json"])
    check_runlogs.main()
    assert calls == []


def test_git_ls_at_merge_base_lists_bare_names_and_an_absent_dir_as_empty(rule11_git_repo):
    """A suite new in this PR has no log directory at the base: that is "nothing
    to compare", not a failed read."""
    _, _, write_head = rule11_git_repo
    write_head(_R11_BASE_TAGS + ["extra"])
    assert check_runlogs.git_ls_at_merge_base("eval/runlogs/unit/research") == [
        "v1.json",
        "v2_2026-10-01_00-00-00.json",
    ]
    assert check_runlogs.git_ls_at_merge_base("eval/runlogs/unit/new-suite") == []


# Rule 11 with no run log: a validator-only edit is compared on the gate maps.


def _drift(head_gates, *, base_test=None, head_test=None):
    return check_runlogs.rule11_gate_drift(
        "research",
        base_tests={"ut_research_rpn": base_test or _r11_test(_RPN_TAGS)},
        head_tests={"ut_research_rpn": head_test or _r11_test(_RPN_TAGS)},
        base_gates=_RPN_GATES,
        head_gates=head_gates,
    )


def test_rule11_gate_drift_a_renamed_gate_fails(capsys):
    head = {**_RPN_GATES, "test_no_new_plan": {"renamed-gate"}}
    assert _drift(head) == 1
    out = capsys.readouterr().out
    assert "`test_no_new_plan`" in out and "renamed-gate" in out
    assert out.count("(gated on") == 1


@pytest.mark.parametrize(
    "head",
    [
        _RPN_GATES,
        {**_RPN_GATES, "test_no_new_plan": set()},
        {k: v for k, v in _RPN_GATES.items() if k != "test_no_new_plan"},
        {**_RPN_GATES, "test_no_new_plan": {"renamed-gate", "research-plan-no-new-plan"}},
    ],
    ids=["unchanged", "gate-removed", "validator-deleted", "gate-widened"],
)
def test_rule11_gate_drift_passes_what_still_runs_or_is_gone(head):
    assert _drift(head) == 0


def test_rule11_gate_drift_edited_explanation_is_exempt():
    head = {**_RPN_GATES, "test_no_new_plan": {"renamed-gate"}}
    assert _drift(head, head_test=_r11_test(_RPN_TAGS, explanation="retargeted")) == 0


def test_rule11_gate_drift_a_test_new_at_head_is_still_checked():
    head = {**_RPN_GATES, "test_no_new_plan": {"renamed-gate"}}
    assert check_runlogs.rule11_gate_drift(
        "research", base_tests={}, head_tests={"ut_research_rpn": _r11_test(_RPN_TAGS)},
        base_gates=_RPN_GATES, head_gates=head,
    ) == 1


@pytest.mark.parametrize(
    ("validator_file", "old", "new"),
    [
        ("test_research.py", '"research-plan-no-new-plan" not in', '"renamed-gate" not in'),
        ("test_universal.py", '"hand-back" not in', '"hand-back-v2" not in'),
        ("shared_validators.py", '"shared-gate" not in', '"shared-gate-v2" not in'),
    ],
    ids=["suite-file", "test_universal", "star-imported-sibling"],
)
def test_rule11_gates_for_skill_catches_a_validator_only_rename_against_a_real_merge_base(
    rule11_git_repo, capsys, validator_file, old, new
):
    repo, _, write_head = rule11_git_repo
    path = repo / "eval/harness/validators" / validator_file
    source = path.read_text(encoding="utf-8")
    assert old in source
    validator = _R11_VALIDATOR
    if validator_file == "test_research.py":
        validator = source.replace(old, new)
    else:
        path.write_text(source.replace(old, new), encoding="utf-8")
    write_head(_R11_BASE_TAGS, validator=validator)
    assert check_runlogs.rule11_gates_for_skill("research") == 1
    assert out_has_one_loss(capsys.readouterr().out)


def out_has_one_loss(out):
    return out.count("(gated on") == 1 and "::error::" in out


def test_rule11_gates_for_skill_passes_an_unrelated_validator_edit(rule11_git_repo, capsys):
    _, _, write_head = rule11_git_repo
    write_head(_R11_BASE_TAGS, validator=_R11_VALIDATOR + "\n\ndef helper():\n    return 1\n")
    assert check_runlogs.rule11_gates_for_skill("research") == 0
    assert capsys.readouterr().out == ""


def test_rule11_gates_for_skill_warns_on_an_unreadable_base(rule11_git_repo, monkeypatch, capsys):
    _, _, write_head = rule11_git_repo
    write_head(_R11_BASE_TAGS + ["extra"])

    def boom(path):
        raise check_runlogs.BaseUnreadable("simulated")

    monkeypatch.setattr(check_runlogs, "git_show_at_merge_base", boom)
    assert check_runlogs.rule11_gates_for_skill("research") == 0
    assert "::warning::rule 11 did not run for `research`" in capsys.readouterr().out


def test_main_runs_rule11_gate_drift_on_a_validator_edit_for_every_suite_rule11_did_not_grade(
    tmp_path, monkeypatch, capsys
):
    runlogs, tests = tmp_path / "runlogs", tmp_path / "tests"
    (runlogs / "research").mkdir(parents=True)
    (runlogs / "research" / "v2_2026-10-26_00-00-00.json").write_text(
        json.dumps({"tests": []}), encoding="utf-8"
    )
    for suite in ("citation", "research"):
        (tests / suite).mkdir(parents=True)
    monkeypatch.setattr(check_runlogs, "RUNLOGS_DIR", runlogs)
    monkeypatch.setattr(check_runlogs, "TESTS_UNIT_DIR", tests)
    for rule in ("rule2_active", "rule2b_judge_prompt", "rule2c_instrument", "rule3_completeness"):
        monkeypatch.setattr(check_runlogs, rule, lambda *a, **k: 0)
    monkeypatch.setattr(check_runlogs, "rule11_for_skill", lambda *a: 0)
    calls = []
    monkeypatch.setattr(check_runlogs, "rule11_gates_for_skill", lambda s: calls.append(s) or 1)

    _patch_diffs(monkeypatch, ["eval/harness/validators/test_universal.py"])
    monkeypatch.delenv("BASE_SHA", raising=False)
    check_runlogs.main()
    assert calls == []
    assert "rule 11 did not compare the validator gate maps" in capsys.readouterr().out

    monkeypatch.setenv("BASE_SHA", "a" * 40)
    monkeypatch.setenv("HEAD_SHA", "b" * 40)
    assert check_runlogs.main() == 1
    assert calls == ["citation", "research"]

    calls.clear()
    _patch_diffs(monkeypatch, [
        "eval/harness/validators/test_universal.py",
        "eval/runlogs/unit/research/v2_2026-10-26_00-00-00.json",
    ])
    check_runlogs.main()
    assert calls == ["citation"]

    calls.clear()
    _patch_diffs(monkeypatch, ["eval/tests/unit/research/rpn.json"])
    check_runlogs.main()
    assert calls == []
