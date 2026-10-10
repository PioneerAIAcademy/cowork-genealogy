"""Unit tests for the advisory return-field detector (issue #3199).

The behaviour worth pinning is the five-state partition under the corpus's real
shapes: the two response envelopes, the prefixed tool names, the flat-and-`ops`
arg forms, and the fourth `not-observable` state that must never collapse into
`condition-never-held`. Each test builds a synthetic run on disk and reads it
back through `scan`, the same entry point the report uses.

At least one synthetic doc per detector carries the REAL `mcp__genealogy__…`
prefixed tool name, so the `bare_tool_name` normalisation is exercised — drop it
and these go red, which is the guard against a report that silently counts zero
over a corpus that only ever stores prefixed names.
"""

from __future__ import annotations

import json
from collections import Counter

import pytest

from e2e.advisory_report import (
    ACTED,
    IGNORED,
    LOG_NO_PERSIST_MARKER,
    NEVER_HELD,
    NOT_OBSERVABLE,
    SEARCH_SHIP_COMMIT,
    SRC_NO_ASSERT_MARKER,
    agent_label,
    classify_run,
    scan,
)
from e2e.runlog_selection import REPO_ROOT

# A date well after both ship dates, so the version gate passes on captured_at.
RECENT = "2026-09-20_10-00-00"
# A date before the search ship (2026-09-01) and the validation ship (2026-08-11).
OLD = "2026-07-01_10-00-00"


def _doc_envelope(doc: dict, *, as_text_block: bool) -> str:
    """A `response_summary` string in one of the two committed envelopes:
    the bare document list `[{...}]`, or the text-block list
    `[{"type": "text", "text": "{...}"}]` that `research_log_append` produces."""
    if as_text_block:
        return json.dumps([{"type": "text", "text": json.dumps(doc)}])
    return json.dumps([doc])


def _write_run(tmp_path, tool_calls, *, captured_at=RECENT, stem=None):
    """A committed run on disk: `<slug>/run-<ts>.json`, no `git_sha` so the
    version gate takes the captured_at path and never shells git."""
    stem = stem or f"run-{captured_at}"
    slug = tmp_path / "some-fixture"
    slug.mkdir(parents=True, exist_ok=True)
    p = slug / f"{stem}.json"
    p.write_text(json.dumps({"captured_at": captured_at, "tool_calls": tool_calls}),
                 encoding="utf-8")
    return p


def _states(rows, field):
    return Counter(r.state for r in rows if r.field == field)


def _search(doc, *, tool="mcp__genealogy__record_search", **extra):
    """A search-tool call carrying a decoded-response `doc`."""
    call = {"tool": tool, "response_summary": _doc_envelope(doc, as_text_block=False)}
    call.update(extra)
    return call


def _log_append(**args):
    return {"tool": "mcp__genealogy__research_log_append", "args": args}


# --- nilSearchNeedsLog: all four states, both envelopes ----------------------


