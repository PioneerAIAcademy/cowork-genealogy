"""Judge calibration — measure judge-vs-human agreement, offline.

The e2e judge is graded *by* this loop and used *in* the e2e pipeline. Its
accuracy must be established here, in the cheap offline loop — never inferred from
expensive live e2e runs. This script runs ONLY the judge (no agent, no live
FamilySearch) against committed human grades, and reports agreement.

See docs/plan/e2e-annotation-calibration.md and docs/specs/e2e-test-spec.md §7.

## Where the grades live

A human grade is a per-run annotation file committed beside the run log it
grades: ``eval/runlogs/e2e/<slug>/run-<ts>.ann.json``. Its presence *is* the
selection — there is no separate calibration-case directory. The file is flat and
small; the human authors only recall labels:

  {
    "annotator": "alice",                  # optional (git blame is the fallback)
    "per_finding": { "f1": "true", "f2": "partial" },    # required; the gate
    "proof_quality_score": 2,              # optional advisory axis (1|2|3|null)
    "notes": { "f2": "year-only date — date-precision call." }   # optional, per-finding
  }

``per_finding`` values are ``true`` / ``partial`` / ``false``. The per-run
**verdict is derived**, not authored (see ``derive_verdict``). Everything else the
judge needs — research_question, expected_findings, final_tree, final_research —
is read from the fixture and the run-log siblings at calibration time.

## Grading integrity (why the number is trustworthy)

- Annotations are never auto-created; a human asks Claude Code to grade a run.
- Grading is blind: the grade flow reads the fixture + the two ``final-*``
  siblings, never ``run-<ts>.json`` (where the judge's own labels live), so the
  human label is arrived at independently of the judge under test.
- An incomplete grade (any ``per_finding`` value null) is detected, warned about,
  and skipped — it cannot inflate the agreement number.

## Target

>=80% per-finding **recall** agreement (~ human inter-rater agreement) — the gate.
Proof-quality agreement is reported alongside but does not gate. Inspect every
disagreement; the disagreements are the signal, not the headline number.

## Usage (from eval/harness/)

  uv run python -m e2e.calibrate_judge                # default roots
  uv run python -m e2e.calibrate_judge --dry-run      # no API calls; classify only
  uv run python -m e2e.calibrate_judge --runlog-root P --fixtures-root P
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from e2e import judge as judge_module
from e2e.judge import derive_verdict  # shared with apply_avoid_guard; re-exported for our callers


# NOTE: these mirror e2e.orchestrator's DEFAULT_RUNLOG_ROOT / DEFAULT_FIXTURES_ROOT
# but we deliberately do NOT import them from there — orchestrator pulls in
# claude_agent_sdk at import time, and calibration must stay importable and
# runnable offline (no agent SDK; --dry-run does zero API work).
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_RUNLOG_ROOT = REPO_ROOT / "eval" / "runlogs" / "e2e"
DEFAULT_FIXTURES_ROOT = REPO_ROOT / "eval" / "tests" / "e2e"

PER_FINDING_TARGET = 0.80  # ~ human inter-rater agreement

FINDING_LABELS = {"true", "partial", "false"}
ALLOWED_ANN_KEYS = {"annotator", "per_finding", "proof_quality_score", "notes"}


# Verdict derivation lives in e2e.judge (`derive_verdict`, re-exported above) —
# it is shared with apply_avoid_guard's recompute.


# --------------------------------------------------------------------------- #
# Per-case grading + aggregation (unchanged math; the gate)
# --------------------------------------------------------------------------- #

@dataclass
class CaseResult:
    case_id: str
    # Per-finding agreement on this case (the primary recall metric).
    finding_total: int = 0
    finding_agreed: int = 0
    finding_disagreements: list[str] = field(default_factory=list)
    # Per-run verdict agreement (computed, but no longer printed — the human
    # verdict is derived, so this is a coarsened echo of per-finding agreement).
    run_agreed: bool | None = None
    human_verdict: str | None = None
    judge_verdict: str | None = None
    # Proof-quality agreement — only scored when the case carries a human
    # proof_quality_score (the soft axis, calibrated separately).
    pq_agreed: bool | None = None
    human_pq: int | None = None
    judge_pq: int | None = None
    error: str | None = None


def _judge_per_finding(judge_output: dict[str, Any]) -> dict[str, str]:
    """Map finding_id -> judge `matched` label from a judge_output object."""
    return {
        str(pf.get("finding_id")): str(pf.get("matched"))
        for pf in judge_output.get("per_finding") or []
    }


def grade_case(
    case: dict[str, Any],
    *,
    model: str,
    client: Any | None = None,
    run_judge=judge_module.run_judge,
) -> CaseResult:
    """Run the judge on one case and compare to the human labels.

    `run_judge` is injectable so tests can drive this without an API call.
    """
    cid = str(case.get("id", "?"))
    result = CaseResult(case_id=cid)
    human = case["human"]
    human_pf: dict[str, str] = human["per_finding"]
    human_notes: dict[str, str] = human.get("notes") or {}
    result.human_verdict = human["verdict"]

    try:
        judge_output = run_judge(
            research_question=case["research_question"],
            expected_findings=case["expected_findings"],
            final_tree=case["final_tree"],
            final_research=case.get("final_research"),
            model=model,
            client=client,
        )
        # Calibration must measure the grader the pipeline actually runs,
        # which is judge + avoid-guard (the deterministic §3.4.1 backstop),
        # not the raw model output.
        judge_output = judge_module.apply_avoid_guard(
            judge_output,
            expected_findings=case["expected_findings"],
            final_tree=case["final_tree"],
            subject_person_ids=case.get("subject_person_ids"),
        )
    except Exception as e:  # noqa: BLE001 — record, don't abort the sweep
        result.error = f"{type(e).__name__}: {e}"
        return result

    result.judge_verdict = str(judge_output.get("verdict"))
    result.run_agreed = result.judge_verdict == result.human_verdict

    judge_pf = _judge_per_finding(judge_output)
    for fid, human_label in human_pf.items():
        result.finding_total += 1
        judge_label = judge_pf.get(fid)
        if judge_label == human_label:
            result.finding_agreed += 1
        else:
            msg = f"{cid}/{fid}: human={human_label} judge={judge_label}"
            note = human_notes.get(fid)
            if note:
                msg += f"\n      note: {note}"
            result.finding_disagreements.append(msg)

    # Proof-quality agreement, only when the human labeled it.
    if "proof_quality_score" in human:
        result.human_pq = human["proof_quality_score"]
        result.judge_pq = (judge_output.get("proof_quality") or {}).get("score")
        result.pq_agreed = result.judge_pq == result.human_pq

    return result


@dataclass
class CalibrationReport:
    results: list[CaseResult]

    @property
    def finding_total(self) -> int:
        return sum(r.finding_total for r in self.results)

    @property
    def finding_agreed(self) -> int:
        return sum(r.finding_agreed for r in self.results)

    @property
    def per_finding_agreement(self) -> float:
        return self.finding_agreed / self.finding_total if self.finding_total else 0.0

    @property
    def run_results(self) -> list[CaseResult]:
        return [r for r in self.results if r.run_agreed is not None]

    @property
    def run_agreement(self) -> float:
        scored = self.run_results
        return (sum(1 for r in scored if r.run_agreed) / len(scored)) if scored else 0.0

    @property
    def pq_results(self) -> list[CaseResult]:
        return [r for r in self.results if r.pq_agreed is not None]

    @property
    def pq_agreement(self) -> float:
        scored = self.pq_results
        return (sum(1 for r in scored if r.pq_agreed) / len(scored)) if scored else 0.0

    @property
    def errors(self) -> list[CaseResult]:
        return [r for r in self.results if r.error]

    @property
    def meets_target(self) -> bool:
        # The gate is recall (per-finding) agreement — the objective axis.
        # Proof-quality agreement is reported but does not gate, mirroring how
        # proof quality is advisory in the verdict itself.
        return self.per_finding_agreement >= PER_FINDING_TARGET and not self.errors


# --------------------------------------------------------------------------- #
# Loader: assemble cases from annotations + run-log siblings + fixtures
# --------------------------------------------------------------------------- #

@dataclass
class LoaderProblem:
    """One excluded annotation. severity 'warn' is benign (incomplete grade);
    'error' needs action and drives a non-zero exit. Either way the file is
    excluded and the sweep continues."""
    file: str
    severity: str  # "warn" | "error"
    message: str


def _rel(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _group_by_slug(results: list[CaseResult]) -> dict[str, list[CaseResult]]:
    groups: dict[str, list[CaseResult]] = {}
    for r in results:
        slug = r.case_id.split("/", 1)[0]
        groups.setdefault(slug, []).append(r)
    return groups


def load_annotated_runs(
    runlog_root: Path,
    fixtures_root: Path,
) -> tuple[list[dict[str, Any]], list[LoaderProblem]]:
    """Discover + classify every ``<slug>/run-<ts>.ann.json`` under runlog_root.

    Returns ``(included_cases, problems)``. Never aborts mid-walk: each problem
    excludes only its one file. The classification order matters — an *incomplete*
    grade is inert and must never hard-fail on a problem in its surroundings, so
    the null-check sits above the fixture / tree / drift checks:

        1. invalid JSON / not an object          -> ERROR  (can't classify)
        2. unknown key, or no `per_finding`      -> ERROR  (structural typo)
        3. any per_finding value null            -> WARN + SKIP (incomplete; inert)
        4. fixture / expected-findings unreadable-> ERROR  (orphaned filled grade)
        5. <stem>.final-tree.gedcomx.json missing-> ERROR  (ungradeable filled grade)
        6. per_finding keys != fixture ids       -> ERROR  (drift; re-grade or delete)
        7. bad enum (label / proof_quality_score)-> ERROR
        8. valid, keys match                     -> INCLUDE (derive verdict)

    Included cases are in the internal shape ``grade_case`` consumes.
    """
    cases: list[dict[str, Any]] = []
    problems: list[LoaderProblem] = []

    for ann_path in sorted(runlog_root.glob("*/run-*.ann.json")):
        rel = _rel(ann_path)

        def err(msg: str) -> None:
            problems.append(LoaderProblem(rel, "error", f"{rel}: {msg}"))

        # 1. parse
        try:
            ann = json.loads(ann_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            err(f"invalid JSON: {e}")
            continue
        if not isinstance(ann, dict):
            err("expected a JSON object")
            continue

        # 2. structural — known keys + per_finding present
        unknown = set(ann) - ALLOWED_ANN_KEYS
        if unknown:
            err(f"unknown key(s) {sorted(unknown)} (allowed: {sorted(ALLOWED_ANN_KEYS)})")
            continue
        per_finding = ann.get("per_finding")
        if not isinstance(per_finding, dict) or not per_finding:
            err("'per_finding' missing or not a non-empty object")
            continue

        # 3. incomplete (inert) — wins over orphaned / missing-tree / drift
        if any(v is None for v in per_finding.values()):
            problems.append(LoaderProblem(
                rel, "warn",
                f"{rel}: ungraded (a per_finding label is null) — skipped"))
            continue

        # 4. fixture + expected-findings (only for FILLED grades)
        stem = ann_path.name[: -len(".ann.json")]  # run-<ts>
        slug = ann_path.parent.name
        fixture_dir = fixtures_root / slug
        try:
            expected = json.loads(
                (fixture_dir / "expected-findings.json").read_text(encoding="utf-8"))
            fixture = json.loads(
                (fixture_dir / "fixture.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            err(f"fixture for slug '{slug}' unreadable ({e})")
            continue

        # 5. final-tree sibling (the judge's input)
        tree_path = ann_path.parent / f"{stem}.final-tree.gedcomx.json"
        if not tree_path.exists():
            err(f"{tree_path.name} missing — nothing to grade")
            continue
        try:
            final_tree = json.loads(tree_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            err(f"{tree_path.name} unreadable ({e})")
            continue
        research_path = ann_path.parent / f"{stem}.final-research.json"
        final_research = None
        if research_path.exists():
            try:
                final_research = json.loads(research_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as e:
                err(f"{research_path.name} unreadable ({e})")
                continue

        # 6. drift — keys must equal the fixture's finding ids
        findings = expected.get("findings") or []
        fixture_ids = {str(f.get("id")) for f in findings}
        ann_ids = set(per_finding)
        if ann_ids != fixture_ids:
            err(f"per_finding keys {sorted(ann_ids)} != fixture findings "
                f"{sorted(fixture_ids)} — fixture changed; re-grade or delete")
            continue

        # 7. enums (filled values)
        bad = {fid: v for fid, v in per_finding.items() if v not in FINDING_LABELS}
        if bad:
            err(f"per_finding labels {bad} not in {sorted(FINDING_LABELS)}")
            continue
        pq = ann.get("proof_quality_score")
        if pq not in (1, 2, 3, None):
            err(f"proof_quality_score {pq!r} not 1/2/3/null")
            continue
        notes = ann.get("notes")
        if notes is not None:
            if not isinstance(notes, dict):
                err("'notes' must be a {finding_id: text} object")
                continue
            note_unknown = set(notes) - ann_ids
            if note_unknown:
                err(f"notes for unknown finding(s) {sorted(note_unknown)}")
                continue

        # 8. INCLUDE — assemble the internal case (verdict derived)
        human: dict[str, Any] = {
            "verdict": derive_verdict(per_finding, findings),
            "per_finding": per_finding,
        }
        if notes:
            human["notes"] = notes
        if "proof_quality_score" in ann:
            human["proof_quality_score"] = ann["proof_quality_score"]
        # Subject id(s) for the avoid-guard's subject exemption — a real
        # source_pid plus final_research's project.subject_person_ids.
        subject_ids: set[str] = set()
        src = fixture.get("source_pid")
        if src and "TODO" not in str(src):
            subject_ids.add(str(src))
        if final_research:
            for sid in (final_research.get("project") or {}).get("subject_person_ids") or []:
                subject_ids.add(str(sid))
        cases.append({
            "id": f"{slug}/{stem}",
            "research_question": fixture.get("researcher_question", ""),
            "expected_findings": expected,
            "final_tree": final_tree,
            "final_research": final_research,
            "subject_person_ids": sorted(subject_ids),
            "human": human,
        })

    return cases, problems


# --------------------------------------------------------------------------- #
# Report + CLI
# --------------------------------------------------------------------------- #

def print_report(report: CalibrationReport) -> None:
    print()
    print("=== Judge calibration ===")
    print(
        f"per-finding agreement: {report.per_finding_agreement:.0%} "
        f"({report.finding_agreed}/{report.finding_total})   "
        f"target >={PER_FINDING_TARGET:.0%}"
    )
    if report.pq_results:
        print(
            f"proof-quality agreement (advisory, not gating): "
            f"{report.pq_agreement:.0%} "
            f"({sum(1 for r in report.pq_results if r.pq_agreed)}/{len(report.pq_results)})"
        )
    # Per-slug breakdown — the detector for count-skew (deferred macro-average).
    by_slug = _group_by_slug(report.results)
    if by_slug:
        print("  by slug:")
        for slug in sorted(by_slug):
            rs = by_slug[slug]
            agreed = sum(r.finding_agreed for r in rs)
            total = sum(r.finding_total for r in rs)
            pct = (agreed / total) if total else 0.0
            n = len(rs)
            print(f"    {slug:<28} {pct:>4.0%} ({agreed}/{total})  "
                  f"{n} graded run{'s' if n != 1 else ''}")
    disagreements = [d for r in report.results for d in r.finding_disagreements]
    if disagreements:
        print("\ndisagreements (inspect each — these are the signal):")
        for d in disagreements:
            print(f"  - {d}")
    if report.errors:
        print("\njudge errors (these block the target):")
        for r in report.errors:
            print(f"  - {r.case_id}: {r.error}")
    verdict = "MEETS target" if report.meets_target else "BELOW target"
    print(f"\n{verdict}.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="e2e.calibrate_judge",
        description="Measure judge-vs-human agreement against committed run annotations.",
    )
    parser.add_argument(
        "--runlog-root", type=Path, default=DEFAULT_RUNLOG_ROOT,
        help=f"Root of e2e run logs + .ann.json grades. Default: {DEFAULT_RUNLOG_ROOT}",
    )
    parser.add_argument(
        "--fixtures-root", type=Path, default=DEFAULT_FIXTURES_ROOT,
        help=f"Root of e2e fixtures. Default: {DEFAULT_FIXTURES_ROOT}",
    )
    parser.add_argument(
        "--model", default=None,
        help="Override the judge model (else the default).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Classify annotations without calling the judge API.",
    )
    args = parser.parse_args(argv)

    if not args.runlog_root.is_dir():
        print(
            f"Run-log root not found: {args.runlog_root}\n"
            "Run a fixture and grade it (see docs/e2e-testing-guide.md -> "
            "Judge calibration).",
            file=sys.stderr,
        )
        return 2

    cases, problems = load_annotated_runs(args.runlog_root, args.fixtures_root)
    warnings = [p for p in problems if p.severity == "warn"]
    errors = [p for p in problems if p.severity == "error"]

    for w in warnings:
        print(f"WARN: {w.message}", file=sys.stderr)
    for e in errors:
        print(f"ERROR: {e.message}", file=sys.stderr)

    model = args.model or judge_module.DEFAULT_JUDGE_MODEL

    if args.dry_run:
        print(
            f"\n{len(cases)} graded annotation(s) ready; "
            f"{len(warnings)} ungraded skipped; {len(errors)} error(s). "
            f"Judge model: {model}"
        )
        if not cases and not errors:
            print("Nothing graded yet — grade a run (see the guide).")
        print("(--dry-run: no judge API calls made.)")
        return 2 if errors else 0

    if not cases:
        print(
            "\nNothing graded yet — no complete annotations to calibrate against.",
            file=sys.stderr,
        )
        return 2

    results = [grade_case(case, model=model) for case in cases]
    report = CalibrationReport(results=results)
    print_report(report)
    if errors:
        return 2
    return 0 if report.meets_target else 1


if __name__ == "__main__":
    sys.exit(main())
