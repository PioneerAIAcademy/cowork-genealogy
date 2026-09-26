"""Tests for the blind bundle entry point (e2e.blind_bundle) and the
mechanical annotation validation (check_e2e_fixtures.validate_e2e_annotations).

Issue #2487 PR B.
"""

from __future__ import annotations

import json
import hashlib
from pathlib import Path

import pytest

from e2e.blind_bundle import bundle_paths, bundle_digest, main as bundle_main, _newest_stem


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _make_fixture(tmp_path: Path, slug: str = "test-slug") -> tuple[Path, Path]:
    """Create a minimal fixture + runlog dir for a slug. Returns (fixtures_root, runlogs_root)."""
    fixtures = tmp_path / "fixtures"
    runlogs = tmp_path / "runlogs"

    fixture_dir = fixtures / slug
    runlog_dir = runlogs / slug
    fixture_dir.mkdir(parents=True)
    runlog_dir.mkdir(parents=True)

    _write_json(fixture_dir / "expected-findings.json", {
        "findings": [{"id": "f1", "description": "test finding"}]
    })
    _write_json(fixture_dir / "fixture.json", {
        "researcher_question": "Who was the father?"
    })

    stem = "run-2026-01-01_00-00-00"
    _write_json(runlog_dir / f"{stem}.json", {"verdict": "pass"})
    _write_json(runlog_dir / f"{stem}.final-tree.gedcomx.json", {"persons": []})
    _write_json(runlog_dir / f"{stem}.final-research.json", {"project": {}})

    return fixtures, runlogs


# --------------------------------------------------------------------------- #
# Blind bundle: bundle_paths
# --------------------------------------------------------------------------- #

def test_bundle_paths_returns_four_files(tmp_path):
    fixtures, runlogs = _make_fixture(tmp_path)
    paths = bundle_paths("test-slug", "run-2026-01-01_00-00-00",
                         fixtures_root=fixtures, runlogs_root=runlogs)
    assert len(paths) == 4
    names = [p.name for p in paths]
    assert "expected-findings.json" in names
    assert "fixture.json" in names
    assert "run-2026-01-01_00-00-00.final-tree.gedcomx.json" in names
    assert "run-2026-01-01_00-00-00.final-research.json" in names
    # run-<ts>.json must NOT be in the list
    assert all("run-2026-01-01_00-00-00.json" != p.name for p in paths)


# --------------------------------------------------------------------------- #
# Blind bundle: digest is deterministic
# --------------------------------------------------------------------------- #

def test_bundle_digest_deterministic(tmp_path):
    fixtures, runlogs = _make_fixture(tmp_path)
    paths = bundle_paths("test-slug", "run-2026-01-01_00-00-00",
                         fixtures_root=fixtures, runlogs_root=runlogs)
    d1 = bundle_digest(paths)
    d2 = bundle_digest(paths)
    assert d1 == d2
    assert len(d1) == 64  # sha256 hex


# --------------------------------------------------------------------------- #
# Blind bundle: newest stem
# --------------------------------------------------------------------------- #

def test_newest_stem_picks_latest(tmp_path):
    slug_dir = tmp_path / "slug"
    slug_dir.mkdir()
    _write_json(slug_dir / "run-2026-01-01_00-00-00.json", {})
    _write_json(slug_dir / "run-2026-06-15_12-30-00.json", {})
    _write_json(slug_dir / "run-2026-06-15_12-30-00.ann.json", {})  # sibling, not a stem
    assert _newest_stem(slug_dir) == "run-2026-06-15_12-30-00"


def test_newest_stem_errors_on_empty(tmp_path):
    slug_dir = tmp_path / "empty"
    slug_dir.mkdir()
    with pytest.raises(FileNotFoundError):
        _newest_stem(slug_dir)


# --------------------------------------------------------------------------- #
# Blind bundle: CLI refusal
# --------------------------------------------------------------------------- #

def test_cli_refuses_json_suffix(tmp_path, capsys):
    fixtures, runlogs = _make_fixture(tmp_path)
    rc = bundle_main([
        "test-slug", "run-2026-01-01_00-00-00.json",
        "--fixtures-root", str(fixtures),
        "--runlogs-root", str(runlogs),
    ])
    assert rc == 1
    assert "refusing" in capsys.readouterr().err


def test_cli_errors_on_nonexistent_slug(tmp_path, capsys):
    rc = bundle_main([
        "nonexistent",
        "--runlogs-root", str(tmp_path),
    ])
    assert rc == 1
    assert "no run logs" in capsys.readouterr().err