@pytest.mark.parametrize("as_text_block", [False, True])
def test_nil_fired_and_acted(tmp_path, as_text_block):
    nil_doc = {"results": [], "totalMatches": 0, "nilSearchNeedsLog": "A nil search is a finding…"}
    calls = [
        {"tool": "mcp__genealogy__record_search",
         "response_summary": _doc_envelope(nil_doc, as_text_block=as_text_block)},
        _log_append(outcome="negative"),  # negative, no stagedResultsRef, before next search
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert _states(rows, "nilSearchNeedsLog") == Counter({ACTED: 1})


@pytest.mark.parametrize("as_text_block", [False, True])
def test_nil_fired_and_ignored(tmp_path, as_text_block):
    nil_doc = {"results": [], "totalMatches": 0, "nilSearchNeedsLog": "A nil search is a finding…"}
    calls = [
        {"tool": "mcp__genealogy__record_search",
         "response_summary": _doc_envelope(nil_doc, as_text_block=as_text_block)},
        # another search before any qualifying log append (itself an emitter,
        # so it classifies too — here never-held, since its response has no note)
        {"tool": "mcp__genealogy__fulltext_search", "response_summary": _doc_envelope({}, as_text_block=False)},
        _log_append(outcome="negative"),
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    s = _states(rows, "nilSearchNeedsLog")
    assert s[IGNORED] == 1 and s[ACTED] == 0


@pytest.mark.parametrize("as_text_block", [False, True])
def test_nil_condition_never_held(tmp_path, as_text_block):
    # observable search response with no nil note
    doc = {"results": [{"id": "x"}], "totalMatches": 5}
    calls = [{"tool": "mcp__genealogy__record_search",
              "response_summary": _doc_envelope(doc, as_text_block=as_text_block)}]
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert _states(rows, "nilSearchNeedsLog") == Counter({NEVER_HELD: 1})


def test_nil_not_observable_predates_ship(tmp_path):
    nil_doc = {"results": [], "totalMatches": 0, "nilSearchNeedsLog": "…"}
    calls = [{"tool": "mcp__genealogy__record_search",
              "response_summary": _doc_envelope(nil_doc, as_text_block=False)}]
    # captured before the search ship date -> engine could not have emitted it
    rows = scan([_write_run(tmp_path, calls, captured_at=OLD)]).rows
    assert _states(rows, "nilSearchNeedsLog") == Counter({NOT_OBSERVABLE: 1})


def test_nil_not_observable_no_summary(tmp_path):
    calls = [{"tool": "mcp__genealogy__record_search"}]  # no response_summary
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert _states(rows, "nilSearchNeedsLog") == Counter({NOT_OBSERVABLE: 1})


def test_nil_acted_via_ops_shape_log_append(tmp_path):
    nil_doc = {"results": [], "totalMatches": 0, "nilSearchNeedsLog": "…"}
    calls = [
        _search(nil_doc),
        _log_append(ops=[{"outcome": "positive", "stagedResultsRef": "results/log_1.json"},
                         {"outcome": "negative"}]),  # a negative, no-ref op qualifies
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert _states(rows, "nilSearchNeedsLog") == Counter({ACTED: 1})


# --- log-without-persistence (validation.warnings): all four states ----------

_LOG_WARN = "6 search(es) logged with a positive outcome but no sources or assertions recorded yet."


def _log_resp(doc, *, as_text_block):
    return {"tool": "mcp__genealogy__research_log_append",
            "response_summary": _doc_envelope(doc, as_text_block=as_text_block),
            "args": {"outcome": "positive"}}


@pytest.mark.parametrize("as_text_block", [False, True])
def test_logpersist_fired_and_acted(tmp_path, as_text_block):
    fired = {"ok": True, "validation": {"valid": False, "warnings": [_LOG_WARN]}}
    calls = [
        _log_resp(fired, as_text_block=as_text_block),
        {"tool": "mcp__genealogy__research_append",
         "args": {"ops": [{"section": "assertions"}]}},  # a section write before next log append
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert _states(rows, "log-without-persistence") == Counter({ACTED: 1})


@pytest.mark.parametrize("as_text_block", [False, True])
def test_logpersist_fired_and_ignored(tmp_path, as_text_block):
    fired = {"ok": True, "validation": {"valid": False, "warnings": [_LOG_WARN]}}
    calls = [
        _log_resp(fired, as_text_block=as_text_block),
        # next thing is another log append (itself an emitter -> not-observable,
        # no response_summary), nothing persisted in between
        {"tool": "mcp__genealogy__research_log_append", "args": {"outcome": "positive"}},
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    s = _states(rows, "log-without-persistence")
    assert s[IGNORED] == 1 and s[ACTED] == 0


@pytest.mark.parametrize("as_text_block", [False, True])
def test_logpersist_condition_never_held(tmp_path, as_text_block):
    clean = {"ok": True, "validation": {"valid": True, "warnings": []}}
    calls = [_log_resp(clean, as_text_block=as_text_block)]
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert _states(rows, "log-without-persistence") == Counter({NEVER_HELD: 1})


@pytest.mark.parametrize("as_text_block", [False, True])
def test_logpersist_not_observable_when_validation_truncated_away(tmp_path, as_text_block):
    # A response whose `validation` block was cut by truncation: the key is
    # absent, so the note cannot be seen -> not-observable, NOT never-held.
    truncated = {"ok": True, "results": {"_summary_truncated": True}}
    calls = [_log_resp(truncated, as_text_block=as_text_block)]
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert _states(rows, "log-without-persistence") == Counter({NOT_OBSERVABLE: 1})


def test_logpersist_acted_via_extraction_append_ops(tmp_path):
    fired = {"ok": True, "validation": {"valid": False, "warnings": [_LOG_WARN]}}
    calls = [
        _log_resp(fired, as_text_block=False),
        {"tool": "mcp__genealogy__extraction_append",
         "args": {"ops": [{"section": "sources"}, {"section": "assertions"}]}},
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert _states(rows, "log-without-persistence") == Counter({ACTED: 1})


# --- sources-without-assertions: the producer-verified marker, 0 in corpus ---


def test_src_without_assertions_fires_on_the_verified_marker(tmp_path):
    # This field never appears in the corpus, so the only proof the matcher works
    # is a synthetic response carrying the exact producer string.
    warn = "3 source(s) recorded but zero assertions drawn from them. Persist…"
    fired = {"ok": True, "validation": {"valid": True, "warnings": [warn]}}
    calls = [
        {"tool": "mcp__genealogy__research_append",
         "response_summary": _doc_envelope(fired, as_text_block=False),
         "args": {"ops": [{"section": "sources"}]}},
        {"tool": "mcp__genealogy__research_append",
         "args": {"ops": [{"section": "assertions"}]}},  # acted
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    s = _states(rows, "sources-without-assertions")
    assert s[ACTED] == 1 and s[IGNORED] == 0  # the 2nd append is also an emitter -> not-observable


def test_src_without_assertions_ignored_when_next_write_is_sources(tmp_path):
    warn = "3 source(s) recorded but zero assertions drawn from them."
    fired = {"ok": True, "validation": {"valid": True, "warnings": [warn]}}
    calls = [
        {"tool": "mcp__genealogy__research_append",
         "response_summary": _doc_envelope(fired, as_text_block=False),
         "args": {"ops": [{"section": "sources"}]}},
        {"tool": "mcp__genealogy__research_append",
         "args": {"ops": [{"section": "sources"}]}},  # another sources append, no assertions
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    s = _states(rows, "sources-without-assertions")
    assert s[IGNORED] == 1 and s[ACTED] == 0  # the 2nd sources append is also an emitter -> not-observable


# --- unloggedSearches: acted on the listed ref, summarised tail counted apart --


def test_unlogged_acted_when_a_listed_ref_is_logged(tmp_path):
    ref = "results/.staging/8ea87945-5d95-460d-bddc-33bac80c9f73.json"
    note = f"1 earlier staged search response(s) in this project have no research.json log entry: {ref}. Call…"
    fired = {"totalMatches": 2, "unloggedSearches": note}
    calls = [
        _search(fired),
        _log_append(stagedResultsRef=ref),
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert _states(rows, "unloggedSearches") == Counter({ACTED: 1})


def test_unlogged_summarised_tail_is_counted_separately_not_as_a_state(tmp_path):
    # The producer lists the first refs then ", and N more". The call is still
    # classified on the LISTED ref; the "N more" is recorded apart on the row.
    ref = "results/.staging/8ea87945-5d95-460d-bddc-33bac80c9f73.json"
    note = (f"6 earlier staged search response(s) in this project have no research.json "
            f"log entry: {ref}, and 5 more. Call…")
    fired = {"totalMatches": 2, "unloggedSearches": note}
    calls = [_search(fired), _log_append(stagedResultsRef=ref)]
    rows = [r for r in scan([_write_run(tmp_path, calls)]).rows if r.field == "unloggedSearches"]
    assert len(rows) == 1
    assert rows[0].state == ACTED          # decided on the listed ref, never "unlistable"
    assert rows[0].summarised_more == 5    # the tail, counted apart


# --- cross-cutting: agent_type, error-skip, partition identity ---------------


def test_agent_label_distinguishes_present_none_from_absent():
    assert agent_label({"agent_type": None}) == "<main>"
    assert agent_label({}) == "unknown"
    assert agent_label({"agent_type": "record-extractor"}) == "record-extractor"


def test_firing_call_carries_its_agent_label(tmp_path):
    nil_doc = {"results": [], "totalMatches": 0, "nilSearchNeedsLog": "…"}
    calls = [
        _search(nil_doc, agent_type=None),                 # <main>
        _log_append(outcome="negative"),
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    nil = [r for r in rows if r.field == "nilSearchNeedsLog"]
    assert len(nil) == 1 and nil[0].agent == "<main>"


def test_error_firing_call_is_skipped_entirely(tmp_path):
    nil_doc = {"results": [], "totalMatches": 0, "nilSearchNeedsLog": "…"}
    calls = [{"tool": "mcp__genealogy__record_search", "is_error": True,
              "response_summary": _doc_envelope(nil_doc, as_text_block=False)}]
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert [r for r in rows if r.field == "nilSearchNeedsLog"] == []


def test_partition_identity_holds(tmp_path):
    # not-observable + never-held + fired(acted+ignored) == emitter calls.
    nil_fire = {"results": [], "totalMatches": 0, "nilSearchNeedsLog": "…"}
    nil_clean = {"results": [{"id": 1}], "totalMatches": 1}
    calls = [
        _search(nil_fire), _log_append(outcome="negative"),   # acted (log before next search)
        _search(nil_fire),                                     # ignored (next emitter is a search)
        _search(nil_clean),                                   # never-held
        {"tool": "mcp__genealogy__record_search"},            # not-observable (no summary)
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    nil = _states(rows, "nilSearchNeedsLog")
    emitter_calls = 4  # four record_search calls; the log_append is not an emitter
    assert sum(nil.values()) == emitter_calls
    assert nil[ACTED] + nil[IGNORED] + nil[NEVER_HELD] + nil[NOT_OBSERVABLE] == emitter_calls


@pytest.mark.parametrize("entries, flagged", [(2, True), (1, False)])
def test_nil_logged_later_credits_one_log_entry_per_nil(tmp_path, entries, flagged):
    # Two nils, then ONE batched append. The 2nd nil is acted (no search between it
    # and the append) and keeps one entry; the 1st is ignored by the cutoff and is
    # "logged later" only if a SECOND entry is there for it.
    nil_doc = {"results": [], "totalMatches": 0, "nilSearchNeedsLog": "…"}
    ops = [{"outcome": "negative"}] * entries
    calls = [_search(nil_doc), _search(nil_doc), _log_append(ops=ops)]
    rows = [r for r in scan([_write_run(tmp_path, calls)]).rows
            if r.field == "nilSearchNeedsLog" and r.state == IGNORED]
    assert len(rows) == 1 and rows[0].logged_later is flagged


def test_non_dict_ops_entry_does_not_crash(tmp_path):
    # A malformed ops entry (a string, not an object) must be skipped, not crash.
    fired = {"ok": True, "validation": {"valid": False, "warnings": [_LOG_WARN]}}
    calls = [
        _log_resp(fired, as_text_block=False),
        {"tool": "mcp__genealogy__research_append", "args": {"ops": ["oops", {"section": "assertions"}]}},
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert _states(rows, "log-without-persistence")[ACTED] == 1


@pytest.mark.parametrize("as_text_block", [False, True])
def test_logpersist_fired_when_the_capture_is_cut_after_the_note(tmp_path, as_text_block):
    fired = {"ok": True, "validation": {"valid": True, "warnings": [_LOG_WARN + " When a search"]}}
    raw = _doc_envelope(fired, as_text_block=as_text_block)
    calls = [
        {"tool": "mcp__genealogy__research_log_append", "args": {"outcome": "positive"},
         "response_summary": raw[: raw.index("When a search")] + "..."},
        {"tool": "mcp__genealogy__research_append", "args": {"ops": [{"section": "sources"}]}},
    ]
    rows = scan([_write_run(tmp_path, calls)]).rows
    assert _states(rows, "log-without-persistence") == Counter({ACTED: 1})


@pytest.mark.parametrize("rel, marker", [
    ("packages/engine/mcp-server/src/tools/research-append.ts", SRC_NO_ASSERT_MARKER),
    ("packages/engine/mcp-server/src/tools/research-log-append.ts", LOG_NO_PERSIST_MARKER),
])
def test_validation_marker_is_what_the_producer_writes(rel, marker):
    assert marker in (REPO_ROOT / rel).read_text(encoding="utf-8"), rel


class _StubProbe:
    def __init__(self, contains):
        self._contains = contains

    def resolvable(self, sha):
        return True

    def contains(self, ship, sha):
        return (ship, sha) in self._contains


def test_resolvable_sha_decides_observability_over_captured_at(tmp_path):
    nil_doc = {"results": [], "totalMatches": 0, "nilSearchNeedsLog": "…"}
    p = _write_run(tmp_path, [_search(nil_doc)])
    doc = json.loads(p.read_text(encoding="utf-8"))
    doc["git_sha"] = "pre-ship"
    assert _states(classify_run(doc, p, _StubProbe(set())), "nilSearchNeedsLog") == Counter({NOT_OBSERVABLE: 1})
    doc["git_sha"] = "post-ship"
    rows = classify_run(doc, p, _StubProbe({(SEARCH_SHIP_COMMIT, "post-ship")}))
    assert _states(rows, "nilSearchNeedsLog") == Counter({IGNORED: 1})


def test_nil_fires_on_a_search_capture_cut_mid_document(tmp_path):
    raw = _doc_envelope({"nilSearchNeedsLog": "Nothing returned", "results": []}, as_text_block=False)
    calls = [{"tool": "mcp__genealogy__record_search", "response_summary": raw[:40] + "..."},
             _log_append(outcome="negative")]
    assert _states(scan([_write_run(tmp_path, calls)]).rows, "nilSearchNeedsLog") == Counter({ACTED: 1})
