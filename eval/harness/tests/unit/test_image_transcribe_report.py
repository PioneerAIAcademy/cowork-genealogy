"""Unit tests for e2e.image_transcribe_report — issue #1594's reachability half.

Everything here builds its own run logs in a tmpdir. Nothing asserts against the
committed corpus: its numbers move with every e2e run that lands, so a test
pinned to them fails for reasons that have nothing to do with this code.
"""

from __future__ import annotations

import json
from pathlib import Path

from e2e.image_transcribe_report import (
    SUCCESS,
    UNCLASSIFIED,
    UNREACHABLE,
    UNRECOGNIZED_ARK,
    classify,
    format_report,
    interleaving_verdict,
    scan,
)


def _run(dir_: Path, name: str, summaries: list[str], *, stripped: bool = False) -> Path:
    """One committed run log holding `image_transcribe` calls."""
    calls = []
    for s in summaries:
        call = {"tool": "mcp__genealogy__image_transcribe"}
        if not stripped:
            call["response_summary"] = s
        calls.append(call)
    doc: dict = {"tool_calls": calls}
    if stripped:
        doc["captures_stripped"] = True
    p = dir_ / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc), encoding="utf-8")
    return p


def _authors(mapping: dict[str, str]):
    return lambda p: mapping.get(p.name, "someone")


# --- the defect this report exists to close ---------------------------------


def test_a_stripped_run_is_tallied_and_kept_out_of_the_denominator(tmp_path: Path):
    """The whole point. `b065b687` strips `response_summary` past 14 days, so a
    stripped call carries no outcome at all. Counting it in the denominator is
    what made the issue's own snippet understate the rate — 30 of 394 instead of
    30 of 175 — and read as the problem receding.

    Break `scan`'s `captures_stripped` check and this test moves: the stripped
    calls land in `unclassified` and the reachability rate halves.
    """
    fresh = _run(tmp_path / "fix-a", "run-2026-08-20_00-00-00.json",
                 ["Could not reach OpenRouter. (fetch failed)", "ok text"])
    old = _run(tmp_path / "fix-b", "run-2026-07-01_00-00-00.json",
               ["", "", ""], stripped=True)

    r = scan([fresh, old], author_of=_authors({}))

    assert r.stripped_calls == 3
    assert r.stripped_runs == 1
    assert r.measurable == 2, "stripped calls must not enter the denominator"
    assert r.reachability_failures == 1

    out = format_report(r)
    assert "1 of 2 measurable (50.0%)" in out
    # And the loss is stated, not silently absorbed.
    assert "3 in 1 run(s)" in out


def test_an_all_stripped_corpus_reports_no_measurable_calls_and_exits_nonzero(tmp_path: Path):
    """A corpus with nothing left to read must not print a 0% failure rate — that
    is a clean bill of health issued over no evidence."""
    old = _run(tmp_path / "fix", "run-2026-01-01_00-00-00.json", ["", ""], stripped=True)
    r = scan([old], author_of=_authors({}))

    assert r.measurable == 0
    out = format_report(r)
    assert "NO MEASURABLE CALLS" in out
    assert "This is not a 0% failure rate" in out


def test_every_rate_carries_its_denominator(tmp_path: Path):
    """A bare percentage is what rots. Each one printed here names what it was
    taken over, so a shrinking corpus reads as shrinking evidence."""
    p = _run(tmp_path / "fix", "run-2026-08-20_00-00-00.json",
             ["Could not reach OpenRouter. (fetch failed)", "ok", "ok", "ok"])
    out = format_report(scan([p], author_of=_authors({})))

    assert "1 of 4 measurable (25.0%)" in out
    # Nothing stripped here, so the rate is exact and must not claim otherwise —
    # overstating the uncertainty is the same failure as understating it.
    assert "exact — no captures stripped in range" in out
    assert "unrecoverable" not in out


def test_the_bound_is_only_claimed_when_captures_were_actually_stripped(tmp_path: Path):
    """The other branch. With stripped calls present the true rate genuinely is
    unknown, and the report must give the interval rather than a point estimate:
    1 known failure and 6 unreadable outcomes over 8 calls is anywhere in
    [12.5%, 87.5%]."""
    fresh = _run(tmp_path / "a", "run-2026-08-20_00-00-00.json",
                 ["Could not reach OpenRouter. (fetch failed)", "ok"])
    old_run = _run(tmp_path / "b", "run-2026-07-01_00-00-00.json",
                   ["", "", "", "", "", ""], stripped=True)
    out = format_report(scan([fresh, old_run], author_of=_authors({})))

    assert "unrecoverable — bounded [12.5%, 87.5%]" in out


# --- classification ---------------------------------------------------------


def test_unrecognized_ark_is_not_counted_as_a_reachability_failure(tmp_path: Path):
    """`Unrecognized ark` is `is_error: true` but is a CONTENT error — the call
    reached OpenRouter and was refused for its argument. Folding it into the
    reachability count is why an `is_error`-only measurement over-counts; there
    are 2 real instances in the committed corpus."""
    assert classify('{"error":"Unrecognized ark. Expected a FamilySearch...') == UNRECOGNIZED_ARK

    p = _run(tmp_path / "fix", "run-2026-08-20_00-00-00.json",
             ['{"error":"Unrecognized ark. Expected..."}', "ok"])
    r = scan([p], author_of=_authors({}))
    assert r.reachability_failures == 0
    assert r.measurable == 2


