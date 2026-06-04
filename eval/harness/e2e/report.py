"""Roll-up reporter for an e2e suite invocation.

Skeleton stub. With one fixture, the "roll-up" is one line. The
real per-tag breakdown lands when there are enough fixtures to make
it useful (build order step 9).
"""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from e2e.result import E2eResult


def print_rollup(results: Iterable[E2eResult]) -> None:
    """Print a one-shot summary of the runs from this invocation.

    Skeleton: total counts, per-tag breakdown, average cost + duration.
    No persistence — devs read the committed runlogs for history.
    """
    results = list(results)
    if not results:
        print("E2E suite: no runs.")
        return

    total = len(results)
    passes = sum(1 for r in results if r.verdict == "pass")
    partials = sum(1 for r in results if r.verdict == "partial")
    fails = sum(1 for r in results if r.verdict == "fail")
    skipped = sum(1 for r in results if r.verdict == "skipped")

    summary = f"E2E suite: {passes}/{total} passed"
    if partials:
        summary += f", {partials} partial"
    if fails:
        summary += f", {fails} fail"
    if skipped:
        summary += f", {skipped} skipped"
    print(summary)

    # By-tag breakdowns. Collect tag-dimension → tag-value → counts.
    by_dim: dict[str, dict[str, dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: {"pass": 0, "partial": 0, "fail": 0, "skipped": 0, "total": 0})
    )
    for r in results:
        for dim, value in (r.tags or {}).items():
            bucket = by_dim[dim][value]
            bucket["total"] += 1
            bucket[r.verdict] = bucket.get(r.verdict, 0) + 1

    for dim, values in by_dim.items():
        parts = []
        for value, bucket in sorted(values.items()):
            parts.append(f"{value} {bucket['pass']}/{bucket['total']}")
        print(f"  by {dim:<15} {'  '.join(parts)}")

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
        print(f"  avg wall-clock: {avg_dur / 60:.1f} min / run     total: {total_dur / 60:.1f} min")
