"""Which committed **e2e** runs a corpus reader should look at.

Discovery only — which files under `eval/runlogs/e2e/` count as results. The
freshness window is shared with the unit-side readers and lives in
`harness/since_window.py`; it is re-exported here so the e2e reports can import
one module. See GitHub issue #985.
"""

from __future__ import annotations

from pathlib import Path

from harness.since_window import (  # noqa: F401  (re-exported for the e2e readers)
    DEFAULT_SINCE_DAYS,
    add_since_arg,
    branch_scope_note,
    describe_window,
    filter_since,
    parse_since,
    run_date,
)

HARNESS_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = HARNESS_DIR.parents[1]
E2E_RUNLOGS = REPO_ROOT / "eval" / "runlogs" / "e2e"


def is_result_json(p: Path) -> bool:
    """True for a committed `run-<ts>.json`, excluding its siblings."""
    n = p.name
    return (
        n.startswith("run-")
        and n.endswith(".json")
        and not n.endswith(".ann.json")
        and ".final-" not in n
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
            out.extend(sorted(p for p in d.iterdir() if is_result_json(p)))
    return out


def result_jsons_for(test_slug: str) -> list[Path]:
    d = E2E_RUNLOGS / test_slug
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if is_result_json(p))
