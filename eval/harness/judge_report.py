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
  is 100% N/A in three suites, and `init-project`'s `Place standardization` — all
  its numeric scores identical, most of its gradings N/A — flips from unflagged to
  flagged if N/A counts toward the threshold.
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
    describe_window,
    run_date,
    staleness_cutoff,
)
from harness.review_sample import is_gradeable, is_mandatory
from harness.versioning import ann_filename_for
from skill_latency_report import (
    UNIT_RUNLOGS,
    all_skills,
    releasable_runlogs_for,
)

#: Fewest numeric gradings before a flat dimension is worth flagging. Below this a
#: single distinct score says more about the sample than about the rubric.
MIN_GRADED_INSTANCES = 5

#: Fewest same-direction disagreements before calling divergence *systematic*.
#: `rubric-critic` defines that flag as recurring "across multiple tests in the
#: same direction", so a lone correction is a judgement call, not a pattern.
MIN_DISAGREEMENTS_FOR_FLAG = 2

#: Verbatim from `.claude/agents/rubric-critic.md`, so the mechanical pass and the
#: LLM pass name the same defect the same way.
FLAG_NON_DISCRIMINATING = "Non-discriminating dimension"
FLAG_DIVERGENCE = "Systematic judge-vs-human divergence"

#: `rubric-critic`'s flag 3. This computes its first half only — the "no test
#: could ever fail on it" half needs the rubric as an input.
FLAG_UNEXERCISED = "Unexercised dimension"


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
    #: Gradings that were neither an int nor null — a float, a bool, a string.
    #: Reported rather than folded into `na`, because silently treating a real
    #: 2.0 as "not applicable" both hides a partial AND can flip the dimension
    #: into looking flat. Unreachable through the judge's tool schema today;
    #: nothing validates score types at write time, so it is cheap insurance.
    malformed: int = 0

    # -- annotation join (sparse; absent means NOT REVIEWED, never "agreed") --
    reviewed: int = 0
    agreements: int = 0
    judge_harsher: int = 0
    judge_softer: int = 0
    #: Disagreements where either side is null. Kept apart because N/A vs a number
    #: has no direction — and because `None > 3` raises, so these must never reach
    #: the comparison at all.
    n_a_disagreement: int = 0

    # -- selection split (additive; changes no flag above) -------------------
    #: Of `reviewed`, how many sat on a test the mandatory slot forced into the
    #: sample, and how many of those disagreed.
    #:
    #: The counters above stay exactly as they were, on purpose: the two
    #: dimensions currently meeting `systematic_divergence` must keep meeting it,
    #: and reclassifying them into a new bucket would hide a live finding behind
    #: a refactor. This pair exists so the reader can SEE the selection effect
    #: rather than have it silently move the headline.
    #:
    #: Why it is needed: the mandatory slot over-samples low-scored cells, and
    #: direction is one-way per score — a judge-1 cell can only ever produce
    #: `judge_harsher`, a judge-3 cell only `judge_softer`. So the harsher/softer
    #: split shifts from *selection*, not from the judge changing.
    reviewed_on_failing: int = 0
    disagreements_on_failing: int = 0

    @property
    def graded(self) -> int:
        return len(self.scores)

    @property
    def instances(self) -> int:
        """Every grading this dimension received, whatever shape it came in.

        Includes `malformed`: it is the denominator behind `unreviewed`, and a
        grading with an unreadable score is still a grading a human either did or
        did not review. Excluding it would quietly undercount what is outstanding.
        """
        return self.graded + self.na + self.malformed

    @property
    def distinct(self) -> list[int]:
        return sorted(set(self.scores))

    @property
    def always_na(self) -> bool:
        return self.graded == 0 and self.na > 0

    @property
    def non_discriminating(self) -> bool:
        """Enough numeric gradings to judge, and every one of them identical.

        A malformed grading blocks the verdict rather than being ignored. The
        claim here is "this dimension never varied", and an unreadable score is
        precisely the case where that cannot be asserted — a float `2.0` dropped
        from the count would leave five identical 3s and manufacture the flatness
        this report exists to detect.
        """
        return (
            self.graded >= MIN_GRADED_INSTANCES
            and len(self.distinct) == 1
            and self.malformed == 0
        )

    @property
    def disagreements(self) -> int:
        return self.judge_harsher + self.judge_softer + self.n_a_disagreement

    @property
    def systematic_divergence(self) -> bool:
        """`rubric-critic`'s definition, not merely "a human changed something".

        That agent defines the flag as a disagreement recurring **across multiple
        tests in the same direction**. One correction is a single judgement call;
        borrowing the flag name for it would make the two instruments disagree
        while claiming to agree — and today it would make 100% of this flag's
        output a false positive.

        **Deliberately no corpus count here.** This was written as a specific
        number and reviewed against a different one, and both were stale inside a
        day — in opposite directions — because a single landing run log moves it.

        It previously said no dimension had reached two same-direction
        corrections, so the flag "reports nothing on live data today". That is
        no longer true — it fires — which is exactly why the count does not
        belong here. Measure it with `make judge-report`; do not trust a number
        in this docstring.

        Read a firing dimension against the `of which on a failing test` line.
        The mandatory slot forces every failing test into the sample, and a
        low-scored cell can only disagree upward, so a same-direction run can
        come from selection rather than from miscalibration.

        N/A-vs-numeric is excluded: it has no direction to be consistent in.
        """
        return (
            max(self.judge_harsher, self.judge_softer) >= MIN_DISAGREEMENTS_FOR_FLAG
        )

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
            # `bool` is an `int` subclass in Python, so check it out explicitly —
            # otherwise a stray True grades as 1 and prints in `distinct` as `True`.
            if isinstance(score, bool):
                stats.malformed += 1
            elif isinstance(score, int):
                stats.scores.append(score)
            elif score is None:
                stats.na += 1
            else:
                stats.malformed += 1
    return [by_key[k] for k in sorted(by_key)]


