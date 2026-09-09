"""Report run logs whose own tests reach opposite verdicts on one conflict.

Group every conflict write in a run log by `(scenario, conflict id)`. When one
group carries two different verdicts — disagreeing on `status` or
`preferred_assertion_id` — the run log contradicts itself: the evidence on file
is identical in every write, so at most one verdict can be right and the suite
currently cannot say which. Issue #1972 V7; the rule and its evidence are stated
in `docs/deep-dives/conflict-resolution-findings-2026-08-27.md` § V7.

Offline and free: it reads committed run logs and the scenario fixtures. No model
calls, no network.

    cd eval/harness && uv run python -m conflict_verdict_report [--skill NAME]

## The trap this module exists to avoid

**Reading `changed_fields` alone finds nothing.** A run that correctly *declines*
to resolve writes `weighing_analysis` and `resolution_rationale` but leaves
`status` untouched, so the contradiction never appears in the diff. Measured
2026-09-08 across the 134 committed unit run logs:

    literal (changed_fields only)   0 hits
    effective (fixture fallback)    3 hits  (all flynn-multi-conflict/c_002)

So the value compared is the **effective post-run state**: `changed_fields[f].after`
where the field was written, and otherwise the value the scenario fixture started
with. A reader who implements the issue's "where to look" line verbatim gets a
clean green scan and concludes the corpus is consistent.

**Re-derive those two numbers rather than quoting them.** Candidate retention
keeps only the newest 5 per skill, so the three logs carrying that contradiction
rotate out and the effective count drops to 0 without anything being fixed. The
deep dive recorded this on six of six logs; four survive, which is the rotation
already at work. `test_conflict_verdict_report.py` is synthetic for exactly this
reason: it pins the 0-vs-1 GAP, which is the durable finding, not the census.

It discriminates rather than flagging everything, and the corpus shows that too:
of the four conflict-resolution logs, the fourth is CLEAN because
`ut_conflict_resolution_003` happened to write `resolved` on that run and so
agreed with `ut_conflict_resolution_002`. That is the deep dive's recorded
2-resolved / 3-unresolved split, and it is what a report that flagged any
multi-writer group would get wrong.

## Why a clean scan reports its denominators

A report whose payload is "nothing found" has to say what it looked at, because
every way this module can break produces the same cheerful zero. Three such ways
were live before review and are why the counters exist:

- **Only 7 of the 134 committed logs carry any conflict write at all** — so
  "scanned 134" is a ~19x inflated denominator that says almost nothing about
  whether the scan read anything. Rename the diff's `file_changes` key and the
  report still printed a full-denominator green.
- **An unreadable run log left both numerator and denominator**, so a truncated
  log quietly shrank the corpus.
- **A missing scenario fixture silently degraded the reading** to the
  coerce-unwritten-to-`None` shortcut this module's own suite forbids
  (`test_defaulting_an_unwritten_field_to_None_is_not_a_shortcut`), which
  manufactures false positives and can also hide real contradictions.

So the report prints groups examined and multi-verdict groups alongside the log
count, and names every run log it could not read and every scenario whose fixture
could not supply a fallback. `GROUPS EXAMINED: 0` is the line that says a green
scan proves nothing.

## Scope is one run log, and that is a ruling rather than an oversight

#1972 says "group every conflict write in a run log" and "flag the run log", so
per-log is settled and not this module's to reverse. Two consequences worth
stating, because a reader will otherwise assume they were missed.

**`conflict-resolution` is NOT the only skill that writes conflicts.**
`proof-conclusion` writes them too, in 3 committed logs — which the "7 of the
134" figure above already implies, since conflict-resolution has only 4. An
earlier version of this PR's body claimed otherwise.

**Grouping the same rule ACROSS logs finds two groups this scan structurally
cannot see**, and one of them is the evidence #1972 itself quotes for V7:

    conflict-resolution / ut_conflict_resolution_003 / flynn-multi-conflict / c_002
        ('unresolved', None)   <- three logs
        ('resolved', 'a_001')  <- one log
    proof-conclusion / ut_proof_conclusion_011 / flynn-with-birthplace-conflict / c_001
        ('resolved', 'a_009')  <- two logs
        ('resolved', 'a_002')  <- one log

The issue's own wording is "across the five logs `ut_003` alone splits 2
resolved / 3 unresolved on that same conflict" — a cross-log observation that a
per-log scan cannot make. Not widened here, because the scope is ruled; recorded
so whoever revisits it starts from a count rather than a hunch.

## Why this is a report and not a validator

Two reasons, and the first is structural. A validator sees ONE run
(`validator_runner.py` passes a single before/after pair), and this rule is a
comparison BETWEEN writes inside a run log — there is no per-run vantage point
from which the contradiction is visible. Same reason `provenance_report.py` is a
report: it scans logs at rest.

Second, deciding *which* verdict is right is genealogy and stays with a human.
Noticing that the corpus contradicts itself is arithmetic, and that is all this
does. It exits 0 on any finding — triage the hits, do not gate on them. A
non-zero exit means the report could not do its job (an unknown `--skill`), not
that it found something.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from harness.versioning import classify

# The two fields a verdict consists of. `status` alone is not enough: a run can
# agree that a conflict is resolved and disagree about which assertion won.
VERDICT_FIELDS = ("status", "preferred_assertion_id")

_HERE = Path(__file__).resolve().parent
_EVAL = _HERE.parent
RUNLOGS_UNIT = _EVAL / "runlogs" / "unit"
SCENARIOS = _EVAL / "fixtures" / "scenarios"


class SkillNotFound(LookupError):
    """`--skill` named no run-log directory.

    Raised rather than scanned as empty: `--skill conflict_resolution` (an
    underscore for the real hyphen) otherwise prints the full clean-scan message
    for the one skill that carries every known contradiction.
    """


@dataclass
class LogScan:
    """One run log's result, with the denominators a clean verdict rests on."""

    findings: list[dict[str, Any]] = field(default_factory=list)
    groups: int = 0
    multi_verdict: int = 0
    # Scenarios where the fixture could not supply a fallback for some conflict
    # this run wrote — either the file was unreadable or the conflict was not in
    # it. Those groups were read WITHOUT the fixture half of the effective
    # reading, which is the shortcut the suite forbids.
    fallback_unavailable: set[str] = field(default_factory=set)


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_scenario_conflicts(
    scenario: str, scenarios_dir: Path = SCENARIOS
) -> tuple[dict[str, dict], bool]:
    """`({conflict id: conflict}, resolved?)` for a scenario fixture.

    The second element is the half that matters, and returning it is the whole
    reason this is not a bare dict: an absent or malformed fixture yields `{}`,
    under which `effective_verdict` falls back to `None` for every unwritten
    field — exactly the coerce-to-`None` shortcut the suite forbids. The report
    must be able to say the fallback was unavailable rather than quietly
    switching to a reading it declares wrong elsewhere.

    It still does not raise: one bad fixture must not kill a corpus report.
    """
    if not scenario:
        return {}, False
    try:
        data = _load(scenarios_dir / scenario / "research.json")
        if not isinstance(data, dict):
            # Valid JSON that is not an object. Without this, `.get` raises
            # AttributeError straight past the handler below — contradicting
            # this docstring — and `main`'s broad catch then names the RUN LOG
            # unreadable when the run log is fine and the fixture is broken.
            return {}, False
    except (OSError, json.JSONDecodeError):
        # Absent (FileNotFoundError is an OSError) or malformed. A no-op
        # `is_file` pre-check stood here and was deleted: it was unreachable
        # behind this handler, and a mutation removing it left the suite green.
        return {}, False
    out: dict[str, dict] = {}
    for c in data.get("conflicts") or []:
        if isinstance(c, dict) and c.get("id"):
            out[c["id"]] = c
    return out, True


