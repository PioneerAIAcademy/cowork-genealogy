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
    REPO_ROOT,
    add_since_arg,
    all_result_jsons,
    branch_scope_note,
    describe_window,
    filter_since,
    result_jsons_for,
)
from e2e.result import axes_from_runlog
from e2e import pricing

# `check_guardrail_compliance` lives in `harness.skill_invocation` (SDK-free) so
# `--recompute` can import it without pulling `claude_agent_sdk` into this
# module's pure-analysis posture — importing it from `e2e.orchestrator` (which
# re-exports it) would drag the SDK in. See issue #1484.
from harness.skill_invocation import (
    check_guardrail_compliance,
    unscoreable_person_evidence_links,
)

# Where a run's committed seed tree lives, for `--recompute`. A run whose fixture
# has no readable `starting-tree.gedcomx.json` is named in a skip list and left
# out of both counts (mirrors `guardrail_shadow_report.replay_provenance`): with
# no baseline every person reads as new and the recompute would manufacture
# exactly the violations it measures.
E2E_FIXTURES = REPO_ROOT / "eval" / "tests" / "e2e"

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
#: The arm the §8 provenance narrowing subtracts from — named so the
#: "unscoreable by design" line can be gated on it rather than on any violation.
_SAME_PERSON_ARM = "same_person (per person)"

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
        except (
            OSError,
            UnicodeDecodeError,
            json.JSONDecodeError,
            TypeError,
            AttributeError,
        ) as e:
            # `UnicodeDecodeError` is a `ValueError`, not a `JSONDecodeError`, and
            # `read_text` decodes before `json` sees the bytes — so without it one
            # file truncated mid-character aborts the whole sweep with a traceback
            # instead of being named and skipped. Same hole found in
            # `judge_report.py`, which cites this function as its precedent (#1485
            # review); fixed in both so the precedent is one worth citing.
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


