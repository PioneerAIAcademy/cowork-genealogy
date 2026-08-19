"""Unit tests for the wiki/pop-stats failure classifier (issue #1552).

The behaviour worth pinning is that classification is shape-agnostic. A
`response_summary` under ~4000 chars keeps the escaped MCP envelope
(`\\"error\\":\\"Place not found\\"`) while a larger one is unwrapped to real JSON
keys (`orchestrator.py::_summarize_tool_response`). The matchers are bare
substrings for exactly that reason, and the first cut of this file proved why:
matching quoted keys dropped 42 real `Place not found` failures into
`unclassified`. So every bucket is asserted in BOTH shapes, and the load-bearing
`unclassified` path is asserted directly — a classifier that folds the unknown
into `success` under-reports the failure rate, which is the whole bug.
"""

from __future__ import annotations

import json

import e2e.wiki_failure_report as wfr
from e2e.wiki_failure_report import (
    Call,
    classify,
    format_report,
    scan,
)


def _envelope(doc_json: str) -> str:
    """The escaped-MCP-envelope shape: the tool's document as an escaped string
    inside a text block, exactly as a sub-4000-char response is stored."""
    return json.dumps([{"type": "text", "text": doc_json}])


# One representative document per bucket. Each is classified in both the escaped
# envelope and the unwrapped form.
UNREACHABLE_WIKI = '{"error":"Could not reach wiki-query-api at https://x/wiki. Is the server running?"}'
UNREACHABLE_POP = '{"error":"Population data service is unavailable. Is the Pop Stats API running?"}'
UPSTREAM_WIKI = '{"error":"wiki-query-api error: 502"}'
UPSTREAM_POP = '{"error":"Population API error: 502 Bad Gateway"}'
NO_WIKI_PAGE = '{"error":"No wiki page found for \\"Bohemia\\"."}'
NO_POP_SERIES = '{"error":"Place not found","place_id":"1355104"}'
NO_POP_SERIES_2 = '{"place": {"place_id": "1926993", "name": "Isle of Man", "level": "country"}}'
UNRESOLVABLE = '{"error":"Could not resolve \\"County Waterford, Ireland\\" to a single FamilySearch place."}'
LEGACY_DIR = '{"error":"Wiki markdown directory is not configured. Add wikiMarkdownDir."}'
WIKI_SEARCH_OK = '{"query": "Bohemia genealogy", "total_chunks_searched": 1240565, "results": []}'
WIKI_PAGE_OK = '{"url": "https://www.familysearch.org/en/wiki/Norway_Genealogy", "content": "# Norway"}'
POP_OK = '{"place": {"place_id": "1929885", "name": "Cochabamba"}, "population": {"1900": 21000}}'


def test_each_service_failure_bucket_in_both_shapes():
    cases = [
        ("wiki_search", UNREACHABLE_WIKI, "unreachable"),
        ("place_population", UNREACHABLE_POP, "unreachable"),
        ("wiki_place_page", UPSTREAM_WIKI, "upstream_5xx"),
        ("place_population", UPSTREAM_POP, "upstream_5xx"),
        ("wiki_place_page", NO_WIKI_PAGE, "no_wiki_page"),
        ("place_population", NO_POP_SERIES, "no_population_series"),
        ("place_population", UNRESOLVABLE, "unresolvable_place"),
        ("wiki_place_page", LEGACY_DIR, "legacy_markdown_dir"),
    ]
    for tool, doc, expected in cases:
        assert classify(tool, doc) == expected, f"unwrapped {expected}"
        assert classify(tool, _envelope(doc)) == expected, f"escaped {expected}"


def test_upstream_5xx_is_a_5xx_not_any_upstream_status():
    """The bucket is named 5xx. Both tools format the failure as `... error:
    {status}`, so a 4xx must not land here — the needle pins the leading 5."""
    assert classify("place_population", '{"error":"Population API error: 500 Internal Server Error"}') == "upstream_5xx"
    assert classify("wiki_place_page", '{"error":"wiki-query-api error: 503"}') == "upstream_5xx"
    # A 4xx upstream status is NOT a 5xx and must not be bucketed as one.
    assert classify("place_population", '{"error":"Population API error: 404 Not Found"}') != "upstream_5xx"
    assert classify("wiki_place_page", '{"error":"wiki-query-api error: 429"}') != "upstream_5xx"


