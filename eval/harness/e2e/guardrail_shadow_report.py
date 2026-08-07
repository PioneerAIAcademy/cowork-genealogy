"""Retroactive calibration tool for the §7 shadow-mode recency window.

docs/specs/guardrail-enforcement-spec.md §7, GitHub issue #911 — the
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
from collections.abc import Callable
from pathlib import Path
from typing import Any

from e2e.runlog_selection import (
    add_since_arg,
    all_result_jsons,
    describe_window,
    filter_since,
    is_result_json as _is_result_json,
    result_jsons_for,
)
from harness.skill_invocation import (
    CITATION_NULLING_KIND,
    CONFLICT_UNPERSISTED_KIND,
    find_unguarded_protected_writes,
)

REPO_ROOT = Path(__file__).resolve().parents[3]

DEFAULT_WINDOWS = (10, 20, 40, 80, 150)


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


def _scan_stored(
    paths: list[Path], keep: Callable[[dict[str, Any]], bool]
) -> list[dict[str, Any]]:
    """Read STORED shadow entries across a corpus, keeping those `keep` selects,
    each enriched with its source file/fixture.

    Read rather than replayed, unlike the §7 sweep above: that check is a pure
    function of `tool_calls` at a given window, so it can be recomputed for any
    window from a committed log. The stored families are not — the #963
    provenance gap depends on the seed tree and on what the live hook could see;
    the #1133 citation-nulling class is a post-hoc read of the final
    research.json. Both share `guardrail_shadow_violations` and are told apart by
    their keys, so each family passes its own predicate here. Unreadable files
    are skipped with a stderr note, never raised.
    """
    out: list[dict[str, Any]] = []
    for path in paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            print(f"  skip {path}: {e}", file=sys.stderr)
            continue
        for v in data.get("guardrail_shadow_violations") or []:
            if not isinstance(v, dict) or not keep(v):
                continue
            try:
                display_path = str(path.relative_to(REPO_ROOT))
            except ValueError:
                display_path = str(path)
            out.append({**v, "file": display_path, "fixture": path.parent.name})
    return out


def scan_provenance(paths: list[Path]) -> list[dict[str, Any]]:
    """The issue-#963 provenance shadow entries STORED in each run's
    `guardrail_shadow_violations` (a `person_evidence` link written with no
    prior `same_person`). Identified by the `detail` key, which only the stored
    sources set — but EXCLUDING the #1133 citation-nulling class, which also
    carries `detail` and is counted separately by `scan_citation_nulling`.
    """
    return _scan_stored(
        paths,
        lambda v: "detail" in v
        and v.get("kind") not in (CITATION_NULLING_KIND, CONFLICT_UNPERSISTED_KIND),
    )


def scan_citation_nulling(paths: list[Path]) -> list[dict[str, Any]]:
    """The issue-#1133 citation-nulling shadow entries STORED in each run's
    `guardrail_shadow_violations` (a source backing a written conclusion whose
    ESM citation string is empty). Identified by `kind == CITATION_NULLING_KIND`.
    """
    return _scan_stored(paths, lambda v: v.get("kind") == CITATION_NULLING_KIND)


def scan_conflict_unpersisted(paths: list[Path]) -> list[dict[str, Any]]:
    """The issue-#1317 conflict-unpersisted shadow entries STORED in each run's
    `guardrail_shadow_violations` (a written conclusion relying on a resolved
    conflict that no `conflicts[]` entry backs). Identified by
    `kind == CONFLICT_UNPERSISTED_KIND`.
    """
    return _scan_stored(paths, lambda v: v.get("kind") == CONFLICT_UNPERSISTED_KIND)


def format_provenance(violations: list[dict[str, Any]]) -> str:
    """One flat count — no window column, because the #963 check has no window
    (`same_person` is a required call, so "was it called for this person" is a
    fact). Runs written before the check shipped simply contribute nothing."""
    affected = len({v["file"] for v in violations})
    lines = [
        "",
        f"§8 live provenance check (issue #963, shadow): {len(violations)} "
        f"person_evidence link(s) with no prior same_person, across {affected} run(s).",
    ]
    return "\n".join(lines)


def format_citation_nulling(violations: list[dict[str, Any]]) -> str:
    """One flat count — no window column, like `format_provenance`: the #1133
    check is a fact about the final research.json, not a windowed recency scan.
    This is the number the graduation decision (shadow → hard §7.5 compliance
    check) is gated on."""
    affected = len({v["file"] for v in violations})
    return (
        "\n§7.5 citation-nulling check (issue #1133, shadow): "
        f"{len(violations)} concluded source(s) with a null/empty citation "
        f"string, across {affected} run(s)."
    )


def format_conflict_unpersisted(violations: list[dict[str, Any]]) -> str:
    """One flat count, like the other post-hoc checks: a fact about the final
    research.json, not a windowed recency scan. This is the number the
    graduation decision (shadow → hard gate) is gated on for issue #1317."""
    affected = len({v["file"] for v in violations})
    return (
        "\nconflict-unpersisted check (issue #1317, shadow): "
        f"{len(violations)} concluded question(s) relying on an unpersisted "
        f"conflict resolution, across {affected} run(s)."
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Retroactive §7 shadow-window calibration (issue #911).")
    ap.add_argument("--test", help="scan every committed run for this fixture slug only")
    ap.add_argument(
        "--windows",
        default=",".join(str(w) for w in DEFAULT_WINDOWS),
        help=f"comma-separated window sizes to compare (default: {','.join(str(w) for w in DEFAULT_WINDOWS)})",
    )
    ap.add_argument("--detail", action="store_true", help="also print every violation at the smallest window given")
    add_since_arg(ap)
    args = ap.parse_args(argv)

    windows = sorted({int(w) for w in args.windows.split(",") if w.strip()})
    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        print("No committed runs found.", file=sys.stderr)
        return 1

    by_window = scan_corpus(paths, windows=windows)
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(format_summary(by_window, n_runs=len(paths)))

    provenance = scan_provenance(paths)
    print(format_provenance(provenance))

    citation_nulling = scan_citation_nulling(paths)
    print(format_citation_nulling(citation_nulling))

    conflict_unpersisted = scan_conflict_unpersisted(paths)
    print(format_conflict_unpersisted(conflict_unpersisted))

    if args.detail:
        smallest = min(windows)
        print(f"\nViolations at window={smallest}:")
        print(format_detail(by_window[smallest]))
        print(f"\nProvenance gaps (issue #963), {len(provenance)}:")
        for v in provenance:
            print(f"  {v['fixture']:<35} idx={v['index']:<4} {v['detail']}")
        print(f"\nCitation nulling (issue #1133), {len(citation_nulling)}:")
        for v in citation_nulling:
            print(f"  {v['fixture']:<35} {v['detail']}")
        print(f"\nConflict unpersisted (issue #1317), {len(conflict_unpersisted)}:")
        for v in conflict_unpersisted:
            print(f"  {v['fixture']:<35} {v['detail']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