def test_cli_succeeds_on_valid_slug(tmp_path, capsys):
    fixtures, runlogs = _make_fixture(tmp_path)
    rc = bundle_main([
        "test-slug",
        "--fixtures-root", str(fixtures),
        "--runlogs-root", str(runlogs),
    ])
    assert rc == 0
    out = capsys.readouterr().out
    assert "blind_bundle_digest=" in out
    assert "expected-findings.json" in out
    assert "run-2026-01-01_00-00-00.json" not in out  # run log must NOT appear


# --------------------------------------------------------------------------- #
# Mechanical rungs: validate_e2e_annotations
# --------------------------------------------------------------------------- #

# Import from the stdlib-only script path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from check_e2e_fixtures import validate_e2e_annotations, _findings_hash_local


def _make_ann(runlogs_dir: Path, slug: str, stem: str, ann: dict,
              *, fixture_findings: list | None = None,
              write_tree: bool = True, write_ef: bool = False,
              fixtures_dir: Path | None = None) -> Path:
    """Write an annotation and its required siblings."""
    slug_dir = runlogs_dir / slug
    slug_dir.mkdir(parents=True, exist_ok=True)
    ann_path = slug_dir / f"{stem}.ann.json"
    _write_json(ann_path, ann)
    if write_tree:
        _write_json(slug_dir / f"{stem}.final-tree.gedcomx.json", {"persons": []})
    return ann_path


def test_rung_valid_annotation_passes(tmp_path):
    runlogs = tmp_path / "runlogs"
    fixtures = tmp_path / "fixtures"
    _write_json(fixtures / "s" / "expected-findings.json", {
        "findings": [{"id": "f1"}]
    })
    _make_ann(runlogs, "s", "run-2026-01-01_00-00-00", {
        "per_finding": {"f1": "true"},
        "annotator": "t",
    }, fixtures_dir=fixtures)
    errors = validate_e2e_annotations(runlogs, fixtures)
    assert errors == []


def test_rung_findings_hash_match_passes(tmp_path):
    runlogs = tmp_path / "runlogs"
    fixtures = tmp_path / "fixtures"
    ef_path = fixtures / "s" / "expected-findings.json"
    _write_json(ef_path, {"findings": [{"id": "f1"}]})
    h = _findings_hash_local(ef_path)
    _make_ann(runlogs, "s", "run-2026-01-01_00-00-00", {
        "per_finding": {"f1": "true"},
        "findings_hash": h,
    }, fixtures_dir=fixtures)
    errors = validate_e2e_annotations(runlogs, fixtures)
    assert errors == []


def test_rung_findings_hash_mismatch_fails(tmp_path):
    runlogs = tmp_path / "runlogs"
    fixtures = tmp_path / "fixtures"
    ef_path = fixtures / "s" / "expected-findings.json"
    _write_json(ef_path, {"findings": [{"id": "f1"}]})
    _make_ann(runlogs, "s", "run-2026-01-01_00-00-00", {
        "per_finding": {"f1": "true"},
        "findings_hash": "0000000000000000000000000000000000000000000000000000000000000000",
    }, fixtures_dir=fixtures)
    errors = validate_e2e_annotations(runlogs, fixtures)
    assert len(errors) == 1
    assert "findings_hash mismatch" in errors[0]


def test_rung_unstamped_passes(tmp_path):
    """Grandfather: no findings_hash → no content-drift check."""
    runlogs = tmp_path / "runlogs"
    fixtures = tmp_path / "fixtures"
    _write_json(fixtures / "s" / "expected-findings.json", {
        "findings": [{"id": "f1"}]
    })
    _make_ann(runlogs, "s", "run-2026-01-01_00-00-00", {
        "per_finding": {"f1": "true"},
        # no findings_hash
    }, fixtures_dir=fixtures)
    errors = validate_e2e_annotations(runlogs, fixtures)
    assert errors == []


def test_rung_unknown_keys_fails(tmp_path):
    runlogs = tmp_path / "runlogs"
    fixtures = tmp_path / "fixtures"
    _write_json(fixtures / "s" / "expected-findings.json", {
        "findings": [{"id": "f1"}]
    })
    _make_ann(runlogs, "s", "run-2026-01-01_00-00-00", {
        "per_finding": {"f1": "true"},
        "verdict": "pass",  # not allowed
    }, fixtures_dir=fixtures)
    errors = validate_e2e_annotations(runlogs, fixtures)
    assert len(errors) == 1
    assert "unknown key" in errors[0]


def test_rung_null_per_finding_skips(tmp_path):
    """Incomplete (null label) → skip, not error."""
    runlogs = tmp_path / "runlogs"
    fixtures = tmp_path / "fixtures"
    _write_json(fixtures / "s" / "expected-findings.json", {
        "findings": [{"id": "f1"}]
    })
    _make_ann(runlogs, "s", "run-2026-01-01_00-00-00", {
        "per_finding": {"f1": None},
    }, fixtures_dir=fixtures)
    errors = validate_e2e_annotations(runlogs, fixtures)
    assert errors == []
