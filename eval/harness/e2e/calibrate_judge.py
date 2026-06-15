"""Judge calibration — measure judge-vs-human agreement, offline.

The e2e judge is graded *by* this loop and used *in* the e2e pipeline.
Its accuracy must be established here, in the cheap offline loop — never
inferred from expensive live e2e runs. This script runs ONLY the judge
(no agent, no live FamilySearch) against a frozen, hand-graded set of
cases, and reports agreement.

See `docs/plan/e2e-skills.md` → "Judge calibration set".

## The calibration set

A committed **directory** of per-file cases —
`eval/tests/e2e/calibration/cases/`, one JSON case object per file
(`<slug>-<who>.json`). One file per fixture/grader means ten teams
contribute without conflicting on a shared file. There is no monolithic
`cases.json`. Seed each file from a real run with
`e2e.seed_calibration_case`, then fill in the `human` block.

Each case pins what a *human* judged so we can compare the model:

  {
    "id": "robert-smith-clean",
    "model": "claude-opus-4-8",            # optional: pin the judge model
    "research_question": "Who were John Smith's parents?",
    "expected_findings": { "findings": [ ... ] },   # same shape as a fixture's
    "final_tree": { "persons": [ ... ] },           # real simplified GedcomX
    "final_research": { "proof_summaries": [ ... ] },  # optional; for proof-quality
    "human": {
      "verdict": "pass",                            # per-RUN human verdict
      "per_finding": { "f1": "true", "f2": "partial" },  # per-FINDING human labels
      "proof_quality_score": 2                      # optional: 1|2|3|null
    },
    "notes": "why this case is here / what makes it a hard call"
  }

`human.per_finding` maps each finding id to the human's `matched` label
(`true` / `partial` / `false`). It is the **primary** metric: per-finding
recall agreement is what discriminates a good judge from a confident-but-
wrong one (the per-run verdict is dominated by easy passes and inflates
the number). `human.verdict` is the secondary, per-run check.

`final_research` + `human.proof_quality_score` are **optional** — include
them only on cases that carry a proof summary worth grading. They
calibrate the *soft* axis (proof quality), which is graded and trusted
separately from recall: it is noisier and needs its own hard cases (a
strong proof, a single-source over-claim, a missing conflict resolution).
Proof-quality agreement is **reported but does not gate** — mirroring how
proof quality is advisory in the verdict. Only recall agreement gates.

## Target

≥80% per-finding **recall** agreement (≈ human inter-rater agreement) —
this is the gate. Proof-quality agreement is reported alongside but does
not gate; treat it as genuinely unproven until the set has enough hard
proof cases. Inspect every disagreement — the disagreements are the
signal, not the headline number.

## Usage (from eval/harness/)

  uv run python -m e2e.calibrate_judge                          # default cases dir
  uv run python -m e2e.calibrate_judge --cases-dir path/to/cases
  uv run python -m e2e.calibrate_judge --dry-run               # no API calls; lint the set
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from e2e import judge as judge_module


REPO_ROOT = Path(__file__).resolve().parents[3]
# Multi-contributor layout: a directory of per-file cases, one (or a few)
# per file, so ten teams don't conflict on a single JSON file. There is
# deliberately NO monolithic cases.json — per-file is the only layout.
DEFAULT_CASES_DIR = REPO_ROOT / "eval" / "tests" / "e2e" / "calibration" / "cases"

PER_FINDING_TARGET = 0.80  # ≈ human inter-rater agreement


@dataclass
class CaseResult:
    case_id: str
    # Per-finding agreement on this case (the primary recall metric).
    finding_total: int = 0
    finding_agreed: int = 0
    finding_disagreements: list[str] = field(default_factory=list)
    # Per-run verdict agreement.
    run_agreed: bool | None = None
    human_verdict: str | None = None
    judge_verdict: str | None = None
    # Proof-quality agreement — only scored when the case carries a human
    # proof_quality_score (the soft axis is calibrated separately, on the
    # subset of cases that have a proof summary worth grading).
    pq_agreed: bool | None = None
    human_pq: int | None = None
    judge_pq: int | None = None
    error: str | None = None


def _validate_case(case: dict[str, Any], label: str) -> list[str]:
    """Structural lint of one case. Returns a list of problems (empty = ok).

    `label` identifies the case in error messages — the source filename, so
    a contributor knows exactly which file to open and fix.
    """
    problems: list[str] = []
    cid = label
    for key in ("research_question", "expected_findings", "final_tree", "human"):
        if key not in case:
            problems.append(f"case {cid}: missing '{key}'")
    human = case.get("human") or {}
    if "verdict" not in human:
        problems.append(f"case {cid}: human.verdict missing")
    elif human["verdict"] not in {"pass", "partial", "fail"}:
        problems.append(
            f"case {cid}: human.verdict {human['verdict']!r} not pass/partial/fail"
        )
    pf = human.get("per_finding")
    if not isinstance(pf, dict) or not pf:
        problems.append(f"case {cid}: human.per_finding missing or empty")
    else:
        for fid, label in pf.items():
            if label not in {"true", "partial", "false"}:
                problems.append(
                    f"case {cid}: human.per_finding[{fid}] = {label!r} "
                    "not true/partial/false"
                )
    # Optional: human proof-quality label. Present only on cases that carry
    # a final_research proof summary worth calibrating the soft axis against.
    if "proof_quality_score" in human:
        pq = human["proof_quality_score"]
        if pq not in (1, 2, 3, None):
            problems.append(
                f"case {cid}: human.proof_quality_score {pq!r} not 1/2/3/null"
            )
    return problems


def load_cases(cases_dir: Path) -> tuple[list[dict[str, Any]], str | None]:
    """Load + structurally validate every case file in the directory.

    `cases_dir` holds one JSON case object per file (the per-contributor
    layout — one file per fixture/grader so teams don't conflict). Returns
    (cases, model). A case file may optionally set `"model"` to pin the
    judge model; the first one seen wins. Raises ValueError with all lint
    problems joined if any case is malformed — a broken set is a hard
    error, not something to silently skip.
    """
    files = sorted(cases_dir.glob("*.json"))
    if not files:
        raise ValueError(f"no calibration case files in {cases_dir}/")

    cases: list[dict[str, Any]] = []
    model: str | None = None
    problems: list[str] = []
    for f in files:
        try:
            case = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"{f.name}: invalid JSON: {e}") from e
        if not isinstance(case, dict):
            raise ValueError(f"{f.name}: expected a single JSON case object")
        model = model or case.get("model")
        cases.append(case)
        # Label problems by FILENAME so a contributor knows which file to fix.
        problems += _validate_case(case, f.name)

    if problems:
        raise ValueError(
            "calibration set has malformed cases:\n  " + "\n  ".join(problems)
        )
    return cases, model


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
            result.finding_disagreements.append(
                f"{cid}/{fid}: human={human_label} judge={judge_label}"
            )

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
        # Proof-quality agreement is reported but does not gate, mirroring
        # how proof quality is advisory in the verdict itself.
        return self.per_finding_agreement >= PER_FINDING_TARGET and not self.errors


def print_report(report: CalibrationReport) -> None:
    print()
    print("=== Judge calibration ===")
    print(
        f"per-finding agreement: {report.per_finding_agreement:.0%} "
        f"({report.finding_agreed}/{report.finding_total})   "
        f"target ≥{PER_FINDING_TARGET:.0%}"
    )
    print(
        f"per-run verdict agreement: {report.run_agreement:.0%} "
        f"({sum(1 for r in report.run_results if r.run_agreed)}/{len(report.run_results)})"
    )
    if report.pq_results:
        print(
            f"proof-quality agreement (advisory, not gating): "
            f"{report.pq_agreement:.0%} "
            f"({sum(1 for r in report.pq_results if r.pq_agreed)}/{len(report.pq_results)})"
        )
        for r in report.pq_results:
            if not r.pq_agreed:
                print(f"  - {r.case_id}: human pq={r.human_pq} judge pq={r.judge_pq}")
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
        description="Measure judge-vs-human agreement against a frozen set.",
    )
    parser.add_argument(
        "--cases-dir",
        type=Path,
        default=DEFAULT_CASES_DIR,
        help=f"Directory of per-file calibration cases. Default: {DEFAULT_CASES_DIR}",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Override the judge model (else the set's `model`, else the default).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Lint the calibration set without calling the judge API.",
    )
    args = parser.parse_args(argv)

    if not args.cases_dir.is_dir():
        print(
            f"Calibration cases directory not found: {args.cases_dir}\n"
            "Seed cases from real e2e runs with `e2e.seed_calibration_case` "
            "(see docs/e2e-testing-guide.md → Judge calibration).",
            file=sys.stderr,
        )
        return 2

    try:
        cases, set_model = load_cases(args.cases_dir)
    except (ValueError, json.JSONDecodeError) as e:
        print(f"Calibration set invalid: {e}", file=sys.stderr)
        return 2

    model = args.model or set_model or judge_module.DEFAULT_JUDGE_MODEL

    if args.dry_run:
        print(f"OK: {len(cases)} case(s) parse and validate. Judge model: {model}")
        print("(--dry-run: no judge API calls made.)")
        return 0

    results = [grade_case(case, model=model) for case in cases]
    report = CalibrationReport(results=results)
    print_report(report)
    return 0 if report.meets_target else 1


if __name__ == "__main__":
    sys.exit(main())