def apply_annotation(
    dimensions: list[DimensionStats],
    annotation: dict[str, Any],
    mandatory_test_ids: frozenset[str] = frozenset(),
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
        on_failing = entry.get("test_id") in mandatory_test_ids
        if on_failing:
            stats.reviewed_on_failing += 1
        if llm == corrected:
            stats.agreements += 1
            continue
        if on_failing:
            stats.disagreements_on_failing += 1
        if not isinstance(llm, int) or not isinstance(corrected, int):
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
        mandatory = frozenset(
            t["test_id"]
            for t in (runlog.get("tests") or [])
            if is_gradeable(t) and is_mandatory(t)
        )
        apply_annotation(dimensions, _load(ann_path), mandatory)
    return SkillReport(
        skill=skill,
        runlog=path.name,
        dimensions=dimensions,
        annotation_missing=annotation_missing,
    )


def format_skill(report: SkillReport) -> str:
    stale = f"  [STALE {report.stale_days}d]" if report.stale_days is not None else ""
    lines = [f"{report.skill}  ({report.runlog}){stale}"]
    report_annotation_missing = report.annotation_missing
    if report_annotation_missing:
        lines.append("  (no .ann.json sibling — judge-vs-human columns are blank, not zero)")
    for d in report.dimensions:
        if d.always_na:
            verdict = f"{FLAG_UNEXERCISED}: always N/A ({d.na})"
        elif d.non_discriminating:
            verdict = f"{FLAG_NON_DISCRIMINATING}: always {d.distinct[0]}"
        elif d.graded < MIN_GRADED_INSTANCES:
            verdict = f"below threshold (n={d.graded} < {MIN_GRADED_INSTANCES})"
        else:
            verdict = f"varies {d.distinct}"
        na = f" +{d.na} N/A" if d.na else ""
        bad = f" +{d.malformed} MALFORMED" if d.malformed else ""
        # Pad the joined key, not the bare name — `base/` and `rubric/` differ in
        # width, so padding the name alone leaves the columns ragged.
        key = f"{d.source}/{d.name}"
        lines.append(f"  {key:52} n={d.graded:3}{na:9}{bad} {verdict}")

        # ALWAYS print the annotation counts, never only on disagreement. A
        # dimension reviewed with full agreement and one nobody looked at are
        # completely different states, and gating this line on `disagreements`
        # rendered them byte-identical — which is precisely the reading the
        # sparse-corrections rule exists to prevent.
        if report_annotation_missing:
            human = "      human review: (no .ann.json)"
        elif d.reviewed == 0:
            human = f"      human review: NONE — {d.unreviewed} grading(s) unreviewed"
        else:
            parts = [f"{d.agreements} agreed"]
            if d.judge_harsher:
                parts.append(f"{d.judge_harsher} judge-harsher")
            if d.judge_softer:
                parts.append(f"{d.judge_softer} judge-softer")
            if d.n_a_disagreement:
                parts.append(f"{d.n_a_disagreement} N/A-vs-numeric")
            flag = f"  [{FLAG_DIVERGENCE}]" if d.systematic_divergence else ""
            human = (
                f"      human review: {', '.join(parts)} of {d.reviewed} reviewed, "
                f"{d.unreviewed} unreviewed{flag}"
            )
            # The selection split, printed only when it is non-zero so a clean
            # suite's report is unchanged. Read the harsher/softer numbers above
            # against this line: the mandatory slot forces every failing test
            # into the sample, and a low-scored cell can only disagree upward.
            if d.reviewed_on_failing:
                human += (
                    f"\n        of which on a failing test: "
                    f"{d.reviewed_on_failing} reviewed, "
                    f"{d.disagreements_on_failing} disagreed"
                )
        lines.append(human)
    return "\n".join(lines)


def format_footer(reports: list[SkillReport]) -> str:
    """Totals, plus the two things a reader would otherwise infer wrongly."""
    dims = [d for r in reports for d in r.dimensions]
    flagged = [d for d in dims if d.non_discriminating]
    always_na = [d for d in dims if d.always_na]
    malformed = sum(d.malformed for d in dims)
    reviewed = sum(d.reviewed for d in dims)
    agreed = sum(d.agreements for d in dims)
    unreviewed = sum(d.unreviewed for d in dims)
    disagreements = sum(d.disagreements for d in dims)
    diverging = [d for d in dims if d.systematic_divergence]
    return "\n".join(
        [
            "",
            f"{FLAG_NON_DISCRIMINATING}: {len(flagged)} of {len(dims)} dimension "
            f"keys across {len(reports)} suite(s) "
            f"(>={MIN_GRADED_INSTANCES} numeric gradings, one distinct score).",
            f"{len(always_na)} meet {FLAG_UNEXERCISED.lower()} (always N/A) — a "
            f"different defect, never counted above."
            + (f" {malformed} grading(s) had a MALFORMED score (neither int nor null)."
               if malformed else ""),
            f"judge-vs-human: {agreed} agreed, {disagreements} disagreed over "
            f"{reviewed} reviewed correction entries; {unreviewed} grading(s) "
            f"UNREVIEWED (never counted as agreement). "
            f"{len(diverging)} dimension(s) meet {FLAG_DIVERGENCE.lower()} "
            f"(>={MIN_DISAGREEMENTS_FOR_FLAG} same-direction disagreements).",
            "",
            "Read a low disagreement count against the flagged column: where a dimension "
            "never varies, agreement mostly means both sides said the same thing every "
            "time, which is the ambiguity this report exists to surface rather than "
            "resolve.",
            "",
            "Not computed here: rubric-critic's 'Flaky / high-variance dimension'. "
            "runs_per_test is pinned to 1, so the flaky flag is dead by construction, "
            "not healthy: a silent flakiness column means this report is blind to it, "
            "never that the suite is stable. Re-run a suspect test with "
            "run_tests.py --test <id> to see whether it flaps, then fix it.",
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
    # Counted before the window so `describe_window` can say what it excluded.
    n_total = sum(1 for s in skills if releasable_runlogs_for(s))
    cutoff = staleness_cutoff()
    reports: list[SkillReport] = []
    stale: list[tuple[str, Any]] = []
    unmeasured: list[str] = []
    windowed_out: list[str] = []
    unreadable: list[tuple[str, str, str]] = []
    for skill in skills:
        # Two different reasons a skill can be absent, and they must not be
        # conflated: never measured at all, versus measured but outside the
        # window. Asking the windowed lookup alone cannot tell them apart, and
        # reporting the second as the first is a false statement about the
        # corpus — the more so because the window line above already counted it.
        if not releasable_runlogs_for(skill):
            # Only scratch_* run logs: never measured. A footer reading "across
            # N suite(s)" over a silently shorter list is the same omission this
            # reader flags staleness to avoid.
            unmeasured.append(skill)
            continue
        logs = releasable_runlogs_for(skill, cutoff=args.since)
        if not logs:
            windowed_out.append(skill)
            continue
        path = logs[-1]
        try:
            report = build_skill_report(skill, path)
        except (
            OSError,
            UnicodeDecodeError,
            json.JSONDecodeError,
            TypeError,
            AttributeError,
        ) as e:
            # One unreadable run log must not take the other 24 suites with it.
            # An analysis tool that dies on a single truncated file is one nobody
            # can use to diagnose the corpus it is meant to describe. Named on
            # stderr and excluded from every count, the way `e2e/corpus_report.py`
            # handles the same case.
            #
            # `UnicodeDecodeError` is listed explicitly because it is a
            # `ValueError`, NOT a `JSONDecodeError` — `_load` decodes before
            # `json` ever sees the bytes, so without it the guard misses the one
            # corruption this corpus actually produces. 19 files in the unit
            # corpus carry multibyte UTF-8 and two of them are read here, so a
            # write interrupted mid-character raises this rather than a JSON
            # error. Caught in review on #1485.
            unreadable.append((skill, path.name, str(e)))
            continue
        d = run_date(path)
        if d is not None and d < cutoff:
            report.stale_days = age_in_days(d)
            stale.append((skill, d))
        reports.append(report)

    if not reports:
        target = f" for skill {args.skill!r}" if args.skill else ""
        # Three different reasons the report can be empty, and each sends the
        # reader somewhere different: fix a file, widen the window, or run a
        # suite. Collapsing them into "none found" is the mislabelling this
        # module has now had to correct three times.
        if unreadable:
            for skill, name, err in unreadable:
                print(f"  skip {skill}/{name}: {err}", file=sys.stderr)
            print(
                f"No readable run logs{target}: "
                f"{len(unreadable)} run log(s) exist but could not be parsed (above).",
                file=sys.stderr,
            )
        elif windowed_out:
            # Say which fact is true. "No releasable run logs found" is false
            # here — they exist, the window excluded them — and it sends the
            # reader looking for a missing corpus instead of widening --since.
            # Same mislabelling the NOT MEASURED line carried.
            print(
                f"No run logs inside the window{target}: "
                f"{len(windowed_out)} skill(s) have releasable run logs, but none "
                f"on/after the --since cutoff. Widen it, or pass --since all.",
                file=sys.stderr,
            )
        else:
            print(f"No releasable run logs found{target}.", file=sys.stderr)
        return 1

    # Stale rows last, so a skim reaches the trustworthy numbers first.
    reports.sort(key=lambda r: (r.stale_days is not None, r.skill))
    # A passed SINCE genuinely drops suites from a one-row-per-skill report, so
    # say which and how many. Without this the report silently shrinks and still
    # reads like a whole-corpus measurement.
    if args.since is not None:
        print(describe_window(args.since, n_runs=len(reports), n_total=n_total, corpus="unit"))
        print()
    if unmeasured:
        print(
            f"NOT MEASURED: {len(unmeasured)} skill(s) have no releasable run log "
            f"(scratch runs only) — they are absent from every count below: "
            f"{', '.join(sorted(unmeasured))}"
        )
        print()
    if windowed_out:
        print(
            f"OUTSIDE THE WINDOW: {len(windowed_out)} skill(s) have a releasable run "
            f"log, but none inside --since — they are absent from every count below: "
            f"{', '.join(sorted(windowed_out))}"
        )
        print()
    if unreadable:
        for skill, name, err in unreadable:
            print(f"  skip {skill}/{name}: {err}", file=sys.stderr)
        print(
            f"UNREADABLE: {len(unreadable)} run log(s) could not be parsed and are "
            f"excluded from every count below (named on stderr)."
        )
        print()
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
