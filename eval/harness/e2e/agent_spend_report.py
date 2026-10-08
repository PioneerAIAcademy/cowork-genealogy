"""`make e2e-agent-spend` — what each subagent costs, and whether it is earning it.

**The question this answers.** `docs/plan/cost-latency-10x.md` is trying to cut a
median research run from $10.57 to $1.00. Its Wave 4 decides which agent gets
which model rung. That decision needs two columns per agent — what it spends and
whether it is doing well — and until #2582 the first column did not exist: the
run log counted the main thread's tokens and nothing else, so an agent's cost was
total-minus-main, a residual rather than a measurement.

The four-box rule this serves, in the owner's own words:

    spending much and doing badly  -> revisit first
    spending much and doing well   -> cut the cost, protect the quality
    spending little and doing badly -> revisit
    spending little and doing well  -> leave it alone

**What is a real join and what is only a name match.** `subagents[].usage`,
`num_assistant_turns`, `runaway_thinking` and `hit_output_cap` are recorded
against `agent_type` on the same object, so the spend and the per-agent failure
flags are a genuine join. Guardrail *violations* are not: `corpus_report` tallies
them by **rule**, not by agent, and only some rule names happen to coincide with
an agent's name. They are reported in a separate column that says so, because a
name match presented as attribution is how a confident wrong number gets quoted.

**Price basis: corpus.** Costs come from `pricing.estimate_cost_usd`, a flat
Sonnet table with cache writes at the 1-hour rate — the basis that calibrates
recorded cost to ~0.86x (`make e2e-corpus SINCE=all CALIBRATE=1` prints the
current figure and its run count). The production (5-minute) basis is ~8%
lower. State the basis next to any figure lifted out of here.

**Runs written before #2582 carry no `subagents[].usage`** and are counted as
uncovered rather than as zero, and the coverage line says how many. A zero
denominator is reported loudly: a report that cannot see its input must not print
a cheerful 0.00.

Zero API spend — pure analysis over committed run logs.
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

from e2e import pricing
from e2e.runlog_selection import all_result_jsons

USAGE_FIELDS = pricing.PRICED_FIELDS


def _load(path: Path) -> dict[str, Any] | None:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    return doc if isinstance(doc, dict) else None


def collect(paths: list[Path]) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    """`(per_agent, counters)` over every run log that can be read."""
    per_agent: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"spawns": 0, "costs": [], "turns": [], "runaway": 0, "capped": 0,
                 "tokens": dict.fromkeys(USAGE_FIELDS, 0), "runs": set()}
    )
    counters = {"runs": 0, "unreadable": 0, "runs_with_subagents": 0,
                "subagents_seen": 0, "subagents_with_usage": 0}

    for path in paths:
        doc = _load(path)
        if doc is None:
            counters["unreadable"] += 1
            continue
        counters["runs"] += 1
        subagents = doc.get("subagents")
        if not isinstance(subagents, list) or not subagents:
            continue
        counters["runs_with_subagents"] += 1
        for sub in subagents:
            if not isinstance(sub, dict):
                continue
            counters["subagents_seen"] += 1
            name = sub.get("agent_type") or "(unnamed)"
            bucket = per_agent[name]
            bucket["spawns"] += 1
            bucket["runs"].add(path.parent.name)
            if sub.get("runaway_thinking"):
                bucket["runaway"] += 1
            if sub.get("hit_output_cap"):
                bucket["capped"] += 1
            turns = sub.get("num_assistant_turns")
            if isinstance(turns, int):
                bucket["turns"].append(turns)
            usage = sub.get("usage")
            if not isinstance(usage, dict):
                continue
            counters["subagents_with_usage"] += 1
            for field in USAGE_FIELDS:
                value = usage.get(field)
                bucket["tokens"][field] += value if isinstance(value, int) else 0
            cost = pricing.estimate_cost_usd(usage)
            if cost is not None:
                bucket["costs"].append(cost)
    return per_agent, counters


def format_report(per_agent: dict[str, dict[str, Any]], counters: dict[str, int]) -> str:
    out: list[str] = []
    seen, covered = counters["subagents_seen"], counters["subagents_with_usage"]
    out.append(
        f"{counters['runs']} run(s) read, {counters['runs_with_subagents']} with "
        f"subagents; {seen} subagent spawn(s), {covered} carrying token counts."
    )
    if counters["unreadable"]:
        out.append(f"  {counters['unreadable']} run log(s) could not be read.")
    if seen == 0:
        out.append("")
        out.append("NO SUBAGENT SPAWNS FOUND — this report proves nothing. Check the")
        out.append("corpus path before reading anything into a zero.")
        return "\n".join(out)
    if covered == 0:
        out.append("")
        out.append(f"NONE of the {seen} spawn(s) carries `subagents[].usage`. Every run")
        out.append("in this corpus predates #2582, so no cost column can be computed.")
        out.append("Commit a run made after that change, then re-run this report.")
        return "\n".join(out)
    if covered < seen:
        out.append(
            f"  COVERAGE: {covered}/{seen} spawns priced "
            f"({100 * covered / seen:.0f}%). The rest predate #2582 and are counted"
            " as uncovered, never as zero."
        )

    rows = sorted(per_agent.items(), key=lambda kv: -sum(kv[1]["costs"]))
    total = sum(sum(b["costs"]) for _, b in rows) or 1.0

    out.append("")
    out.append("Spend per agent (corpus basis — flat sonnet table, 1h cache write):")
    out.append("")
    head = f"  {'agent':<26} {'spawns':>6} {'$/spawn':>9} {'$ total':>9} {'share':>6} {'turns':>6}"
    out.append(head)
    out.append("  " + "-" * (len(head) - 2))
    for name, b in rows:
        if not b["costs"]:
            out.append(f"  {name:<26} {b['spawns']:>6} {'--':>9} {'--':>9} {'--':>6}"
                       f" {'--':>6}   (no priced spawn)")
            continue
        med = statistics.median(b["costs"])
        tot = sum(b["costs"])
        turns = statistics.median(b["turns"]) if b["turns"] else 0
        out.append(
            f"  {name:<26} {b['spawns']:>6} {med:>9.3f} {tot:>9.2f}"
            f" {100 * tot / total:>5.0f}% {turns:>6.0f}"
        )

    out.append("")
    out.append("Per-agent trouble flags (a genuine join — same object as the spend):")
    out.append("")
    out.append(f"  {'agent':<26} {'runaway':>8} {'hit cap':>8}  of spawns")
    out.append("  " + "-" * 54)
    for name, b in rows:
        if not (b["runaway"] or b["capped"]):
            continue
        out.append(f"  {name:<26} {b['runaway']:>8} {b['capped']:>8}  of {b['spawns']}")
    if not any(b["runaway"] or b["capped"] for _, b in rows):
        out.append("  none — no spawn in this corpus ran away or hit its output cap.")

    out.append("")
    out.append("Guardrail violations are NOT joined here. `make e2e-corpus` tallies")
    out.append("them by RULE, not by agent; some rule names merely coincide with an")
    out.append("agent name. Read the two side by side, do not add a column.")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--test", help="one fixture slug, else the whole corpus")
    args = parser.parse_args()

    paths = all_result_jsons()
    if args.test:
        paths = [p for p in paths if p.parent.name == args.test]
        if not paths:
            print(f"No committed run logs for fixture {args.test!r}.")
            return 2
    per_agent, counters = collect(paths)
    print(format_report(per_agent, counters))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
