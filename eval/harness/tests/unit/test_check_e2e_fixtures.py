"""Unit tests for scripts/check_e2e_fixtures.py — the fixture-validity gate."""

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
