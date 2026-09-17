"""Unit tests for e2e.ranked_read_report — whether the main thread's record
reads were inside the ranker's visible top 3 (issue #1156)."""

from __future__ import annotations

import json

import pytest

from e2e.ranked_read_report import (
    CAVEAT,
    LATE_RATE_FLOOR,
    TOP_N,
    ReadRow,
    format_preamble,
    format_report,
    id_key,
    main,
    preamble,
    ranked_matches,
    scan,
    scan_run,
)
from e2e.runlog_selection import all_result_jsons, filter_since
from harness.since_window import parse_since

# --- fixture builders -------------------------------------------------------
# Captures are built as a one-element LIST, which is what the committed corpus
# actually holds: `_summarize_tool_response` leaves the MCP content-block list
# in place, so `response_summary` never deserializes to the document itself.


def _assistant(names):
    return [0.0, "assistant", names]


def _boundary():
    return [0.0, "system:compact_boundary"]


def _capture(payload) -> str:
    return json.dumps([payload])


def _match(rank, record_id, record_ark=None):
    return {
        "matchRank": rank,
        "searchRank": rank,
        "recordId": record_id,
        "recordArk": record_ark or f"ark:/61903/1:2:ARK{rank}",
    }


def _search(
    matches=None,
    ranking_skipped=False,
    staging_ref=None,
    include_results=True,
    agent_type=None,
):
    payload = {"query": {}, "returned": 0}
    if include_results:
        payload["results"] = []
    if staging_ref:
        payload["staged"] = {"resultsRef": staging_ref, "returnedCount": 1}
    if ranking_skipped:
        payload["rankingSkipped"] = "No subjectId supplied; ranking did not run."
    if matches is not None:
        payload["ranked"] = {
            "subjectId": "G8Q5-BJ1",
            "scoredCount": len(matches),
            "matches": {
                "_summary_truncated": True,
                "_full_length": 10,
                "_first_n": list(matches),
            },
        }
    call = {
        "tool": "mcp__genealogy__record_search",
        "args": {"projectPath": "/p"},
        "response_summary": _capture(payload),
        "agent_type": agent_type,
    }
    return call


def _read(record_id, agent_type=None, is_error=False, results_ref=None):
    args = {"recordId": record_id}
    if results_ref:
        args["resultsRef"] = results_ref
    return {
        "tool": "mcp__genealogy__record_read",
        "args": args,
        "response_summary": _capture({"ok": True}),
        "agent_type": agent_type,
        "is_error": is_error,
    }


def _log_append(staged_ref, log_ref):
    """`research_log_append` returns the DOUBLE-encoded envelope — a text block
    whose `text` is itself JSON. Both shapes are live in the corpus."""
    inner = json.dumps({"ok": True, "logId": "log_010", "resultsRef": log_ref})
    return {
        "tool": "mcp__genealogy__research_log_append",
        "args": {"stagedResultsRef": staged_ref, "projectPath": "/p"},
        "response_summary": json.dumps([{"type": "text", "text": inner}]),
        "agent_type": None,
    }


def _doc(calls, boundaries_after=()):
    """One run whose timeline places `calls` in order, inserting a compact
    boundary after each index in `boundaries_after`."""
    timeline = []
    for i, call in enumerate(calls):
        timeline.append(_assistant([call["tool"]]))
        if i in boundaries_after:
            timeline.append(_boundary())
    return {"usage": {"timeline": timeline}, "tool_calls": list(calls)}


def _write_run(tmp_path, doc, stem="run-2026-08-10_00-00-00"):
    d = tmp_path / "a-fixture"
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{stem}.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    return p


def _outcomes(doc):
    rows, delegated, reason = scan_run(doc, "a-fixture/run")
    assert reason is None
    return [r.outcome for r in rows], delegated


# --- the acceptance check ---------------------------------------------------


