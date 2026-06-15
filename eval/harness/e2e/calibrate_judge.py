"""Judge calibration — measure judge-vs-human agreement, offline.

The e2e judge is graded *by* this loop and used *in* the e2e pipeline.
Its accuracy must be established here, in the cheap offline loop — never
inferred from expensive live e2e runs. This script runs ONLY the judge
(no agent, no live FamilySearch) against a frozen, hand-graded set of
cases, and reports agreement.

See `docs/plan/e2e-skills.md` → "Judge calibration set".

## The calibration set

A committed JSON file — default `eval/tests/e2e/calibration/cases.json` —
holding hand-graded cases. Each case pins what a *human* judged so we can
compare the model against it:

  {
    "model": "claude-opus-4-8",          # optional: default judge model
    "cases": [
      {
        "id": "robert-smith-clean",
        "research_question": "Who were John Smith's parents?",
        "expected_findings": { "findings": [ ... ] },   # same shape as a fixture's
        "final_tree": { "persons": [ ... ] },           # real simplified GedcomX
        "human": {
          "verdict": "pass",                            # per-RUN human verdict
          "per_finding": { "f1": "true", "f2": "partial" }  # per-FINDING human labels
        },
        "notes": "why this case is here / what makes it a hard call"
      }
    ]
  }

`human.per_finding` maps each finding id to the human's `matched` label
(`true` / `partial` / `false`). It is the **primary** metric: per-finding
agreement is what discriminates a good judge from a confident-but-wrong
one (the per-run verdict is dominated by easy passes and inflates the
number). `human.verdict` is the secondary, per-run check.

## Target

≥80% per-finding agreement (≈ human inter-rater agreement). Inspect every
disagreement — the disagreements are the signal, not the headline number.

## Usage (from eval/harness/)

  uv run python -m e2e.calibrate_judge                       # default set
  uv run python -m e2e.calibrate_judge --cases path/to.json
  uv run python -m e2e.calibrate_judge --dry-run            # no API calls; lint the set
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
DEFAULT_CASES = REPO_ROOT / "eval" / "tests" / "e2e" / "calibration" / "cases.json"

PER_FINDING_TARGET = 0.80  # ≈ human inter-rater agreement


@dataclass
class CaseResult:
    case_id: str
    # Per-finding agreement on this case.
    finding_total: int = 0
    finding_agreed: int = 0
    finding_disagreements: list[str] = field(default_factory=list)
    # Per-run verdict agreement.
    run_agreed: bool | None = None
    human_verdict: str | None = None
    judge_verdict: str | None = None
    error: str | None = None


def _validate_case(case: dict[str, Any], index: int) -> list[str]:
    """Structural lint of one case. Returns a list of problems (empty = ok)."""
    problems: list[str] = []
    cid = case.get("id", f"#{index}")
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
    return problems


def load_cases(path: Path) -> tuple[list[dict[str, Any]], str | None]:
    """Load + structurally validate the calibration set.

    Returns (cases, default_model). Raises ValueError with all lint
    problems joined if any case is malformed — a broken calibration set
    is a hard error, not something to silently skip.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    cases = data.get("cases") or []
    if not cases:
        raise ValueError(f"calibration set {path} has no cases")
    problems: list[str] = []
    for i, case in enumerate(cases):
        problems += _validate_case(case, i)
    if problems:
        raise ValueError(
            "calibration set has malformed cases:\n  " + "\n  ".join(problems)
        )
    return cases, data.get("model")


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
    def errors(self) -> list[CaseResult]:
        return [r for r in self.results if r.error]

    @property
    def meets_target(self) -> bool:
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
        "--cases",
        type=Path,
        default=DEFAULT_CASES,
        help=f"Calibration set JSON. Default: {DEFAULT_CASES}",
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

    if not args.cases.exists():
        print(
            f"Calibration set not found: {args.cases}\n"
            "Author one per the format in this module's docstring "
            "(seed it from the first real e2e run's trees).",
            file=sys.stderr,
        )
        return 2

    try:
        cases, set_model = load_cases(args.cases)
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
