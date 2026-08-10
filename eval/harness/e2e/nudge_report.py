"""Where `/research` yields mid-loop, over committed e2e runs.

GitHub issue #1104. The `/research` skill must run until
`project.status == "completed"`, but the agent periodically narrates a next step
and ends its turn. A `Stop` hook vetoes the yield and re-instructs it, and every
one of those nudges is a wasted turn on a seam that should not exist.

This report answers "where does it yield" from already-committed data: no live
run, no model, no API spend — same posture as `corpus_report.py`,
`latency_report.py` and `agent_tool_usage_report.py`.

## Why the seam matters more than the count

`orchestrator.py` already records the count in `usage.continue_nudges`, so
totals were always available. What was not available is *where*, and that is the
part that decides the fix. `research/SKILL.md` already forbids the yield about
as hard as prose can — "do **not** end your turn to announce, plan, or ask about
a next step", plus a step titled "Iterate — without yielding" — and it is
disobeyed anyway. So the live hypothesis is that the *sub-skills* close the turn
from the other side, and that is a claim about which skill boundary each nudge
follows.

## Two sources, and reading only the newer one sees almost nothing

Nudges are recoverable two ways, and this unions both:

1. **`narration[]`** — entries `{tool_calls_before, kind, text}`, where a nudge is
   `kind == "harness"` and the text opens `continue-nudge N/M:`. `tool_calls_before`
   indexes `tool_calls[]`, so the tool call the agent yielded *after* is
   `tool_calls[tool_calls_before - 1]`. This is the richer source: it gives the
   seam directly rather than inferring it from prose.
2. **`<run>.transcript.md`** — the older format, `**[HARNESS]** continue-nudge N/M:`
   preceded by the assistant's own prose. No tool markers, so the seam is read
   from what the agent said it was doing.

`narration` replaced the transcript in #1238 (2026-08-04). At the time of
writing it covers **2 of 145** committed runs while the transcripts carry **20
nudge events across 7 runs** — so a reader that only understands `narration`
reports 3 events and misses the finding entirely. That asymmetry is the whole
reason for the fallback, and it inverts as the corpus turns over: keep both.
"""

from __future__ import annotations

import argparse
import json
import re
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

# `**[HARNESS]** continue-nudge 1/20: agent yielded before …` in a transcript,
# and the same text as a `narration` entry's `text`. The counter is captured so
# a malformed line cannot silently read as a nudge.
NUDGE_RE = re.compile(r"continue-nudge\s+(\d+)\s*/\s*(\d+)\s*:")
HARNESS_LINE_RE = re.compile(r"^\*\*\[HARNESS\]\*\*\s*(.*)$")

# How much of the agent's last words to keep. Long enough to carry an explicit
# handoff ("Returning findings to the orchestrator"), short enough to scan.
EXCERPT_CHARS = 240

# Two independent axes, because they answer different questions.
#
# The SEAM is *which artifact had just been written* — the boundary the yield
# sits on, and therefore which skill's closing prose to look at. Keyed on the
# id prefixes the writer tools mint (`pli_`, `loc_`, `q_`, `ps_`) before any
# English, since those are stable and the narration wording is not: the same
# seam appears as "Handing off to `search-records`", as a plan-item table, and
# as a raw `plan_items` tool_result in three different runs.
#
# Ordered; first match wins. Anything unmatched lands in `other` and is printed
# verbatim — a bucket that quietly swallows a new seam is worse than an honest
# `other`, so keep these tight rather than greedy.
SEAMS: list[tuple[str, re.Pattern[str]]] = [
    ("subagent-await", re.compile(r"\b(agents?|subagents?)\b[^.]{0,60}\b(running|in parallel|complete)", re.I)),
    ("plan-written", re.compile(r"\bpli_\d|\bplan_items\b|\bresearch-plan\b|\bplan\b[^.]{0,40}\b(written|created|persisted)\b", re.I)),
    ("locality-persisted", re.compile(r"\bloc_\d|\blocality[- ]guide\b|\blocality\b|\brepositor(y|ies)\b|\brecord types\b|\bkey quirk\b", re.I)),
    ("question-written", re.compile(r"\bq_\d|\bquestion-selection\b|\bquestion\b[^.]{0,40}\b(created|written|framed)\b", re.I)),
    ("warnings-checked", re.compile(r"\bcheck-warnings\b|\bwarnings\b[^.]{0,40}\b(for|none|returned)\b|\bquality scores?\b", re.I)),
    ("extraction-complete", re.compile(r"\bextract(ion|ed)\b|\brecord-extraction\b|\bassertions?\b[^.]{0,30}\blink", re.I)),
    ("search-logged", re.compile(r"\bsearch(es)?\b[^.]{0,40}\blogged\b|\bresearch_log_append\b|\bsearch-records\b", re.I)),
    ("proof-written", re.compile(r"\bps_\d|\bproof[- ]conclusion\b|\bproof summary\b", re.I)),
]

