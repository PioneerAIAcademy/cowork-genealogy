"""Three-axis totals + violation detail across every committed e2e run.

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
degenerate the report says so rather than printing a number. The same rule binds
the violation total: it is stated across decidable runs, because a `not_checked`
run's violations field is absent and so it cannot contribute one.

**Bash access to the protected files.** The raw-write lockdown
(`docs/specs/guardrail-enforcement-spec.md` §6) covers `Write` / `Edit` /
`NotebookEdit` and deliberately not `Bash`: the skills run their stdlib scripts
through the shell, and matching command text would deny a legitimate
`python script.py research.json > out` while still missing a variable-built
path. Its stated close-condition is "close this if a bypass appears in a
runlog" — and nothing watched for one. This report counts them, splitting
*write-shaped* commands out of the mostly-read traffic. Write-**shaped**, not
write-proven: the classifier reads command text, which is exactly the inference
§6 refuses to make a DENY on. Here it only decides what a human reads, so a
false positive costs a glance and a false negative is bounded by the total
sitting next to it.

CLI (from eval/harness/):
  uv run python -m e2e.corpus_report                        # last 14 days
  uv run python -m e2e.corpus_report --since all            # whole corpus
  uv run python -m e2e.corpus_report --since 2026-07-27     # detector ship date
  uv run python -m e2e.corpus_report --test bagley-father-1884
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
from e2e.result import axes_from_runlog

VERDICT_ORDER = ("pass", "partial", "fail", "ungraded", "skipped")

# How many fixtures the concentration block names individually. The remainder is
# summarised on one line rather than dropped — see `_concentration_lines`.
TOP_CONTRIBUTORS = 3

# Substring → arm. Ordered: the first match wins, so a more specific probe must
# precede a more general one. Keep in sync with the detector's message text in
# `orchestrator.check_guardrail_compliance` — a message reworded there without a
# matching entry here silently lands in `other`, which is why `other` is printed
# rather than dropped. `other` therefore means DRIFT, and every arm the detector
# can currently emit is mapped: `test_every_live_detector_message_maps_to_a_named_arm`
# drives the real detectors and fails if one is missing.
#
# `person-evidence` is safe after `same_person` because the same_person arm's
# message spells it `person_evidence` (underscore), never hyphenated.
VIOLATION_ARMS: tuple[tuple[str, str], ...] = (
    ("same_person", "same_person (per person)"),
    ("research-exhaustiveness", "exhaustiveness"),
    ("proof-conclusion", "proof-conclusion"),
    ("conflict-resolution", "conflict-resolution"),
    ("person-evidence", "person-evidence (no link)"),
    ("proof-critique", "mentor verdict"),
)


# The files §6 protects, named for the census rather than spelled
# `PROTECTED_PROJECT_FILES`. That name belongs to the three ENFORCEMENT copies,
# which `tests/unit/test_write_lockdown_parity.py` holds to a shared behavioural
# contract; this module denies nothing and has no predicate to compare, so
# registering it there would be false and leaving it unregistered would trip
# that test's "no unregistered copy" rule. Kept in step with the real constant
# by `test_the_census_watches_the_files_the_lockdown_protects`.
WATCHED_PROJECT_FILES = ("research.json", "tree.gedcomx.json")

_PROTECTED_RE = "|".join(re.escape(f) for f in WATCHED_PROJECT_FILES)

# Ordered `(label, pattern)`; the first match names the shape. Each pattern
# either targets a protected path directly (redirect, tee, mv/cp) or is a
# whole-command write verb that only gets here because the command already
# named a protected file (`sed -i`, a Python write mode).
WRITE_SHAPES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("redirect", re.compile(rf">>?\s*[^\s|;&]*(?:{_PROTECTED_RE})")),
    ("tee", re.compile(rf"\btee\b[^|;&]*(?:{_PROTECTED_RE})")),
    ("mv/cp", re.compile(rf"\b(?:mv|cp|install|dd|truncate)\b[^|;&]*(?:{_PROTECTED_RE})")),
    ("sed -i", re.compile(r"\bsed\b[^|;&]*\s-i")),
    ("python write", re.compile(r"json\.dump\(|\bopen\([^)]*['\"][wax]")),
)


def write_shape(command: str) -> str | None:
    """Which write shape a command matches, or None if it only reads.

    Called only on commands already known to name a protected file, which is
    what lets `sed -i` and the Python write modes stay this loose.
    """
    for label, pattern in WRITE_SHAPES:
        if pattern.search(command):
            return label
    return None


class BashHit(NamedTuple):
    """One `Bash` call whose command text named a protected project file."""

    fixture: str
    runlog: str
    shape: str | None  # None = read-shaped
    command: str


class Tally(NamedTuple):
    """What one pass over the corpus counts. Named so a new axis is one line."""

    recall: Counter
    compliance: Counter
    gate: Counter
    problems: list[str]
    arms: Counter
    per_fixture: Counter
    bash: list[BashHit]


def decidable_runs(compliance: Counter) -> int:
    """Runs whose compliance axis is known either way.

    `not_checked` is excluded everywhere a denominator is printed: counting it
    would assert those runs were clean, the inference `axes_from_runlog` refuses.
    """
    return compliance.get("pass", 0) + compliance.get("fail", 0)


def violations_of(data: dict) -> list[str]:
    """Bypass violations from a runlog of either vintage.

    v1+ carries the list at the top level; pre-v1 carries it under
    `judge_output`. Absent in both is NOT the same as empty — see
    `axes_from_runlog`, which maps that case to `not_checked`.
    """
    top = data.get("guardrail_bypass_violations")
    if isinstance(top, list):
        return [str(v) for v in top]
    judge_output = data.get("judge_output")
    if not isinstance(judge_output, dict):
        return []
    nested = judge_output.get("guardrail_bypass_violations")
    return [str(v) for v in nested] if isinstance(nested, list) else []


def bash_protected_hits(data: dict, path: Path) -> list[BashHit]:
    """Every `Bash` call in one runlog whose command names a protected file.

    Reads `tool_calls`, the same already-committed field `guardrail_shadow_report`
    replays, so this costs nothing and needs no new instrumentation. A runlog
    with no `tool_calls` (a crash before the first turn) contributes nothing
    rather than raising.
    """
    hits: list[BashHit] = []
    calls = data.get("tool_calls")
    if not isinstance(calls, list):
        return hits
    for call in calls:
        if not isinstance(call, dict) or call.get("tool") != "Bash":
            continue
        args = call.get("args")
        command = args.get("command") if isinstance(args, dict) else None
        if not isinstance(command, str):
            continue
        if not any(f in command for f in WATCHED_PROJECT_FILES):
            continue
        hits.append(
            BashHit(path.parent.name, path.name, write_shape(command), command)
        )
    return hits


def classify(violation: str) -> str:
    for probe, arm in VIOLATION_ARMS:
        if probe in violation:
            return arm
    return "other"


def tally(paths: list[Path]) -> Tally:
    """Count every axis over the given files.

    `arms` counts individual violations by kind; `per_fixture` counts them by
    fixture slug (the run's parent directory). Both are empty for a corpus with
    no recorded violations.

    Every read of one runlog happens inside the `try`, and no counter is touched
    until all of them succeed. A structurally-wrong-but-parseable log — a
    non-dict `judge_output`, say — must land in `problems` exactly once and in
    the axes zero times, or the reported run count and the axis rows disagree.
    """
    recall: Counter = Counter()
    compliance: Counter = Counter()
    gate: Counter = Counter()
    arms: Counter = Counter()
    per_fixture: Counter = Counter()
    problems: list[str] = []
    bash: list[BashHit] = []
    for path in paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            verdict, compliance_axis, outcome = axes_from_runlog(data)
            violations = violations_of(data)
            hits = bash_protected_hits(data, path)
        except (OSError, json.JSONDecodeError, TypeError, AttributeError) as e:
            problems.append(f"{path}: {e}")
            continue
        recall[verdict] += 1
        compliance[compliance_axis] += 1
        gate[outcome] += 1
        bash.extend(hits)
        if violations:
            per_fixture[path.parent.name] += len(violations)
        for violation in violations:
            arms[classify(violation)] += 1
    return Tally(recall, compliance, gate, problems, arms, per_fixture, bash)


def _counts(c: Counter, order: tuple[str, ...]) -> str:
    parts = [f"{c[k]} {k}" for k in order if c.get(k)]
    for k in sorted(set(c) - set(order)):
        parts.append(f"{c[k]} {k}")
    return " / ".join(parts) if parts else "(none)"


def _compliance_rate_line(compliance: Counter, *, windowed: bool = False) -> str:
    """The rate, or an explicit refusal to state one.

    A percentage over `pass + fail + not_checked` would assert that every
    unknown ran clean. Where the decidable set is empty (or all-one-way) that
    assertion is doing all the work, so say what is known instead of dressing
    it as a rate.

    Labelled `runs w/ >=1 violation`, not `violation rate`: this counts RUNS,
    while the `violations:` line four rows up counts individual violations.
    Two quantities under one word, printed together, is how a reader ends up
    quoting one against the other's denominator.
    """
    ok, bad = compliance.get("pass", 0), compliance.get("fail", 0)
    decidable = decidable_runs(compliance)
    scope = "in this window" if windowed else "in the corpus"
    if decidable == 0:
        return (
            f"  runs w/ >=1 violation: NOT MEASURABLE — no run {scope} has a "
            "decidable\n                         compliance axis."
        )
    if ok == 0:
        return (
            f"  runs w/ >=1 violation: {bad}/{decidable} of DECIDABLE runs (100%) — but no run "
            f"is known\n                         clean, so this is a floor on incidence, not a rate."
        )
    return (
        f"  runs w/ >=1 violation: {bad}/{decidable} of decidable runs "
        f"({_pct(bad, decidable)}%)"
    )


def _pct(n: int, total: int) -> int:
    """The displayed percentage, as an integer.

    Every percentage and every threshold in this report is derived from this one
    value, so a figure the reader sees and a branch the code takes cannot
    disagree — a `.0%` display against an unrounded threshold made an even split
    print "50%" and call itself dominant.
    """
    return round(n / total * 100)


def _concentration_lines(per_fixture: Counter, total: int) -> list[str]:
    """Top contributors, so a dominant fixture cannot hide inside an average.

    Suppressed entirely below two contributing fixtures: with one, the leader
    trivially holds 100%, so `make e2e-corpus TEST=<slug>` would flag the fixture
    the user just asked for. A warning that always fires teaches its reader to
    skip it, which costs the real outlier its disclosure.
    """
    contributors = {slug: n for slug, n in per_fixture.items() if n}
    if not total or len(contributors) < 2:
        return []
    lines = ["  concentration:"]
    shown = [(slug, n) for slug, n in per_fixture.most_common(TOP_CONTRIBUTORS) if n]
    for slug, n in shown:
        lines.append(f"    {slug:34} {n:3}  ({_pct(n, total)}% of all violations)")
    # Name what the cap withheld. A truncated list that does not say it is
    # truncated reads as the complete set of contributors, which is how a
    # three-fixture headline gets quoted off a seventeen-fixture corpus.
    withheld = len(contributors) - len(shown)
    if withheld:
        hidden = total - sum(n for _, n in shown)
        lines.append(
            f"    … {withheld} further fixture(s) not shown, "
            f"{hidden} violation(s) ({_pct(hidden, total)}%)"
        )
    top_slug, top_n = per_fixture.most_common(1)[0]
    # Two independent triggers, either sufficient — neither works alone.
    #
    # A flat majority bar never fires on a wide corpus: the present outlier is
    # well under half the violations yet several times its even share, the exact
    # shape the docs build an argument on, and >50% stays silent on it. (No
    # figure quoted here on purpose — the report prints the live one, and a
    # corpus count written into a comment is the thing this tool exists to stop.)
    #
    # A purely relative bar is degenerate for small n: with 2 contributors an
    # even share is already 50%, so "3x its even share" is 150% and unreachable
    # no matter how lopsided the split. An 8-vs-1 corpus would never flag.
    #
    # Both branches read `pct`, the SAME rounded integer the line prints. Testing
    # the raw ratio instead reintroduces the split this function was fixed for,
    # just narrower: at 101/201 the display rounds to "50%" while a raw `> 0.5`
    # fires the NOTE underneath it.
    pct = _pct(top_n, total)
    even_share_pct = 100 / len(contributors)
    if pct > 50 or pct >= 3 * even_share_pct:
        lines.append(
            f"    NOTE: `{top_slug}` alone accounts for {pct}% of violations "
            f"({pct / even_share_pct:.1f}x its even\n          share across "
            f"{len(contributors)} contributing fixtures). Any headline is "
            f"substantially\n          this one fixture's behavior."
        )
    return lines


def _violation_scope(compliance: Counter, total: int, n_runs: int) -> str:
    """`N across <denominator>` — the denominator a reader would actually divide by.

    Pairing the total with every run in scope invites `total / n_runs`, but a
    `not_checked` run cannot contribute: its violations field is absent, which is
    precisely *why* it is unknown. Saying "recorded none" rather than "had none"
    keeps that an absence of evidence, not evidence of compliance.
    """
    decidable = decidable_runs(compliance)
    if decidable == 0:
        return f"{total} across {n_runs} run(s)"
    unknown = compliance.get("not_checked", 0)
    scope = f"{total} across {decidable} decidable run(s)"
    return f"{scope}; {unknown} unknown recorded none" if unknown else scope


def _bash_lines(bash: list[BashHit]) -> list[str]:
    """The §6 Bash-gap census: total access, then every write-shaped command.

    The total is printed even at zero, because "nobody has touched these files
    from the shell" and "the counter is not running" have to look different —
    a close-condition nothing prints is the state this counter was added to
    leave. Write-shaped hits are listed individually, since the decision they
    feed (does §6's Bash gap close?) is made by reading the command.
    """
    writes = [h for h in bash if h.shape]
    lines = [
        f"  bash protected-file access: {len(bash)} call(s) naming "
        f"{' / '.join(WATCHED_PROJECT_FILES)}"
    ]
    if not writes:
        # Deliberately not scoped with "in this window" / "in the corpus": the
        # rate line above owns that phrasing, and two lines competing to name
        # the same scope is how a reader quotes one against the other's runs.
        lines.append(
            "    write-shaped: none — spec §6's Bash gap has not been exercised."
        )
        return lines
    lines.append(
        f"    write-shaped: {len(writes)} — read these; they are the close-condition in "
        "\n                  guardrail-enforcement-spec.md §6. Shape is matched on command"
        "\n                  text, so confirm each against its transcript before acting."
    )
    for hit in writes:
        first = hit.command.strip().splitlines()[0] if hit.command.strip() else ""
        lines.append(f"      {hit.fixture}/{hit.runlog}  [{hit.shape}]")
        lines.append(f"        {first[:120]}")
    return lines


def format_report(
    recall: Counter,
    compliance: Counter,
    gate: Counter,
    *,
    n_runs: int,
    arms: Counter | None = None,
    per_fixture: Counter | None = None,
    bash: list[BashHit] | None = None,
    windowed: bool = False,
    skipped: int = 0,
) -> str:
    # The window itself is named by `describe_window`, printed immediately
    # above this — stating it twice invites the two lines to disagree.
    not_checked = compliance.get("not_checked", 0)
    scope = f"{n_runs} committed run(s)"
    if skipped:
        scope += f" ({skipped} unreadable, excluded)"
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
        lines.append(f"  violations:         {_violation_scope(compliance, total_violations, n_runs)}")
        for arm, n in arms.most_common():
            lines.append(f"    {arm:34} {n:3}")
        lines.extend(_concentration_lines(per_fixture or Counter(), total_violations))
    lines.append(_compliance_rate_line(compliance, windowed=windowed))
    lines.extend(_bash_lines(bash or []))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Three-axis totals + violation detail across committed e2e runs "
            "(issues #972, #1176)."
        )
    )
    ap.add_argument("--test", help="restrict to one fixture slug")
    # `--since` is the shared one (`harness/since_window.py`), not a second
    # spelling of it: `type=parse_since` rejects a malformed value at parse
    # time, and `filter_since` KEEPS a run whose filename carries no parseable
    # date rather than dropping it, so a naming change cannot silently shrink
    # the window. Both properties are what a local implementation had to
    # re-derive. Its granularity is a date, which costs nothing here — every
    # decidable figure this report prints is identical whether the detector's
    # ship day is included whole or excluded whole; only `not_checked` moves,
    # and that is the bucket the report draws no conclusion from.
    add_since_arg(ap)
    args = ap.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        # Branch on whether the corpus had anything, not on whether a window was
        # in effect: an empty corpus reported as an empty window sends the reader
        # hunting for a window bug that isn't there.
        where = f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        print(f"No committed runs found{where}.", file=sys.stderr)
        return 1

    counts = tally(paths)
    for problem in counts.problems:
        print(f"  skip {problem}", file=sys.stderr)
    # Unreadable files are excluded from every count, so they must be excluded
    # from the denominator too — the skip lines go to stderr, and a report piped
    # to a file would otherwise carry an inflated count with no trace of why.
    skipped = len(counts.problems)
    parsed = len(paths) - skipped
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(
        format_report(
            counts.recall,
            counts.compliance,
            counts.gate,
            n_runs=parsed,
            arms=counts.arms,
            per_fixture=counts.per_fixture,
            bash=counts.bash,
            windowed=cutoff is not None,
            skipped=skipped,
        )
    )
    # Nothing readable is a failure, not an empty success: a caller keying on the
    # exit code must be able to tell "clean run, nothing to say" from "the whole
    # corpus was unreadable", and both print a report.
    return 0 if parsed else 1


if __name__ == "__main__":
    sys.exit(main())
