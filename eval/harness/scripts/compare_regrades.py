#!/usr/bin/env python3
"""Compare judge scores across scratch regrade passes.

`make judge-regrade SCRATCH=<dir>` writes one copy of each skill's latest run
log under `<dir>/<skill>/`. An A/B on a judge input (issue #2478: the scenario
README against its judge brief) runs that into one fresh dir per pass, e.g.
`readme-1`, `readme-2`, `brief-1`, `brief-2`, and this prints every judge
dimension side by side, one column per pass, marking each row whose score
differs between any two passes.

Usage (from eval/harness/):
  uv run python scripts/compare_regrades.py <dir> <dir> [<dir> ...] [--all]

Without `--all` only rows that differ are printed. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

Key = tuple[str, str, int, str, str]  # skill, test_id, run_index, source, dimension


def load_scores(pass_dir: Path) -> dict[Key, int | None]:
    scores: dict[Key, int | None] = {}
    for log_path in sorted(pass_dir.glob("*/*.json")):
        log = json.loads(log_path.read_text(encoding="utf-8"))
        skill = log.get("skill") or log_path.parent.name
        for test in log.get("tests") or []:
            for run in test.get("runs") or []:
                for dim in (run.get("judge") or {}).get("dimensions") or []:
                    key = (
                        skill,
                        test.get("test_id") or "?",
                        int(run.get("run_index") or 0),
                        dim.get("source") or "",
                        dim.get("name") or "",
                    )
                    scores[key] = dim.get("score")
    return scores


def compare(pass_dirs: list[Path]) -> tuple[list[str], list[tuple[Key, list]]]:
    """Return (pass names, rows); each row is (key, [score per pass])."""
    per_pass = [load_scores(d) for d in pass_dirs]
    keys = sorted(set().union(*per_pass))
    rows = [(k, [p.get(k, "-") for p in per_pass]) for k in keys]
    return [d.name for d in pass_dirs], rows


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dirs", nargs="+", type=Path)
    parser.add_argument("--all", action="store_true", help="print rows that agree too")
    args = parser.parse_args(argv)
    if len(args.dirs) < 2:
        parser.error("give at least two pass dirs")
    for d in args.dirs:
        if not d.is_dir():
            parser.error(f"not a directory: {d}")

    names, rows = compare(args.dirs)
    if not rows:
        print("No judge dimensions found in any pass dir.")
        return 1
    print("\t".join(["skill", "test", "run", "dimension", *names, "differs"]))
    differing = 0
    for (skill, test_id, run_index, source, name), scores in rows:
        differs = len(set(map(str, scores))) > 1
        differing += differs
        if differs or args.all:
            print("\t".join([
                skill, test_id, str(run_index), f"{source}:{name}",
                *(str(s) for s in scores), "YES" if differs else "",
            ]))
    print(f"\n{differing} of {len(rows)} dimension row(s) differ across {len(names)} pass(es).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