# The ANNOUNCEMENT axis is *the behaviour `research/SKILL.md` forbids* — "do
# **not** end your turn to announce, plan, or ask about a next step." A nudge
# whose last words name the next step is direct evidence the rule is being
# disobeyed rather than merely not reached; one without is a plainer stall.
# This is the number that argues for or against editing the sub-skills, so it
# is counted separately rather than folded into the seam.
ANNOUNCE_RE = re.compile(
    r"\b(hand(ing)?\s*(off|back)|proceed(ing)?\s+to|routing\s+(back|to)|"
    r"return(ing)?\s+to|next step|now invoking|invoking\b)",
    re.I,
)


class Nudge(NamedTuple):
    """One observed yield, with whatever context its source could supply."""

    run: str          # "<fixture>/<run stem>"
    index: int        # the N in "continue-nudge N/M"
    cap: int          # the M
    source: str       # "narration" | "transcript"
    after_tool: str   # the tool call it yielded after, or "" when unknown
    excerpt: str      # the agent's last words before yielding
    seam: str
    announced: bool   # did its last words name the next step (the forbidden move)


def classify(excerpt: str, after_tool: str) -> tuple[str, bool]:
    """(seam, announced) for one yield. Seam is `other` when nothing matches."""
    haystack = f"{excerpt} {after_tool}"
    seam = "other"
    for name, pattern in SEAMS:
        if pattern.search(haystack):
            seam = name
            break
    return seam, bool(ANNOUNCE_RE.search(excerpt))


def _tail(text: str) -> str:
    """The last words of a narration/prose block, whitespace-collapsed."""
    flat = " ".join((text or "").split())
    return flat[-EXCERPT_CHARS:] if len(flat) > EXCERPT_CHARS else flat


def nudges_from_narration(doc: dict, run: str) -> list[Nudge]:
    """Nudges recoverable from `narration[]` + `tool_calls[]`."""
    narration = doc.get("narration") or []
    tool_calls = doc.get("tool_calls") or []
    out: list[Nudge] = []
    for i, entry in enumerate(narration):
        if (entry or {}).get("kind") != "harness":
            continue
        m = NUDGE_RE.search(entry.get("text") or "")
        if not m:
            continue
        # The agent's own last words are the nearest preceding assistant entry.
        excerpt = ""
        for prev in reversed(narration[:i]):
            if (prev or {}).get("kind") == "assistant":
                excerpt = _tail(prev.get("text") or "")
                break
        before = entry.get("tool_calls_before")
        after_tool = ""
        if isinstance(before, int) and 0 < before <= len(tool_calls):
            after_tool = str((tool_calls[before - 1] or {}).get("tool") or "")
        out.append(
            Nudge(run, int(m.group(1)), int(m.group(2)), "narration",
                  after_tool, excerpt, *classify(excerpt, after_tool))
        )
    return out


