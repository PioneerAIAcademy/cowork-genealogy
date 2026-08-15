"""Non-discrimination scan for the *unit* eval judge — the free calibration pass.

The unit judge grades every unit run (`claude-haiku-4-5`, temperature pinned to 0)
and nothing measures it. `make e2e-calibrate` measures a *different* judge, on a
different model and cadence. `/audit-rubric` defines the right checks but runs one
skill at a time, by LLM judgment, only when someone remembers to invoke it — which
is how every judge defect so far was found: by hand, one suite at a time. Meanwhile
`skill-improver` reads these same scores and proposes SKILL.md edits from them, so
prose is being optimized toward an instrument no one has checked.

This is the mechanical half of that check: same definitions, no model call, every
suite in one command, computed entirely from committed data.

**A rubric dimension whose score never varies carries no signal, whatever it is
nominally grading.** That is the primary finding here. A second free signal sits in
the `.ann.json` corrections: how often the judge and a human disagreed, and in which
direction.

Two definitions do the work, and both are load-bearing:

* **`graded` counts numeric scores only.** An always-N/A dimension is a *different*
  defect from an always-3 one, so N/A is reported separately and never flags as
  non-discriminating. This changes answers, not just wording: `base/Tool Arguments`
  is 100% N/A in three suites, and `init-project`'s `Place standardization` (2
  numeric, 6 N/A) flips from unflagged to flagged if N/A counts toward the threshold.
* **A dimension is keyed `(skill, source, name)`.** Keying on `(source, name)` alone
  merges seven names across suites — all three base dimensions plus `Jurisdiction
  accuracy`, `Result triage`, `Actionability`, `Accuracy` — collapsing the corpus
  from ~169 keys to ~93 and averaging two suites' rubrics into one reading.

Scope, deliberately: **one run log per skill**, the newest released-or-candidate.
An older log's scores describe a SKILL.md and rubric that no longer exist, and that
depth read is `rubric-critic`'s job. The choice is not cosmetic — the two readings
disagree on roughly a third of dimensions.

And this reader **flags** stale run logs rather than filtering them (see
`eval/CLAUDE.md` § "Run log naming"): it shows one row per skill, so a date cut
would delete the skill entirely and hide the very fact worth acting on — that it
needs a re-run.

Pure analysis over committed JSON — **no live run, no API call, no cost**.

CLI (from eval/harness/):
  uv run python -m judge_report
  uv run python -m judge_report --skill research-plan
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from harness.since_window import (
    add_since_arg,
    age_in_days,
    describe_stale,
    run_date,
    staleness_cutoff,
)
from harness.versioning import ann_filename_for
from skill_latency_report import (
    UNIT_RUNLOGS,
    all_skills,
    releasable_runlogs_for,
)

#: Fewest numeric gradings before a flat dimension is worth flagging. Below this a
#: single distinct score says more about the sample than about the rubric.
MIN_GRADED_INSTANCES = 5

#: Verbatim from `.claude/agents/rubric-critic.md`, so the mechanical pass and the
#: LLM pass name the same defect the same way.
FLAG_NON_DISCRIMINATING = "Non-discriminating dimension"
FLAG_DIVERGENCE = "Systematic judge-vs-human divergence"


@dataclass
class DimensionStats:
    """One `(skill, source, name)` dimension's grading profile in one run log."""

    skill: str
    source: str
    name: str
    #: Numeric scores in grading order. N/A (null) is NOT in here — see `na`.
    scores: list[int] = field(default_factory=list)
    #: How many gradings returned N/A (null) rather than 1/2/3.
    na: int = 0

    # -- annotation join (sparse; absent means NOT REVIEWED, never "agreed") --
    reviewed: int = 0
    agreements: int = 0
    judge_harsher: int = 0
    judge_softer: int = 0
    #: Disagreements where either side is null. Kept apart because N/A vs a number
    #: has no direction — and because `None > 3` raises, so these must never reach
    #: the comparison at all.
    n_a_disagreement: int = 0

    @property
    def graded(self) -> int:
        return len(self.scores)

    @property
    def instances(self) -> int:
        return self.graded + self.na

    @property
    def distinct(self) -> list[int]:
        return sorted(set(self.scores))

    @property
    def always_na(self) -> bool:
        return self.graded == 0 and self.na > 0

    @property
    def non_discriminating(self) -> bool:
        """Enough numeric gradings to judge, and every one of them identical."""
        return self.graded >= MIN_GRADED_INSTANCES and len(self.distinct) == 1

    @property
    def disagreements(self) -> int:
        return self.judge_harsher + self.judge_softer + self.n_a_disagreement

    @property
    def unreviewed(self) -> int:
        """Gradings with no correction entry. Reported, never a denominator."""
        return max(0, self.instances - self.reviewed)


