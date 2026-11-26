"""Per-suite run-log state for /audit-board's paid-run tax table.

For every unit suite (a directory under eval/runlogs/unit/ with a matching
eval/tests/unit/<suite>/), reports the newest releasable run log, how many days it
has sat, and whether any releasable run log is active against the working tree.

Newest is by the log's own timestamp.

States:
    active   a releasable log is active
    stale    no releasable log is active; the next edit's run is owed regardless

Usage (from eval/harness, so the harness imports resolve):
    uv run python ../../.claude/skills/audit-board/runlog_state.py [--today YYYY-MM-DD]
"""

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
REPO = Path(_HERE).parents[2]
sys.path.insert(0, str(REPO / "eval" / "harness"))

from harness.snapshot import diff_snapshot_vs_disk  # noqa: E402
from harness.versioning import classify  # noqa: E402


def _log_date(timestamp):
    return date.fromisoformat(timestamp[:10])


def suite_state(suite_dir, repo_root, today):
    """Return the state row for one suite's run-log directory, or None if it has no
    releasable log."""
    logs = []
    for path in suite_dir.iterdir():
        if not path.is_file() or path.name.endswith(".ann.json"):
            continue
        c = classify(path.name)
        if c.kind != "candidate":
            continue
        with open(path, encoding="utf-8") as f:
            log = json.load(f)
        active = not diff_snapshot_vs_disk(log.get("snapshot") or {}, repo_root)
        logs.append((log.get("timestamp") or "", path.name, active))
    if not logs:
        return None
    logs.sort()
    ts, name, _ = logs[-1]
    return {
        "suite": suite_dir.name,
        "newest": name,
        "idle_days": (today - _log_date(ts)).days if ts else None,
        "state": "active" if any(entry[2] for entry in logs) else "stale",
    }


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--today", type=date.fromisoformat, default=date.today())
    args = parser.parse_args(argv)
    rows = []
    for suite_dir in sorted((REPO / "eval" / "runlogs" / "unit").iterdir()):
        if not suite_dir.is_dir() or not (REPO / "eval" / "tests" / "unit" / suite_dir.name).is_dir():
            continue
        row = suite_state(suite_dir, REPO, args.today)
        if row:
            rows.append(row)
    for r in rows:
        print(f"{r['suite']:28} {r['newest']:34} {str(r['idle_days']):>4}d  {r['state']}")
    counts = {s: sum(r["state"] == s for r in rows) for s in ("active", "stale")}
    print(f"\n{len(rows)} suites: {counts['active']} active, {counts['stale']} stale")
    return 0


if __name__ == "__main__":
    sys.exit(main())
