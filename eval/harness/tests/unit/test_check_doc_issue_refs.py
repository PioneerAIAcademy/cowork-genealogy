"""Tests for scripts/check_doc_issue_refs.py — the closed-issue-citation lint.

The lint's whole value is its narrowness: it flags a closed issue cited in a
TRACKING position and stays silent on one cited as history. Un-narrowed it fired
on 99 sites, nearly all of them correct prose ("three subagents were deleted on
2026-08-02, issue #1161"), and a lint that noisy is one nobody reads. Most of
what is below pins that line.

No network: `closed_issues` is the only thing that talks to GitHub, and every
test here either substitutes it or exercises the pure extraction half.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import check_doc_issue_refs as lint  # noqa: E402


def _refs(tmp_path: Path, body: str) -> dict[int, list[tuple[Path, int]]]:
    doc = tmp_path / "spec.md"
    doc.write_text(body, encoding="utf-8")
    return lint.refs_by_number([doc])


# --- the tracking shapes it MUST catch -------------------------------------


def test_flags_an_issue_in_a_tracking_table_column(tmp_path):
    """`architecture.md` §9.4's shape — the one that let #999 go stale."""
    refs = _refs(
        tmp_path,
        "| Gap | Consequence | Tracking |\n"
        "|---|---|---|\n"
        "| **Nothing checks X.** | Y breaks. | #999 |\n",
    )
    assert 999 in refs


def test_flags_tracking_prose(tmp_path):
    for phrasing in (
        "The window is uncalibrated. Tracked as issue #911.",
        "That is deferred — filed as #1285.",
        "Graduating it is gated on #940.",
        "- **Sweep the cites.** → #1300",
    ):
        assert _refs(tmp_path, phrasing), f"missed tracking prose: {phrasing!r}"


# --- the history shapes it MUST NOT catch ----------------------------------


def test_ignores_an_issue_cited_as_history(tmp_path):
    """A closed issue named as the reason something happened stays true forever.

    ADR-0001, ADR-0007, CLAUDE.md and DEVELOPMENT.md all do this deliberately.
    """
    assert not _refs(
        tmp_path,
        "Three subagents were deleted on 2026-08-02 (issue #1161) because their "
        "paths rotted silently after `packages/engine/` was introduced.",
    )


def test_ignores_a_non_tracking_table_column(tmp_path):
    assert not _refs(
        tmp_path,
        "| Change | Why |\n|---|---|\n| Deleted the copy | landed in #1161 |\n",
    )


def test_table_scope_ends_at_the_blank_line(tmp_path):
    """A tracking column must not leak onto prose further down the file."""
    refs = _refs(
        tmp_path,
        "| Gap | Tracking |\n|---|---|\n| A | #999 |\n"
        "\n"
        "Unrelated prose mentioning #1006 in passing.\n",
    )
    assert 999 in refs
    assert 1006 not in refs


def test_ignores_headings_anchors_and_short_numbers(tmp_path):
    assert not _refs(
        tmp_path,
        "### 1.2 Scope\n\nSee [the section](#94-what-nothing-checks). Colour #fff. "
        "Tracked as item #12 in the old list.\n",
    )


# --- the failure paths, which must never red a PR --------------------------


def test_exits_clean_when_github_is_unavailable(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(lint, "scan_targets", lambda: [tmp_path / "x.md"])
    (tmp_path / "x.md").write_text("Tracked as issue #999.\n", encoding="utf-8")
    monkeypatch.setattr(lint, "closed_issues", lambda numbers: None)
    assert lint.main() == 0
    assert "skipped" in capsys.readouterr().out


def test_reports_but_still_exits_zero_when_a_ref_is_closed(tmp_path, monkeypatch, capsys):
    """Warn-only. A blocking check that fires 27 times on day one gets bypassed."""
    monkeypatch.setattr(lint, "scan_targets", lambda: [tmp_path / "x.md"])
    (tmp_path / "x.md").write_text("Tracked as issue #999.\n", encoding="utf-8")
    monkeypatch.setattr(lint, "closed_issues", lambda numbers: {999})
    assert lint.main() == 0
    out = capsys.readouterr().out
    assert "::warning" in out and "#999" in out


def test_a_number_github_cannot_resolve_does_not_blind_the_batch(monkeypatch):
    """GraphQL errors on one bad alias while resolving every other one, and `gh`
    exits non-zero for it. Bailing there would hide every real finding."""
    class Proc:
        returncode = 1
        stdout = '{"data":{"repository":{"i999":{"state":"CLOSED"},"i4242":null}},' \
                 '"errors":[{"message":"Could not resolve to an issue"}]}'
        stderr = ""

    monkeypatch.setattr(lint.subprocess, "run", lambda *a, **k: Proc())
    assert lint.closed_issues([999, 4242]) == {999}


@pytest.mark.parametrize("stdout", ["", "not json", '{"data":null}'])
def test_unparseable_api_output_is_treated_as_unavailable(monkeypatch, stdout):
    class Proc:
        returncode = 0
        stderr = ""

    Proc.stdout = stdout
    monkeypatch.setattr(lint.subprocess, "run", lambda *a, **k: Proc())
    assert lint.closed_issues([999]) is None