def test_subagent_reads_are_excluded_from_the_denominator():
    """THE acceptance check. A subagent runs in fresh context and never saw
    the ranked block — counting its reads against 'the agent ignored the
    ranker' mis-attributes a third of the denominator (issue #1156)."""
    top = _match(1, "ark:/61903/1:1:AAAA-111")
    doc = _doc(
        [
            _search(matches=[top]),
            _read("ark:/61903/1:1:AAAA-111"),
            _read("ark:/61903/1:1:ZZZZ-999", agent_type="record-extractor"),
            _read("ark:/61903/1:1:YYYY-888", agent_type="person-evidence"),
        ]
    )
    outcomes, delegated = _outcomes(doc)
    assert outcomes == ["in_top3"]
    assert delegated == {"record-extractor": 1, "person-evidence": 1}


def test_preamble_matches_the_recorded_corpus_figures():
    """The second acceptance check, against the REAL corpus.

    A fixture-only suite passes even if the module joins nothing over the
    committed captures — which is exactly what an implementation reading
    `doc["ranked"]` would do, since no capture parses to a dict. This asserts
    the envelope descent, the regex fallback and the join all reach real data.

    Deliberately floors rather than equalities: the corpus grows (it gained a
    run between 2026-09-15 and 2026-09-16 while this was being written), so
    pinned counts would fail on the next committed run. Recorded values on
    2026-09-16 at --since 2026-08-04: searches 493, ranked 168, cut 58,
    main reads 198, scorable 65.
    """
    paths = filter_since(all_result_jsons(), parse_since("2026-08-04"))
    if not paths:
        pytest.skip("no committed e2e runs in the window in this checkout")
    pre = preamble(paths, cap=4000)
    if not pre.ranked:
        pytest.skip("no unstripped ranked captures (prune-runlogs STRIP=1?)")

    # The envelope descent works: most captures are reached WITHOUT the regex.
    assert pre.unparseable < pre.ranked
    # The regex fallback is exercised by real truncated captures.
    assert pre.unparseable > 0
    assert pre.reads["main"] > 0

    rows, delegated, excluded, _unreadable = scan(paths)
    scorable = [r for r in rows if r.outcome in ("in_top3", "not_in_top3")]
    assert scorable, "the join reached zero real reads — it is not joining"
    assert any(r.outcome == "in_top3" for r in scorable)
    assert any(r.arm in ("staging", "log") for r in scorable)
    assert sum(delegated.values()) > 0


# --- the boundaries a one-character mutation would flip ---------------------


def test_top_n_boundary_is_exactly_at_rank_three():
    """rank 3 is inside, rank 4 is not. `compaction_report` records a `<=`/`<`
    mutation that reversed a published finding with every test still green."""
    doc = _doc(
        [
            _search(matches=[_match(3, "ark:/61903/1:1:AAAA-111")]),
            _read("ark:/61903/1:1:AAAA-111"),
        ]
    )
    assert _outcomes(doc)[0] == ["in_top3"]


def test_rank_four_is_outside_the_visible_top_three():
    doc = _doc(
        [
            _search(matches=[_match(4, "ark:/61903/1:1:AAAA-111")]),
            _read("ark:/61903/1:1:AAAA-111"),
        ]
    )
    assert _outcomes(doc)[0] == ["not_in_top3"]
    assert TOP_N == 3


def test_segment_two_reads_land_in_early_not_late():
    """The segment the `<=`/`<` mutation flips. Two boundaries put the read in
    segment 2, which is early."""
    top = _match(1, "ark:/61903/1:1:AAAA-111")
    doc = _doc(
        [
            _search(matches=[top]),
            _search(matches=[top]),
            _search(matches=[top]),
            _read("ark:/61903/1:1:AAAA-111"),
        ],
        boundaries_after=(0, 1),
    )
    rows, _delegated, reason = scan_run(doc, "a-fixture/run")
    assert reason is None
    assert [r.segment for r in rows] == [2]
    out = format_report(rows, {}, n_runs=1, excluded={})
    assert "segments 0-2 (early): 1/1" in out


# --- exclusions, each on its own line ---------------------------------------


