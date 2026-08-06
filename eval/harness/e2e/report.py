"""Roll-up reporter for an e2e suite invocation.

Skeleton stub. With one fixture, the "roll-up" is one line. The
real per-tag breakdown lands when there are enough fixtures to make
it useful (build order step 9).
"""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from e2e.result import E2eResult

# The verdict vocabulary this reporter knows how to render. Kept here as one
# name so the per-tag buckets and any future tally seed from the same list
# instead of re-typing a literal that then drifts (issue #1245).
#
# `skipped` is the harness's own value for a run that produced nothing to grade
# (spec §7.2); `ungraded` is #1239's narrower "judge raised while a tree
# existed" case. A new ungradeable verdict must go in **both** tuples:
# KNOWN_VERDICTS seeds the bucket keys, and UNGRADED_VERDICTS is summed with
# `if v in bucket` — so adding it to the second alone sums zero and prints every
# such run as "unrecognised" instead.
KNOWN_VERDICTS = ("pass", "partial", "fail", "ungraded", "skipped")

# The subset that means "this run produced no grade". NOT failures, and the
# whole point of #1245: 19 ungraded runs reported as 19 failures is a claim
# about genealogy that the harness never actually made.
UNGRADED_VERDICTS = ("ungraded", "skipped")


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
    ungraded = sum(1 for r in results if r.verdict == "ungraded")
    skipped = sum(1 for r in results if r.verdict == "skipped")
    # A verdict this module does not know. Counted at the HEADLINE, not only in
    # the per-tag loop below: an untagged run never reaches that loop, so an
    # unreadable verdict would leave `0/1 recall pass` and no other trace, which
    # is the same silent non-reconciliation issue #1245 is about.
    unrecognised = sum(1 for r in results if r.verdict not in KNOWN_VERDICTS)

    # The recall line counts the GENEALOGICAL verdict only. It is labelled as
    # such because it is no longer the whole story: a run can recover the
    # answer perfectly and still fail the gate on compliance (issue #972).
    summary = f"E2E suite: {passes}/{total} recall pass"
    if partials:
        summary += f", {partials} partial"
    if fails:
        summary += f", {fails} fail"
    if ungraded:
        summary += f", {ungraded} ungraded"
    if skipped:
        summary += f", {skipped} skipped"
    if unrecognised:
        summary += f", {unrecognised} unrecognised"
    print(summary)

    # Compliance + the combined gate, always printed — a silent compliance
    # line would put us right back to one number that means two things.
    non_compliant = [r for r in results if r.compliance == "fail"]
    if non_compliant:
        names = ", ".join(r.test_id for r in non_compliant)
        print(
            f"  compliance: {total - len(non_compliant)}/{total} clean — "
            f"{len(non_compliant)} guardrail bypass ({names})"
        )
    else:
        print(f"  compliance: {total}/{total} clean")

    gate_pass = sum(1 for r in results if r.outcome == "pass")
    print(f"  overall gate: {gate_pass}/{total} pass")

    # By-tag breakdowns. Collect tag-dimension → tag-value → counts.
    #
    # Seeded from KNOWN_VERDICTS rather than a literal, and anything outside it
    # lands in `other` — which IS printed. `verdict` reaches us as whatever
    # string the judge returned (`orchestrator.py`: `str(judge_output.get(
    # "verdict") or "fail")`), so an unrecognised value is reachable, and the
    # previous `bucket.get(v, 0) + 1` filed it under a key nothing rendered.
    # A tally that silently fails to reconcile is the #1245 defect in miniature.
    by_dim: dict[str, dict[str, dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: {k: 0 for k in (*KNOWN_VERDICTS, "other", "total")})
    )
    for r in results:
        for dim, value in (r.tags or {}).items():
            bucket = by_dim[dim][value]
            bucket["total"] += 1
            bucket[r.verdict if r.verdict in KNOWN_VERDICTS else "other"] += 1

    for dim, values in by_dim.items():
        parts = []
        for value, bucket in sorted(values.items()):
            # Ungradeable runs are named, not folded into the denominator's
            # silence: "3/8" with 5 ungraded reads as five genealogical
            # failures, which is the miscount acceptance criterion 4 asks about.
            ungradeable = sum(bucket[v] for v in UNGRADED_VERDICTS if v in bucket)
            suffix = f" ({ungradeable} ungraded)" if ungradeable else ""
            if bucket["other"]:
                suffix += f" ({bucket['other']} unrecognised)"
            parts.append(f"{value} {bucket['pass']}/{bucket['total']}{suffix}")
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
