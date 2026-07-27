"""Unit tests for scripts/check_e2e_fixtures.py — the e2e grading gate."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "check_e2e_fixtures",
    Path(__file__).resolve().parents[2] / "scripts" / "check_e2e_fixtures.py",
)
check_e2e_fixtures = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check_e2e_fixtures)


# --- Grading gate (blocking): PR-added run logs with a tree must ship an ann ---


def _make_e2e_run(repo_root: Path, slug: str, ts: str, *, tree: bool, ann: bool) -> Path:
    """Create a run log (+ optional tree/ann siblings) under repo_root and
    return its repo-relative Path (as git diff would report it)."""
    d = repo_root / "eval" / "runlogs" / "e2e" / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / f"run-{ts}.json").write_text(json.dumps({"verdict": "pass"}), encoding="utf-8")
    if tree:
        (d / f"run-{ts}.final-tree.gedcomx.json").write_text("{}", encoding="utf-8")
    if ann:
        (d / f"run-{ts}.ann.json").write_text("{}", encoding="utf-8")
    return Path("eval/runlogs/e2e") / slug / f"run-{ts}.json"


def test_is_primary_runlog_excludes_siblings():
    ok = check_e2e_fixtures._is_primary_runlog
    assert ok("run-2026-06-15_10-00-00.json")
    assert not ok("run-2026-06-15_10-00-00.ann.json")
    assert not ok("run-2026-06-15_10-00-00.final-tree.gedcomx.json")
    assert not ok("run-2026-06-15_10-00-00.final-research.json")
    assert not ok("run-2026-06-15_10-00-00.transcript.md")


def test_graded_run_with_tree_and_ann_passes(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    assert check_e2e_fixtures.check_added_runlogs_graded([rel]) == []


def test_run_with_tree_missing_ann_is_violation(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=False)
    violations = check_e2e_fixtures.check_added_runlogs_graded([rel])
    assert len(violations) == 1
    assert "run-2026-06-15_10-00-00.ann.json" in violations[0]


def test_treeless_run_is_exempt(tmp_path, monkeypatch):
    """A crashed/skipped run with no final tree owes no annotation."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=False, ann=False)
    assert check_e2e_fixtures.check_added_runlogs_graded([rel]) == []


def test_git_added_returns_none_without_pr_env(monkeypatch):
    monkeypatch.delenv("BASE_SHA", raising=False)
    monkeypatch.delenv("HEAD_SHA", raising=False)
    assert check_e2e_fixtures.git_added_e2e_runlogs() is None


def test_git_added_filters_to_primary_e2e_runlogs(monkeypatch):
    monkeypatch.setenv("BASE_SHA", "aaa")
    monkeypatch.setenv("HEAD_SHA", "bbb")
    diff = "\n".join(
        [
            "eval/runlogs/e2e/smith/run-2026-06-15_10-00-00.json",
            "eval/runlogs/e2e/smith/run-2026-06-15_10-00-00.ann.json",
            "eval/runlogs/e2e/smith/run-2026-06-15_10-00-00.final-tree.gedcomx.json",
            "eval/runlogs/unit/citation/v1.json",
            "eval/tests/e2e/smith/fixture.json",
            "",
        ]
    )
    monkeypatch.setattr(
        check_e2e_fixtures.subprocess, "check_output", lambda *a, **k: diff
    )
    assert check_e2e_fixtures.git_added_e2e_runlogs() == [
        Path("eval/runlogs/e2e/smith/run-2026-06-15_10-00-00.json")
    ]


# --- Unresolved-draft check (warn only) -----------------------------------


def _write_fixture_readme(repo_root: Path, slug: str, *, draft: bool) -> None:
    d = repo_root / "eval" / "tests" / "e2e" / slug
    d.mkdir(parents=True, exist_ok=True)
    marker = "**DRAFT PENDING ADJUDICATION.** Transcribed from an unverified hint."
    body = f"# {slug}\n\n## Notes for reviewers\n\n"
    (d / "README.md").write_text(
        body + (marker if draft else "Resolved: the hint is a true match."),
        encoding="utf-8",
    )


def test_draft_fixture_with_committed_run_warns(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    _write_fixture_readme(tmp_path, "smith", draft=True)
    warnings = check_e2e_fixtures.check_added_runlogs_resolved([rel])
    assert len(warnings) == 1
    assert "smith" in warnings[0]
    assert check_e2e_fixtures.DRAFT_MARKER in warnings[0]


def test_resolved_fixture_does_not_warn(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    _write_fixture_readme(tmp_path, "smith", draft=False)
    assert check_e2e_fixtures.check_added_runlogs_resolved([rel]) == []


def test_missing_fixture_readme_does_not_warn(tmp_path, monkeypatch):
    """A run log with no fixture dir (renamed/removed) is silent, not a crash."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    assert check_e2e_fixtures.check_added_runlogs_resolved([rel]) == []


def test_two_runs_of_one_draft_fixture_warn_once(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rels = [
        _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True),
        _make_e2e_run(tmp_path, "smith", "2026-06-15_18-00-00", tree=True, ann=True),
    ]
    _write_fixture_readme(tmp_path, "smith", draft=True)
    assert len(check_e2e_fixtures.check_added_runlogs_resolved(rels)) == 1


# --- main() exit-code behavior --------------------------------------------


def test_main_grading_gate_blocks_missing_ann(tmp_path, monkeypatch):
    """A PR-added run log with a tree but no ann fails main()."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=False)
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 1


def test_main_grading_gate_passes_when_graded(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 0


def test_main_skips_without_pr_context(monkeypatch):
    """No PR env (BASE_SHA/HEAD_SHA unset) → gate is skipped, exit 0."""
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: None)
    assert check_e2e_fixtures.main() == 0


def test_main_draft_warning_does_not_fail_the_job(tmp_path, monkeypatch, capsys):
    """An unresolved-draft fixture warns but must never change the exit code —
    20 people working drafts in parallel can't have this blocking their PRs."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    _write_fixture_readme(tmp_path, "smith", draft=True)
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    assert check_e2e_fixtures.main() == 0
    assert "::warning::" in capsys.readouterr().out