def test_read_after_a_ranking_skipped_search_is_excluded_not_a_miss():
    """The control the issue was filed for: a subject-less broad sweep cannot
    rank, so a read after one had no ranking to ignore."""
    doc = _doc([_search(ranking_skipped=True), _read("ark:/61903/1:1:AAAA-111")])
    assert _outcomes(doc)[0] == ["ranking-skipped"]


def test_read_after_a_search_with_neither_marker_is_its_own_bucket():
    """A nil or errored search carries neither `ranked` nor `rankingSkipped`.
    Counting these as misses moved the headline by 13 reads in the corpus."""
    doc = _doc([_search(), _read("ark:/61903/1:1:AAAA-111")])
    assert _outcomes(doc)[0] == ["no-ranking-signal"]


def test_read_after_a_ranked_search_that_surfaced_nothing_is_excluded():
    """A `ranked` block with no matches — the subject would not resolve, or the
    cap cut the capture before any match — is the same "no ranking to ignore"
    case as `rankingSkipped`. Scoring these as misses inflated the headline by
    3 reads in the 2026-08-04 window."""
    doc = _doc([_search(matches=[]), _read("ark:/61903/1:1:AAAA-111")])
    assert _outcomes(doc)[0] == ["ranked-no-matches"]


def test_a_ranked_search_with_matches_is_still_scored():
    """The other direction — the exclusion above must not swallow a real hit."""
    doc = _doc(
        [
            _search(matches=[_match(1, "ark:/61903/1:1:AAAA-111")]),
            _read("ark:/61903/1:1:AAAA-111"),
        ]
    )
    assert _outcomes(doc)[0] == ["in_top3"]


def test_an_escaped_ranked_key_is_detected_not_read_as_no_signal():
    """A capture can arrive with its JSON escaped inside a text block, where
    the plain `"ranked"` form is absent. `orchestrator._summarize_tool_response`
    documents this trap and says to match the bare name. Matching the quoted
    form only fails silently into `no-ranking-signal`."""
    inner = json.dumps(
        {"ranked": {"matches": {"_first_n": [_match(1, "ark:/61903/1:1:AAAA-111")]}}}
    )
    escaped = json.dumps([{"type": "text", "text": inner}])
    assert '"ranked"' not in escaped, "fixture must not contain the plain form"
    search = {
        "tool": "mcp__genealogy__record_search",
        "args": {"projectPath": "/p"},
        "response_summary": escaped,
        "agent_type": None,
    }
    doc = _doc([search, _read("ark:/61903/1:1:AAAA-111")])
    assert _outcomes(doc)[0] == ["in_top3"]


def test_errored_read_is_excluded_not_counted_as_a_miss():
    doc = _doc(
        [
            _search(matches=[_match(1, "ark:/61903/1:1:AAAA-111")]),
            _read("ark:/61903/1:1:AAAA-111", is_error=True),
        ]
    )
    assert _outcomes(doc)[0] == ["read-errored"]


def test_read_with_no_preceding_search_is_excluded():
    doc = _doc([_read("ark:/61903/1:1:AAAA-111")])
    assert _outcomes(doc)[0] == ["no-preceding-search"]


def test_image_ark_read_is_excluded_as_a_different_id_space():
    """A `3:1:` document-image ark can never match `ranked[].recordId`. The
    only live instance in the corpus also errored, so this bucket has no real
    sample and would rot unmeasured without a synthetic case."""
    doc = _doc(
        [
            _search(matches=[_match(1, "ark:/61903/1:1:AAAA-111")]),
            _read("ark:/61903/3:1:3QS7-L9QX-2H77"),
        ]
    )
    assert _outcomes(doc)[0] == ["image-ark"]


def test_a_read_matching_two_exclusions_is_counted_once_in_the_first():
    """The bucket order is load bearing, not presentational. The only live
    main-thread `3:1:` read in the corpus is ALSO `is_error: true`, so this
    pins which bucket wins — otherwise a reordering would silently move a
    read between two lines of the report with every other test green."""
    doc = _doc(
        [
            _search(matches=[_match(1, "ark:/61903/1:1:AAAA-111")]),
            _read("ark:/61903/3:1:3QS7-L9QX-2H77", is_error=True),
        ]
    )
    outcomes, _delegated = _outcomes(doc)
    assert outcomes == ["read-errored"]
    assert len(outcomes) == 1


