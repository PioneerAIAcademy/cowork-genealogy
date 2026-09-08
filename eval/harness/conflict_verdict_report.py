"""Report run logs whose own tests reach opposite verdicts on one conflict.

Group every conflict write in a run log by `(scenario, conflict id)`. When two
tests write the same conflict in the same scenario and disagree on `status` or
`preferred_assertion_id`, the run log contradicts itself: the evidence on file is
identical in both, so at most one verdict can be right and the suite currently
cannot say which. Issue #1972 V7; the rule and its evidence are stated in
`docs/deep-dives/conflict-resolution-findings-2026-08-27.md` § V7.

Offline and free: it reads committed run logs and the scenario fixtures. No model
calls, no network.

    cd eval/harness && uv run python -m conflict_verdict_report [--skill NAME]

## The trap this module exists to avoid

**Reading `changed_fields` alone finds nothing.** A run that correctly *declines*
to resolve writes `weighing_analysis` and `resolution_rationale` but leaves
`status` untouched, so the contradiction never appears in the diff. Measured
2026-09-08 across the 135 committed unit run logs:

    literal (changed_fields only)   0 hits
    effective (fixture fallback)    3 hits  (all flynn-multi-conflict/c_002)

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

So the value compared is the **effective post-run state**: `changed_fields[f].after`
where the field was written, and otherwise the value the scenario fixture started
with. A reader who implements the issue's "where to look" line verbatim gets a
clean green scan and concludes the corpus is consistent. `test_conflict_verdict_report.py`
pins that difference, because it is the whole finding.

## Why this is a report and not a validator

Two reasons, and the first is structural. A validator sees ONE run
(`validator_runner.py` passes a single before/after pair), and this rule is a
comparison BETWEEN tests inside a run log — there is no per-run vantage point from
which the contradiction is visible. Same reason `provenance_report.py` is a
report: it scans logs at rest.

Second, deciding *which* verdict is right is genealogy and stays with a human.
Noticing that the corpus contradicts itself is arithmetic, and that is all this
does. It exits 0 whatever it finds — triage the hits, do not gate on them.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

# The two fields a verdict consists of. `status` alone is not enough: a run can
# agree that a conflict is resolved and disagree about which assertion won.
VERDICT_FIELDS = ("status", "preferred_assertion_id")

_HERE = Path(__file__).resolve().parent
_EVAL = _HERE.parent
RUNLOGS_UNIT = _EVAL / "runlogs" / "unit"
SCENARIOS = _EVAL / "fixtures" / "scenarios"


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def scenario_conflicts(scenario: str, scenarios_dir: Path = SCENARIOS) -> dict[str, dict]:
    """The conflicts a scenario fixture starts with, by id.

    This is the fallback half of the effective-post-state reading. An absent or
    unreadable fixture yields `{}` rather than raising: a report must not die on
    one malformed fixture, and a missing fixture simply means no fallback value.
    """
    try:
        data = _load(scenarios_dir / scenario / "research.json")
    except (OSError, json.JSONDecodeError):
        # Absent (FileNotFoundError is an OSError) or malformed. A no-op `is_file`
        # pre-check stood here and was deleted: it was unreachable behind this
        # handler, and a mutation that removed it left the suite green.
        return {}
    out: dict[str, dict] = {}
    for c in data.get("conflicts") or []:
        if isinstance(c, dict) and c.get("id"):
            out[c["id"]] = c
    return out


def effective_verdict(
    changed_fields: dict[str, Any], fixture_conflict: dict[str, Any]
) -> tuple:
    """The post-run value of each verdict field.

    `changed_fields[f].after` when this run wrote the field, otherwise what the
    scenario started with. Reading only the first half is what makes the
    contradiction invisible — see the module docstring.
    """
    values = []
    for field in VERDICT_FIELDS:
        if field in changed_fields:
            entry = changed_fields[field]
            values.append(entry.get("after") if isinstance(entry, dict) else None)
        else:
            values.append(fixture_conflict.get(field))
    return tuple(values)


def conflicting_verdicts(
    runlog: dict[str, Any], scenarios_dir: Path = SCENARIOS
) -> list[dict[str, Any]]:
    """Every `(scenario, conflict id)` in one run log with more than one verdict.

    Only conflicts written by MORE THAN ONE test can contradict, so a group of
    one is never reported.
    """
    # (scenario, cid) -> verdict -> [test_id]
    groups: dict[tuple[str, str], dict[tuple, list[str]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for test in runlog.get("tests") or []:
        scenario = str(test.get("scenario") or "")
        test_id = str(test.get("test_id") or "?")
        base = scenario_conflicts(scenario, scenarios_dir) if scenario else {}
        for run in test.get("runs") or []:
            diff = (
                ((run.get("output") or {}).get("file_changes") or {}).get(
                    "research.json"
                )
                or {}
            ).get("diff") or {}
            conflicts = diff.get("conflicts") or {}
            for entry in conflicts.get("modified") or []:
                cid = entry.get("id")
                if not cid:
                    continue
                verdict = effective_verdict(
                    entry.get("changed_fields") or {}, base.get(cid) or {}
                )
                by_verdict = groups[(scenario, str(cid))]
                if test_id not in by_verdict[verdict]:
                    by_verdict[verdict].append(test_id)

    findings = []
    for (scenario, cid), by_verdict in sorted(groups.items()):
        if len(by_verdict) < 2:
            continue
        findings.append(
            {
                "scenario": scenario,
                "conflict_id": cid,
                "verdicts": {
                    v: sorted(tids) for v, tids in sorted(by_verdict.items(), key=str)
                },
            }
        )
    return findings


def _runlogs(skill: str | None) -> list[Path]:
    """Every committed candidate/released log, in no meaningful order — the scan
    visits all of them and selects no "newest", so #1629's `v10`-sorts-before-`v2`
    bug is not inherited here.

    Scratch logs are excluded: they are gitignored and partial, so a `--test` run
    has no sibling test to contradict. `.ann.json` siblings are excluded by the
    single-dot filter.
    """
    skills = [RUNLOGS_UNIT / skill] if skill else sorted(
        p for p in RUNLOGS_UNIT.iterdir() if p.is_dir()
    )
    out: list[Path] = []
    for d in skills:
        if not d.is_dir():
            continue
        out.extend(
            sorted(p for p in d.glob("v*.json") if p.name.count(".") == 1)
        )
    return out


def format_report(rows: list[tuple[str, str, list[dict[str, Any]]]]) -> str:
    lines: list[str] = []
    total = sum(len(f) for _, _, f in rows)
    scanned = len(rows)
    flagged = sum(1 for _, _, f in rows if f)

    lines.append("Contradictory conflict verdicts within a run log (issue #1972 V7)")
    lines.append("")
    if not total:
        lines.append(
            f"No contradictions across {scanned} committed run log(s). "
            "Note this reads the EFFECTIVE post-run state; a changed_fields-only "
            "reading reports zero even when the corpus does contradict itself."
        )
        return "\n".join(lines)

    for skill, name, findings in rows:
        if not findings:
            continue
        lines.append(f"{skill}/{name}")
        for f in findings:
            lines.append(f"  {f['scenario']} / {f['conflict_id']}")
            for verdict, tests in f["verdicts"].items():
                status, pref = verdict
                lines.append(
                    f"    status={status!r} preferred_assertion_id={pref!r}"
                    f"  <- {', '.join(tests)}"
                )
        lines.append("")

    lines.append(
        f"{total} contradiction(s) in {flagged} of {scanned} run log(s). "
        "The evidence on file is identical in each, so at most one verdict can be "
        "right; which one is a genealogist's call, not this report's."
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="conflict_verdict_report",
        description=(
            "Run logs whose own tests reach opposite verdicts on one conflict. "
            "Offline; exits 0 whatever it finds."
        ),
    )
    ap.add_argument("--skill", help="limit to one skill's run logs")
    args = ap.parse_args(argv)

    rows = []
    for path in _runlogs(args.skill):
        try:
            runlog = _load(path)
        except (OSError, json.JSONDecodeError):
            continue
        rows.append((path.parent.name, path.name, conflicting_verdicts(runlog)))

    print(format_report(rows))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
