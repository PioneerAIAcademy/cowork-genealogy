"""Tests for e2e.runlog_selection — the corpus-reader query window.

The default window is what stops a whole-corpus average from silently mixing
eras (GitHub issue #985; the hand-rolled precedents are #1104 and #1085).
"""

from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from harness.since_window import add_since_arg, describe_stale
from e2e.runlog_selection import (
    DEFAULT_SINCE_DAYS,
    all_result_jsons,
    branch_scope_note,
    describe_window,
    filter_since,
    is_result_json,
    parse_since,
    result_jsons_for,
    run_date,
)


def _write_run(d: Path, name: str, tool_calls: list) -> None:
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(json.dumps({"tool_calls": tool_calls}), encoding="utf-8")


def _p(name: str) -> Path:
    return Path("eval/runlogs/e2e/some-slug") / name


def test_is_result_json_excludes_siblings():
    assert is_result_json(_p("run-2026-07-31_13-02-13.json"))
    assert not is_result_json(_p("run-2026-07-31_13-02-13.ann.json"))
    assert not is_result_json(_p("run-2026-07-31_13-02-13.final-tree.gedcomx.json"))
    assert not is_result_json(_p("run-2026-07-31_13-02-13.final-research.json"))
    assert not is_result_json(_p("scratch_2026-07-31_13-02-13.json"))


def test_run_date_parses_the_filename():
    assert run_date(_p("run-2026-07-31_13-02-13.json")) == date(2026, 7, 31)
    assert run_date(_p("nonsense.json")) is None


def test_parse_since_defaults_to_the_window():
    assert parse_since(None) == date.today() - timedelta(days=DEFAULT_SINCE_DAYS)


def test_parse_since_accepts_days_date_and_all():
    assert parse_since("7") == date.today() - timedelta(days=7)
    assert parse_since("2026-07-20") == date(2026, 7, 20)
    assert parse_since("all") is None
    assert parse_since("ALL") is None


def test_parse_since_rejects_garbage():
    with pytest.raises(argparse.ArgumentTypeError):
        parse_since("last tuesday")


def test_filter_since_excludes_older_runs():
    paths = [
        _p("run-2026-07-01_00-00-00.json"),
        _p("run-2026-07-25_00-00-00.json"),
    ]
    kept = filter_since(paths, date(2026, 7, 20))
    assert [p.name for p in kept] == ["run-2026-07-25_00-00-00.json"]


def test_filter_since_keeps_everything_when_cutoff_is_none():
    paths = [_p("run-2026-01-01_00-00-00.json")]
    assert filter_since(paths, None) == paths


def test_filter_since_keeps_undated_runs():
    """A filename we cannot date is KEPT. Dropping it would silently shrink
    the sample on a naming change — the exact failure this module prevents."""
    paths = [_p("weird-name.json")]
    assert filter_since(paths, date(2026, 7, 20)) == paths


def test_describe_window_names_the_sample():
    line = describe_window(date(2026, 7, 20), n_runs=75, n_total=134)
    assert "2026-07-20" in line
    assert "75 of 134" in line
    assert "59 older" in line
    # issue #1444: every e2e reader's line also carries the branch-scope caveat
    assert "make e2e-branch-only" in line


def test_describe_window_says_so_for_the_whole_corpus():
    line = describe_window(None, n_runs=134, n_total=134)
    assert "entire corpus" in line
    assert "make e2e-branch-only" in line


# --- branch-scope caveat (issue #1444) --------------------------------------


def test_branch_scope_note_e2e_names_the_crawl_script():
    assert "make e2e-branch-only" in branch_scope_note(corpus="e2e")


def test_branch_scope_note_unit_does_not_name_an_e2e_only_tool():
    """A unit-corpus reader must not claim `make e2e-branch-only` covers it --
    that script only crawls eval/runlogs/e2e/."""
    note = branch_scope_note(corpus="unit")
    assert "make e2e-branch-only" not in note
    assert "e2e" not in note


def test_branch_scope_note_rejects_an_unrecognized_corpus():
    """No Python type-checking runs over this tree, so a typo'd corpus value
    must fail loudly rather than silently drop (or wrongly add) the
    make e2e-branch-only remedy line."""
    with pytest.raises(ValueError, match="corpus"):
        branch_scope_note(corpus="E2E")


def test_describe_window_unit_corpus_caveat_has_no_e2e_tool_name():
    line = describe_window(date(2026, 7, 20), n_runs=75, n_total=134, corpus="unit")
    assert "75 of 134" in line
    assert "Scoped to this checkout" in line
    assert "make e2e-branch-only" not in line


# --- discovery (moved here with the collectors) ---------------------------