def test_a_read_with_no_record_id_is_excluded_not_a_crash():
    """`id_key` returns None for a missing or non-string recordId; without its
    own bucket that read reaches `_read_outcome` and raises."""
    doc = _doc([_search(matches=[_match(1, "ark:/61903/1:1:A-1")]), _read(None)])
    assert _outcomes(doc)[0] == ["unusable-record-id"]


# --- the id spaces ----------------------------------------------------------


def test_record_source_ark_joins_via_record_ark_not_record_id():
    """A `1:2:` id is the `recordArk` counterpart of `recordId`. Normalizing
    both sides with arkToBareId alone (as the issue proposed) scores these as
    misses; both live instances in the corpus are real hits."""
    match = _match(1, "ark:/61903/1:1:AAAA-111", record_ark="ark:/61903/1:2:MBTR-TRQ")
    doc = _doc([_search(matches=[match]), _read("ark:/61903/1:2:MBTR-TRQ")])
    assert _outcomes(doc)[0] == ["in_top3"]


def test_bare_id_joins_against_record_id():
    """7 reads in the corpus pass a bare `XXXX-XXX`; a literal string compare
    drops them."""
    doc = _doc(
        [
            _search(matches=[_match(1, "ark:/61903/1:1:6B2L-FKDG")]),
            _read("6B2L-FKDG"),
        ]
    )
    assert _outcomes(doc)[0] == ["in_top3"]


def test_id_key_keeps_the_type_prefix():
    assert id_key("ark:/61903/1:1:AAAA-111") == ("1:1", "AAAA-111")
    assert id_key("ark:/61903/1:2:MBTR-TRQ") == ("1:2", "MBTR-TRQ")
    assert id_key("1:1:AAAA-111") == ("1:1", "AAAA-111")
    assert id_key("6B2L-FKDG") == (None, "6B2L-FKDG")
    assert id_key("") is None
    assert id_key(None) is None


# --- the capture envelope ---------------------------------------------------


def test_list_envelope_is_reached_without_the_regex_fallback():
    """110 of the corpus's 168 ranked captures parse cleanly to a LIST. An
    implementation reading `doc["ranked"]` finds nothing on every one."""
    summary = _capture({"ranked": {"matches": {"_first_n": [_match(1, "ark:/61903/1:1:A-1")]}}})
    matches, by_regex = ranked_matches(summary)
    assert by_regex is False
    assert [m.rank for m in matches] == [1]


def test_double_encoded_text_block_envelope_is_unwrapped():
    """The other live shape — what `research_log_append` returns."""
    inner = json.dumps({"ranked": {"matches": {"_first_n": [_match(2, "ark:/61903/1:1:A-1")]}}})
    summary = json.dumps([{"type": "text", "text": inner}])
    matches, by_regex = ranked_matches(summary)
    assert by_regex is False
    assert [m.rank for m in matches] == [2]


def test_capture_cut_mid_json_is_recovered_by_regex():
    """58 of 168 ranked captures are cut at the run-log cap; `json.loads`
    raises on every one, so the bounded regex is the only way in."""
    full = _capture(
        {
            "ranked": {
                "matches": {
                    "_first_n": [
                        _match(1, "ark:/61903/1:1:AAAA-111"),
                        _match(2, "ark:/61903/1:1:BBBB-222"),
                    ]
                }
            }
        }
    )
    truncated = full[: full.index("BBBB-222") + len("BBBB-222") + 1]
    with pytest.raises(ValueError):
        json.loads(truncated)
    matches, by_regex = ranked_matches(truncated)
    assert by_regex is True
    assert [m.rank for m in matches] == [1, 2]
    assert matches[0].record_id == ("1:1", "AAAA-111")