def _load_json(path: Path) -> dict | None:
    """Parse one committed file, or None on any read/parse failure.

    A None is a signal the caller records in a skip/problems list — never a
    silent zero. Mirrors the exception set `tally` catches.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


class RecomputeTally(NamedTuple):
    """What `--recompute` derives by re-running the detectors over committed data.

    `arms`/`per_fixture` mirror `Tally`'s; `scanned` is the number of runs the
    detectors actually ran on; `skipped` names every run left out of THIS
    recompute (and why), so a shrunk denominator can never read as a clean
    corpus. (A skipped run still appears in the report's stored column, which
    spans all paths to stay byte-identical with the default report — the skip
    only removes it from the recomputed side.)

    `regressed` names every run whose stored count EXCEEDS its recomputed one: a
    violation the run recorded that today's detector clears (a detector
    correction, not a corpus change). Surfaced for the same reason skips are: a
    `stored > recomputed` case otherwise vanishes into the aggregate and the
    report reads as if the recompute could only ever find more. The §8
    provenance narrowing is exactly such a correction, so it populates this
    list; that is the intended reading, not a bug.
    """

    arms: Counter
    per_fixture: Counter
    scanned: int
    skipped: list[str]
    regressed: list[str]
    #: `person_evidence` links on brand-new persons that the §8 provenance check
    #: deliberately does NOT flag, because their assertion's provenance lane cannot
    #: yield a record persona from what the run retained — the "unscoreable by design" bucket the lead asked
    #: for on 2026-08-09 so the exemption is visible instead of silent. A count,
    #: never a violation, so it gets no `VIOLATION_ARMS` entry. Defaulted
    #: because this is a NamedTuple built with all-keyword calls in the tests.
    unscoreable: int = 0


def recompute_tally(paths: list[Path], *, fixtures_root: Path = E2E_FIXTURES) -> RecomputeTally:
    """Derive violations by calling `check_guardrail_compliance` over each run's
    committed `tool_calls` + `final-research`/`final-tree` sidecars + the
    fixture's committed seed tree — instead of reading the stored field, which is
    absent on every run written before the detector (they read `not_checked` and
    contribute zero). Issue #1484 (a).

    Skip discipline follows `replay_provenance`: a run whose seed tree is
    unreadable — or which is missing a required sidecar — is NAMED in `skipped`
    and excluded from the recomputed count, never counted as zero (it still shows
    in the stored column — see `RecomputeTally`). `william-ferber-ancestry`
    has a committed run log but no fixture directory, so it is the one expected
    skip on today's corpus (recomputing it with `starting_tree=None` would
    manufacture spurious `same_person` violations).

    Deterministic against the stored data: this runs the SAME detector over the
    SAME committed `tool_calls` the harness recorded. The ledger truncates and
    summarises some writer entries (issue #1484 comment 2026-08-16), so a small
    population of assigned ids was never written down; the recomputed number
    inherits that ceiling rather than introducing a discrepancy — it is a
    function of an imperfect ledger, documented, not a bug here.
    """
    arms: Counter = Counter()
    per_fixture: Counter = Counter()
    skipped: list[str] = []
    regressed: list[str] = []
    scanned = 0
    unscoreable = 0
    for path in paths:
        slug = path.parent.name
        seed = _load_json(fixtures_root / slug / "starting-tree.gedcomx.json")
        if seed is None:
            skipped.append(f"{slug}/{path.name}: no readable starting-tree.gedcomx.json")
            continue
        data = _load_json(path)
        if data is None:
            skipped.append(f"{slug}/{path.name}: unreadable run log")
            continue
        final_research = _load_json(path.with_name(path.stem + ".final-research.json"))
        final_tree = _load_json(path.with_name(path.stem + ".final-tree.gedcomx.json"))
        if final_research is None or final_tree is None:
            skipped.append(f"{slug}/{path.name}: missing final-research/final-tree sidecar")
            continue
        tool_calls = data.get("tool_calls") or []
        scanned += 1
        # The exemption's own counter, from the same sidecars already loaded.
        unscoreable += len(
            unscoreable_person_evidence_links(final_research, final_tree, starting_tree=seed)
        )
        recomputed_here = 0
        for violation in check_guardrail_compliance(
            tool_calls, final_research, final_tree, starting_tree=seed
        ):
            arms[classify(violation)] += 1
            per_fixture[slug] += 1
            recomputed_here += 1
        stored_here = len(violations_of(data))
        if stored_here > recomputed_here:
            regressed.append(
                f"{slug}/{path.name}  stored {stored_here} -> recomputed {recomputed_here}"
            )
    return RecomputeTally(arms, per_fixture, scanned, skipped, regressed, unscoreable)


class Spend(NamedTuple):
    """Abort-path cost, never blended into one total (issue #1484 b).

    `recorded` sums the authoritative `total_cost_usd`; `estimated` sums the
    flat-rate `pricing.estimate_cost_usd` over runs that carry a token block but
    no recorded cost; `neither` counts runs with neither (the pre-fallback runs
    with no token counts, unrecoverable).
    """

    recorded: float
    recorded_n: int
    estimated: float
    estimated_n: int
    neither_n: int


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def _usage_block(data: dict) -> dict:
    usage = data.get("usage")
    return usage if isinstance(usage, dict) else {}


def spend_tally(paths: list[Path]) -> Spend:
    """Recorded / estimated / neither — three numbers, never blended.

    Report-time estimation is what recovers the committed null-cost runs: a
    write-time field on `_fallback_usage` alone would leave every already-committed
    aborted run at zero. Only runs carrying a token block are recoverable; the
    rest fall in `neither` rather than being imputed.
    """
    recorded = estimated = 0.0
    recorded_n = estimated_n = neither_n = 0
    for path in paths:
        data = _load_json(path)
        if data is None:
            continue  # already surfaced by `tally`'s problems list
        usage = _usage_block(data)
        cost = usage.get("total_cost_usd")
        if isinstance(cost, (int, float)) and not isinstance(cost, bool):
            recorded += cost
            recorded_n += 1
            continue
        est = pricing.estimate_cost_usd(usage.get("usage"))
        if est is not None:
            estimated += est
            estimated_n += 1
        else:
            neither_n += 1
    return Spend(recorded, recorded_n, estimated, estimated_n, neither_n)


def _calibration_ratios(paths: list[Path]) -> list[float]:
    """estimated/recorded for every run carrying BOTH a recorded cost and a token
    block — the free, offline accuracy measurement (issue #1484 3a). Single
    source for both the inline accuracy note and `--calibrate-cost`.
    """
    ratios: list[float] = []
    for path in paths:
        data = _load_json(path)
        if data is None:
            continue
        usage = _usage_block(data)
        cost = usage.get("total_cost_usd")
        if not isinstance(cost, (int, float)) or isinstance(cost, bool) or cost <= 0:
            continue
        est = pricing.estimate_cost_usd(usage.get("usage"))
        if est is not None:
            ratios.append(est / cost)
    return ratios


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
    recomputing: bool = False,
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
    if arms.get(_SAME_PERSON_ARM) and not recomputing:
        # A reader of the default report would otherwise see the same_person arm
        # with no sign that a labelled population was subtracted from it. Gated
        # on the arm being present (the line is meaningless without it) and on
        # the recompute being off — with RECOMPUTE=1 the real number is printed
        # a few lines down, and claiming "unknown" beside it is just wrong.
        lines.append(
            "  unscoreable by design: unknown for stored runs — re-run with RECOMPUTE=1"
        )
    lines.append(_compliance_rate_line(compliance, windowed=windowed))
    lines.extend(_bash_lines(bash or []))
    return "\n".join(lines)


def format_spend(spend: Spend, ratios: list[float]) -> str:
    """The three-number spend line (issue #1484 step 4), with the estimate's
    measured accuracy beside it (3a). Recorded, estimated and unrecoverable are
    never blended into one total: abort-path cost is estimated, and folding it
    into recorded would launder an approximation into the authoritative figure.
    """
    median = _median(ratios)
    acc = (
        f" (~{median:.2f}x recorded, median over {len(ratios)} calibrating run(s))"
        if median is not None
        else ""
    )
    return "\n".join(
        [
            "  spend:",
            f"    recorded    ${spend.recorded:,.2f}  over {spend.recorded_n} run(s) carrying total_cost_usd",
            f"    estimated   ${spend.estimated:,.2f}  over {spend.estimated_n} null-cost run(s) with token counts{acc}",
            f"    unrecovered {spend.neither_n} run(s) carry neither a cost nor token counts",
        ]
    )


def format_recompute(stored_arms: Counter, rt: RecomputeTally) -> str:
    """Stored vs recomputed, per arm, labelled — then every regressed run and
    every named skip.

    The two columns are not the same measurement: `stored` is what each run
    recorded at the time (pre-detector runs recorded none), `recomputed` is
    today's detectors over the same committed data. Recomputed is NOT guaranteed
    to be >= stored: today's detector can clear a violation a contemporaneous
    checker recorded, which the regressed list below names.
    """
    lines = [
        "",
        "  --recompute: violations re-derived from tool_calls + committed sidecars.",
        "               stored = what each run recorded at the time (pre-detector runs record none); ",
        "               recomputed = today's detectors over the same committed data. Not the same ",
        "               measurement: recomputed is not guaranteed >= stored.",
        f"    {'arm':<34} {'stored':>7} {'recomputed':>11}",
    ]
    # Tiebreak alphabetically so equal-count arms order deterministically across
    # processes (set iteration is hash-seed-dependent); matches `_counts`.
    for arm in sorted(set(stored_arms) | set(rt.arms), key=lambda a: (-rt.arms.get(a, 0), a)):
        lines.append(f"    {arm:<34} {stored_arms.get(arm, 0):>7} {rt.arms.get(arm, 0):>11}")
    lines.append(
        f"    {'TOTAL':<34} {sum(stored_arms.values()):>7} {sum(rt.arms.values()):>11}"
        f"   ({rt.scanned} run(s) scanned)"
    )
    # The exemption, next to the violations it was subtracted from. Stored runs
    # carry no such field, so that column is `-` rather than 0 — the same rule
    # `axes_from_runlog` follows for `not_checked`: an unknown is never a zero.
    # Below the TOTAL and labelled with its own unit, because it is NOT a term
    # of that sum: the arms count flagged PERSONS, this counts exempted LINKS.
    # Printed unlabelled and inline it invites a subtraction that means nothing.
    lines.append("")
    lines.append(
        f"    not a term of the total above — links, not persons:"
    )
    lines.append(
        f"    {'unscoreable by design (links)':<34} {'-':>7} {rt.unscoreable:>11}"
    )
    if rt.regressed:
        lines.append(
            f"    {len(rt.regressed)} run(s) where TODAY's detector clears a violation the run recorded"
        )
        lines.append("      (a detector correction, not a corpus change):")
        lines.extend(f"      {r}" for r in rt.regressed)
    if rt.skipped:
        lines.append(
            f"    {len(rt.skipped)} skip(s) — excluded from the recomputed count, never counted as zero:"
        )
        lines.extend(f"      {s}" for s in rt.skipped)
    return "\n".join(lines)


def format_calibration(ratios: list[float]) -> str:
    """`--calibrate-cost`: median + range of estimated/recorded, offline and free
    over the runs carrying both (issue #1484 3a). Anything materially worse than
    ~0.90x median means the price table is wrong, not the corpus — re-measure,
    do not reword.
    """
    if not ratios:
        return "  calibrate-cost: no run carries both a recorded cost and token counts."
    return "\n".join(
        [
            "  calibrate-cost (estimated / recorded, flat sonnet table w/ 1h cache-write):",
            f"    median {_median(ratios):.2f}x   range {min(ratios):.2f}x - {max(ratios):.2f}x"
            f"   over {len(ratios)} run(s)",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    # The house pattern (`e2e/author.py`). A Windows console defaults to cp1252
    # and dies on the arrows and box glyphs this module prints; the team it is
    # written for is on Windows. Guarded by tests/unit/test_encoding_lint.py.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(
        description=(
            "Three-axis totals + violation detail across committed e2e runs "
            "(issues #972, #1176)."
        )
    )
    ap.add_argument("--test", help="restrict to one fixture slug")
    ap.add_argument(
        "--recompute",
        action="store_true",
        help="also re-derive violations from tool_calls + committed sidecars. "
        "Prints stored vs recomputed — not the same measurement, and neither "
        "bounds the other; the default stays the stored path.",
    )
    ap.add_argument(
        "--calibrate-cost",
        action="store_true",
        help="report median + range of estimated/recorded cost over runs carrying "
        "both — the offline accuracy check for the flat price table.",
    )
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
        print(branch_scope_note(), file=sys.stderr)
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
            recomputing=args.recompute,
        )
    )
    # Everything above this line is byte-identical to the pre-#1484 report — the
    # spend line is the only always-added output (issue #1484 step 4). The
    # accuracy note beside the estimate reuses the same ratios `--calibrate-cost`
    # would print (3a).
    ratios = _calibration_ratios(paths)
    print(format_spend(spend_tally(paths), ratios))
    if args.recompute:
        print(format_recompute(counts.arms, recompute_tally(paths)))
    if args.calibrate_cost:
        print(format_calibration(ratios))
    # Nothing readable is a failure, not an empty success: a caller keying on the
    # exit code must be able to tell "clean run, nothing to say" from "the whole
    # corpus was unreadable", and both print a report.
    return 0 if parsed else 1


if __name__ == "__main__":
    sys.exit(main())
