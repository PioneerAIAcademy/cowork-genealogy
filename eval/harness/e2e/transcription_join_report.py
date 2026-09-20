"""Join each `image_transcribe` call to the assertions extracted from it.

Issue #2561's audit axis. The transcription-to-assertion join is what answers
"did the model read the record right": a transcription linked to the assertions
the extractor derived from it, so a reviewer can see what was read and what was
concluded side by side. The join itself already worked (482/482 measured
2026-09-15); what was broken was the transcription being truncated at 500 chars
in the committed run log, making the joined data useless.

No live run, no model, no API spend — same posture as `image_transcribe_report.py`
and the other corpus readers. Reads committed run JSONs only.

## The join

Walk `tool_calls[]` in order. An `image_transcribe` call becomes the "current
transcription". Every subsequent `extraction_append` call is joined to it, until
the next `image_transcribe` (which starts a new group) or the end of the list.
An `extraction_append` before any `image_transcribe` is unjoined (possible if
the extractor writes assertions from a record it read via `record_read` rather
than from a transcription).

## The denominator

The report prints the denominator and labels it a floor, not a rate: a stripped
run's transcriptions are invisible, and a v4 log's are truncated, so the corpus
this can answer for is smaller than the corpus that exists.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from e2e.runlog_selection import all_result_jsons, result_jsons_for
from harness.since_window import (
    add_since_arg,
    branch_scope_note,
    describe_window,
    filter_since,
)

TRANSCRIBE_SUFFIX = "image_transcribe"
EXTRACTION_SUFFIX = "extraction_append"


@dataclass
class TranscriptionGroup:
    """One `image_transcribe` call and the `extraction_append` calls that follow it."""

    run: str
    transcribe_index: int
    transcription_chars: int
    is_complete: bool  # not truncated by the harness
    is_error: bool
    assertion_count: int = 0


@dataclass
class ScanResult:
    groups: list[TranscriptionGroup] = field(default_factory=list)
    unjoined_extractions: int = 0  # extraction_append before any image_transcribe
    unreadable: int = 0
    stripped_runs: int = 0
    stripped_transcriptions: int = 0

    @property
    def total_transcriptions(self) -> int:
        return len(self.groups)

    @property
    def complete_transcriptions(self) -> int:
        return sum(1 for g in self.groups if g.is_complete and not g.is_error)

    @property
    def error_transcriptions(self) -> int:
        return sum(1 for g in self.groups if g.is_error)

    @property
    def truncated_transcriptions(self) -> int:
        return sum(
            1 for g in self.groups if not g.is_complete and not g.is_error
        )

    @property
    def joined_assertions(self) -> int:
        return sum(g.assertion_count for g in self.groups)

    @property
    def complete_joined_assertions(self) -> int:
        """Assertions joined to a complete (untruncated, non-error) transcription."""
        return sum(
            g.assertion_count
            for g in self.groups
            if g.is_complete and not g.is_error
        )


def _is_truncated_summary(summary: str) -> bool:
    """Whether the harness truncated this response_summary.

    Two truncation markers: the per-string cap leaves
    "[truncated by harness for prompt size; full length N chars]", and the
    backstop cap leaves "..." at the end after slicing at _RUNLOG_MAX_CHARS.
    A verbatim passthrough (under _RUNLOG_VERBATIM_MAX) has neither.
    """
    return (
        "[truncated by harness" in summary
        or (summary.endswith("...") and len(summary) > 500)
    )


def scan(paths: list[Path]) -> ScanResult:
    """Walk every run log and build transcription-to-assertion groups."""
    result = ScanResult()
    for p in paths:
        run = f"{p.parent.name}/{p.stem}"
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
            if not isinstance(doc, dict):
                raise ValueError("run log is not a JSON object")

            stripped = bool(doc.get("captures_stripped"))
            tool_calls = doc.get("tool_calls") or []
            if not isinstance(tool_calls, list):
                raise ValueError("tool_calls is not a list")

            if stripped:
                # Count stripped transcriptions but don't try to classify them.
                for tc in tool_calls:
                    if isinstance(tc, dict) and str(
                        tc.get("tool") or ""
                    ).endswith(TRANSCRIBE_SUFFIX):
                        result.stripped_transcriptions += 1
                if any(
                    isinstance(tc, dict)
                    and str(tc.get("tool") or "").endswith(TRANSCRIBE_SUFFIX)
                    for tc in tool_calls
                ):
                    result.stripped_runs += 1
                continue

            current_group: TranscriptionGroup | None = None
            for i, tc in enumerate(tool_calls):
                if not isinstance(tc, dict):
                    continue
                tool = str(tc.get("tool") or "")

                if tool.endswith(TRANSCRIBE_SUFFIX):
                    # Commit previous group, start a new one.
                    if current_group is not None:
                        result.groups.append(current_group)

                    rs = tc.get("response_summary")
                    rs_str = (
                        rs
                        if isinstance(rs, str)
                        else json.dumps(rs) if rs is not None else ""
                    )
                    is_error = bool(tc.get("is_error"))
                    is_complete = (
                        not is_error
                        and bool(rs_str)
                        and not _is_truncated_summary(rs_str)
                    )

                    current_group = TranscriptionGroup(
                        run=run,
                        transcribe_index=i,
                        transcription_chars=len(rs_str),
                        is_complete=is_complete,
                        is_error=is_error,
                    )

                elif tool.endswith(EXTRACTION_SUFFIX):
                    if current_group is not None:
                        current_group.assertion_count += 1
                    else:
                        result.unjoined_extractions += 1

            # Commit last group.
            if current_group is not None:
                result.groups.append(current_group)

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
    total = result.total_transcriptions
    total_with_stripped = total + result.stripped_transcriptions

    out.append(
        "Transcription-to-assertion join over committed e2e runs (issue #2561)"
    )
    out.append("")
    out.append(f"  image_transcribe calls found: {total_with_stripped}")
    if result.stripped_transcriptions:
        out.append(
            f"  captures STRIPPED (>14d):     {result.stripped_transcriptions} "
            f"in {result.stripped_runs} run(s) — excluded below"
        )
    out.append(f"  measurable:                   {total}")
    if result.unreadable:
        out.append(f"  UNREADABLE run logs:          {result.unreadable}")
    out.append("")

    if total == 0:
        out.append(
            "  NO MEASURABLE CALLS. Every capture in range has been stripped "
            "or is unreadable."
        )
        return "\n".join(out)

    complete = result.complete_transcriptions
    errors = result.error_transcriptions
    truncated = result.truncated_transcriptions
    out.append(f"  complete transcriptions:      {complete} of {total}")
    out.append(f"  error payloads:               {errors}")
    out.append(f"  truncated by harness:         {truncated}")
    out.append("")

    joined = result.joined_assertions
    complete_joined = result.complete_joined_assertions
    out.append(f"  assertions joined to a transcription:           {joined}")
    out.append(
        f"  assertions joined to a COMPLETE transcription:  {complete_joined}"
    )
    if result.unjoined_extractions:
        out.append(
            f"  extraction_append before any image_transcribe:  "
            f"{result.unjoined_extractions}"
        )
    out.append("")

    # The denominator statement the acceptance criteria require.
    out.append("Denominator (floor, not a rate):")
    out.append(
        f"  {complete} complete transcriptions of {total} captures, "
        f"{complete_joined} joined assertions."
    )
    if result.stripped_transcriptions:
        out.append(
            f"  {result.stripped_transcriptions} further captures stripped — "
            "their completeness is unknown, so this is a floor."
        )
    elif truncated:
        out.append(
            f"  {truncated} captures truncated by the harness (pre-v5 run logs) "
            "— their full text is lost, so this is a floor."
        )
    else:
        out.append("  No captures stripped or truncated — this is exact.")

    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="transcription-join-report",
        description=(
            "Join image_transcribe calls to extraction_append assertions "
            "over committed e2e run logs (issue #2561)."
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
    return 1 if result.total_transcriptions == 0 else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
