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
from check_e2e_fixtures import validate_e2e_annotations, _findings_hash_local, _bundle_digest_local


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
    if fixtures_dir is not None and not (fixtures_dir / slug / "fixture.json").exists():
        _write_json(fixtures_dir / slug / "fixture.json", {"slug": slug})
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


# --- blind_bundle_digest rung (rung 8) in validate_e2e_annotations ----------


def test_rung_bundle_digest_match_passes(tmp_path):
    runlogs = tmp_path / "runlogs"
    fixtures = tmp_path / "fixtures"
    stem = "run-2026-01-01_00-00-00"
    _write_json(fixtures / "s" / "expected-findings.json", {"findings": [{"id": "f1"}]})
    _write_json(fixtures / "s" / "fixture.json", {"id": "s"})
    _write_json(runlogs / "s" / f"{stem}.final-tree.gedcomx.json", {"persons": []})
    _write_json(runlogs / "s" / f"{stem}.final-research.json", {"proof_summaries": []})
    h = _bundle_digest_local("s", stem, fixtures, runlogs)
    _make_ann(runlogs, "s", stem, {
        "per_finding": {"f1": "true"},
        "blind_bundle_digest": h,
    }, fixtures_dir=fixtures)
    errors = validate_e2e_annotations(runlogs, fixtures)
    assert errors == []


def test_rung_bundle_digest_mismatch_fails(tmp_path):
    runlogs = tmp_path / "runlogs"
    fixtures = tmp_path / "fixtures"
    stem = "run-2026-01-01_00-00-00"
    _write_json(fixtures / "s" / "expected-findings.json", {"findings": [{"id": "f1"}]})
    _write_json(fixtures / "s" / "fixture.json", {"id": "s"})
    _write_json(runlogs / "s" / f"{stem}.final-tree.gedcomx.json", {"persons": []})
    _write_json(runlogs / "s" / f"{stem}.final-research.json", {"proof_summaries": []})
    _make_ann(runlogs, "s", stem, {
        "per_finding": {"f1": "true"},
        "blind_bundle_digest": "0" * 64,
    }, fixtures_dir=fixtures)
    errors = validate_e2e_annotations(runlogs, fixtures)
    assert len(errors) == 1
    assert "blind_bundle_digest mismatch" in errors[0]


def test_rung_absent_bundle_digest_passes(tmp_path):
    """Grandfather: no blind_bundle_digest → no bundle-provenance check."""
    runlogs = tmp_path / "runlogs"
    fixtures = tmp_path / "fixtures"
    _write_json(fixtures / "s" / "expected-findings.json", {"findings": [{"id": "f1"}]})
    _make_ann(runlogs, "s", "run-2026-01-01_00-00-00", {
        "per_finding": {"f1": "true"},
    }, fixtures_dir=fixtures)
    errors = validate_e2e_annotations(runlogs, fixtures)
    assert errors == []


def test_bundle_digest_local_agrees_with_real(tmp_path):
    """Cross-check: stdlib reimplementation produces the same digest as the real one."""
    fixtures = tmp_path / "fixtures"
    runlogs = tmp_path / "runlogs"
    stem = "run-2026-01-01_00-00-00"
    _write_json(fixtures / "s" / "expected-findings.json", {"findings": [{"id": "f1"}]})
    _write_json(fixtures / "s" / "fixture.json", {"id": "s"})
    _write_json(runlogs / "s" / f"{stem}.final-tree.gedcomx.json", {"persons": []})
    _write_json(runlogs / "s" / f"{stem}.final-research.json", {"proof_summaries": []})
    local = _bundle_digest_local("s", stem, fixtures, runlogs)
    real = bundle_digest(bundle_paths("s", stem, fixtures_root=fixtures, runlogs_root=runlogs))
    assert local == real


# --------------------------------------------------------------------------- #
# A stamped digest survives a fixture.json `hint` backfill (issue #3553)
# --------------------------------------------------------------------------- #

import shutil

from check_e2e_fixtures import _DIGEST_IGNORED_FIXTURE_KEYS as _LOCAL_IGNORED_KEYS
from e2e.blind_bundle import (
    DEFAULT_FIXTURES_ROOT,
    DEFAULT_RUNLOGS_ROOT,
    _DIGEST_IGNORED_FIXTURE_KEYS,
)

_JOAO_SLUG = "joao-sousa-death"
_JOAO_STEM = "run-2026-10-13_17-30-36"
_JOAO_HINT = {"persona_ark": "ark:/61903/1:1:6YP6-D37M", "identity": "unresolved"}


def _drop_hint(obj: dict) -> dict:
    obj.pop("hint", None)
    return obj