def test_place_not_found_survives_the_escaped_envelope():
    """The exact bug the first cut had: the wrapped shape escapes the quotes, so
    a quoted-key match misses it and it falls through to `unclassified`."""
    assert classify("place_population", _envelope(NO_POP_SERIES)) == "no_population_series"
    # ...but that arm alone does NOT pin the matcher: the `place_population`
    # fallback below the matcher table (`if "place" in rs`) returns the same
    # bucket, so it stays green even with the matcher reverted to a quoted key.
    # A wiki tool takes no such fallback, so this is the arm that actually fails
    # when the matcher stops being a bare substring.
    assert classify("wiki_place_page", _envelope(NO_POP_SERIES)) == "no_population_series"
    # And the second no-series shape — a resolved place with no population series
    # — is a data gap, not an unknown.
    assert classify("place_population", NO_POP_SERIES_2) == "no_population_series"
    assert classify("place_population", _envelope(NO_POP_SERIES_2)) == "no_population_series"


def test_success_buckets_in_both_shapes():
    for tool, doc in [
        ("wiki_search", WIKI_SEARCH_OK),
        ("wiki_place_page", WIKI_PAGE_OK),
        ("wiki_read", WIKI_PAGE_OK),
        ("place_population", POP_OK),
    ]:
        assert classify(tool, doc) == "success", f"unwrapped success {tool}"
        assert classify(tool, _envelope(doc)) == "success", f"escaped success {tool}"


def test_other_bucket_recognises_non_service_failures():
    for doc in [
        "<tool_use_error>Error: No such tool available: wiki_place_page</tool_use_error>",
        "<persisted-output> Output too large (73.2KB). Full output saved to: /home/x/.claude/p",
        "Error: result (104,565 characters across 1 line) exceeds maximum allowed tokens.",
        "wiki_search is disabled for this benchmark fixture: its ground truth derives from wiki",
    ]:
        assert classify("wiki_place_page", doc) == "other"


def test_unknown_shape_is_unclassified_never_success():
    """The safety net. A shape none of the matchers know must NOT be absorbed
    into success — that is the under-reporting bug the bucket exists to stop."""
    assert classify("wiki_search", '{"totally": "novel error shape"}') == "unclassified"
    # place_population with neither a population series nor a place object.
    assert classify("place_population", '{"unexpected": "body"}') == "unclassified"


def _call(bucket, *, author="A", day="2026-08-01", tool="wiki_search", sample=""):
    return Call("fx/run-x", tool, bucket, day, author, sample)


def test_report_always_shows_the_unclassified_count_even_at_zero():
    out = format_report([_call("success"), _call("unreachable")], n_runs=1)
    assert "unclassified" in out  # printed at 0 so the net is visibly empty
    assert "0    0%  unclassified" in out


def test_report_splits_by_cause_day_and_author():
    calls = [
        _call("unreachable", author="Chris", day="2026-07-30"),
        _call("unreachable", author="Chris", day="2026-07-30"),
        _call("success", author="Dallan", day="2026-07-30"),
        _call("no_wiki_page", author="Dallan", day="2026-07-31"),
    ]
    out = format_report(calls, n_runs=3)
    assert "By cause:" in out and "By day:" in out
    assert "By run-log author" in out
    # The per-operator reachability split: Chris 100% unreachable ranks above
    # Dallan at 0%.
    assert out.index("Chris") < out.index("Dallan")
    # A single day carrying both a success and a failure is the not-downtime
    # evidence, and must be visible.
    assert "2026-07-30" in out


def test_report_prints_examples_for_other_and_unclassified():
    calls = [
        _call("other", sample="<persisted-output> Output too large (73.2KB)"),
        _call("unclassified", sample='{"totally": "novel"}'),
    ]
    out = format_report(calls, n_runs=1)
    assert "Output too large" in out
    assert '{"totally": "novel"}' in out


def test_empty_is_a_real_result_and_flags_unreadable_runs():
    clean = format_report([], n_runs=5)
    assert "No classifiable wiki or pop-stats calls" in clean
    assert "real result" in clean
    # Unreadable run logs must not masquerade as a clean corpus.
    flagged = format_report([], n_runs=5, unreadable=3)
    assert "3 run log(s)" in flagged and "not proof of a clean corpus" in flagged


