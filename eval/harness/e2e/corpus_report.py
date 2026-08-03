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

**Violation detail and concentration (issue #1176).** The run-level axes above
answer "how many runs violated"; they do not answer "how many violations, of
what kind, and were they one fixture's". That gap is why the critique carried
three hand-computed windows, one of which did not reproduce under its own label,
and a hand-written "excluding <fixture>" exclusion that only described the
outlier we happened to have. Counting here instead means a future outlier
discloses itself without anyone re-deriving anything.

**Rates are printed over DECIDABLE runs only.** A rate whose denominator
includes `not_checked` silently asserts those runs were clean — the exact
inference `axes_from_runlog` refuses. Where the decidable set is empty or
degenerate the report says so rather than printing a number.

CLI (from eval/harness/):
  uv run python -m e2e.corpus_report
  uv run python -m e2e.corpus_report --test bagley-father-1884
  uv run python -m e2e.corpus_report --since 2026-07-27_20-00-00
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

from e2e.guardrail_shadow_report import all_result_jsons, result_jsons_for
from e2e.result import axes_from_runlog

VERDICT_ORDER = ("pass", "partial", "fail", "skipped")

# `run-<ts>.json`, excluding the `.ann` / `.final-*` sidecars that share the stem.
RUN_STEM = re.compile(r"^run-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})$")

# Substring → arm. Ordered: the first match wins, so a more specific probe must
# precede a more general one. Keep in sync with the detector's message text in
# `orchestrator.check_guardrail_compliance` — a message reworded there without a
# matching entry here silently lands in `other`, which is why `other` is printed
# rather than dropped.
VIOLATION_ARMS: tuple[tuple[str, str], ...] = (
    ("same_person", "same_person (per person)"),
    ("research-exhaustiveness", "exhaustiveness"),
    ("proof-conclusion", "proof-conclusion"),
    ("conflict-resolution", "conflict-resolution"),
)


def run_timestamp(path: Path) -> str | None:
    """The run's timestamp, or None if `path` is a sidecar rather than a run."""
    m = RUN_STEM.match(path.stem)
    return m.group(1) if m else None


def violations_of(data: dict) -> list[str]:
    """Bypass violations from a runlog of either vintage.

    v1+ carries the list at the top level; pre-v1 carries it under
    `judge_output`. Absent in both is NOT the same as empty — see
    `axes_from_runlog`, which maps that case to `not_checked`.
    """
    top = data.get("guardrail_bypass_violations")
    if isinstance(top, list):
        return [str(v) for v in top]
    nested = (data.get("judge_output") or {}).get("guardrail_bypass_violations")
    return [str(v) for v in nested] if isinstance(nested, list) else []


def classify(violation: str) -> str:
    for probe, arm in VIOLATION_ARMS:
        if probe in violation:
            return arm
    return "other"


def tally(
    paths: list[Path],
) -> tuple[Counter, Counter, Counter, list[str], Counter, Counter]:
    """(recall, compliance, gate, problems, arms, per_fixture) over the files.

    `arms` counts individual violations by kind; `per_fixture` counts them by
    fixture slug (the run's parent directory). Both are empty for a corpus with
    no recorded violations.
    """
    recall: Counter = Counter()
    compliance: Counter = Counter()
    gate: Counter = Counter()
    arms: Counter = Counter()
    per_fixture: Counter = Counter()
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
        violations = violations_of(data)
        per_fixture[path.parent.name] += len(violations)
        for violation in violations:
            arms[classify(violation)] += 1
    return recall, compliance, gate, problems, arms, per_fixture


def _counts(c: Counter, order: tuple[str, ...]) -> str:
    parts = [f"{c[k]} {k}" for k in order if c.get(k)]
    for k in sorted(set(c) - set(order)):
        parts.append(f"{c[k]} {k}")
    return " / ".join(parts) if parts else "(none)"


def _compliance_rate_line(compliance: Counter) -> str:
    """The rate, or an explicit refusal to state one.

    A percentage over `pass + fail + not_checked` would assert that every
    unknown ran clean. Where the decidable set is empty (or all-one-way) that
    assertion is doing all the work, so say what is known instead of dressing
    it as a rate.
    """
    ok, bad = compliance.get("pass", 0), compliance.get("fail", 0)
    decidable = ok + bad
    if decidable == 0:
        return (
            "  violation rate:     NOT MEASURABLE — no run in this window has a "
            "decidable\n                      compliance axis."
        )
    if ok == 0:
        return (
            f"  violation rate:     {bad}/{decidable} of DECIDABLE runs (100%) — but no run is "
            f"known\n                      clean, so this is a floor on incidence, not a rate."
        )
    return f"  violation rate:     {bad}/{decidable} of decidable runs ({bad / decidable:.0%})"


def _concentration_lines(per_fixture: Counter, total: int) -> list[str]:
    """Top contributors, so a dominant fixture cannot hide inside an average."""
    if not total:
        return []
    lines = ["  concentration:"]
    for slug, n in per_fixture.most_common(3):
        if not n:
            continue
        lines.append(f"    {slug:34} {n:3}  ({n / total:.0%} of all violations)")
    top_slug, top_n = per_fixture.most_common(1)[0]
    if top_n / total >= 0.5:
        lines.append(
            f"    NOTE: `{top_slug}` alone accounts for {top_n / total:.0%} of violations. "
            f"Any\n          headline rate is substantially this one fixture's behavior."
        )
    return lines


def format_report(
    recall: Counter,
    compliance: Counter,
    gate: Counter,
    *,
    n_runs: int,
    arms: Counter | None = None,
    per_fixture: Counter | None = None,
    since: str | None = None,
) -> str:
    not_checked = compliance.get("not_checked", 0)
    scope = f"{n_runs} committed run(s)"
    if since:
        scope += f" since {since}"
    lines = [
        scope,
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
    arms = arms or Counter()
    total_violations = sum(arms.values())
    if total_violations:
        lines.append(f"  violations:         {total_violations} across {n_runs} run(s)")
        for arm, n in arms.most_common():
            lines.append(f"    {arm:34} {n:3}")
        lines.extend(_concentration_lines(per_fixture or Counter(), total_violations))
    lines.append(_compliance_rate_line(compliance))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Three-axis totals over committed e2e runs (issue #972)."
    )
    ap.add_argument("--test", help="restrict to one fixture slug")
    ap.add_argument(
        "--since",
        metavar="YYYY-MM-DD_HH-MM-SS",
        help=(
            "only runs at or after this timestamp. Use it to scope to a "
            "detector's ship date rather than hand-editing a window into prose."
        ),
    )
    args = ap.parse_args(argv)

    paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    if args.since:
        # A sidecar has no run timestamp; excluding it here also keeps the
        # unfiltered and filtered denominators comparable.
        paths = [p for p in paths if (ts := run_timestamp(p)) and ts >= args.since]
    if not paths:
        print("No committed runs found.", file=sys.stderr)
        return 1

    recall, compliance, gate, problems, arms, per_fixture = tally(paths)
    print(
        format_report(
            recall,
            compliance,
            gate,
            n_runs=len(paths),
            arms=arms,
            per_fixture=per_fixture,
            since=args.since,
        )
    )
    for problem in problems:
        print(f"  skip {problem}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
