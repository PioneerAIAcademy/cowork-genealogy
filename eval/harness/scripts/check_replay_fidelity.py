"""Acceptance check for `harness/replay.py`, over the committed e2e corpus.

Replays every committed run from its fixture's `starting-research.json` and
compares the reconstruction against that run's own `run-<ts>.final-research.json`
sidecar. If the engine cannot reproduce known-good endings, nothing built on it
can be believed — and several things are meant to be: the "would a gate have
refused this write, at the moment it was made" question, both halves of the
guardrail-detector corpus replay, and the violation recompute.

**Compared by the SET OF ENTRY IDS per section, not by deep equality.** The real
tool also stamps timestamps, resolves places and heals shapes, none of which a
replay of arguments can or should reproduce. Ids are what every consumer joins
on, so id fidelity is the property that matters.

This is a *report*, not a pass/fail gate: the corpus grows weekly and the
reconstruction rate moves with it. Run it after any change to `replay.py` and
compare against the recorded baseline below.

    Baseline, 2026-08-15, 154 runs — SUPERSEDED, see below:
      exact id match on all 12 sections : 136 (88%)
      1-2 sections differ               :  13
      3+ sections differ                :   5
      per-section exact-match rate      : 94-100%

Two ledger properties bound this permanently and are why it is not 100%:
responses are truncated mid-JSON (~1,600 of ~4,800), and a large batch reports
only `_first_n` entry ids, so **the ledger never recorded every id the tool
assigned**. Ids past the cut are reconstructed by the tool's sequential
convention and counted in `ReplayResult.synthesised_ids`.

Usage:  make replay-check
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "eval" / "harness"))

from harness.replay import replay  # noqa: E402

RUN_RE = re.compile(r"run-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$")
SECTIONS = [
    "questions", "plans", "log", "sources", "assertions",
    "person_evidence", "conflicts", "hypotheses", "timelines",
    "proof_summaries", "evaluations", "localities",
]


def ids(doc: dict, section: str) -> set:
    v = doc.get(section)
    return {e.get("id") for e in v if isinstance(e, dict)} if isinstance(v, list) else set()


def main() -> int:
    runs = sorted(
        p for p in (REPO / "eval/runlogs/e2e").glob("*/run-*.json") if RUN_RE.search(p.name)
    )
    exact = partial = failed = skipped = 0
    per_section: Counter = Counter()
    per_section_total: Counter = Counter()
    unmodelled: Counter = Counter()
    totals = {"applied": 0, "rejected": 0, "unparseable": 0, "synthesised_ids": 0}

    for path in runs:
        final_p = path.with_name(path.name[:-5] + ".final-research.json")
        if not final_p.exists():
            skipped += 1
            continue
        try:
            log = json.loads(path.read_text(encoding="utf-8"))
            final = json.loads(final_p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            skipped += 1
            continue

        start_p = REPO / "eval/tests/e2e" / path.parent.name / "starting-research.json"
        start = None
        if start_p.exists():
            try:
                start = json.loads(start_p.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                start = None

        r = replay(log.get("tool_calls") or [], starting_research=start)
        for k in totals:
            totals[k] += getattr(r, k)
        for k, n in r.unmodelled.items():
            unmodelled[k] += n

        differing = 0
        for sec in SECTIONS:
            per_section_total[sec] += 1
            if ids(final, sec) == ids(r.research, sec):
                per_section[sec] += 1
            else:
                differing += 1
        if differing == 0:
            exact += 1
        elif differing <= 2:
            partial += 1
        else:
            failed += 1

    n = exact + partial + failed
    pct = (100 * exact // n) if n else 0
    print(f"runs replayed: {n}   (skipped, no sidecar: {skipped})")
    print(f"  EXACT id match on all {len(SECTIONS)} sections : {exact}  ({pct}%)")
    print(f"  1-2 sections differ                : {partial}")
    print(f"  3+ sections differ                 : {failed}")
    print(
        f"\nops: applied={totals['applied']} rejected={totals['rejected']} "
        f"unparseable={totals['unparseable']} synthesised_ids={totals['synthesised_ids']}"
    )
    print("\nper-section exact-match rate:")
    for sec in SECTIONS:
        t = per_section_total[sec]
        if t:
            print(f"  {sec:16s} {per_section[sec]:4d}/{t}  ({100 * per_section[sec] // t}%)")
    if unmodelled:
        print("\nunmodelled (the coverage gap, reported rather than hidden):")
        for k, v in unmodelled.most_common(12):
            print(f"  {v:5d}  {k}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
