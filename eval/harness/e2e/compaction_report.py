"""record_search subjectId supply, segmented by compaction boundary.

GitHub issue #1155. The ranking fold (`record-search.ts`: `subjectId &&
projectPath` triggers host-side ranking) is pinned in code and cannot decay —
that part is a property of the code, confirmed by
`record-search.test.ts`, not a model decision any live run could disconfirm.
What is still unmeasured is whether the agent keeps *supplying* `subjectId`
deep into a long session, since that instruction lives only as prose in
`search-records/SKILL.md` (over 55KB and still growing). This answers that
from the already-committed e2e corpus — no live run, no API spend — same
posture as `nudge_report.py`, `corpus_report.py`, and `latency_report.py`.

## How a call is placed into a segment

`usage.timeline` is `[[elapsed_s, kind, tool_names?], ...]`. A
`system:compact_boundary` entry increments the segment counter (segment 0 is
before the first compaction). An `assistant` entry's `tool_names` list (added
by #895, 2026-07-26 — runs before that date carry the 2-element form and
cannot be segmented) consumes `tool_calls[]` in order via a running cursor:
the Nth name across all assistant entries in timeline order corresponds to
`tool_calls[N]`. Verified positionally aligned on a real committed run
(198/198) — the two disagree only in formatting (`record_search` vs
`mcp__genealogy__record_search`, `Skill:<name>` vs bare `Skill`), never in
order or count.

Segments 0–2 are "early", segment 3+ is "late" — issue #1155's own split,
not derived from the data.

## Two exclusions, both counted rather than silently dropped

A run is excluded as `unsegmentable-timeline` when any assistant entry lacks
`tool_names` (the pre-#895 form — nothing to segment). It is excluded as
`tool-count-mismatch` when the summed tool-name count disagrees with
`len(tool_calls)` — the positional alignment above is an empirical property
of the data, not a documented contract, so a run where it breaks must not be
silently mis-attributed.

CLI (from eval/harness/):
  uv run python -m e2e.compaction_report --since 2026-07-27
  uv run python -m e2e.compaction_report --since 2026-08-04
  uv run python -m e2e.compaction_report --test hannah-earnest-children --since all
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import NamedTuple

from e2e.runlog_selection import (
    add_since_arg,
    all_result_jsons,
    describe_window,
    filter_since,
    result_jsons_for,
)
from harness.context_policy import bare_tool_name

#: Segments 0-2 are "early"; segment 3+ is "late" — issue #1155's own split.
EARLY_MAX_SEGMENT = 2


class RecordSearchCall(NamedTuple):
    run: str          # "<fixture>/<run stem>"
    segment: int
    has_subject: bool


def segment_run(doc: dict) -> tuple[list[tuple[int, bool]], str | None]:
    """(calls, exclusion_reason) for one run's record_search calls.

    `calls` is a list of `(segment, has_subjectId)` tuples, one per
    `record_search` call recovered from `tool_calls`. `exclusion_reason` is
    `None` on success, else `"unsegmentable-timeline"` or
    `"tool-count-mismatch"` — see the module docstring.
    """
    timeline = (doc.get("usage") or {}).get("timeline") or []
    tool_calls = doc.get("tool_calls") or []

    calls: list[tuple[int, bool]] = []
    cursor = 0
    segment = 0
    for entry in timeline:
        kind = entry[1] if len(entry) > 1 else None
        if kind == "system:compact_boundary":
            segment += 1
            continue
        if kind != "assistant":
            continue
        if len(entry) != 3:
            return [], "unsegmentable-timeline"
        for _ in entry[2]:
            if cursor >= len(tool_calls):
                return [], "tool-count-mismatch"
            call = tool_calls[cursor]
            cursor += 1
            if bare_tool_name(call.get("tool") or "") == "record_search":
                has_subject = bool((call.get("args") or {}).get("subjectId"))
                calls.append((segment, has_subject))
    if cursor != len(tool_calls):
        return [], "tool-count-mismatch"
    return calls, None


def scan(paths: list[Path]) -> tuple[list[RecordSearchCall], Counter, list[str]]:
    """Every `record_search` call across the given run JSONs, with excluded
    (unreadable or unsegmentable) runs counted rather than silently dropped.

    `unreadable_files` names every run that failed to even parse as a JSON
    object — mirrors `corpus_report.py`'s `skipped` list, so a caller can
    print which files to go look at rather than just a count.
    """
    calls: list[RecordSearchCall] = []
    excluded: Counter = Counter()
    unreadable_files: list[str] = []
    for p in paths:
        run = f"{p.parent.name}/{p.stem}"
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            doc = None
        if not isinstance(doc, dict):
            excluded["unreadable"] += 1
            unreadable_files.append(run)
            continue
        run_calls, reason = segment_run(doc)
        if reason:
            excluded[reason] += 1
            continue
        calls.extend(RecordSearchCall(run, seg, has_subject) for seg, has_subject in run_calls)
    return calls, excluded, unreadable_files


def _bucket(segment: int) -> str:
    return "early" if segment <= EARLY_MAX_SEGMENT else "late"


def format_report(
    calls: list[RecordSearchCall],
    n_runs: int,
    excluded: Counter,
    unreadable_files: list[str] | None = None,
) -> str:
    n_excluded = sum(excluded.values())
    if n_excluded:
        exclusion_line = (
            f"{n_excluded} of {n_runs} run(s) excluded from segmentation: "
            + ", ".join(f"{v} {k}" for k, v in sorted(excluded.items()))
        )
    else:
        exclusion_line = f"0 of {n_runs} run(s) excluded from segmentation."
    if unreadable_files:
        exclusion_line += "\n  unreadable: " + ", ".join(unreadable_files)

    if not calls:
        return (
            f"{exclusion_line}\n"
            "No record_search calls found in the segmentable runs in this "
            "window. That is a real result, not an empty one — check the "
            "exclusion count above before reading it as 'no record_search "
            "activity'."
        )

    lines = [exclusion_line, ""]

    by_bucket: dict[str, list[RecordSearchCall]] = {"early": [], "late": []}
    for c in calls:
        by_bucket[_bucket(c.segment)].append(c)

    early_range = f"0-{EARLY_MAX_SEGMENT}"
    late_range = f"{EARLY_MAX_SEGMENT + 1}+"
    for bucket, seg_range in (("early", early_range), ("late", late_range)):
        bucket_calls = by_bucket[bucket]
        n = len(bucket_calls)
        n_sub = sum(1 for c in bucket_calls if c.has_subject)
        pct = f"{round(100 * n_sub / n, 1)}%" if n else "no calls"
        lines.append(
            f"{bucket.upper()} (segments {seg_range}): {n} record_search "
            f"call(s), {n_sub} carrying subjectId ({pct})"
        )

    late_by_run: dict[str, list[RecordSearchCall]] = {}
    for c in calls:
        if _bucket(c.segment) == "late":
            late_by_run.setdefault(c.run, []).append(c)

    if late_by_run:
        lines.append("")
        lines.append("Per-run late-segment supply, worst first:")
        rows = []
        for run, run_calls in late_by_run.items():
            n = len(run_calls)
            n_sub = sum(1 for c in run_calls if c.has_subject)
            rows.append((run, n, n_sub))
        rows.sort(key=lambda r: (r[2] / r[1], -r[1]))
        for run, n, n_sub in rows:
            pct = round(100 * n_sub / n, 1)
            lines.append(f"  {n_sub}/{n} ({pct}%)  {run}")

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "record_search subjectId supply by compaction segment, over "
            "committed e2e runs (issue #1155)."
        ),
    )
    parser.add_argument("--test", default=None, help="Only this fixture slug.")
    add_since_arg(parser)
    args = parser.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    if args.test:
        # An explicit --test is a deliberate request for that fixture's runs;
        # the cutoff guards *aggregate* reads, same convention as
        # latency_report.py's --test/--all split.
        cutoff = None
        paths = all_paths
    else:
        cutoff = args.since
        paths = filter_since(all_paths, cutoff)
    if not paths:
        where = f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        print(f"No committed runs found{where}.", file=sys.stderr)
        return 1

    calls, excluded, unreadable_files = scan(paths)
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(format_report(calls, n_runs=len(paths), excluded=excluded, unreadable_files=unreadable_files))
    # Nothing readable is a failure, not an empty success — same convention as
    # corpus_report.py: a caller keying on the exit code must be able to tell
    # "clean run, nothing to say" from "the whole window was unreadable".
    readable = len(paths) - excluded.get("unreadable", 0)
    return 0 if readable else 1


if __name__ == "__main__":
    sys.exit(main())
