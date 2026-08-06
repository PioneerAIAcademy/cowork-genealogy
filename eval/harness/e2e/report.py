"""Roll-up reporter for an e2e suite invocation.

Prints compliance and cost/duration only.  Verdict-bearing lines (recall
summary, overall gate, by-tag breakdowns) are deliberately omitted — §7.4
requires blind grading, and the person who runs a fixture is usually the
same person who grades it next.  For verdict totals use ``make e2e-corpus``.
"""

from __future__ import annotations

from typing import Iterable

from e2e.result import E2eResult


def print_rollup(results: Iterable[E2eResult]) -> None:
    """Print a one-shot summary of the runs from this invocation.

    Only compliance and cost/duration are shown — verdict-bearing output is
    suppressed to preserve blind grading (spec §7.4, issue #1114).
    """
    results = list(results)
    if not results:
        print("E2E suite: no runs.")
        return

    total = len(results)

    # Compliance, always printed — §7.4 permits this axis.  A silent
    # compliance line would put us back to one number meaning two things.
    non_compliant = [r for r in results if r.compliance == "fail"]
    if non_compliant:
        names = ", ".join(r.test_id for r in non_compliant)
        print(
            f"  compliance: {total - len(non_compliant)}/{total} clean — "
            f"{len(non_compliant)} guardrail bypass ({names})"
        )
    else:
        print(f"  compliance: {total}/{total} clean")

    # Cost + duration averages from usage.
    costs = [r.usage.get("total_cost_usd") for r in results if r.usage.get("total_cost_usd")]
    durations = [r.usage.get("wall_clock_seconds") for r in results if r.usage.get("wall_clock_seconds")]
    if costs:
        avg_cost = sum(costs) / len(costs)
        total_cost = sum(costs)
        print(f"  avg cost: ${avg_cost:.2f} / run     total cost: ${total_cost:.2f}")
    if durations:
        avg_dur = sum(durations) / len(durations)
        total_dur = sum(durations)
        print(
            f"  avg wall-clock: {avg_dur / 60:.1f} min / run     "
            f"total: {total_dur / 60:.1f} min  (active; excludes system sleep)"
        )
    # Surface system sleep so an inflated real-clock never reads as a stall.
    total_slept = sum((r.usage.get("slept_seconds") or 0) for r in results)
    if total_slept > 60:
        print(
            f"  note: machine slept ~{total_slept / 60:.0f} min during run(s) — "
            "not counted above; use `caffeinate` to avoid (see e2e-run)"
        )
