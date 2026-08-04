"""Three-axis totals across every committed e2e run.

GitHub issue #972: "Aggregate pass rate is our cheapest signal and it is
currently uninterpretable." `report.py`'s roll-up cannot supply it — its only
production caller is `run_e2e.py`, which runs one fixture per invocation by
design, so it never sees more than a single result. This module reads the
committed history instead.

Adds NO instrumentation to a run (same posture as `latency_report.py` and
`guardrail_shadow_report.py`); it is pure analysis over already-committed data,
so it costs nothing to run.

Every run resolves through `e2e.result.axes_from_runlog`, which is what makes
the pre-#972 corpus readable at all: a run whose guardrail check fired had its
top-level `verdict` overwritten to "fail", and the real genealogical verdict
survives only inside `judge_output`.

**`not_checked` is never counted as clean.** 122 of the committed runs were
written before the §4.4 detector existed or by a version of it we cannot pin,
so their compliance is genuinely unknown. Folding those into a pass count
would reinstate, one field over, exactly the uninterpretable aggregate this
issue was filed about.

CLI (from eval/harness/):
  uv run python -m e2e.corpus_report
  uv run python -m e2e.corpus_report --test bagley-father-1884
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from e2e.guardrail_shadow_report import all_result_jsons, result_jsons_for
from e2e.result import axes_from_runlog

VERDICT_ORDER = ("pass", "partial", "fail", "skipped")


def tally(paths: list[Path]) -> tuple[Counter, Counter, Counter, list[str]]:
    """(recall, compliance, gate, problems) over the given result files."""
    recall: Counter = Counter()
    compliance: Counter = Counter()
    gate: Counter = Counter()
    problems: list[str] = []
    for path in paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            problems.append(f"{path}: {e}")
            continue
        verdict, compliance_axis, outcome = axes_from_runlog(data)
        recall[verdict] += 1
        compliance[compliance_axis] += 1
        gate[outcome] += 1
    return recall, compliance, gate, problems


def _counts(c: Counter, order: tuple[str, ...]) -> str:
    parts = [f"{c[k]} {k}" for k in order if c.get(k)]
    for k in sorted(set(c) - set(order)):
        parts.append(f"{c[k]} {k}")
    return " / ".join(parts) if parts else "(none)"


def format_report(
    recall: Counter, compliance: Counter, gate: Counter, *, n_runs: int
) -> str:
    not_checked = compliance.get("not_checked", 0)
    lines = [
        f"{n_runs} committed run(s)",
        f"  recall (genealogy): {_counts(recall, VERDICT_ORDER)}",
        f"  compliance:         {_counts(compliance, ('pass', 'fail', 'not_checked'))}",
        f"  gate (outcome):     {_counts(gate, VERDICT_ORDER)}",
    ]
    if not_checked:
        lines.append(
            f"  NOTE: {not_checked} run(s) have unknown compliance — written before "
            "the guardrail\n        detector existed, or by a version of it that "
            "cannot be pinned. They are\n        NOT counted as clean. See "
            "e2e.result.axes_from_runlog."
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Three-axis totals over committed e2e runs (issue #972)."
    )
    ap.add_argument("--test", help="restrict to one fixture slug")
    args = ap.parse_args(argv)

    paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    if not paths:
        print("No committed runs found.", file=sys.stderr)
        return 1

    recall, compliance, gate, problems = tally(paths)
    print(format_report(recall, compliance, gate, n_runs=len(paths)))
    for problem in problems:
        print(f"  skip {problem}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