def _copy_joao(tmp_path: Path) -> tuple[Path, Path, str]:
    """Copy the real graded joao-sousa-death run into tmp; return its stamped digest.

    The copied fixture.json loses any ``hint``, so every test starts from the
    pre-backfill state the grade was stamped against, whatever main holds.
    """
    fixtures = tmp_path / "fixtures"
    runlogs = tmp_path / "runlogs"
    shutil.copytree(DEFAULT_FIXTURES_ROOT / _JOAO_SLUG, fixtures / _JOAO_SLUG)
    _rewrite_json(fixtures / _JOAO_SLUG / "fixture.json", _drop_hint)
    (runlogs / _JOAO_SLUG).mkdir(parents=True)
    for suffix in (".ann.json", ".final-tree.gedcomx.json", ".final-research.json"):
        name = _JOAO_STEM + suffix
        shutil.copy2(DEFAULT_RUNLOGS_ROOT / _JOAO_SLUG / name, runlogs / _JOAO_SLUG / name)
    ann = json.loads((runlogs / _JOAO_SLUG / f"{_JOAO_STEM}.ann.json").read_text(encoding="utf-8"))
    return fixtures, runlogs, ann["blind_bundle_digest"]


def _joao_digests(fixtures: Path, runlogs: Path) -> tuple[str, str]:
    real = bundle_digest(bundle_paths(_JOAO_SLUG, _JOAO_STEM,
                                      fixtures_root=fixtures, runlogs_root=runlogs))
    local = _bundle_digest_local(_JOAO_SLUG, _JOAO_STEM, fixtures, runlogs)
    return real, local


def _rewrite_json(path: Path, edit, *, indent: int = 2) -> None:
    obj = json.loads(path.read_text(encoding="utf-8"))
    obj = edit(obj)
    path.write_text(json.dumps(obj, indent=indent, ensure_ascii=False) + "\n", encoding="utf-8")


def test_ignored_fixture_keys_agree_across_implementations():
    assert _DIGEST_IGNORED_FIXTURE_KEYS == _LOCAL_IGNORED_KEYS == ("hint",)


def test_joao_copy_reproduces_stamped_digest(tmp_path):
    fixtures, runlogs, stamped = _copy_joao(tmp_path)
    assert _joao_digests(fixtures, runlogs) == (stamped, stamped)


@pytest.mark.parametrize("edit,indent", [
    (lambda m: {**m, "hint": _JOAO_HINT}, 2),
    (lambda m: {**m, "hint": None}, 2),
    (lambda m: {"hint": _JOAO_HINT, **m}, 4),
], ids=["hint-object-appended", "hint-null", "hint-object-first-reindented"])
def test_hint_backfill_keeps_stamped_digest(tmp_path, edit, indent):
    fixtures, runlogs, stamped = _copy_joao(tmp_path)
    _rewrite_json(fixtures / _JOAO_SLUG / "fixture.json", edit, indent=indent)
    assert _joao_digests(fixtures, runlogs) == (stamped, stamped)


def _set(key, value):
    def edit(obj):
        obj[key] = value
        return obj
    return edit


def _set_nested_hint(obj):
    obj["tags"]["hint"] = _JOAO_HINT
    return obj


@pytest.mark.parametrize("filename,edit", [
    ("fixture.json", _set("researcher_question", "When did João Gomes de Sousa die?")),
    ("fixture.json", _set("notes", "")),
    ("fixture.json", _set("hints", _JOAO_HINT)),
    ("fixture.json", _set_nested_hint),
    ("expected-findings.json", _set("hint", _JOAO_HINT)),
], ids=["researcher_question", "notes", "hints-key", "nested-tags-hint",
        "hint-in-expected-findings"])
def test_any_other_change_still_moves_digest(tmp_path, filename, edit):
    fixtures, runlogs, stamped = _copy_joao(tmp_path)
    _rewrite_json(fixtures / _JOAO_SLUG / filename, edit)
    real, local = _joao_digests(fixtures, runlogs)
    assert real != stamped
    assert local != stamped


def test_hint_backfill_passes_both_rung_8_checks(tmp_path):
    from e2e.calibrate_judge import load_annotated_runs

    fixtures, runlogs, _ = _copy_joao(tmp_path)
    fixture_json = fixtures / _JOAO_SLUG / "fixture.json"
    _rewrite_json(fixture_json, lambda m: {**m, "hint": _JOAO_HINT})
    assert validate_e2e_annotations(runlogs, fixtures) == []
    cases, problems = load_annotated_runs(runlogs, fixtures)
    assert [p for p in problems if p.severity == "error"] == []
    assert [c["blind_bundle_digest_present"] for c in cases] == [True]

    _rewrite_json(fixture_json, _set("researcher_question", "Where did he die?"))
    errors = validate_e2e_annotations(runlogs, fixtures)
    assert len(errors) == 1 and "blind_bundle_digest mismatch" in errors[0]
    cases, problems = load_annotated_runs(runlogs, fixtures)
    assert cases == []
    assert any("blind_bundle_digest mismatch" in p.message for p in problems)