@dataclass
class SkillReport:
    skill: str
    runlog: str
    dimensions: list[DimensionStats]
    #: Age in days when the run log is past the staleness cutoff, else None.
    stale_days: int | None = None
    #: True when the run log had no `.ann.json` sibling at all.
    annotation_missing: bool = False


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def collect_dimensions(runlog: dict[str, Any], skill: str) -> list[DimensionStats]:
    """Per-dimension grading profile from one run log.

    Reads `tests[].outcome_summary.aggregated_dimensions[]` — **not**
    `tests[].dimensions[]`, which does not exist. Getting this wrong prints zeros
    for every suite while every synthetic fixture still passes, which is why one
    test in the suite reads a real committed log.

    `runlog.aggregate_dimensions` has already collapsed a test's runs to one modal
    score per dimension, so reading this path cannot double-count a multi-run test.
    """
    by_key: dict[tuple[str, str], DimensionStats] = {}
    for test in runlog.get("tests") or []:
        summary = test.get("outcome_summary") or {}
        for dim in summary.get("aggregated_dimensions") or []:
            source = str(dim.get("source") or "")
            name = str(dim.get("name") or "")
            key = (source, name)
            stats = by_key.get(key)
            if stats is None:
                stats = DimensionStats(skill=skill, source=source, name=name)
                by_key[key] = stats
            score = dim.get("score")
            if isinstance(score, int):
                stats.scores.append(score)
            else:
                stats.na += 1
    return [by_key[k] for k in sorted(by_key)]


def apply_annotation(
    dimensions: list[DimensionStats], annotation: dict[str, Any]
) -> None:
    """Fold `.ann.json` corrections into the matching dimensions, in place.

    Corrections are **sparse**: an entry exists only for a dimension a human
    actually reviewed, so a missing entry means *not reviewed* and must never be
    counted as agreement. Every count here is over entries that exist.

    Direction is signed — `corrected > llm` means the judge graded harsher than the
    human. Either score may be null (the schema allows N/A on both sides), and
    `None > 3` raises `TypeError`, so a null on either side is bucketed as
    `n_a_disagreement` before any comparison happens.
    """
    index = {(d.source, d.name): d for d in dimensions}
    for entry in annotation.get("corrections") or []:
        key = (str(entry.get("dimension_source") or ""), str(entry.get("dimension_name") or ""))
        stats = index.get(key)
        if stats is None:
            continue
        llm, corrected = entry.get("llm_score"), entry.get("corrected_score")
        stats.reviewed += 1
        if llm == corrected:
            stats.agreements += 1
        elif not isinstance(llm, int) or not isinstance(corrected, int):
            stats.n_a_disagreement += 1
        elif corrected > llm:
            stats.judge_harsher += 1
        else:
            stats.judge_softer += 1


def build_skill_report(skill: str, path: Path) -> SkillReport:
    runlog = _load(path)
    dimensions = collect_dimensions(runlog, skill)
    ann_path = path.parent / ann_filename_for(path.name)
    annotation_missing = not ann_path.exists()
    if not annotation_missing:
        apply_annotation(dimensions, _load(ann_path))
    return SkillReport(
        skill=skill,
        runlog=path.name,
        dimensions=dimensions,
        annotation_missing=annotation_missing,
    )


