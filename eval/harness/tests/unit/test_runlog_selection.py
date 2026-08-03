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

from e2e.runlog_selection import (
    DEFAULT_SINCE_DAYS,
    all_result_jsons,
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


def test_describe_window_says_so_for_the_whole_corpus():
    assert "entire corpus" in describe_window(None, n_runs=134, n_total=134)


# --- discovery (moved here with the collectors) ---------------------------


def test_all_result_jsons_finds_every_fixture(tmp_path, monkeypatch):
    import e2e.runlog_selection as mod

    monkeypatch.setattr(mod, "E2E_RUNLOGS", tmp_path)
    _write_run(tmp_path / "fixture-a", "run-2026-07-01_00-00-00.json", [])
    _write_run(tmp_path / "fixture-a", "run-2026-07-02_00-00-00.json", [])
    _write_run(tmp_path / "fixture-b", "run-2026-07-01_00-00-00.json", [])
    # siblings that must be excluded
    (tmp_path / "fixture-a" / "run-2026-07-01_00-00-00.ann.json").write_text("{}")

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
