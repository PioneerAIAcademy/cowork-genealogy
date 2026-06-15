"""Seed a judge-calibration case from a real e2e run log.

Turns the four committed artifacts of one e2e run into a calibration-case
stub: it pulls the real `final_tree` / `final_research` / `expected_findings`
and pre-fills the **judge's** labels, leaving the **human** fields blank
(`null`) for a grader to correct. Reviewing-and-correcting a draft is far
cheaper than hand-authoring a case from scratch — which is what lets ten
teams each contribute calibration cases from their own runs.

The emitted case is one file under the per-contributor calibration
directory (`eval/tests/e2e/calibration/cases/<slug>-<who>.json`), so
contributors don't conflict on a single JSON file. `calibrate_judge`
reads that whole directory.

## What the grader does with the stub

The stub has, per finding, the judge's `matched` label in a comment-ish
`_judge_matched` field and a blank `human.per_finding[fid]` to fill. The
grader reads the committed tree vs. expected-findings, decides the true
label, and writes it. Where the human and judge agree, the case still
counts (it confirms agreement); where they differ, that disagreement is
exactly the signal calibration exists to surface.

## Usage (from eval/harness/)

  # latest run log for a fixture -> a stub for grader "alice"
  uv run python -m e2e.seed_calibration_case --test kenneth-quass-death --who alice

  # an explicit run log
  uv run python -m e2e.seed_calibration_case \\
      --runlog eval/runlogs/e2e/kenneth-quass-death/run-2026-06-15_10-00-00.json \\
      --who bob

  # print to stdout instead of writing a file
  uv run python -m e2e.seed_calibration_case --test <slug> --stdout
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_RUNLOG_ROOT = REPO_ROOT / "eval" / "runlogs" / "e2e"
DEFAULT_FIXTURES_ROOT = REPO_ROOT / "eval" / "tests" / "e2e"
DEFAULT_CASES_DIR = DEFAULT_FIXTURES_ROOT / "calibration" / "cases"


def _latest_runlog(runlog_root: Path, slug: str) -> Path | None:
    slug_dir = runlog_root / slug
    if not slug_dir.is_dir():
        return None
    runs = sorted(slug_dir.glob("run-*.json"))
    return runs[-1] if runs else None


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def build_case(
    *,
    runlog_path: Path,
    fixtures_root: Path = DEFAULT_FIXTURES_ROOT,
) -> dict[str, Any]:
    """Build a calibration-case stub from one run log + its fixture.

    Reads the run log's sibling final-tree / final-research files and the
    fixture's expected-findings + researcher_question. Pre-fills judge
    labels; leaves human labels null.
    """
    result = _load(runlog_path)
    slug = result.get("test_id") or runlog_path.parent.name
    stem = runlog_path.name[: -len(".json")]  # run-<ts>
    run_dir = runlog_path.parent

    tree_path = run_dir / f"{stem}.final-tree.gedcomx.json"
    research_path = run_dir / f"{stem}.final-research.json"
    final_tree = _load(tree_path) if tree_path.exists() else None
    final_research = _load(research_path) if research_path.exists() else None

    fixture_dir = fixtures_root / slug
    fixture = _load(fixture_dir / "fixture.json")
    expected_findings = _load(fixture_dir / "expected-findings.json")

    judge = result.get("judge_output") or {}
    judge_pf = {
        str(pf.get("finding_id")): pf.get("matched")
        for pf in (judge.get("per_finding") or [])
    }
    judge_pq = (judge.get("proof_quality") or {}).get("score")

    # Blank human per-finding map, with the judge's call alongside each id
    # so the grader can agree or correct.
    finding_ids = [str(f.get("id")) for f in expected_findings.get("findings") or []]
    human_per_finding = {fid: None for fid in finding_ids}

    try:
        source = str(runlog_path.relative_to(REPO_ROOT))
    except ValueError:
        source = str(runlog_path)  # runlog outside the repo (e.g. a test tmpdir)

    return {
        "id": f"{slug}-{stem}",
        "_slug": slug,
        "_source_runlog": source,
        "research_question": fixture.get("researcher_question", ""),
        "expected_findings": expected_findings,
        "final_tree": final_tree,
        "final_research": final_research,
        # The judge's labels, for the grader to compare against. These are
        # NOT read by calibrate_judge — only `human.*` is. They live here so
        # the grader corrects a draft instead of authoring from scratch.
        "_judge": {
            "verdict": judge.get("verdict"),
            "per_finding": judge_pf,
            "proof_quality_score": judge_pq,
        },
        # FILL THESE IN. null = not yet graded.
        "human": {
            "verdict": None,                       # "pass" | "partial" | "fail"
            "per_finding": human_per_finding,      # each fid -> "true"|"partial"|"false"
            # Optional — only if this run wrote a proof summary worth grading:
            # "proof_quality_score": null,         # 1 | 2 | 3 | null
        },
        "notes": "",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="e2e.seed_calibration_case",
        description="Seed a judge-calibration case stub from a real e2e run log.",
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--test", help="Fixture slug; uses its latest run log.")
    src.add_argument("--runlog", type=Path, help="Explicit run-<ts>.json path.")
    parser.add_argument(
        "--who",
        help="Contributor id, used in the output filename (<slug>-<who>.json).",
    )
    parser.add_argument(
        "--runlog-root", type=Path, default=DEFAULT_RUNLOG_ROOT,
        help=f"Default: {DEFAULT_RUNLOG_ROOT}",
    )
    parser.add_argument(
        "--cases-dir", type=Path, default=DEFAULT_CASES_DIR,
        help=f"Where to write the stub. Default: {DEFAULT_CASES_DIR}",
    )
    parser.add_argument(
        "--stdout", action="store_true", help="Print the stub instead of writing it."
    )
    args = parser.parse_args(argv)

    if args.runlog:
        runlog_path = args.runlog
        if not runlog_path.exists():
            print(f"Run log not found: {runlog_path}", file=sys.stderr)
            return 2
    else:
        runlog_path = _latest_runlog(args.runlog_root, args.test)
        if runlog_path is None:
            print(
                f"No run log found for '{args.test}' under {args.runlog_root}. "
                "Run the fixture for real first.",
                file=sys.stderr,
            )
            return 2

    try:
        case = build_case(runlog_path=runlog_path)
    except (OSError, json.JSONDecodeError, KeyError) as e:
        print(f"Could not build case from {runlog_path}: {e}", file=sys.stderr)
        return 2

    rendered = json.dumps(case, indent=2)
    if args.stdout:
        print(rendered)
        return 0

    slug = case["_slug"]  # the real fixture slug (not re-derived from id)
    who = args.who or "ungraded"
    args.cases_dir.mkdir(parents=True, exist_ok=True)
    out = args.cases_dir / f"{slug}-{who}.json"
    out.write_text(rendered + "\n", encoding="utf-8")
    print(f"Wrote calibration-case stub: {out}")
    print("Fill in the `human` block (it's null until you grade it), then "
          "run `e2e.calibrate_judge`.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
