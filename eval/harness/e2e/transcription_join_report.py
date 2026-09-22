"""Join each `image_transcribe` transcription to the assertions extracted from it.

Issue #2561's audit axis. The transcription-to-assertion join is what answers
"did the model read the record right": a transcription linked to the assertions
the extractor derived from it, so a reviewer can see what was read and what was
concluded side by side. What was broken was the transcription being truncated at
500 chars in the committed run log, making the joined data useless.

No live run, no model, no API spend — same posture as `image_transcribe_report.py`
and the other corpus readers. Reads committed run JSONs only.

## The join (issue #2561's decided reproduce script)

The link is a chain, NOT positional adjacency in `tool_calls[]`. `image_transcribe`
and `extraction_append` are granted to different agents (`image-reader` vs
`record-extractor`), so no thread calls both and their order in `tool_calls[]`
carries no relationship. The real chain is:

    assertions[].log_entry_id
      -> log[].id            (where log[].tool is a transcribe entry and
                              log[].query carries `imageArk` or `imageIds`)
      -> tool_calls[].args.ark | tool_calls[].args.imageId

The `assertions[]` and `log[]` live in the `run-<ts>.final-research.json` sibling,
which the 14-day capture strip never touches, so the join still works on stripped
runs (only the transcription's *completeness* is then unknown).

We match the image key by EXACT string, not the card's `norm()` regex: `args.ark`
is byte-equal to `log[].query.imageArk`, while `norm()`'s two patterns silently
drop every call whose ark/imageId matches neither (e.g. `ark:/61903/1:2:...`,
`004514824_001_00001`). Exact match never joins fewer assertions than `norm()`
over the committed corpus. Do not reintroduce `norm()` to "match the card".

## The denominator

We count real persisted `assertions[]` chained to a transcription, NOT
`extraction_append` calls (one call carries many assertion ops, and an errored
call persists none). The report prints the denominator and labels it a floor, not
a rate: a stripped run's transcriptions have unknown completeness and a pre-v5
log's are truncated, so the corpus this can answer completely for is smaller than
the corpus that exists.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from e2e.runlog_selection import all_result_jsons, result_jsons_for
from harness.since_window import (
    add_since_arg,
    branch_scope_note,
    describe_window,
    filter_since,
)

TRANSCRIBE_SUFFIX = "image_transcribe"


@dataclass
class ScanResult:
    total_captures: int = 0  # image_transcribe calls across all runs
    complete: int = 0  # measurable, non-error, non-truncated
    truncated: int = 0  # measurable, harness-truncated
    error: int = 0  # measurable, is_error
    no_summary: int = 0  # measurable, empty response_summary (pre-#1182)
    stripped_captures: int = 0  # captures in stripped runs (completeness unknown)
    stripped_runs: int = 0
    chained_assertions: int = 0  # assertions on a transcribe log entry
    joined_assertions: int = 0  # ...whose key also matches a captured call
    complete_joined_assertions: int = 0  # ...to a COMPLETE transcription
    unreadable: int = 0  # run log itself unreadable
    sibling_unreadable: int = 0  # final-research sibling unreadable (join skipped)

    @property
    def measurable_captures(self) -> int:
        return self.complete + self.truncated + self.error + self.no_summary


def _is_truncated_summary(summary: str) -> bool:
    """Whether the harness truncated this response_summary.

    Two truncation markers: the per-string cap leaves
    "[truncated by harness for prompt size; full length N chars]", and the
    backstop cap leaves "..." at the end after slicing at _RUNLOG_MAX_CHARS.
    A verbatim passthrough (under _RUNLOG_VERBATIM_MAX) has neither.

    The `>= 500` bound is deliberate: the pre-v2 head cut and the "never
    shorter" floor both emit exactly `497 + "..." == 500` chars with no marker,
    and every such capture in the corpus is genuinely truncated (none parses as
    a complete JSON document). A `> 500` bound files those 34 as complete.
    """
    return "[truncated by harness" in summary or (
        summary.endswith("...") and len(summary) >= 500
    )


def _summary_text(rs: object) -> str:
    if isinstance(rs, str):
        return rs
    if rs is None:
        return ""
    return json.dumps(rs)


def _flat_str_values(node: object) -> set[str]:
    """Every string leaf under a `log[].query` value (imageArk scalar or
    imageIds list), so both call shapes surface their image key."""
    out: set[str] = set()
    if isinstance(node, str):
        out.add(node)
    elif isinstance(node, list):
        for v in node:
            out |= _flat_str_values(v)
    elif isinstance(node, dict):
        for v in node.values():
            out |= _flat_str_values(v)
    return out


def _final_research_path(run_path: Path) -> Path:
    return run_path.with_name(run_path.stem + ".final-research.json")


def _scan_one(run_path: Path, result: ScanResult) -> None:
    doc = json.loads(run_path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict):
        raise ValueError("run log is not a JSON object")
    tool_calls = doc.get("tool_calls") or []
    if not isinstance(tool_calls, list):
        raise ValueError("tool_calls is not a list")
    stripped = bool(doc.get("captures_stripped"))

    # Capture-side: classify each image_transcribe call and collect its image key.
    tc_keys: set[str] = set()  # every key seen in this run's transcribe calls
    complete_keys: set[str] = set()  # keys whose call is a COMPLETE transcription
    run_has_transcribe = False
    for tc in tool_calls:
        if not (isinstance(tc, dict) and str(tc.get("tool") or "").endswith(TRANSCRIBE_SUFFIX)):
            continue
        run_has_transcribe = True
        result.total_captures += 1
        args = tc.get("args") or {}
        key = args.get("ark") or args.get("imageId") if isinstance(args, dict) else None
        if key:
            tc_keys.add(key)

        if stripped:
            result.stripped_captures += 1
            continue  # completeness unknown; the join below still runs
        if bool(tc.get("is_error")):
            result.error += 1
            continue
        text = _summary_text(tc.get("response_summary"))
        if not text:
            result.no_summary += 1
        elif _is_truncated_summary(text):
            result.truncated += 1
        else:
            result.complete += 1
            if key:
                complete_keys.add(key)

    if stripped and run_has_transcribe:
        result.stripped_runs += 1

    # Join-side: assertions whose `log_entry_id` chains to a transcribe log
    # entry in this run. `chained_assertions` counts every such assertion;
    # `joined_assertions` narrows to those whose log-entry image key also matches
    # a captured `tool_calls[]` transcription (the only ones whose transcription
    # TEXT is on file). Isolated in its own try so a corrupt sibling marks the
    # JOIN unreadable, not the whole run — its captures above are valid.
    fr = _final_research_path(run_path)
    if not tc_keys or not fr.exists():
        return
    try:
        research = json.loads(fr.read_text(encoding="utf-8"))
        if not isinstance(research, dict):
            return
        logkeys: dict[str, set[str]] = {}
        for entry in research.get("log") or []:
            # Skip id-less entries: a `None` id would collect every id-less
            # assertion under one bucket and mis-join them.
            if (
                isinstance(entry, dict)
                and entry.get("id") is not None
                and "transcribe" in str(entry.get("tool") or "")
            ):
                logkeys[entry["id"]] = _flat_str_values(entry.get("query"))
        for assertion in research.get("assertions") or []:
            if not isinstance(assertion, dict):
                continue
            le = assertion.get("log_entry_id")
            if le is None or le not in logkeys:
                continue
            result.chained_assertions += 1
            keys = logkeys[le]
            if keys & tc_keys:
                result.joined_assertions += 1
                if keys & complete_keys:
                    result.complete_joined_assertions += 1
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError, AttributeError):
        result.sibling_unreadable += 1
        return


def scan(paths: list[Path]) -> ScanResult:
    """Walk every run log and chain-join transcriptions to their assertions."""
    result = ScanResult()
    for p in paths:
        try:
            _scan_one(p, result)
        except (
            OSError,
            UnicodeDecodeError,
            json.JSONDecodeError,
            ValueError,
            TypeError,
            AttributeError,
        ):
            result.unreadable += 1
            continue
    return result


def format_report(result: ScanResult) -> str:
    out: list[str] = []
    total = result.total_captures
    measurable = result.measurable_captures

    out.append(
        "Transcription-to-assertion join over committed e2e runs (issue #2561)"
    )
    out.append("")
    out.append(f"  image_transcribe calls found: {total}")
    if result.stripped_captures:
        out.append(
            f"  captures STRIPPED (>14d):     {result.stripped_captures} "
            f"in {result.stripped_runs} run(s) — completeness unknown, still joined below"
        )
    out.append(f"  measurable for completeness:  {measurable}")
    if result.unreadable:
        out.append(f"  UNREADABLE run logs:          {result.unreadable}")
    if result.sibling_unreadable:
        out.append(
            f"  UNREADABLE final-research:    {result.sibling_unreadable} "
            "(captures counted, join skipped)"
        )
    out.append("")

    if total == 0:
        out.append(
            "  NO image_transcribe CALLS in range."
        )
        return "\n".join(out)

    out.append(f"  complete transcriptions:      {result.complete} of {measurable}")
    out.append(f"  truncated by harness:         {result.truncated}")
    out.append(f"  error payloads:               {result.error}")
    if result.no_summary:
        out.append(f"  no response_summary:          {result.no_summary}")
    out.append("")

    out.append(
        f"  assertions on a transcribe log entry:           {result.chained_assertions}"
    )
    out.append(
        f"  ...matched to a captured transcription call:    {result.joined_assertions}"
    )
    out.append(
        f"  ...to a COMPLETE transcription:                 {result.complete_joined_assertions}"
    )
    unmatched = result.chained_assertions - result.joined_assertions
    if unmatched:
        out.append(
            f"  ({unmatched} chained assertion(s) whose transcription call was not "
            "captured in this run's tool_calls — subagent capture gap)"
        )
    out.append("")

    # The denominator statement the acceptance criteria require.
    out.append("Denominator (floor, not a rate):")
    out.append(
        f"  {result.complete} complete transcriptions of {measurable} measurable "
        f"captures, {result.joined_assertions} joined assertions."
    )
    floors = []
    if result.stripped_captures:
        floors.append(
            f"{result.stripped_captures} captures are in stripped runs "
            "(completeness unknown)"
        )
    if result.truncated:
        floors.append(
            f"{result.truncated} were truncated by the harness (pre-v5)"
        )
    if floors:
        out.append(
            f"  {' and '.join(floors)}, so complete-joined is a floor, not a rate."
        )
    else:
        out.append("  No captures stripped or truncated — this is exact.")

    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="transcription-join-report",
        description=(
            "Chain-join image_transcribe transcriptions to the assertions "
            "extracted from them over committed e2e run logs (issue #2561)."
        ),
    )
    parser.add_argument("--test", default=None, help="Only this fixture slug.")
    add_since_arg(parser)
    args = parser.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        where = (
            f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        )
        print(f"No committed runs found{where}.", file=sys.stderr)
        print(branch_scope_note(), file=sys.stderr)
        return 1

    result = scan(paths)
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(format_report(result))
    return 1 if result.total_captures == 0 else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