def nudges_from_transcript(path: Path, run: str) -> list[Nudge]:
    """Nudges recoverable from a `<run>.transcript.md`.

    No tool markers exist in that format, so `after_tool` stays empty and the
    seam is read from the assistant prose immediately above the harness line.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    lines = text.splitlines()
    out: list[Nudge] = []
    for i, line in enumerate(lines):
        harness = HARNESS_LINE_RE.match(line)
        if not harness:
            continue
        m = NUDGE_RE.search(harness.group(1))
        if not m:
            continue
        # Walk back over blank lines and pick up the preceding prose block,
        # stopping at the previous harness line or a heading.
        buf: list[str] = []
        for prev in reversed(lines[:i]):
            if HARNESS_LINE_RE.match(prev) or prev.startswith("## "):
                break
            buf.append(prev)
            if len(" ".join(buf)) > EXCERPT_CHARS * 3:
                break
        excerpt = _tail(" ".join(reversed(buf)))
        out.append(
            Nudge(run, int(m.group(1)), int(m.group(2)), "transcript",
                  "", excerpt, *classify(excerpt, ""))
        )
    return out


def scan(paths: list[Path]) -> list[Nudge]:
    """Every nudge across the given run JSONs, narration first then transcript.

    A run is read from exactly one source: `narration` when it has any nudge
    there, else the sibling transcript. Reading both would double-count a run
    that carries the transcript *and* the newer field.
    """
    found: list[Nudge] = []
    for p in paths:
        run = f"{p.parent.name}/{p.stem}"
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        from_narration = nudges_from_narration(doc, run)
        if from_narration:
            found.extend(from_narration)
            continue
        found.extend(nudges_from_transcript(p.with_suffix(".transcript.md"), run))
    return found


def format_report(nudges: list[Nudge], n_runs: int) -> str:
    if not nudges:
        return (
            "No continue-nudges found in the selected runs.\n"
            "That is a real result, not an empty one: it means every run in the\n"
            "window completed its loop without the Stop hook re-instructing it."
        )
    runs_hit = {n.run for n in nudges}
    per_run = Counter(n.run for n in nudges)
    by_seam = Counter(n.seam for n in nudges)
    by_source = Counter(n.source for n in nudges)
    worst = max(n.index for n in nudges)
    caps = {n.cap for n in nudges}

    lines = [
        f"{len(nudges)} nudge(s) across {len(runs_hit)} of {n_runs} run(s)"
        f"   sources: " + ", ".join(f"{k}={v}" for k, v in sorted(by_source.items())),
        f"worst single run reached nudge {worst}"
        + (f" against a cap of {sorted(caps)[0]}" if len(caps) == 1 else ""),
        "",
        f"{sum(1 for n in nudges if n.announced)} of {len(nudges)} named the next"
        " step in their last words — the move research/SKILL.md forbids outright.",
        "",
        "By seam — which artifact had just been written:",
    ]
    for seam, count in by_seam.most_common():
        lines.append(f"  {count:>4}  {seam}")
    lines += ["", "Runs, worst first:"]
    for run, count in per_run.most_common():
        lines.append(f"  {count:>4}  {run}")

    lines += ["", "Each nudge, with the agent's last words before it yielded:"]
    for n in sorted(nudges, key=lambda x: (x.run, x.index)):
        where = f" after {n.after_tool}" if n.after_tool else ""
        flag = " announced-next-step" if n.announced else ""
        lines.append(f"\n  {n.run}  #{n.index}/{n.cap}  [{n.seam}]{flag}{where}")
        lines.append(f"    {n.excerpt or '(no preceding narration captured)'}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Where /research yields mid-loop, over committed e2e runs (issue #1104).",
    )
    parser.add_argument("--test", default=None, help="Only this fixture slug.")
    add_since_arg(parser)
    args = parser.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        where = f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        print(f"No committed runs found{where}.", file=sys.stderr)
        return 1

    nudges = scan(paths)
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(format_report(nudges, n_runs=len(paths)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
