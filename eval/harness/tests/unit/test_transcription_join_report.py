"""Pin the transcription-to-assertion chain join (issue #2561).

Guards clack391's three code blockers on `transcription_join_report.py`:
  - B1: the join is the `log_entry_id` chain, NOT positional `tool_calls[]`
        adjacency (extraction_append order carries no relationship — the two
        tools are granted to different agents);
  - B2: the counter counts real persisted `assertions[]`, not
        `extraction_append` calls (one call carries many ops; an errored call
        persists none);
  - B4: a summary of exactly `497 + "..." == 500` chars reads as truncated.
Plus the stripped-run join (final-research survives the 14-day strip) and the
imageId-list query shape.
"""

from __future__ import annotations

import json
from pathlib import Path

from e2e.transcription_join_report import ScanResult, scan


def _write_run(
    tmp_path: Path,
    tool_calls: list[dict],
    research: dict | None,
    *,
    stripped: bool = False,
    stem: str = "run-2026-09-20_00-00-00",
) -> Path:
    run = tmp_path / f"{stem}.json"
    doc: dict = {"tool_calls": tool_calls}
    if stripped:
        doc["captures_stripped"] = True
    run.write_text(json.dumps(doc), encoding="utf-8")
    if research is not None:
        sib = tmp_path / f"{stem}.final-research.json"
        sib.write_text(json.dumps(research), encoding="utf-8")
    return run


def _transcribe(ark: str | None = None, image_id: str | None = None, **kw) -> dict:
    args: dict = {}
    if ark is not None:
        args["ark"] = ark
    if image_id is not None:
        args["imageId"] = image_id
    return {"tool": "mcp__genealogy__image_transcribe", "args": args, **kw}


def test_join_is_the_log_entry_id_chain_not_positional(tmp_path):
    """B1 + B2: an extraction_append call sitting right after the transcribe
    call must NOT join by adjacency; only assertions whose log entry chains to
    the transcription's image key count, and every such ASSERTION counts (not
    the one extraction_append call)."""
    ark = "ark:/61903/3:1:AAAA-BBBB"
    tool_calls = [
        _transcribe(ark=ark, response_summary="a full transcription"),
        # A positional neighbour the OLD report credited to the transcription.
        {"tool": "mcp__genealogy__extraction_append", "args": {}},
    ]
    research = {
        "log": [
            {"id": "log_1", "tool": "image_transcribe", "query": {"imageArk": ark}},
            {"id": "log_2", "tool": "record_read", "query": {"ark": ark}},
        ],
        "assertions": [
            {"id": "a1", "log_entry_id": "log_1"},
            {"id": "a2", "log_entry_id": "log_1"},
            {"id": "a3", "log_entry_id": "log_1"},
            # Chained to a NON-transcribe entry — must not join.
            {"id": "a4", "log_entry_id": "log_2"},
        ],
    }
    r = scan([_write_run(tmp_path, tool_calls, research)])
    assert r.joined_assertions == 3  # the three on log_1, not 1 (the call) or 4
    assert r.complete_joined_assertions == 3  # transcription is complete


def test_off_by_one_exactly_500_reads_truncated(tmp_path):
    """B4: 497 chars + '...' == 500 is truncated, so complete-joined is 0."""
    ark = "ark:/61903/3:1:CCCC-DDDD"
    summary = "x" * 497 + "..."
    assert len(summary) == 500
    tool_calls = [_transcribe(ark=ark, response_summary=summary)]
    research = {
        "log": [{"id": "log_1", "tool": "image_transcribe", "query": {"imageArk": ark}}],
        "assertions": [{"id": "a1", "log_entry_id": "log_1"}],
    }
    r = scan([_write_run(tmp_path, tool_calls, research)])
    assert r.truncated == 1
    assert r.complete == 0
    assert r.joined_assertions == 1
    assert r.complete_joined_assertions == 0


def test_stripped_run_still_joins_with_unknown_completeness(tmp_path):
    """The final-research sibling survives the 14-day capture strip, so a
    stripped run still joins; its transcription completeness is unknown."""
    ark = "ark:/61903/3:1:EEEE-FFFF"
    tool_calls = [_transcribe(ark=ark)]  # no response_summary (stripped)
    research = {
        "log": [{"id": "log_1", "tool": "image_transcribe", "query": {"imageArk": ark}}],
        "assertions": [
            {"id": "a1", "log_entry_id": "log_1"},
            {"id": "a2", "log_entry_id": "log_1"},
        ],
    }
    r = scan([_write_run(tmp_path, tool_calls, research, stripped=True)])
    assert r.stripped_captures == 1
    assert r.stripped_runs == 1
    assert r.joined_assertions == 2
    assert r.complete_joined_assertions == 0  # completeness unknown


def test_imageid_list_query_joins(tmp_path):
    """imageId-based calls carry `query.imageIds` (a list); exact match on the
    id joins them."""
    image_id = "004514824_001_00001"
    tool_calls = [_transcribe(image_id=image_id, response_summary="full")]
    research = {
        "log": [
            {"id": "log_1", "tool": "image_transcribe", "query": {"imageIds": [image_id]}}
        ],
        "assertions": [{"id": "a1", "log_entry_id": "log_1"}],
    }
    r = scan([_write_run(tmp_path, tool_calls, research)])
    assert r.joined_assertions == 1


def test_errored_transcription_is_not_complete_but_still_joins(tmp_path):
    ark = "ark:/61903/3:1:GGGG-HHHH"
    tool_calls = [_transcribe(ark=ark, is_error=True, response_summary='{"error": "x"}')]
    research = {
        "log": [{"id": "log_1", "tool": "image_transcribe", "query": {"imageArk": ark}}],
        "assertions": [{"id": "a1", "log_entry_id": "log_1"}],
    }
    r = scan([_write_run(tmp_path, tool_calls, research)])
    assert r.error == 1
    assert r.joined_assertions == 1
    assert r.complete_joined_assertions == 0


def test_missing_sibling_counts_captures_but_no_join(tmp_path):
    ark = "ark:/61903/3:1:IIII-JJJJ"
    tool_calls = [_transcribe(ark=ark, response_summary="full")]
    r = scan([_write_run(tmp_path, tool_calls, research=None)])
    assert r.total_captures == 1
    assert r.complete == 1
    assert r.joined_assertions == 0


def test_unreadable_run_is_counted_not_raised(tmp_path):
    run = tmp_path / "run-2026-09-20_00-00-00.json"
    run.write_text("{not json", encoding="utf-8")
    r = scan([run])
    assert r.unreadable == 1
    assert isinstance(r, ScanResult)