def test_capture_cut_at_exactly_the_run_log_cap_recovers_the_visible_matches():
    """58 of the corpus's 168 ranked captures are cut at exactly 4000 chars.
    The cut must land INSIDE the match list for this to prove anything — a cut
    that lands before the ranked block recovers nothing whatever the gate
    does, which is the neighbouring case below."""
    many = [_match(i, f"ark:/61903/1:1:AAAA-{i:03d}") for i in range(1, 41)]
    full = _capture({"ranked": {"matches": {"_first_n": many}}})
    assert len(full) > 4000, "fixture must exceed the cap to be cut by it"
    truncated = full[:4000]
    with pytest.raises(ValueError):
        json.loads(truncated)
    matches, by_regex = ranked_matches(truncated)
    assert by_regex is True
    # Real recovery: the early matches survive the cut and are readable.
    assert matches, "the cap cut off every match — the fixture, not the code"
    assert matches[0].rank == 1
    assert matches[0].record_id == ("1:1", "AAAA-001")
    assert len(matches) < len(many), "nothing was actually truncated"


def test_capture_cut_before_the_ranked_block_yields_no_matches_not_a_crash():
    """The other truncation shape: the cut lands before `ranked` is reached.
    Zero visible matches is the correct read — it must not raise, and must not
    be mistaken for a search that ranked nothing."""
    full = _capture(
        {
            "note": "x" * 4000,
            "ranked": {
                "matches": {"_first_n": [_match(1, "ark:/61903/1:1:AAAA-111")]}
            },
        }
    )
    matches, by_regex = ranked_matches(full[:4000])
    assert by_regex is True
    assert matches == []


def test_regex_recovery_does_not_borrow_fields_across_matches():
    """Each match's fields come from the slice between its own matchRank and
    the next, so a cut tail yields fewer matches rather than a neighbour's id."""
    summary = _capture(
        {
            "ranked": {
                "matches": {
                    "_first_n": [
                        _match(1, "ark:/61903/1:1:AAAA-111"),
                        _match(2, "ark:/61903/1:1:BBBB-222"),
                    ]
                }
            }
        }
    )
    matches, _ = ranked_matches(summary[: summary.index('"matchRank": 2') + 20])
    assert [m.rank for m in matches] == [1, 2]
    assert matches[0].record_id == ("1:1", "AAAA-111")
    assert matches[1].record_id is None


def test_post_2473_shape_with_ranked_and_no_results_is_still_counted():
    """PR #2473 makes `ranked` REPLACE the inline `results` block. A join that
    requires `results` silently skips every post-#2473 run."""
    doc = _doc(
        [
            _search(matches=[_match(1, "ark:/61903/1:1:AAAA-111")], include_results=False),
            _read("ark:/61903/1:1:AAAA-111"),
        ]
    )
    assert _outcomes(doc)[0] == ["in_top3"]


# --- the three join arms ----------------------------------------------------


def test_staging_ref_attributes_to_its_emitting_search_not_the_nearest():
    """Arm 1. The read's ref names the FIRST search's handle while the nearest
    preceding search is the second — they must not be confused."""
    doc = _doc(
        [
            _search(
                matches=[_match(1, "ark:/61903/1:1:AAAA-111")],
                staging_ref="results/.staging/one.json",
            ),
            _search(matches=[_match(1, "ark:/61903/1:1:ZZZZ-999")]),
            _read("ark:/61903/1:1:AAAA-111", results_ref="results/.staging/one.json"),
        ]
    )
    rows, _delegated, reason = scan_run(doc, "a-fixture/run")
    assert reason is None
    assert [(r.arm, r.outcome) for r in rows] == [("staging", "in_top3")]


def test_log_ref_resolves_through_research_log_append():
    """Arm 2. A `results/log_NNN.json` ref reaches its search only via the
    append's `stagedResultsRef`; 88 of 297 corpus reads carry this form."""
    doc = _doc(
        [
            _search(
                matches=[_match(1, "ark:/61903/1:1:AAAA-111")],
                staging_ref="results/.staging/one.json",
            ),
            _log_append("results/.staging/one.json", "results/log_010.json"),
            _search(matches=[_match(1, "ark:/61903/1:1:ZZZZ-999")]),
            _read("ark:/61903/1:1:AAAA-111", results_ref="results/log_010.json"),
        ]
    )
    rows, _delegated, reason = scan_run(doc, "a-fixture/run")
    assert reason is None
    assert [(r.arm, r.outcome) for r in rows] == [("log", "in_top3")]


