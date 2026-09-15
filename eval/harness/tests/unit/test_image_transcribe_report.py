"""Unit tests for e2e.image_transcribe_report — issue #1594's reachability half.

Everything here builds its own run logs in a tmpdir. Nothing asserts against the
committed corpus: its numbers move with every e2e run that lands, so a test
pinned to them fails for reasons that have nothing to do with this code.
"""

from __future__ import annotations

import json
from pathlib import Path

from e2e.image_transcribe_report import (
    Call,
    SUCCESS,
    TIMEOUT,
    TRUNCATED,
    UNCLASSIFIED,
    UNREACHABLE,
    UNRECOGNIZED_ARK,
    UPSTREAM_ERROR,
    classify,
    format_report,
    interleaving_verdict,
    scan,
)


def _run(
    dir_: Path,
    name: str,
    summaries: list[str],
    *,
    stripped: bool = False,
    git_sha: str | None = None,
) -> Path:
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
    if git_sha is not None:
        doc["git_sha"] = git_sha
    p = dir_ / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc), encoding="utf-8")
    return p


def _authors(mapping: dict[str, str]):
    return lambda p: mapping.get(p.name, "someone")


#: A hermetic marker-capability proxy: a run is capable iff its log carries a
#: git_sha at all. Keeps the truncation-denominator tests off git while still
#: honouring "no git_sha means incapable".
def _capable_if_sha(git_sha: str | None) -> bool:
    return bool(git_sha)


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
    are 3 in the committed corpus, 2 of them carrying `is_error`."""
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


def test_a_timeout_counts_as_a_reachability_failure(tmp_path: Path):
    """A 180s OCR timeout never got OpenRouter's answer, so it is reachability —
    6 of the corpus's 30. Its real text also carries `{"error":...}`, so dropping
    it from the bucket does NOT surface as `unclassified`: it silently becomes
    `upstream_error`, a bucket defined as not-reachability, and leaves the
    headline (17.1% -> 13.7%) with nothing going red."""
    timed_out = (
        '{"error":"Request to https://openrouter.ai/api/v1/chat/completions '
        'timed out after 180000ms while reading the response body."}'
    )
    assert classify(timed_out) == TIMEOUT

    p = _run(tmp_path / "fix", "run-2026-08-20_00-00-00.json", [timed_out, "ok"])
    r = scan([p], author_of=_authors({}))
    assert r.reachability_failures == 1
    assert "1 of 2 measurable" in format_report(r)


def test_an_error_is_caught_in_the_escaped_envelope_too():
    """`response_summary` has two shapes and 52 of 175 measurable calls use the
    escaped one, where the document's keys read `\\"error\\"` — containing
    neither `"error"` nor `error:`. A matcher that only sees the unwrapped form
    files an unknown failure as `success`, the defect this classifier exists to
    prevent, one level down."""
    unwrapped = '{"error":"OpenRouter OCR failed: 502 Bad Gateway"}'
    escaped = (
        '[{"type": "text", "text": '
        '"{\\"error\\":\\"OpenRouter OCR failed: 502 Bad Gateway\\"}"}]'
    )
    assert classify(unwrapped) == UPSTREAM_ERROR
    assert classify(escaped) == UPSTREAM_ERROR, "the escaped form must not read as success"


def test_a_null_response_summary_is_never_a_success():
    """The orchestrator creates every tool-call entry with
    `response_summary: None` and fills it when the result streams back, so a run
    cut off by its wall-clock or tool cap mid-call commits a null — likeliest on
    this tool, the slowest at 180s. `json.dumps(None)` is the string `"null"`,
    which is non-empty and sailed past the guard into `success`.

    Measured 0 such calls in the committed corpus today: this closes a hole in
    the guarantee, it does not correct a live number."""
    import json as _json

    assert classify(_json.dumps(None)) == UNCLASSIFIED
    assert classify("null") == UNCLASSIFIED


def test_a_run_log_that_is_not_a_json_object_does_not_take_the_report_down(tmp_path: Path):
    """Valid JSON that is not an object — a top-level [], a bare string, a number
    — reached `doc.get(...)` and raised AttributeError, which nothing caught. The
    previous robustness test fed only invalid UTF-8, so it passed while this
    crashed. A truthy non-dict `tool_calls` entry crashed the same way."""
    good = _run(tmp_path / "fix", "run-2026-08-20_00-00-00.json", ["ok"])
    listy = tmp_path / "fix" / "run-2026-08-21_00-00-00.json"
    listy.write_text("[]", encoding="utf-8")
    stringy = tmp_path / "fix" / "run-2026-08-22_00-00-00.json"
    stringy.write_text('"not an object"', encoding="utf-8")

    r = scan([good, listy, stringy], author_of=_authors({}))
    assert r.unreadable == 2
    assert r.measurable == 1, "the readable run was still inspected"

    import json as _json

    weird = tmp_path / "fix" / "run-2026-08-23_00-00-00.json"
    weird.write_text(
        _json.dumps({"tool_calls": ["a string, not a call", 42]}), encoding="utf-8"
    )
    r2 = scan([good, weird], author_of=_authors({}))
    assert r2.measurable == 1, "a non-dict tool_calls entry is skipped, not fatal"


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


def test_an_operator_who_never_reached_the_service_is_not_a_concurrent_success(tmp_path: Path):
    """`unrecognized_ark` is raised BEFORE the OpenRouter call, so an operator
    whose calls were all arks demonstrated nothing about reachability. Treating
    "no reachability failure" as "succeeded" made the verdict print
    "points at the machine" on exactly that evidence — a false positive in the
    one function whose job is to not over-claim."""
    a = _run(tmp_path / "f1", "run-2026-08-20_00-00-00.json",
             ["Could not reach OpenRouter. (fetch failed)"])
    b = _run(tmp_path / "f2", "run-2026-08-20_11-00-00.json",
             ['{"error":"Unrecognized ark. Expected..."}'])
    r = scan([a, b], author_of=_authors({
        "run-2026-08-20_00-00-00.json": "alice",
        "run-2026-08-20_11-00-00.json": "bob",
    }))

    verdict, _ = interleaving_verdict(r.calls)
    assert "CANNOT SEPARATE" in verdict, (
        "bob never reached OpenRouter, so his day is no evidence about alice's failure"
    )


def test_a_truncated_read_counts_as_having_reached_the_service():
    """A capped read got content back, so it proves the operator reached
    OpenRouter — the same reachability evidence a `success` is, and the opposite
    of `unrecognized_ark` (raised before the call goes out). Adding the
    `truncated` bucket must NOT withdraw that: a day where one operator's read was
    capped while another's was unreachable still SEPARATES machine from service.
    Before the fix (#2501 review) the truncated read fell outside `reached`, so
    the same data read CANNOT SEPARATE — the very headline this report exists to
    produce, silently withdrawn the first time a truncation lands."""
    separates = [
        Call("r1", TRUNCATED, "2026-08-20", "alice", "x"),
        Call("r2", UNREACHABLE, "2026-08-20", "bob", "x"),
    ]
    verdict, _ = interleaving_verdict(separates)
    assert "SEPARATES" in verdict, "a truncated read reached the service — it is a concurrent success"


def test_a_non_list_tool_calls_costs_only_its_own_run(tmp_path: Path):
    """The neighbouring shape of the previous review's finding. A truthy non-list
    `tool_calls` (42, True, 3.14) reached `for tc in ...` and threw TypeError
    outside the guard, taking the whole scan down.

    Two reviews each named one shape and each fix closed only that one, so the
    guard is now structural: the whole per-run body is inside the try, and the
    failure domain is the RUN rather than a list of shapes someone thought of.
    """
    good = _run(tmp_path / "fx", "run-2026-08-20_00-00-00.json", ["ok"])
    bads = []
    for i, value in enumerate((42, True, 3.14, {"not": "a list"})):
        b = tmp_path / "fx" / f"run-2026-08-2{i + 1}_00-00-00.json"
        b.write_text(json.dumps({"tool_calls": value}), encoding="utf-8")
        bads.append(b)

    r = scan([good, *bads], author_of=_authors({}))
    assert r.measurable == 1, "the readable run was still inspected"
    assert r.unreadable >= 3, "each malformed run is counted, not fatal"


def test_one_malformed_entry_costs_its_entry_not_its_whole_run(tmp_path: Path):
    """The per-entry guard is NOT redundant with the per-run one — it decides how
    much a malformed entry costs, and nothing recorded which behaviour was meant.

    Without it the entry raises, the run-level guard catches, and the run's other
    calls leave the tally: 2 measurable becomes 0 and a real reachability failure
    disappears from the headline. Both behaviours are defensible; this pins the
    one that is intended. It was the only mutation of eleven that did not fire.
    """
    p = tmp_path / "fx" / "run-2026-08-20_00-00-00.json"
    p.parent.mkdir(parents=True)
    p.write_text(
        json.dumps({"tool_calls": [
            {"tool": "mcp__genealogy__image_transcribe", "response_summary": "ok"},
            42,
            {"tool": "mcp__genealogy__image_transcribe",
             "response_summary": "Could not reach OpenRouter. (fetch failed)"},
        ]}),
        encoding="utf-8",
    )

    r = scan([p], author_of=_authors({}))
    assert r.measurable == 2, "the entry is skipped; its neighbours still count"
    assert r.unreadable == 0, "one bad entry does not condemn the run"
    assert r.reachability_failures == 1


def test_a_transcription_that_quotes_the_word_error_is_still_a_success():
    """The reverse of the escaped-envelope fix. Unescaping is what made a bare
    `"error"` substring dangerous: a genuine transcription quoting the word
    unescapes to contain it and was filed as `upstream_error`, quietly dropping a
    real success from the reached count the verdict depends on."""
    clerk = '[{"type":"text","text":"the clerk wrote \\"error\\" in the margin"}]'
    assert classify(clerk) == SUCCESS
    # The real envelope still matches, by key adjacency.
    assert classify('{"error":"OpenRouter OCR failed: 502"}') == UPSTREAM_ERROR


def test_a_capped_read_with_content_is_truncated_not_success():
    """#2457 item 3. `image_transcribe` returns the partial transcription verbatim
    beside `truncated: true` — non-empty and carrying no `"error":` key — so it
    read as an ordinary `success` and the truncation rate could not be measured.
    Both envelope shapes must land in `truncated`: the unwrapped document and the
    escaped one where the key reads `\\"truncated\\"`."""
    unwrapped = (
        '{"transcription":"birth register, first half of page","truncated":true,'
        '"truncationNotice":"This transcription is INCOMPLETE..."}'
    )
    escaped = (
        '[{"type": "text", "text": '
        '"{\\"transcription\\":\\"first half\\",\\"truncated\\":true}"}]'
    )
    assert classify(unwrapped) == TRUNCATED
    assert classify(escaped) == TRUNCATED, "the escaped form must not read as success"


def test_a_transcription_that_quotes_the_word_truncated_is_still_a_success():
    """The other direction, and the reason for key-adjacency. A genuine reading of
    a document that uses the word must not be filed as a partial read: only the
    colon-adjacent envelope key `"truncated":` is the signal, never the bare word."""
    clerk = '[{"type":"text","text":"the marriage entry was truncated at the fold"}]'
    assert classify(clerk) == SUCCESS
    # The real envelope still matches, by key adjacency.
    assert classify('{"transcription":"x","truncated":true}') == TRUNCATED


def test_a_truncated_read_is_reported_but_is_not_a_reachability_failure(tmp_path: Path):
    """It reached the service and returned content, so it is measurable and NOT
    lost to reachability — it gets its own rate line so the #2457 marker's real
    load-bearing frequency is visible rather than hidden inside `success`. The
    run is marker-capable (post-#2168), so the rate is taken over all four."""
    p = _run(tmp_path / "fix", "run-2026-08-20_00-00-00.json",
             ['{"transcription":"half a page","truncated":true}', "ok", "ok", "ok"],
             git_sha="a" * 40)
    r = scan([p], author_of=_authors({}), marker_capable_of=_capable_if_sha)

    assert r.truncated_reads == 1
    assert r.reachability_failures == 0
    assert r.measurable == 4
    assert r.truncation_measurable == 4
    out = format_report(r)
    assert "truncated (capped mid-read): 1 of 4 marker-capable (25.0%)" in out
    # And it appears as its own By-cause bucket (whitespace-tolerant on the column).
    assert any(
        line.strip().startswith("truncated") and line.strip().endswith("of 4")
        for line in out.splitlines()
    ), "the truncated bucket must show in the By-cause table"


# --- the truncation rate is taken only over marker-capable calls (#2501 review) ---


def test_pre_marker_calls_are_excluded_from_the_truncation_denominator(tmp_path: Path):
    """`image_transcribe` began emitting `truncated` in 733a2c7 (#2168). A capped
    read on an older engine files as `success`, so counting it in the denominator
    prints the rate over calls that could never have produced the numerator — the
    exact strip-denominator mistake this module's header rejects. Here one capable
    truncated read sits beside three blind (pre-marker) calls: the honest rate is
    1 of 1, not 1 of 4."""
    capable = _run(tmp_path / "new", "run-2026-09-10_00-00-00.json",
                   ['{"transcription":"half","truncated":true}'], git_sha="a" * 40)
    blind = _run(tmp_path / "old", "run-2026-08-01_00-00-00.json",
                 ["ok", "ok", "ok"])  # no git_sha -> incapable
    r = scan([capable, blind], author_of=_authors({}), marker_capable_of=_capable_if_sha)

    assert r.measurable == 4
    assert r.truncation_measurable == 1
    assert r.truncated_reads == 1
    out = format_report(r)
    assert "truncated (capped mid-read): 1 of 1 marker-capable (100.0%)" in out
    # The blind majority is disclosed, not silently dropped.
    assert "3 of 4 measurable calls predate 733a2c7" in out
    # And the rate line is NOT printed over the full measurable set — the pre-fix
    # bug. (Bare "1 of 4" legitimately appears in the By-cause count column, so
    # pin the rate-line wording specifically.)
    assert "truncated (capped mid-read): 1 of 4" not in out


def test_an_all_blind_corpus_reports_truncation_not_measurable(tmp_path: Path):
    """When every call predates the marker, a `0 of N` line would read as "no
    truncation happened" over calls that could not have reported it either way.
    The honest statement is that the rate cannot be measured at all."""
    blind = _run(tmp_path / "old", "run-2026-08-01_00-00-00.json", ["ok", "ok"])
    r = scan([blind], author_of=_authors({}), marker_capable_of=_capable_if_sha)

    assert r.measurable == 2
    assert r.truncation_measurable == 0
    out = format_report(r)
    assert "truncated (capped mid-read): NOT MEASURABLE" in out
    assert "predates 733a2c7" in out
    # The line must NOT assert every call predates the marker: `tm == 0` also
    # fires when a sha (or 733a2c7 itself, in a shallow clone) is unresolvable,
    # where that absolute claim is false (#2501 round-3 review). Pin the honest
    # phrasing so a regression to the absolute one is caught.
    assert "every call in range predates" not in out
    assert "cannot resolve" in out
    # No bare percentage over a denominator that cannot produce the numerator.
    assert "of 2 marker-capable" not in out


def test_a_run_log_with_no_git_sha_is_incapable(tmp_path: Path):
    """The default capability function must count a missing `git_sha` as incapable
    — provably safe because `git_sha` landed a month before the marker, so a log
    without it is always from the blind era. Short-circuits before any git call,
    so this stays hermetic even under the real default."""
    from e2e.image_transcribe_report import commit_emits_truncation_marker

    assert commit_emits_truncation_marker(None) is False
    assert commit_emits_truncation_marker("") is False
    # An unresolvable sha (git returncode 128) is incapable too — unverifiable is
    # treated as blind, never assumed capable.
    assert commit_emits_truncation_marker("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef") is False

    # And through scan() with the real default: no git_sha -> truncation blind.
    p = _run(tmp_path / "fix", "run-2026-09-10_00-00-00.json",
             ['{"transcription":"half","truncated":true}'])
    r = scan([p], author_of=_authors({}))
    assert r.truncation_measurable == 0, "no git_sha means the marker era is unknown -> incapable"


def test_the_word_none_is_not_treated_as_an_absent_summary():
    """`scan` never calls `str()`, so no infrastructure path produces the summary
    "none" — the only thing that arm could ever match is a genuine transcription
    of the word, filed as unclassified instead of success."""
    assert classify("None") == SUCCESS
    assert classify("null") == UNCLASSIFIED  # this one IS json.dumps(None)


def test_one_operator_who_both_failed_and_reached_does_not_separate():
    """The neighbouring shape again. "Did anyone fail" and "did anyone reach" as
    two independent questions are both satisfied by ONE operator who did both,
    so a day where alice failed once, alice succeeded once, and bob only threw
    `unrecognized_ark` printed "points at the machine" though no second operator
    ever reached OpenRouter."""
    calls = [
        Call("r1", UNREACHABLE, "2026-08-20", "alice", "x"),
        Call("r1", SUCCESS, "2026-08-20", "alice", "x"),
        Call("r2", UNRECOGNIZED_ARK, "2026-08-20", "bob", "x"),
    ]
    verdict, _ = interleaving_verdict(calls)
    assert "CANNOT SEPARATE" in verdict, "bob never reached, so alice's own success proves nothing"

    # And a genuinely distinct pair still separates, so the guard is not a constant.
    distinct = [
        Call("r1", UNREACHABLE, "2026-08-20", "alice", "x"),
        Call("r2", SUCCESS, "2026-08-20", "bob", "x"),
    ]
    assert "SEPARATES" in interleaving_verdict(distinct)[0]
