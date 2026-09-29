"""Derive the narration figures the later-phases plan builds on (R7).

Pure analysis over committed e2e run logs -- no live run, no API.

Four numbers in `docs/plan/research-as-a-job-later.md` decide design and none of
them could be recomputed, which is how PR #2870's corpus figures drifted as the
corpus grew. This derives the three that live in the narration capture:

  L166  share of assistant paragraphs that follow NO research_log_append
        (decides "anchor to the step, not the log entry")
  L-plan median minutes into a run at which `Skill:research-plan` first lands
  L-open share of paragraphs opening "Now..." / "Let me..."
        (decides whether the between-actions rule survives)
  L-yield share of runs that NEVER yield, and the median nudges per run
        (decides whether a contract may ride the Stop hook at all)

The fourth -- the identifier validator's refusal rate -- is not in this capture
and is not derived here; see the plan's R7 note.

A run only carries `narration` if it was captured after that field shipped, so
the denominator is reported rather than assumed. A scan that examines zero runs
proves nothing and exits non-zero rather than printing a cheerful 0%.
"""

from __future__ import annotations

import json
import re
import statistics
import sys
from pathlib import Path

LOG_WRITE = "mcp__genealogy__research_log_append"
PLAN_SKILL = "Skill:research-plan"
# Anchored at the paragraph's first character: an opener is how the paragraph
# STARTS, not a phrase it happens to contain further in.
OPENER = re.compile(r"^\s*(?:now\b|let me\b|let's\b)", re.IGNORECASE)


def _runs(root: Path):
    for p in sorted(root.glob("*/run-*.json")):
        if p.name.endswith(".ann.json") or ".final-" in p.name:
            continue
        try:
            yield p, json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue


def derive(root: Path) -> dict:
    runs_total = runs_with_narration = 0
    paras = no_log_write = openers = 0
    plan_minutes: list[float] = []
    # Runs carrying `usage.continue_nudges` at all, and how many of those never
    # yielded. Kept separate because "no counter" and "zero nudges" are different
    # facts and collapsing them silently inflates or deflates the share.
    nudge_counts: list[int] = []

    for _path, doc in _runs(root):
        runs_total += 1
        # The timeline figure does NOT depend on the narration capture, so it is
        # derived before the narration guard -- gating it on narration silently
        # narrows its denominator to the runs that happen to carry paragraphs.
        timeline = (doc.get("usage") or {}).get("timeline") or []
        for row in timeline:
            if len(row) > 2 and row[2] and PLAN_SKILL in row[2]:
                plan_minutes.append(float(row[0]) / 60.0)
                break

        nudges = (doc.get("usage") or {}).get("continue_nudges")
        if isinstance(nudges, int):
            nudge_counts.append(nudges)

        narration = doc.get("narration")
        if not narration:
            continue
        runs_with_narration += 1

        calls = doc.get("tool_calls") or []
        prev_idx = 0
        for entry in narration:
            if entry.get("kind") != "assistant":
                continue
            idx = entry.get("tool_calls_before")
            text = entry.get("text") or ""
            paras += 1
            if OPENER.match(text):
                openers += 1
            # Calls made since the previous paragraph. A non-int index means the
            # capture cannot place this paragraph, so it is not counted either way.
            if isinstance(idx, int):
                window = calls[prev_idx:idx]
                if not any((c.get("tool") or "") == LOG_WRITE for c in window):
                    no_log_write += 1
                prev_idx = idx

    return {
        "runs_total": runs_total,
        "runs_with_narration": runs_with_narration,
        "paragraphs": paras,
        "no_log_write": no_log_write,
        "openers": openers,
        "plan_minutes": plan_minutes,
        "nudge_counts": nudge_counts,
    }


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path("eval/runlogs/e2e")
    if not root.is_dir():
        print(f"ERROR: no e2e runlog directory at {root}", file=sys.stderr)
        return 2
    r = derive(root)

    print("Narration figures (R7) -- derived, no API")
    print(f"  runs examined ............ {r['runs_total']}")
    print(f"  runs carrying narration .. {r['runs_with_narration']}")
    print(f"  assistant paragraphs ..... {r['paragraphs']}")
    print()

    if r["runs_with_narration"] == 0 or r["paragraphs"] == 0:
        print("ERROR: zero paragraphs examined -- this scan proves nothing.", file=sys.stderr)
        return 2

    pct_no_log = 100.0 * r["no_log_write"] / r["paragraphs"]
    pct_open = 100.0 * r["openers"] / r["paragraphs"]
    print(f"  L166   paragraphs following NO log write .. {pct_no_log:5.1f}%  "
          f"({r['no_log_write']}/{r['paragraphs']})")
    print(f"  L-open paragraphs opening Now/Let me ..... {pct_open:5.1f}%  "
          f"({r['openers']}/{r['paragraphs']})")
    if r["plan_minutes"]:
        med = statistics.median(r["plan_minutes"])
        print(f"  L-plan research-plan lands at median ..... {med:5.1f} min  "
              f"(n={len(r['plan_minutes'])} runs)")
    else:
        print("  L-plan research-plan lands at median ..... NOT MEASURED "
              "(no run's timeline names Skill:research-plan)")

    nc = r["nudge_counts"]
    if nc:
        never = sum(1 for n in nc if n == 0)
        print(f"  L-yield runs that NEVER yield ............ {100.0 * never / len(nc):5.1f}%  "
              f"({never}/{len(nc)} runs carrying the counter, of {r['runs_total']} total)")
        print(f"  L-yield median nudges per run ............ {statistics.median(nc):5.1f}")
    else:
        print("  L-yield runs that NEVER yield ............ NOT MEASURED "
              "(no run carries usage.continue_nudges)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