def test_results_ref_that_resolves_to_nothing_falls_through_to_nearest():
    """Arm 3 must catch an unresolvable ref rather than dropping the read."""
    doc = _doc(
        [
            _search(matches=[_match(1, "ark:/61903/1:1:AAAA-111")]),
            _read("ark:/61903/1:1:AAAA-111", results_ref="results/.staging/gone.json"),
        ]
    )
    rows, _delegated, reason = scan_run(doc, "a-fixture/run")
    assert reason is None
    assert [(r.arm, r.outcome) for r in rows] == [("nearest", "in_top3")]


# --- scan(), exclusions and unreadable files --------------------------------


def test_corrupt_json_is_excluded_as_unreadable_not_a_crash(tmp_path):
    d = tmp_path / "a-fixture"
    d.mkdir(parents=True, exist_ok=True)
    corrupt = d / "run-2026-08-03_00-00-00.json"
    corrupt.write_text("{not valid json", encoding="utf-8")
    rows, delegated, excluded, unreadable_files = scan([corrupt])
    assert rows == []
    assert excluded == {"unreadable": 1}
    assert unreadable_files == [f"a-fixture/{corrupt.stem}"]


def test_non_dict_top_level_json_is_excluded_as_unreadable_not_a_crash(tmp_path):
    """`json.loads` succeeds on a bare `null`; `doc.get(...)` then raises."""
    d = tmp_path / "a-fixture"
    d.mkdir(parents=True, exist_ok=True)
    not_a_dict = d / "run-2026-08-04_00-00-00.json"
    not_a_dict.write_text("null", encoding="utf-8")
    rows, delegated, excluded, unreadable_files = scan([not_a_dict])
    assert rows == []
    assert excluded == {"unreadable": 1}
    assert unreadable_files == [f"a-fixture/{not_a_dict.stem}"]


def test_unsegmentable_run_is_excluded_and_counted(tmp_path):
    p = _write_run(tmp_path, {"usage": {"timeline": [[0.0, "assistant"]]}, "tool_calls": []})
    rows, delegated, excluded, unreadable_files = scan([p])
    assert rows == []
    assert excluded == {"unsegmentable-timeline": 1}
    assert unreadable_files == []


def test_preamble_counts_the_same_runs_the_body_scores(tmp_path):
    """The preamble prints under a header calling any disagreement a bug in the
    join, so it must not count tool calls from runs `scan` drops. It did: at
    SINCE=all that read 1450 reads against 526 scored."""
    scored = _write_run(
        tmp_path,
        _doc([_search(matches=[_match(1, "ark:/61903/1:1:A-1")]), _read("ark:/61903/1:1:A-1")]),
        stem="run-2026-08-10_00-00-00",
    )
    # Unsegmentable (pre-#895 two-element timeline) but carrying real traffic.
    dropped = _write_run(
        tmp_path,
        {
            "usage": {"timeline": [[0.0, "assistant"]]},
            "tool_calls": [_read("ark:/61903/1:1:ZZZZ-999"), _read("ark:/61903/1:1:YYYY-888")],
        },
        stem="run-2026-08-11_00-00-00",
    )
    paths = [scored, dropped]
    rows, _delegated, excluded, _unreadable = scan(paths)
    assert excluded == {"unsegmentable-timeline": 1}
    body_main = len(rows)
    assert preamble(paths, cap=4000).reads["main"] == body_main == 1


# --- format_report ----------------------------------------------------------