def _hashable(value: Any) -> Any:
    """Verdicts are dict keys, and a malformed log can carry a list `after`.

    Coerced to a stable string rather than allowed to raise `TypeError`, so one
    bad entry degrades to a distinguishable verdict instead of killing the scan.
    """
    try:
        hash(value)
    except TypeError:
        return json.dumps(value, sort_keys=True, default=str)
    return value


def effective_verdict(
    changed_fields: dict[str, Any], fixture_conflict: dict[str, Any]
) -> tuple:
    """The post-run value of each verdict field.

    `changed_fields[f].after` when this run wrote the field, otherwise what the
    scenario started with. Reading only the first half is what makes the
    contradiction invisible — see the module docstring.
    """
    values = []
    for f in VERDICT_FIELDS:
        if f in changed_fields:
            entry = changed_fields[f]
            values.append(
                _hashable(entry.get("after") if isinstance(entry, dict) else None)
            )
        else:
            values.append(_hashable(fixture_conflict.get(f)))
    return tuple(values)


def _writes(run: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Every conflict write in one run, as `(conflict id, changed_fields)`.

    Two of the THREE diff arms, which carry DIFFERENT shapes
    (`harness/diff.py` returns added, modified and deleted): a
    `modified` entry is `{id, changed_fields}`, while an `added` entry is the
    whole conflict object. A conflict a test creates outright — verdict and all —
    lands in `added`, so reading only `modified` makes it invisible with nothing
    to distinguish that from agreement. Normalized here so one comparison covers
    both: an added object's own fields ARE its post-run state, expressed in the
    `{"after": ...}` shape `effective_verdict` reads.
    """
    diff = (
        ((run.get("output") or {}).get("file_changes") or {}).get("research.json") or {}
    ).get("diff") or {}
    conflicts = diff.get("conflicts") or {}
    if not isinstance(conflicts, dict):
        return []

    out: list[tuple[str, dict[str, Any]]] = []
    for entry in conflicts.get("modified") or []:
        if isinstance(entry, dict) and entry.get("id"):
            out.append((str(entry["id"]), entry.get("changed_fields") or {}))
    for entry in conflicts.get("added") or []:
        if isinstance(entry, dict) and entry.get("id"):
            out.append(
                (
                    str(entry["id"]),
                    {f: {"after": entry[f]} for f in VERDICT_FIELDS if f in entry},
                )
            )
    return out


def scan_runlog(runlog: dict[str, Any], scenarios_dir: Path = SCENARIOS) -> LogScan:
    """Group one run log's conflict writes and report the groups that disagree.

    The gate is **two distinct verdicts in a group**, not two distinct tests. A
    single test whose repeated runs flip-flop is therefore reported too, and is a
    real finding of a different kind — run-to-run nondeterminism rather than two
    tests disagreeing — so each finding names which of the two it is.

    The multi-`runs[]` route into that arm is latent: `runs_per_test` is pinned to
    1 by policy AND by a schema `maximum`, so every committed test entry has one
    run. The route that is live today is two `tests[]` entries sharing one
    `test_id` — the corruption `check_runlogs.py` rule 4 exists to catch, which
    reaches this code as one test id appearing under two verdicts.
    """
    scan = LogScan()
    groups: dict[tuple[str, str], dict[tuple, list[str]]] = defaultdict(
        lambda: defaultdict(list)
    )
    cache: dict[str, tuple[dict[str, dict], bool]] = {}

    for test in runlog.get("tests") or []:
        if not isinstance(test, dict):
            continue
        scenario = str(test.get("scenario") or "")
        test_id = str(test.get("test_id") or "?")
        outcome = test.get("outcome")
        if outcome and outcome != "pass":
            # Only a non-pass is annotated: labelling every id "(pass)" is noise,
            # and the point is to show a side the suite ALREADY flagged.
            test_id = f"{test_id} [{outcome}]"
        if scenario not in cache:
            cache[scenario] = load_scenario_conflicts(scenario, scenarios_dir)
        base, resolved = cache[scenario]

        # A test with no scenario cannot be grouped with another test's
        # conflicts — two unnamed scenarios are not the same scenario — so it is
        # keyed to itself rather than merged under a shared empty string, which
        # would manufacture the cross-scenario false positive the scenario key
        # exists to prevent.
        key_scenario = scenario or f"<no scenario: {test_id}>"

        for run in test.get("runs") or []:
            if not isinstance(run, dict):
                continue
            for cid, changed in _writes(run):
                # Per CONFLICT ID, not per file. `resolved` says the fixture was
                # readable; it does not say this conflict was IN it. A conflict
                # the fixture never had reached `base.get(cid) or {}` and so the
                # coerce-to-None reading this suite forbids elsewhere, printing
                # an illegal `status=None` with no caveat.
                #
                # `needs_fallback` is what keeps it honest: a conflict a test
                # CREATES is absent from the fixture by definition, so without it
                # every added-arm finding got stamped "fixture unavailable".
                needs_fallback = any(f not in changed for f in VERDICT_FIELDS)
                if scenario and needs_fallback and (not resolved or cid not in base):
                    scan.fallback_unavailable.add(scenario)
                verdict = effective_verdict(changed, base.get(cid) or {})
                by_verdict = groups[(key_scenario, cid)]
                if test_id not in by_verdict[verdict]:
                    by_verdict[verdict].append(test_id)

    scan.groups = len(groups)
    for (scenario, cid), by_verdict in sorted(groups.items()):
        if len(by_verdict) < 2:
            continue
        scan.multi_verdict += 1
        writers = {t for tids in by_verdict.values() for t in tids}
        scan.findings.append(
            {
                "scenario": scenario,
                "conflict_id": cid,
                "kind": (
                    # NOT "flip-flopped across its runs": 2184 of 2184
                    # committed test entries carry exactly one run, so the
                    # multi-`runs[]` route cannot fire. The live route is two
                    # `tests[]` entries sharing one `test_id` — the corruption
                    # check_runlogs rule 4 exists to catch — reaching here as
                    # one id under two verdicts.
                    "two tests disagree"
                    if len(writers) > 1
                    else "one test_id appears under two verdicts"
                ),
                "fixture_unavailable": scenario in scan.fallback_unavailable,
                "verdicts": {
                    v: sorted(tids) for v, tids in sorted(by_verdict.items(), key=str)
                },
            }
        )
    return scan


def _runlogs(skill: str | None) -> list[Path]:
    """Every committed candidate/released log, in no meaningful order — the scan
    visits all of them and selects no "newest", so #1629's `v10`-sorts-before-`v2`
    bug is not inherited here.

    Scratch logs are excluded by the `v*` glob: they are gitignored and partial.
    `.ann.json` siblings are excluded by the single-dot filter.
    """
    if skill is not None:
        d = RUNLOGS_UNIT / skill
        if not d.is_dir():
            available = (
                sorted(p.name for p in RUNLOGS_UNIT.iterdir() if p.is_dir())
                if RUNLOGS_UNIT.is_dir()
                else []
            )
            raise SkillNotFound(
                f"no run-log directory {d}\n"
                f"available: {', '.join(available) or '(none)'}"
            )
        dirs = [d]
    else:
        if not RUNLOGS_UNIT.is_dir():
            raise SkillNotFound(f"no unit run-log root at {RUNLOGS_UNIT}")
        dirs = sorted(p for p in RUNLOGS_UNIT.iterdir() if p.is_dir())

    out: list[Path] = []
    for d in dirs:
        # `classify()` rather than a local glob-and-count-dots. That filter was
        # a fifth hand-rolled spelling of a classification
        # `harness/versioning.py` owns and `eval/CLAUDE.md` points at, and it
        # admitted `validators.json`, `v_notes.json` and `vNOTAVERSION.json` as
        # run logs (zero instances today).
        out.extend(
            sorted(
                p
                for p in d.glob("*.json")
                if classify(p.name).kind in ("released", "candidate")
            )
        )
    return out


def format_report(
    rows: list[tuple[str, str, LogScan]], unreadable: list[Path] | None = None
) -> str:
    unreadable = unreadable or []
    lines = ["Contradictory conflict verdicts within a run log (issue #1972 V7)", ""]

    total = sum(len(r.findings) for _, _, r in rows)
    scanned = len(rows)
    flagged = sum(1 for _, _, r in rows if r.findings)
    groups = sum(r.groups for _, _, r in rows)
    multi = sum(r.multi_verdict for _, _, r in rows)
    unresolved = sorted({s for _, _, r in rows for s in r.fallback_unavailable})

    for skill, name, r in rows:
        if not r.findings:
            continue
        lines.append(f"{skill}/{name}")
        for f in r.findings:
            caveat = "  [fixture unavailable]" if f["fixture_unavailable"] else ""
            lines.append(
                f"  {f['scenario']} / {f['conflict_id']}  ({f['kind']}){caveat}"
            )
            for verdict, tests in f["verdicts"].items():
                # Derived from VERDICT_FIELDS rather than unpacked positionally,
                # so adding a third verdict field widens the output instead of
                # raising ValueError in the printer.
                shown = " ".join(
                    f"{name}={value!r}" for name, value in zip(VERDICT_FIELDS, verdict)
                )
                lines.append(f"    {shown}  <- {', '.join(tests)}")
        lines.append("")

    if total:
        lines.append(
            f"{total} contradiction(s) in {flagged} of {scanned} run log(s). "
            "The evidence on file is identical in each write, so at most one "
            "verdict can be right; which one is a genealogist's call, not this "
            "report's."
        )
    else:
        lines.append(
            "No contradictions. This reads the EFFECTIVE post-run state; a "
            "changed_fields-only reading reports zero even on a corpus that does "
            "contradict itself."
        )

    # The denominators, printed on a clean scan AND a dirty one: every way this
    # module can break also produces a plausible-looking count.
    lines += [
        "",
        f"RUN LOGS SCANNED: {scanned}",
        f"GROUPS EXAMINED: {groups}   (conflict writes grouped by scenario + id)",
        f"GROUPS WITH >1 VERDICT: {multi}",
    ]
    if not groups:
        lines.append(
            "  ^ zero groups examined, so this scan proves NOTHING. Either no run "
            "log carries a conflict write, or the diff shape moved and nothing is "
            "being read."
        )
    if unreadable:
        lines.append(f"UNREADABLE RUN LOGS: {len(unreadable)} (excluded from the scan)")
        lines += [f"  - {p}" for p in unreadable]
    if unresolved:
        lines.append(
            f"SCENARIOS WITH NO FIXTURE FALLBACK: {len(unresolved)} — groups under "
            "these were read WITHOUT the fixture fallback, which both manufactures "
            "false positives and can hide real contradictions"
        )
        lines += [f"  - {s}" for s in unresolved]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="conflict_verdict_report",
        description=(
            "Run logs whose own tests reach opposite verdicts on one conflict. "
            "Offline; exits 0 on any finding."
        ),
    )
    ap.add_argument("--skill", help="limit to one skill's run logs")
    args = ap.parse_args(argv)

    try:
        paths = _runlogs(args.skill)
    except SkillNotFound as e:
        print(f"conflict_verdict_report: {e}", file=sys.stderr)
        return 2

    rows: list[tuple[str, str, LogScan]] = []
    unreadable: list[Path] = []
    for path in paths:
        # Two failure modes, one handling. `_load` covers unreadable/malformed
        # JSON; the broad catch covers a structurally-odd log that parses but
        # violates the schema, which otherwise raised out of `scan_runlog` and
        # killed the whole corpus scan over one bad file — the opposite of the
        # "must not die on one bad input" discipline stated below.
        #
        # Both are NAMED in the report rather than dropped: for a report whose
        # payload is a count, a silently shrinking denominator is the bug.
        try:
            runlog = _load(path)
            scan = scan_runlog(runlog, SCENARIOS)
        except (OSError, json.JSONDecodeError):
            unreadable.append(path)
            continue
        except Exception as e:  # noqa: BLE001 - a report must survive one bad log
            unreadable.append(Path(f"{path}  ({type(e).__name__}: {e})"))
            continue
        rows.append((path.parent.name, path.name, scan))

    print(format_report(rows, unreadable))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