def format_skill(report: SkillReport) -> str:
    stale = f"  [STALE {report.stale_days}d]" if report.stale_days is not None else ""
    lines = [f"{report.skill}  ({report.runlog}){stale}"]
    if report.annotation_missing:
        lines.append("  (no .ann.json sibling — judge-vs-human columns are blank, not zero)")
    for d in report.dimensions:
        if d.always_na:
            verdict = f"always-N/A ({d.na})"
        elif d.non_discriminating:
            verdict = f"{FLAG_NON_DISCRIMINATING}: always {d.distinct[0]}"
        elif d.graded < MIN_GRADED_INSTANCES:
            verdict = f"below threshold (n={d.graded} < {MIN_GRADED_INSTANCES})"
        else:
            verdict = f"varies {d.distinct}"
        na = f" +{d.na} N/A" if d.na else ""
        # Pad the joined key, not the bare name — `base/` and `rubric/` differ in
        # width, so padding the name alone leaves the columns ragged.
        key = f"{d.source}/{d.name}"
        lines.append(f"  {key:52} n={d.graded:3}{na:9} {verdict}")
        if d.disagreements:
            parts = []
            if d.judge_harsher:
                parts.append(f"{d.judge_harsher} judge-harsher")
            if d.judge_softer:
                parts.append(f"{d.judge_softer} judge-softer")
            if d.n_a_disagreement:
                parts.append(f"{d.n_a_disagreement} N/A-vs-numeric")
            lines.append(
                f"      {FLAG_DIVERGENCE}: {', '.join(parts)} "
                f"of {d.reviewed} reviewed ({d.unreviewed} unreviewed)"
            )
    return "\n".join(lines)


def format_footer(reports: list[SkillReport]) -> str:
    """Totals, plus the two things a reader would otherwise infer wrongly."""
    dims = [d for r in reports for d in r.dimensions]
    flagged = [d for d in dims if d.non_discriminating]
    always_na = [d for d in dims if d.always_na]
    reviewed = sum(d.reviewed for d in dims)
    disagreements = sum(d.disagreements for d in dims)
    return "\n".join(
        [
            "",
            f"{FLAG_NON_DISCRIMINATING}: {len(flagged)} of {len(dims)} dimension "
            f"keys across {len(reports)} suite(s) "
            f"(>={MIN_GRADED_INSTANCES} numeric gradings, one distinct score).",
            f"{len(always_na)} are always-N/A — a different defect, never counted above.",
            f"judge-vs-human: {disagreements} disagreement(s) over {reviewed} reviewed "
            f"correction entries. A dimension with no entry is UNREVIEWED, not agreed.",
            "",
            "Read a low disagreement count against the flagged column: where a dimension "
            "never varies, agreement mostly means both sides said the same thing every "
            "time, which is the ambiguity this report exists to surface rather than "
            "resolve.",
            "",
            "Not computed here: rubric-critic's 'Flaky / high-variance dimension' is out "
            "of reach for an offline single-log reader — runs_per_test is pinned to 1, so "
            "there is no within-test variance to measure.",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Non-discrimination scan for the unit eval judge. Reads committed run "
            "logs and annotations only — no model call, no cost."
        )
    )
    ap.add_argument("--skill", help="restrict to one skill")
    # default="all" is deliberate and load-bearing: the shared default is 14 days,
    # which would silently drop the stale suites this report exists to show. A
    # one-row-per-skill reader flags staleness instead of filtering it.
    add_since_arg(ap, default="all")
    args = ap.parse_args(argv)

    if not UNIT_RUNLOGS.is_dir():
        print(f"No unit run logs at {UNIT_RUNLOGS}.", file=sys.stderr)
        return 1

    skills = [args.skill] if args.skill else all_skills()
    cutoff = staleness_cutoff()
    reports: list[SkillReport] = []
    stale: list[tuple[str, Any]] = []
    for skill in skills:
        logs = releasable_runlogs_for(skill, cutoff=args.since)
        if not logs:
            continue
        path = logs[-1]
        report = build_skill_report(skill, path)
        d = run_date(path)
        if d is not None and d < cutoff:
            report.stale_days = age_in_days(d)
            stale.append((skill, d))
        reports.append(report)

    if not reports:
        target = f" for skill {args.skill!r}" if args.skill else ""
        print(f"No releasable run logs found{target}.", file=sys.stderr)
        return 1

    # Stale rows last, so a skim reaches the trustworthy numbers first.
    reports.sort(key=lambda r: (r.stale_days is not None, r.skill))
    if (note := describe_stale(stale)):
        print(note)
        print()
    for report in reports:
        print(format_skill(report))
        print()
    print(format_footer(reports))
    return 0


if __name__ == "__main__":
    sys.exit(main())
