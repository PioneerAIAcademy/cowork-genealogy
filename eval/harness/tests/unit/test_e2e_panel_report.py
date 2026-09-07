"""The standing e2e panel's scoreboard (`make e2e-panel`).

Two halves. The **count** is the number the panel's acceptance check reads, so
its window has to be the panel's month rather than the shared fortnight. The
**last-run** half is the cadence-free reading: the panel is filed whenever the
lead runs the skill, not on a Monday schedule, so this reports how long ago each
fixture ran rather than whether it ran "this week".

Both halves depend on a filename-shape question an `ls` pipeline gets wrong,
because every run drops a `.ann.json` and two `.final-*` siblings beside itself.

The last two tests guard the panel definition itself, which is stated in two
places: `PANEL` in the reader, and the fixture paths the skill body cites.
`doc-links.test.ts` proves each cited path resolves; nothing else compares the
two lists, so a skill naming three where `PANEL` holds four would pass every
other check in the repo.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from pathlib import Path

import pytest

from e2e import panel_report, runlog_selection
from e2e.panel_report import PANEL

REPO_ROOT = Path(__file__).resolve().parents[4]
SKILL_MD = REPO_ROOT / ".claude" / "skills" / "file-e2e-panel" / "SKILL.md"


def _touch_run(root: Path, slug: str, day: date, *, siblings: bool = True) -> Path:
    """A committed run and the siblings a real run drops beside it."""
    d = root / slug
    d.mkdir(parents=True, exist_ok=True)
    stem = f"run-{day.isoformat()}_12-00-00"
    run = d / f"{stem}.json"
    run.write_text("{}", encoding="utf-8")
    if siblings:
        (d / f"{stem}.ann.json").write_text("{}", encoding="utf-8")
        (d / f"{stem}.final-research.json").write_text("{}", encoding="utf-8")
        (d / f"{stem}.final-tree.gedcomx.json").write_text("{}", encoding="utf-8")
    return run


def test_the_last_run_is_named_with_its_age(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(runlog_selection, "E2E_RUNLOGS", tmp_path)
    _touch_run(tmp_path, PANEL[0], date.today() - timedelta(days=3))

    assert panel_report.main([]) == 0
    out = capsys.readouterr().out
    # The date and the age, so the row is checkable by hand against
    # `ls eval/runlogs/e2e/<slug>/` without doing arithmetic.
    assert f"last {(date.today() - timedelta(days=3)).isoformat()} (3d ago)" in out


def test_only_siblings_is_not_a_run(tmp_path, monkeypatch, capsys):
    """The failure an `ls | grep` pipeline makes, and the reason this is a module.

    A graded run leaves `.ann.json` and two `.final-*` files beside the result.
    A fixture holding *only* those has never run.
    """
    monkeypatch.setattr(runlog_selection, "E2E_RUNLOGS", tmp_path)
    run = _touch_run(tmp_path, PANEL[0], date.today())
    run.unlink()  # leave the three siblings, take the result away

    assert panel_report.main([]) == 0
    out = capsys.readouterr().out
    assert "never run" in out
    assert ".ann.json" not in out
    assert ".final-" not in out


def test_a_fixture_that_never_ran_says_so(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(runlog_selection, "E2E_RUNLOGS", tmp_path)
    _touch_run(tmp_path, PANEL[0], date.today())

    assert panel_report.main([]) == 0
    out = capsys.readouterr().out
    assert out.count("never run") == 3  # the other three panel fixtures


def test_the_count_is_per_fixture_and_honors_the_window(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(runlog_selection, "E2E_RUNLOGS", tmp_path)
    today = date.today()
    _touch_run(tmp_path, PANEL[0], today - timedelta(days=3))
    _touch_run(tmp_path, PANEL[0], today - timedelta(days=20))
    _touch_run(tmp_path, PANEL[0], today - timedelta(days=200))  # outside any month
    _touch_run(tmp_path, PANEL[1], today - timedelta(days=3))

    assert panel_report.main([]) == 0
    rows = _rows(capsys.readouterr().out)
    # 28-day default, not the shared 14: the panel compares months.
    assert rows[PANEL[0]] == 2
    assert rows[PANEL[1]] == 1
    assert rows[PANEL[2]] == 0

    assert panel_report.main(["--since", "all"]) == 0
    assert _rows(capsys.readouterr().out)[PANEL[0]] == 3

    assert panel_report.main(["--since", "7"]) == 0
    assert _rows(capsys.readouterr().out)[PANEL[0]] == 1


def _rows(out: str) -> dict[str, int]:
    found = {}
    for slug in PANEL:
        m = re.search(rf"^\s*{re.escape(slug)}\s+(\d+) in window", out, re.M)
        assert m, f"{slug} missing from report:\n{out}"
        found[slug] = int(m.group(1))
    return found


def test_an_empty_window_is_a_report_not_a_failure(tmp_path, monkeypatch, capsys):
    """The state this reader shipped in: nobody has run the panel lately, and
    that is the answer. Exiting non-zero here would make the skill treat its own
    headline finding as a broken tool."""
    monkeypatch.setattr(runlog_selection, "E2E_RUNLOGS", tmp_path)
    _touch_run(tmp_path, PANEL[0], date.today() - timedelta(days=200))

    assert panel_report.main([]) == 0
    assert "No panel fixture has run inside the window" in capsys.readouterr().out


@pytest.mark.parametrize("slug", PANEL)
def test_every_panel_slug_is_a_real_fixture(slug):
    """The panel rots the moment a fixture is renamed, and nothing else notices:
    the run-log directory it reads is not deleted by a rename, so the reader
    would keep reporting a fixture that can no longer be run."""
    assert (REPO_ROOT / "eval" / "tests" / "e2e" / slug / "fixture.json").is_file()


def test_the_skill_names_exactly_the_panel():
    """`PANEL` and the skill body are two statements of one list.

    `doc-links.test.ts` proves each path the skill cites resolves; it cannot see
    a skill listing three of four, or naming a real fixture that is not on the
    panel. This is the only check that compares them.
    """
    body = SKILL_MD.read_text(encoding="utf-8")
    cited = set(re.findall(r"eval/tests/e2e/([a-z0-9-]+)/", body))
    assert cited == set(PANEL), (
        f"the skill cites {sorted(cited)} but PANEL holds {sorted(PANEL)} — "
        "update whichever is wrong; they are one list stated twice"
    )