def test_format_report_prints_counts_and_the_arm_split():
    rows = [
        ReadRow("f/r", 0, "staging", "in_top3"),
        ReadRow("f/r", 0, "nearest", "not_in_top3"),
        ReadRow("f/r", 0, "nearest", "ranking-skipped"),
    ]
    out = format_report(rows, {"record-extractor": 4}, n_runs=1, excluded={})
    assert "Main-thread record_read calls: 3" in out
    assert "excluded, ranking-skipped        1" in out
    assert "scorable                     2" in out
    assert "staging                      1" in out
    assert "1 of 2 joined by an explicit resultsRef" in out
    assert f"Inside the visible top {TOP_N}: 1/2" in out
    assert "record-extractor             4" in out


def test_format_report_refuses_a_late_rate_below_the_floor():
    rows = [ReadRow("f/r", 0, "nearest", "in_top3")] * 12
    rows += [ReadRow("f/r", 9, "nearest", "in_top3")]
    out = format_report(rows, {}, n_runs=1, excluded={})
    assert "too few to state a rate" in out
    assert LATE_RATE_FLOOR == 10


def test_format_report_states_a_late_rate_at_the_floor():
    rows = [ReadRow("f/r", 9, "nearest", "in_top3")] * LATE_RATE_FLOOR
    out = format_report(rows, {}, n_runs=1, excluded={})
    assert "too few to state a rate" not in out


def test_format_report_prints_the_caveat_on_every_non_empty_report():
    out = format_report([ReadRow("f/r", 0, "nearest", "in_top3")], {}, n_runs=1, excluded={})
    assert CAVEAT in out


def test_format_report_with_no_rows_is_a_real_result_not_an_empty_one():
    out = format_report([], {}, n_runs=3, excluded={"unreadable": 1})
    assert "1 of 3 run(s) excluded" in out
    assert "That is a real result, not an empty one" in out


# --- main() -----------------------------------------------------------------


def test_preamble_names_the_corpus_date_range_actually_read(tmp_path):
    """`describe_window` names the REQUESTED cutoff and prints no dates at all
    under `--since all`. Issue #1156 asks for the range actually read, because
    `make prune-runlogs STRIP=1` can shrink the corpus between two runs."""
    doc = _doc([_search(matches=[_match(1, "ark:/61903/1:1:A-1")]), _read("ark:/61903/1:1:A-1")])
    older = _write_run(tmp_path, doc, stem="run-2026-08-09_00-00-00")
    newer = _write_run(tmp_path, doc, stem="run-2026-09-02_00-00-00")
    out = format_preamble(preamble([newer, older], cap=4000))
    assert "corpus date range actually read  2026-08-09 .. 2026-09-02" in out


def test_preamble_says_so_when_no_run_carries_a_date(tmp_path):
    d = tmp_path / "a-fixture"
    d.mkdir(parents=True, exist_ok=True)
    undated = d / "run-not-a-timestamp.json"
    undated.write_text(json.dumps({"tool_calls": []}), encoding="utf-8")
    out = format_preamble(preamble([undated], cap=4000))
    assert "no dated runs" in out


def test_main_exits_nonzero_when_nothing_in_the_window_is_readable(tmp_path, monkeypatch):
    d = tmp_path / "a-fixture"
    d.mkdir(parents=True, exist_ok=True)
    corrupt = d / "run-2026-08-05_00-00-00.json"
    corrupt.write_text("{nope", encoding="utf-8")
    monkeypatch.setattr("e2e.ranked_read_report.all_result_jsons", lambda: [corrupt])
    assert main(["--since", "all"]) == 1


def test_main_reports_the_window_and_the_preamble(tmp_path, monkeypatch, capsys):
    doc = _doc(
        [
            _search(matches=[_match(1, "ark:/61903/1:1:AAAA-111")]),
            _read("ark:/61903/1:1:AAAA-111"),
        ]
    )
    p = _write_run(tmp_path, doc)
    monkeypatch.setattr("e2e.ranked_read_report.all_result_jsons", lambda: [p])
    assert main(["--since", "all"]) == 0
    out = capsys.readouterr().out
    assert "record_search calls              1" in out
    assert "carrying a ranked block        1" in out
    assert f"Inside the visible top {TOP_N}: 1/1" in out
