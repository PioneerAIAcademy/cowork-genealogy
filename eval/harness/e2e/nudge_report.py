"""How `/research` hands back at a step boundary, over committed e2e runs.

GitHub issues #1104 and #2328. The `/research` skill must run until
`project.status == "completed"`, and it is *meant* to yield at every step
boundary — naming the next step and asking whether to do it (#2292). In an e2e
run the harness IS the user, so a yield is not a defect: a well-formed hand-back
gets answered "Yes." Two things at a yield still are defects — a **silent stop**
(the turn ends naming no next step) and a **false completion claim** (it claims
done while `project.status != "completed"`).

So the question this report answers is not "how often does it yield" but "how
does it hand back", via `classify_hand_back` — the same predicate the Stop hook
grades with, so the report and the run cannot disagree.

This report answers "where does it yield" from already-committed data: no live
run, no model, no API spend — same posture as `corpus_report.py`,
`latency_report.py` and `agent_tool_usage_report.py`.

## Why the seam still matters

`orchestrator.py` records the count in `usage.continue_nudges`, so totals were
always available. What was not available is *where* and *in what form*. The seam
says which artifact had just been written, and therefore which skill's closing
prose to look at; the hand-back class says whether that prose did its job.

`step` reads 0 until #2292 lands the hand-back prose in `research/SKILL.md` —
that is the correct result, not a broken classifier. Until then every yield is
`silent`, and that figure is the pre-#2292 floor the post-#2292 `step` share is
read against.

## Two sources

Nudges are recoverable two ways:

1. **`narration[]`** — entries `{tool_calls_before, kind, text}`, where a nudge is
   `kind == "harness"` and the text opens `continue-nudge N/M:`. `tool_calls_before`
   indexes `tool_calls[]`, so the tool call the agent yielded *after* is
   `tool_calls[tool_calls_before - 1]`. This is the richer source: it gives the
   seam directly rather than inferring it from prose.
2. **`<run>.transcript.md`** — the older format, `**[HARNESS]** continue-nudge N/M:`
   preceded by the assistant's own prose. No tool markers, so the seam is read
   from what the agent said it was doing.

`narration` replaced the transcript in #1238 (2026-08-04) and is now the sole
source. The committed `.transcript.md` files were removed in PR #2204 — they
were zombie re-lands from stale-base merges (issue #1342). The transcript
fallback code path is retained for any local copies that may still exist on
developer machines.

## Coverage is still sparse

`narration` is not retained for most runs. `usage.continue_nudges` records **294
nudges across 123 of the committed runs**; only **25** of those carry a narration
nudge entry, because `narration` started recently. So the seam and hand-back
histograms are a sample and never a census. (Re-derive with
`make e2e-nudges SINCE=all`; the corpus churns and a pasted-forward figure is the
defect this module exists to report on.)

`counter_totals()` reads that counter so every report states the gap, and so the
no-results branch cannot claim a clean loop over runs it simply could not read.
Widening coverage means retaining a source, not parsing harder.
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
    branch_scope_note,
    describe_window,
    filter_since,
    result_jsons_for,
)
from e2e.stop_checker import classify_hand_back

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

# The HAND-BACK axis. One predicate, defined once: `classify_hand_back` in
# stop_checker.py is what the harness itself uses at the Stop hook, so the report
# grades against the same rule the run was graded by. The former ANNOUNCE_RE lived
# here and matched free prose — which called 31 of 71 yields "announced" where the
# harness classifies every one of them `silent`. A report keyed on a predicate the
# harness does not use is a report about nothing.
#
# `step` is structurally 0 until #2292 lands the hand-back prose. That is the correct
# reading, not a broken classifier.


class Nudge(NamedTuple):
    """One observed yield, with whatever context its source could supply."""

    run: str          # "<fixture>/<run stem>"
    index: int        # the N in "continue-nudge N/M"
    cap: int          # the M
    source: str       # "narration" | "transcript"
    after_tool: str   # the tool call it yielded after, or "" when unknown
    excerpt: str      # the agent's last words before yielding
    seam: str
    hand_back: str    # "step" | "silent" | "completion_claim" (classify_hand_back)


def classify(excerpt: str, after_tool: str, full_text: str | None = None) -> tuple[str, str]:
    """(seam, hand_back_class) for one yield. Seam is `other` when nothing matches.

    `full_text` is the UNTRUNCATED narration text. `excerpt` is cut to the last
    EXCERPT_CHARS for printing, and `classify_hand_back`'s "Next: " containment test
    does not survive a suffix cut — a hand-back whose step description sits more than
    240 characters from the end would read `step` in the orchestrator and `silent`
    here. Classify the whole text; print the tail.
    """
    haystack = f"{excerpt} {after_tool}"
    seam = "other"
    for name, pattern in SEAMS:
        if pattern.search(haystack):
            seam = name
            break
    return seam, classify_hand_back(full_text if full_text is not None else excerpt)


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
        # Mirror the orchestrator's selection EXACTLY (orchestrator.py stop_hook):
        # the nearest non-harness entry, and only when no tool call landed after it.
        # Sharing classify_hand_back does not by itself make the two agree — 2 of the
        # 71 committed narration nudges have tool calls between the last assistant
        # text and the nudge, and those must read `silent` on both sides.
        excerpt = ""
        full_text = ""
        before = entry.get("tool_calls_before")
        for prev in reversed(narration[:i]):
            if (prev or {}).get("kind") in ("harness", "blocked"):
                continue
            if prev.get("tool_calls_before") == before:
                full_text = prev.get("text") or ""
                excerpt = _tail(full_text)
            break
        before = entry.get("tool_calls_before")
        after_tool = ""
        if isinstance(before, int) and 0 < before <= len(tool_calls):
            after_tool = str((tool_calls[before - 1] or {}).get("tool") or "")
        out.append(
            Nudge(run, int(m.group(1)), int(m.group(2)), "narration",
                  after_tool, excerpt, *classify(excerpt, after_tool, full_text))
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


def tool_call_total(paths: list[Path]) -> int:
    """Total tool calls across the scanned runs — the denominator for a rate.

    A flat count of hand-backs is not comparable between a 40-call run and a
    400-call one, which is what the pre-registered baseline is read against.
    Unreadable runs contribute 0 rather than aborting: the report already states
    its attribution gap and a rate that silently skips runs is worse than one
    whose denominator is honestly smaller.
    """
    total = 0
    for p in paths:
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        total += len(doc.get("tool_calls") or [])
    return total


def counter_totals(paths: list[Path]) -> tuple[int, int]:
    """(events, runs) from `usage.continue_nudges` — the orchestrator's own tally.

    Every nudge lands there whether or not a narration entry or a transcript
    survives to say WHERE it happened, and across the committed corpus most do
    not: 98 of the 123 nudged runs carry neither source. That makes this the
    denominator the seam histogram is a sample of. Without it an unreadable run
    is indistinguishable from a clean one, and the report says "every run
    completed its loop" over a fixture that nudged sixteen times.
    """
    events = runs = 0
    for p in paths:
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        n = (doc.get("usage") or {}).get("continue_nudges") or 0
        if n:
            events += n
            runs += 1
    return events, runs


def format_report(nudges: list[Nudge], n_runs: int, recorded: tuple[int, int] = (0, 0),
                  tool_calls_total: int = 0) -> str:
    rec_events, rec_runs = recorded
    if not nudges:
        if rec_events:
            return (
                f"{rec_events} nudge(s) in {rec_runs} of {n_runs} run(s) per\n"
                "usage.continue_nudges, and NOT ONE is attributable: no run in this\n"
                "window carries a narration nudge or a .transcript.md sibling, so\n"
                "this report can say nothing about where they happened."
            )
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
        f"ATTRIBUTED {len(nudges)} of the {rec_events} that usage.continue_nudges"
        f" recorded; {rec_runs - len(runs_hit)} nudged run(s) carry neither a"
        " narration nudge nor a transcript, so every count below is a sample and"
        " not the population.",
        f"worst single run reached nudge {worst}"
        + (f" against a cap of {sorted(caps)[0]}" if len(caps) == 1 else ""),
        "",
        "By hand-back class — a well-formed `Next: <step>. Continue?` is the CORRECT"
        " move (#2292); `silent` is a stall:",
        *(
            f"  {sum(1 for n in nudges if n.hand_back == k):>4}  {k}"
            + (
                f"   ({sum(1 for n in nudges if n.hand_back == k) * 100 / tool_calls_total:.2f}"
                " per 100 tool calls)"
                if tool_calls_total
                else ""
            )
            for k in ("step", "silent", "completion_claim")
        ),
        (
            f"  over {tool_calls_total} tool call(s) in the scanned runs"
            if tool_calls_total
            else "  (no tool calls counted — rates omitted)"
        ),
        "  (step is 0 until #2292 lands the hand-back prose — that is expected)",
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
        flag = f" {n.hand_back}"
        lines.append(f"\n  {n.run}  #{n.index}/{n.cap}  [{n.seam}]{flag}{where}")
        lines.append(f"    {n.excerpt or '(no preceding narration captured)'}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="How /research hands back at a step boundary, over committed e2e runs (issues #1104, #2328).",
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
        print(branch_scope_note(), file=sys.stderr)
        return 1

    nudges = scan(paths)
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(format_report(nudges, n_runs=len(paths), recorded=counter_totals(paths),
                        tool_calls_total=tool_call_total(paths)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