def test_all_result_jsons_finds_every_fixture(tmp_path, monkeypatch):
    import e2e.runlog_selection as mod

    monkeypatch.setattr(mod, "E2E_RUNLOGS", tmp_path)
    _write_run(tmp_path / "fixture-a", "run-2026-07-01_00-00-00.json", [])
    _write_run(tmp_path / "fixture-a", "run-2026-07-02_00-00-00.json", [])
    _write_run(tmp_path / "fixture-b", "run-2026-07-01_00-00-00.json", [])
    # siblings that must be excluded
    (tmp_path / "fixture-a" / "run-2026-07-01_00-00-00.ann.json").write_text("{}", encoding="utf-8")

    found = all_result_jsons()
    assert len(found) == 3  # not the latest-per-fixture-only; every run


def test_result_jsons_for_scopes_to_one_fixture(tmp_path, monkeypatch):
    import e2e.runlog_selection as mod

    monkeypatch.setattr(mod, "E2E_RUNLOGS", tmp_path)
    _write_run(tmp_path / "fixture-a", "run-2026-07-01_00-00-00.json", [])
    _write_run(tmp_path / "fixture-b", "run-2026-07-01_00-00-00.json", [])

    assert len(result_jsons_for("fixture-a")) == 1
    assert result_jsons_for("nonexistent-fixture") == []


def test_add_since_arg_default_is_converted(tmp_path):
    """argparse runs `type=` over a STRING default, so supplied and defaulted
    values take one code path. A non-string default would slip through raw."""
    ap = argparse.ArgumentParser()
    from e2e.runlog_selection import add_since_arg

    add_since_arg(ap)
    assert ap.parse_args([]).since == date.today() - timedelta(days=DEFAULT_SINCE_DAYS)


def test_add_since_arg_accepts_a_whole_corpus_default():
    """guardrail_shadow_report needs the whole corpus by default — calibration
    picks a window size, so a freshness cutoff would shrink its own sample."""
    ap = argparse.ArgumentParser()
    from e2e.runlog_selection import add_since_arg

    add_since_arg(ap, default="all")
    assert ap.parse_args([]).since is None


def test_bad_since_is_a_usage_error_not_a_traceback():
    """As a `type=` converter argparse catches ArgumentTypeError and exits 2
    with usage; calling parse_since by hand after parse_args would traceback."""
    ap = argparse.ArgumentParser()
    from e2e.runlog_selection import add_since_arg

    add_since_arg(ap)
    with pytest.raises(SystemExit) as exc:
        ap.parse_args(["--since", "2weeks"])
    assert exc.value.code == 2


# --- the window now spans BOTH corpora (issue #985 follow-up) --------------


def test_run_date_parses_a_unit_runlog_filename():
    """Unit logs are `v{N}_<ts>.json`, e2e are `run-<ts>.json`. One window
    serves both, so the parser must read either shape."""
    assert run_date(Path("eval/runlogs/unit/citation/v1_2026-07-31_12-57-04.json")) == date(2026, 7, 31)
    assert run_date(Path("eval/runlogs/unit/citation/v12_2026-06-01_00-00-00.json")) == date(2026, 6, 1)


def test_run_date_is_none_for_a_released_runlog():
    """A released `v{N}.json` carries no timestamp; filter_since must keep it
    rather than age out the one tier the retention rule keeps forever."""
    p = Path("eval/runlogs/unit/citation/v3.json")
    assert run_date(p) is None
    assert filter_since([p], date(2026, 7, 20)) == [p]


def test_filter_since_mixes_both_corpora():
    paths = [
        Path("eval/runlogs/e2e/slug/run-2026-07-01_00-00-00.json"),
        Path("eval/runlogs/e2e/slug/run-2026-07-25_00-00-00.json"),
        Path("eval/runlogs/unit/s1/v1_2026-07-02_00-00-00.json"),
        Path("eval/runlogs/unit/s1/v1_2026-07-30_00-00-00.json"),
    ]
    kept = [p.name for p in filter_since(paths, date(2026, 7, 20))]
    assert kept == ["run-2026-07-25_00-00-00.json", "v1_2026-07-30_00-00-00.json"]


# --- unit readers FLAG staleness rather than filtering it ------------------


def test_describe_stale_names_the_subjects_and_their_age():
    line = describe_stale([("assertion-classification", date(2026, 6, 29))])
    assert "assertion-classification" in line
    assert "STALE" in line
    assert "re-run" in line


def test_describe_stale_is_empty_when_nothing_is_stale():
    assert describe_stale([]) == ""


def test_unit_readers_default_to_no_cutoff():
    """A date filter on a one-row-per-skill report deletes the skill instead of
    narrowing a sample, hiding the fact that it needs a re-run. Those readers
    pass default="all"; the aggregating e2e reports keep the 14-day default."""
    unit = argparse.ArgumentParser()
    add_since_arg(unit, default="all")
    assert unit.parse_args([]).since is None

    e2e = argparse.ArgumentParser()
    add_since_arg(e2e)
    assert e2e.parse_args([]).since == date.today() - timedelta(days=DEFAULT_SINCE_DAYS)