def test_stripped_calls_are_reported_not_silently_dropped_or_called_unknown():
    """A corpus that is entirely stripped must say so, not read as a clean run
    and not inflate `unclassified` — the strip removed the cause text on purpose."""
    out = format_report([], n_runs=6, stripped_calls=508, stripped_runs=103)
    assert "508 wiki/pop-stats call(s) in 103 run(s)" in out
    assert "stripped" in out
    assert "real result" not in out  # it is NOT a clean corpus
    # And the note also rides along on a non-empty report.
    mixed = format_report([_call("success")], n_runs=6, stripped_calls=10, stripped_runs=2)
    assert "10 wiki/pop-stats call(s) in 2 run(s)" in mixed
    assert "NOT counted as unclassified" in mixed


def _write_run(tmp_path, tool_calls, *, stem="run-2026-08-01_00-00-00"):
    slug = tmp_path / "some-fixture"
    slug.mkdir(parents=True, exist_ok=True)
    p = slug / f"{stem}.json"
    p.write_text(json.dumps({"tool_calls": tool_calls}), encoding="utf-8")
    return p


def test_scan_collects_only_the_four_tools_and_counts_unreadable(tmp_path):
    good = _write_run(
        tmp_path,
        [
            {"tool": "mcp__genealogy__wiki_search", "response_summary": WIKI_SEARCH_OK},
            {"tool": "mcp__genealogy__place_population", "response_summary": NO_POP_SERIES},
            {"tool": "mcp__genealogy__record_search", "response_summary": "irrelevant"},
        ],
    )
    corrupt = tmp_path / "some-fixture" / "run-2026-08-02_00-00-00.json"
    corrupt.write_text("{not json", encoding="utf-8")

    res = scan([good, corrupt], author_of=lambda p: "tester")
    assert res.unreadable == 1
    # record_search is excluded; the two wiki/pop calls are kept and classified.
    buckets = sorted(c.bucket for c in res.calls)
    assert buckets == ["no_population_series", "success"]
    assert all(c.author == "tester" and c.day == "2026-08-01" for c in res.calls)


def test_scan_counts_a_stripped_run_as_stripped_not_unclassified(tmp_path):
    """A stripped run's wiki calls carry no response_summary, so they must be
    tallied as stripped and kept out of the classifier — not run through it,
    where a missing summary would land in `unclassified`."""
    slug = tmp_path / "old-fixture"
    slug.mkdir(parents=True, exist_ok=True)
    p = slug / "run-2026-06-01_00-00-00.json"
    p.write_text(
        json.dumps(
            {
                "captures_stripped": True,
                "tool_calls": [
                    {"tool": "mcp__genealogy__wiki_place_page", "args": {"place": "X"}},
                    {"tool": "mcp__genealogy__place_population", "args": {"place": "Y"}},
                    {"tool": "mcp__genealogy__record_search", "args": {}},
                ],
            }
        ),
        encoding="utf-8",
    )
    res = scan([p], author_of=lambda p: "tester")
    assert res.calls == []  # nothing classified
    assert res.stripped_calls == 2  # both wiki/pop calls, not the record_search
    assert res.stripped_runs == 1


def test_resolve_authors_never_spawns_per_file_when_the_batch_resolved_all(monkeypatch):
    """The one-shot `git log` resolves every committed run in a single process; the
    per-file `commit_author` fallback must fire only for a path the batch missed.
    `setdefault(p, commit_author(p))` evaluated the default eagerly, spawning a git
    process per run log even for paths already resolved — 72s vs 0.19s over the
    corpus (florencemashipei's review). This pins that it does not."""
    rel = "eval/runlogs/e2e/fixture/run-2026-08-01_00-00-00.json"
    p = wfr.REPO_ROOT / rel

    class _FakeProc:
        # one commit (author "Ada Lovelace") that added `rel`
        stdout = f"\x01Ada Lovelace\n{rel}\n"

    monkeypatch.setattr(wfr.subprocess, "run", lambda *a, **k: _FakeProc())

    def _boom(path):
        raise AssertionError(f"commit_author spawned for {path}; the batch resolved it")

    monkeypatch.setattr(wfr, "commit_author", _boom)

    authors = wfr.resolve_authors([p])
    assert authors[p] == "Ada Lovelace"
