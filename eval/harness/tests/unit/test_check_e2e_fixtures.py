"""Unit tests for scripts/check_e2e_fixtures.py — the advisory fixture-validity report."""

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
check = check_e2e_fixtures.check


def _make_fixture(fixtures_dir: Path, slug: str):
    d = fixtures_dir / slug
    d.mkdir(parents=True)
    (d / "fixture.json").write_text(json.dumps({"id": slug}), encoding="utf-8")


def _make_runlog(runlogs_dir: Path, slug: str, verdict: str, ts="2026-06-15_10-00-00"):
    d = runlogs_dir / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / f"run-{ts}.json").write_text(
        json.dumps({"test_id": slug, "verdict": verdict}), encoding="utf-8"
    )


def test_fixture_with_passing_runlog_is_valid(tmp_path):
    fx, rl = tmp_path / "tests", tmp_path / "runlogs"
    _make_fixture(fx, "smith-parents")
    _make_runlog(rl, "smith-parents", "pass")
    assert check(fixtures_dir=fx, runlogs_dir=rl) == []


def test_fixture_without_any_runlog_is_violation(tmp_path):
    fx, rl = tmp_path / "tests", tmp_path / "runlogs"
    _make_fixture(fx, "smith-parents")
    rl.mkdir()
    violations = check(fixtures_dir=fx, runlogs_dir=rl)
    assert len(violations) == 1
    assert "smith-parents" in violations[0]


def test_fixture_with_only_failing_runlog_is_violation(tmp_path):
    fx, rl = tmp_path / "tests", tmp_path / "runlogs"
    _make_fixture(fx, "smith-parents")
    _make_runlog(rl, "smith-parents", "fail")
    violations = check(fixtures_dir=fx, runlogs_dir=rl)
    assert len(violations) == 1


def test_one_passing_among_several_runlogs_is_enough(tmp_path):
    fx, rl = tmp_path / "tests", tmp_path / "runlogs"
    _make_fixture(fx, "smith-parents")
    _make_runlog(rl, "smith-parents", "fail", ts="2026-06-15_09-00-00")
    _make_runlog(rl, "smith-parents", "pass", ts="2026-06-15_10-00-00")
    assert check(fixtures_dir=fx, runlogs_dir=rl) == []


def test_gitkeep_only_dir_has_no_fixtures(tmp_path):
    """An empty corpus (.gitkeep only) passes — no fixtures to gate."""
    fx, rl = tmp_path / "tests", tmp_path / "runlogs"
    fx.mkdir()
    (fx / ".gitkeep").write_text("", encoding="utf-8")
    rl.mkdir()
    assert check(fixtures_dir=fx, runlogs_dir=rl) == []


def test_multiple_fixtures_mixed_validity(tmp_path):
    fx, rl = tmp_path / "tests", tmp_path / "runlogs"
    _make_fixture(fx, "good")
    _make_fixture(fx, "bad")
    _make_runlog(rl, "good", "pass")
    violations = check(fixtures_dir=fx, runlogs_dir=rl)
    assert len(violations) == 1
    assert "bad" in violations[0]


def test_corrupt_runlog_is_ignored_not_counted(tmp_path):
    fx, rl = tmp_path / "tests", tmp_path / "runlogs"
    _make_fixture(fx, "smith-parents")
    d = rl / "smith-parents"
    d.mkdir(parents=True)
    (d / "run-2026-06-15_10-00-00.json").write_text("{not json", encoding="utf-8")
    # corrupt log doesn't count as passing -> violation
    assert len(check(fixtures_dir=fx, runlogs_dir=rl)) == 1


# --- main() exit-code behavior: advisory by default, hard with --strict ---


def test_main_is_advisory_by_default(monkeypatch, capsys):
    """A fixture missing a passing run log warns but does NOT fail CI."""
    monkeypatch.setattr(
        check_e2e_fixtures, "check", lambda: ["fixture 'x' has no passing run log"]
    )
    monkeypatch.setattr(check_e2e_fixtures, "_fixture_slugs", lambda d: ["x"])
    assert check_e2e_fixtures.main([]) == 0
    # Surfaced as a GitHub Actions warning annotation on stdout.
    assert "::warning::" in capsys.readouterr().out


def test_main_strict_fails_on_violation(monkeypatch):
    """--strict restores a hard non-zero exit for local gating."""
    monkeypatch.setattr(
        check_e2e_fixtures, "check", lambda: ["fixture 'x' has no passing run log"]
    )
    monkeypatch.setattr(check_e2e_fixtures, "_fixture_slugs", lambda d: ["x"])
    assert check_e2e_fixtures.main(["--strict"]) == 1


def test_main_passes_on_clean_corpus(monkeypatch):
    """No violations -> exit 0 in both modes."""
    monkeypatch.setattr(check_e2e_fixtures, "check", lambda: [])
    monkeypatch.setattr(check_e2e_fixtures, "_fixture_slugs", lambda d: [])
    assert check_e2e_fixtures.main([]) == 0
    assert check_e2e_fixtures.main(["--strict"]) == 0


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


def test_main_grading_gate_blocks_missing_ann(tmp_path, monkeypatch):
    """A PR-added run log with a tree but no ann fails main() even when
    fixture-validity is clean."""
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=False)
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    monkeypatch.setattr(check_e2e_fixtures, "check", lambda: [])
    monkeypatch.setattr(check_e2e_fixtures, "_fixture_slugs", lambda d: [])
    assert check_e2e_fixtures.main([]) == 1


def test_main_grading_gate_passes_when_graded(tmp_path, monkeypatch):
    monkeypatch.setattr(check_e2e_fixtures, "REPO_ROOT", tmp_path)
    rel = _make_e2e_run(tmp_path, "smith", "2026-06-15_10-00-00", tree=True, ann=True)
    monkeypatch.setattr(check_e2e_fixtures, "git_added_e2e_runlogs", lambda: [rel])
    monkeypatch.setattr(check_e2e_fixtures, "check", lambda: [])
    monkeypatch.setattr(check_e2e_fixtures, "_fixture_slugs", lambda d: [])
    assert check_e2e_fixtures.main([]) == 0
