"""Retroactive calibration tool for the §4.1 shadow-mode recency window.

docs/plan/research-guardrail-bypass-plan.md §4.1/§7, GitHub issue #911 — the
window (`GUARDRAIL_SHADOW_WINDOW` in `e2e/orchestrator.py`) is a first-cut
default, not yet tuned. Every committed e2e runlog already persists its full
`tool_calls` list, so `harness.skill_invocation.find_unguarded_protected_writes`
can be replayed against the whole historical corpus for free — no new API
spend — rather than waiting on new live runs to accumulate a sample.

This module adds NO instrumentation to a run (same posture as
`latency_report.py`); it's pure analysis over already-committed data.

CLI (from eval/harness/):
  uv run python -m e2e.guardrail_shadow_report
  uv run python -m e2e.guardrail_shadow_report --windows 10,20,40,80,150
  uv run python -m e2e.guardrail_shadow_report --windows 40 --detail
  uv run python -m e2e.guardrail_shadow_report --test bagley-father-1884
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from harness.skill_invocation import find_unguarded_protected_writes

REPO_ROOT = Path(__file__).resolve().parents[3]
E2E_RUNLOGS = REPO_ROOT / "eval" / "runlogs" / "e2e"

DEFAULT_WINDOWS = (10, 20, 40, 80, 150)


def _is_result_json(p: Path) -> bool:
    """A committed structured result, not its tree/research/ann/session siblings."""
    name = p.name
    return (
        name.startswith("run-")
        and name.endswith(".json")
        and not name.endswith(".ann.json")
        and ".final-" not in name
    )


def all_result_jsons() -> list[Path]:
    """EVERY committed run, not just the latest per fixture — calibration
    wants maximum sample size, unlike latency_report's "latest only" (which
    exists to avoid stale per-fixture latency numbers, a different goal)."""
    if not E2E_RUNLOGS.is_dir():
        return []
    out: list[Path] = []
    for d in sorted(E2E_RUNLOGS.iterdir()):
        if d.is_dir():
            out.extend(sorted(p for p in d.iterdir() if _is_result_json(p)))
    return out


def result_jsons_for(test_slug: str) -> list[Path]:
    d = E2E_RUNLOGS / test_slug
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if _is_result_json(p))


def scan_one(path: Path, *, window: int) -> list[dict[str, Any]]:
    """Violations `find_unguarded_protected_writes` reports for one committed
    run at a given window size. Each violation is enriched with the source
    file so a multi-run aggregate stays traceable back to a transcript."""
    data = json.loads(path.read_text(encoding="utf-8"))
    tool_calls = data.get("tool_calls") or []
    violations = find_unguarded_protected_writes(tool_calls, window=window)
    try:
        display_path = str(path.relative_to(REPO_ROOT))
    except ValueError:
        display_path = str(path)  # outside REPO_ROOT (e.g. ad hoc/test usage) -- show absolute
    for v in violations:
        v["file"] = display_path
        v["fixture"] = path.parent.name
    return violations


def scan_corpus(paths: list[Path], *, windows: list[int]) -> dict[int, list[dict[str, Any]]]:
    """Violations per window size, across every path given."""
    by_window: dict[int, list[dict[str, Any]]] = {w: [] for w in windows}
    for path in paths:
        try:
            for w in windows:
                by_window[w].extend(scan_one(path, window=w))
        except (json.JSONDecodeError, OSError) as e:
            print(f"  skip {path}: {e}", file=sys.stderr)
    return by_window


def format_summary(by_window: dict[int, list[dict[str, Any]]], *, n_runs: int) -> str:
    lines = [f"Scanned {n_runs} committed run(s).", ""]
    lines.append(f"{'window':>8}  {'violations':>10}  {'runs affected':>14}  by-skill breakdown")
    for w in sorted(by_window):
        violations = by_window[w]
        affected = len({v["file"] for v in violations})
        by_skill: dict[str, int] = {}
        for v in violations:
            by_skill[v["required_skill"]] = by_skill.get(v["required_skill"], 0) + 1
        skill_str = ", ".join(f"{k}={v}" for k, v in sorted(by_skill.items()))
        lines.append(f"{w:>8}  {len(violations):>10}  {affected:>14}  {skill_str or '(none)'}")
    return "\n".join(lines)


def format_detail(violations: list[dict[str, Any]]) -> str:
    lines = []
    for v in violations:
        lines.append(
            f"  {v['fixture']:<35} idx={v['index']:<4} tool={v['tool']:<30} "
            f"needs={v['required_skill']:<24} q={v.get('question_id')}"
        )
    return "\n".join(lines) if lines else "  (none)"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Retroactive §4.1 shadow-window calibration (issue #911).")
    ap.add_argument("--test", help="scan every committed run for this fixture slug only")
    ap.add_argument(
        "--windows",
        default=",".join(str(w) for w in DEFAULT_WINDOWS),
        help=f"comma-separated window sizes to compare (default: {','.join(str(w) for w in DEFAULT_WINDOWS)})",
    )
    ap.add_argument("--detail", action="store_true", help="also print every violation at the smallest window given")
    args = ap.parse_args(argv)

    windows = sorted({int(w) for w in args.windows.split(",") if w.strip()})
    paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    if not paths:
        print("No committed runs found.", file=sys.stderr)
        return 1

    by_window = scan_corpus(paths, windows=windows)
    print(format_summary(by_window, n_runs=len(paths)))

    if args.detail:
        smallest = min(windows)
        print(f"\nViolations at window={smallest}:")
        print(format_detail(by_window[smallest]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
