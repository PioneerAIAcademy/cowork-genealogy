"""Unit tests for e2e.provided_docs_coverage (issue #2083).

The module reports which e2e fixtures skip non-FamilySearch primary plan items
but ship no bundled external-evidence capture.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from e2e.provided_docs_coverage import (
    coverage_report,
    _capture_count,
    _external_primary_skips,
    _has_real_capture,
    PROVIDED_DOCS_DIRNAME,
)


# ---------------------------------------------------------------------------
# Helpers shared across tests
# ---------------------------------------------------------------------------


def _make_fixture_dir(tmp_path: Path, slug: str = "test-fixture") -> Path:
    d = tmp_path / slug
    d.mkdir()
    return d


def _write_final_research(
    runlogs_root: Path,
    slug: str,
    plans: list[dict],
    ts: str = "2026-08-01T12-00-00Z",
) -> Path:
    slug_dir = runlogs_root / slug
    slug_dir.mkdir(parents=True, exist_ok=True)
    path = slug_dir / f"run-{ts}.final-research.json"
    path.write_text(json.dumps({"plans": plans}), encoding="utf-8")
    return path


def _make_plan_item(
    repo: str,
    status: str = "completed",
    fallback_for: str | None = None,
) -> dict:
    item: dict = {"id": "pli_001", "repository": repo, "status": status}
    if fallback_for:
        item["fallback_for"] = fallback_for
    return item


def _add_capture(fixture_dir: Path, name: str = "ancestry-cert.pdf") -> None:
    docs = fixture_dir / PROVIDED_DOCS_DIRNAME
    docs.mkdir(exist_ok=True)
    (docs / name).write_bytes(b"%PDF-1.4 fake")


def _add_gitkeep(fixture_dir: Path) -> None:
    docs = fixture_dir / PROVIDED_DOCS_DIRNAME
    docs.mkdir(exist_ok=True)
    (docs / ".gitkeep").write_bytes(b"")


# ---------------------------------------------------------------------------
# _has_real_capture
# ---------------------------------------------------------------------------


def test_has_real_capture_false_when_no_dir(tmp_path: Path):
    assert _has_real_capture(tmp_path / "no-such-fixture") is False


def test_has_real_capture_false_when_dir_absent_docs(tmp_path: Path):
    d = tmp_path / "fixture"
    d.mkdir()
    assert _has_real_capture(d) is False


def test_has_real_capture_false_when_only_gitkeep(tmp_path: Path):
    d = _make_fixture_dir(tmp_path)
    _add_gitkeep(d)
    assert _has_real_capture(d) is False


def test_has_real_capture_true_when_pdf_present(tmp_path: Path):
    d = _make_fixture_dir(tmp_path)
    _add_capture(d, "ancestry-cert.pdf")
    assert _has_real_capture(d) is True


def test_has_real_capture_true_when_png_present(tmp_path: Path):
    d = _make_fixture_dir(tmp_path)
    _add_capture(d, "ancestry-screen.png")
    assert _has_real_capture(d) is True


# ---------------------------------------------------------------------------
# _capture_count
# ---------------------------------------------------------------------------


def test_capture_count_zero_when_empty(tmp_path: Path):
    assert _capture_count(tmp_path / "no-such") == 0


def test_capture_count_ignores_gitkeep(tmp_path: Path):
    d = _make_fixture_dir(tmp_path)
    _add_gitkeep(d)
    assert _capture_count(d) == 0


def test_capture_count_returns_real_files(tmp_path: Path):
    d = _make_fixture_dir(tmp_path)
    _add_capture(d, "a.pdf")
    _add_capture(d, "b.pdf")
    _add_gitkeep(d)
    assert _capture_count(d) == 2


# ---------------------------------------------------------------------------
# _external_primary_skips
# ---------------------------------------------------------------------------


def test_external_primary_skips_empty_when_no_plans():
    assert _external_primary_skips({}) == {}


def test_external_primary_skips_ignores_completed():
    data = {"plans": [{"items": [_make_plan_item("Ancestry", "completed")]}]}
    assert _external_primary_skips(data) == {}


def test_external_primary_skips_ignores_familysearch():
    data = {"plans": [{"items": [_make_plan_item("FamilySearch", "skipped")]}]}
    assert _external_primary_skips(data) == {}


def test_external_primary_skips_ignores_fallback_items():
    item = _make_plan_item("Ancestry", "skipped", fallback_for="pli_001")
    data = {"plans": [{"items": [item]}]}
    assert _external_primary_skips(data) == {}


def test_external_primary_skips_counts_ancestry():
    data = {
        "plans": [
            {
                "items": [
                    _make_plan_item("Ancestry", "skipped"),
                    _make_plan_item("Ancestry", "skipped"),
                    _make_plan_item("FamilySearch", "completed"),
                ]
            }
        ]
    }
    result = _external_primary_skips(data)
    assert result["Ancestry"] == 2


def test_external_primary_skips_counts_other_repos():
    data = {
        "plans": [
            {
                "items": [
                    _make_plan_item("FindAGrave", "skipped"),
                    _make_plan_item("MyHeritage", "skipped"),
                ]
            }
        ]
    }
    result = _external_primary_skips(data)
    assert result["FindAGrave"] == 1
    assert result["MyHeritage"] == 1


def test_external_primary_skips_multi_plan():
    """Items across multiple plans are all counted."""
    data = {
        "plans": [
            {"items": [_make_plan_item("Ancestry", "skipped")]},
            {"items": [_make_plan_item("Ancestry", "skipped")]},
        ]
    }
    assert _external_primary_skips(data)["Ancestry"] == 2


# ---------------------------------------------------------------------------
# coverage_report (integration over tmp corpus)
# ---------------------------------------------------------------------------


def _make_corpus(
    tmp_path: Path,
    *,
    slug: str,
    plans: list[dict],
    with_capture: bool = False,
    with_gitkeep: bool = False,
) -> tuple[Path, Path]:
    """Build a minimal corpus in tmp_path. Returns (runlogs_root, fixtures_root)."""
    runlogs_root = tmp_path / "runlogs"
    fixtures_root = tmp_path / "fixtures"
    fixtures_root.mkdir()
    fixture_dir = fixtures_root / slug
    fixture_dir.mkdir()
    if with_capture:
        _add_capture(fixture_dir)
    elif with_gitkeep:
        _add_gitkeep(fixture_dir)
    _write_final_research(runlogs_root, slug, plans)
    return runlogs_root, fixtures_root


def test_coverage_report_empty_when_no_runlogs(tmp_path: Path):
    skip_table, gap_rows = coverage_report(
        tmp_path / "empty-runlogs",
        tmp_path / "fixtures",
    )
    assert gap_rows == []
    assert skip_table["Ancestry"]["total"] == 0


def test_coverage_report_no_gap_when_only_fs_skips(tmp_path: Path):
    plans = [{"items": [_make_plan_item("FamilySearch", "skipped")]}]
    runlogs, fixtures = _make_corpus(tmp_path, slug="test", plans=plans)
    _, gap_rows = coverage_report(runlogs, fixtures)
    assert gap_rows == []


def test_coverage_report_gap_when_ancestry_skip_no_capture(tmp_path: Path):
    plans = [{"items": [_make_plan_item("Ancestry", "skipped")]}]
    runlogs, fixtures = _make_corpus(tmp_path, slug="test", plans=plans)
    _, gap_rows = coverage_report(runlogs, fixtures)
    assert len(gap_rows) == 1
    assert gap_rows[0]["slug"] == "test"
    assert gap_rows[0]["captures"] == 0
    assert gap_rows[0]["skips"]["Ancestry"] == 1


def test_coverage_report_no_gap_when_capture_present(tmp_path: Path):
    plans = [{"items": [_make_plan_item("Ancestry", "skipped")]}]
    runlogs, fixtures = _make_corpus(
        tmp_path, slug="test", plans=plans, with_capture=True
    )
    _, gap_rows = coverage_report(runlogs, fixtures)
    # Fixture IS in gap_rows because it still has external skips — but captures > 0
    assert len(gap_rows) == 1
    assert gap_rows[0]["captures"] == 1


def test_coverage_report_gitkeep_treated_as_no_capture(tmp_path: Path):
    """A .gitkeep placeholder must not count as a real capture."""
    plans = [{"items": [_make_plan_item("Ancestry", "skipped")]}]
    runlogs, fixtures = _make_corpus(
        tmp_path, slug="test", plans=plans, with_gitkeep=True
    )
    _, gap_rows = coverage_report(runlogs, fixtures)
    assert gap_rows[0]["captures"] == 0


def test_coverage_report_picks_latest_run(tmp_path: Path):
    """Only the lexicographically latest .final-research.json per fixture counts."""
    runlogs_root = tmp_path / "runlogs"
    fixtures_root = tmp_path / "fixtures"
    (fixtures_root / "test").mkdir(parents=True)

    # Older run: Ancestry skipped
    _write_final_research(
        runlogs_root,
        "test",
        [{"items": [_make_plan_item("Ancestry", "skipped")]}],
        ts="2026-07-01T00-00-00Z",
    )
    # Newer run: Ancestry completed — the gap is closed
    _write_final_research(
        runlogs_root,
        "test",
        [{"items": [_make_plan_item("Ancestry", "completed")]}],
        ts="2026-08-01T00-00-00Z",
    )
    _, gap_rows = coverage_report(runlogs_root, fixtures_root)
    assert gap_rows == []


def test_coverage_report_skip_table_accumulates(tmp_path: Path):
    """The skip table counts across all primary items, not just gaps."""
    plans = [
        {
            "items": [
                _make_plan_item("FamilySearch", "skipped"),
                _make_plan_item("Ancestry", "skipped"),
                _make_plan_item("Ancestry", "completed"),
            ]
        }
    ]
    runlogs, fixtures = _make_corpus(tmp_path, slug="test", plans=plans)
    skip_table, _ = coverage_report(runlogs, fixtures)
    assert skip_table["FamilySearch"] == {"skip": 1, "total": 1}
    assert skip_table["Ancestry"] == {"skip": 1, "total": 2}


def test_coverage_report_sorted_by_total_skips_descending(tmp_path: Path):
    """Gap rows are sorted most-skipped first."""
    runlogs_root = tmp_path / "runlogs"
    fixtures_root = tmp_path / "fixtures"

    for slug, skips in [("few", 1), ("many", 3)]:
        (fixtures_root / slug).mkdir(parents=True)
        items = [_make_plan_item("Ancestry", "skipped")] * skips
        _write_final_research(runlogs_root, slug, [{"items": items}])

    _, gap_rows = coverage_report(runlogs_root, fixtures_root)
    assert [r["slug"] for r in gap_rows] == ["many", "few"]