def test_an_unknown_shape_lands_in_unclassified_never_in_success():
    """A classifier that folds what it cannot match into `success` reports a
    lower failure rate than reality — the same defect as the stripped
    denominator, one level down."""
    assert classify("") == UNCLASSIFIED
    assert classify("   ") == UNCLASSIFIED
    assert classify("transcribed text of a birth register") == SUCCESS
    assert classify("Could not reach OpenRouter. (fetch failed)") == UNREACHABLE


def test_a_call_is_matched_under_every_server_spelling(tmp_path: Path):
    """The tool arrives under three prefixes depending on registrar (CLAUDE.md
    § "Dual-spelled tool names"). Matching one spelling would silently measure a
    fraction of the corpus."""
    doc = {
        "tool_calls": [
            {"tool": "mcp__genealogy__image_transcribe", "response_summary": "ok"},
            {"tool": "mcp__Genealogy_Research__image_transcribe", "response_summary": "ok"},
            {
                "tool": "mcp__remote-devices__Genealogy_Research__image_transcribe",
                "response_summary": "ok",
            },
            {"tool": "mcp__genealogy__record_search", "response_summary": "ok"},
        ]
    }
    p = tmp_path / "fix" / "run-2026-08-20_00-00-00.json"
    p.parent.mkdir(parents=True)
    p.write_text(json.dumps(doc), encoding="utf-8")

    r = scan([p], author_of=_authors({}))
    assert r.measurable == 3, "all three spellings count; the non-transcribe call does not"


def test_one_unreadable_run_log_does_not_take_the_report_down(tmp_path: Path):
    """An interrupted write leaves invalid UTF-8, which raises UnicodeDecodeError
    — a ValueError, NOT a JSONDecodeError. An analysis tool that dies on one bad
    file is one nobody can use (#1485 review)."""
    good = _run(tmp_path / "fix", "run-2026-08-20_00-00-00.json", ["ok"])
    bad = tmp_path / "fix" / "run-2026-08-21_00-00-00.json"
    bad.write_bytes(b'{"tool_calls": [], "n": "\xff\xfe"}')

    r = scan([good, bad], author_of=_authors({}))
    assert r.unreadable == 1
    assert r.measurable == 1, "the readable run was still inspected"


# --- the verdict that keeps the by-author table honest ----------------------


def test_no_interleaving_means_the_report_refuses_to_blame_the_machine(tmp_path: Path):
    """The by-author split clusters on the real corpus, but clustering alone
    cannot separate a bad machine from a bad service — the operators simply ran
    on different days. Only a day where one fails while another succeeds does
    that, and this corpus has none."""
    a = _run(tmp_path / "f1", "run-2026-08-20_00-00-00.json",
             ["Could not reach OpenRouter. (fetch failed)"])
    b = _run(tmp_path / "f2", "run-2026-08-21_00-00-00.json", ["ok"])
    r = scan([a, b], author_of=_authors({
        "run-2026-08-20_00-00-00.json": "alice",
        "run-2026-08-21_00-00-00.json": "bob",
    }))

    verdict, rows = interleaving_verdict(r.calls)
    assert "CANNOT SEPARATE" in verdict
    assert rows == [], "no day has two operators"
    assert "lead, not a verdict" in format_report(r) or "no day has more than one" in verdict


def test_a_concurrent_failure_and_success_does_separate_them(tmp_path: Path):
    """The positive case, so the verdict is not a constant. One operator failing
    while another succeeds in the same window points at the machine."""
    a = _run(tmp_path / "f1", "run-2026-08-20_00-00-00.json",
             ["Could not reach OpenRouter. (fetch failed)"])
    b = _run(tmp_path / "f2", "run-2026-08-20_11-00-00.json", ["ok"])
    r = scan([a, b], author_of=_authors({
        "run-2026-08-20_00-00-00.json": "alice",
        "run-2026-08-20_11-00-00.json": "bob",
    }))

    verdict, rows = interleaving_verdict(r.calls)
    assert "SEPARATES on 1 day(s)" in verdict
    assert any("2026-08-20" in r_ for r_ in rows)


def test_both_operators_failing_on_one_day_does_not_separate(tmp_path: Path):
    """The shape the real corpus actually has, on 2026-08-13: two operators, both
    failing. That is consistent with a bad service AND with two similar hosts, so
    it must not read as evidence for either."""
    a = _run(tmp_path / "f1", "run-2026-08-13_00-00-00.json",
             ["Could not reach OpenRouter. (fetch failed)"])
    b = _run(tmp_path / "f2", "run-2026-08-13_09-00-00.json",
             ["Could not reach OpenRouter. (fetch failed)"])
    r = scan([a, b], author_of=_authors({
        "run-2026-08-13_00-00-00.json": "alice",
        "run-2026-08-13_09-00-00.json": "bob",
    }))

    verdict, _ = interleaving_verdict(r.calls)
    assert "CANNOT SEPARATE" in verdict
    assert "lead, not a verdict" in verdict
