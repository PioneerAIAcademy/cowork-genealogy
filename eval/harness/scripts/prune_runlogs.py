#!/usr/bin/env python3
"""Maintenance sweeps over the committed unit run-log corpus.

    --rehash        migrate pre-v3 run logs: snapshot content -> sha256
                    digests, dropping the dead mcp-server/src keys.

Run via `make prune-runlogs`. Read-modify-write over
`eval/runlogs/unit/<skill>/*.json`; scratch and partial logs are gitignored
local artifacts and are never touched.

Rehash is exact, not approximate: a pre-v3 snapshot stores the *normalized*
content, which is the same string `build_snapshot` hashes, so digests computed
here are identical to what a fresh run would produce. No re-run is needed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS_DIR = HERE.parent
sys.path.insert(0, str(HARNESS_DIR))

from harness.snapshot import _MCP_SRC_PREFIX, hash_snapshot, is_hashed_snapshot  # noqa: E402

REPO_ROOT = HARNESS_DIR.parents[1]
RUNLOGS_UNIT = REPO_ROOT / "eval" / "runlogs" / "unit"

CURRENT_SCHEMA_VERSION = 3


def committed_runlogs(root: Path) -> list[Path]:
    """Every committed unit run log, oldest-first within each skill.

    Excludes `.ann.json` siblings and the gitignored `scratch_*` / `.partial_*`
    local artifacts.
    """
    out: list[Path] = []
    if not root.is_dir():
        return out
    for skill_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        for p in sorted(skill_dir.iterdir()):
            if not p.name.endswith(".json"):
                continue
            if p.name.endswith(".ann.json"):
                continue
            if p.name.startswith("scratch_") or p.name.startswith(".partial_"):
                continue
            out.append(p)
    return out


def rehash_one(path: Path) -> tuple[bool, int, int]:
    """Migrate one run log in place.

    Returns (changed, bytes_before, bytes_after). A log already at the current
    schema version is left untouched, so the sweep is idempotent.
    """
    before = path.stat().st_size
    log = json.loads(path.read_text(encoding="utf-8"))

    if log.get("schema_version", 0) >= CURRENT_SCHEMA_VERSION:
        return False, before, before

    snapshot = log.get("snapshot") or {}
    # Drop the dead MCP-source keys rather than hashing them: build_snapshot
    # stopped emitting them and diff_snapshot_vs_disk already skips them, so
    # they are pure weight (~14% of snapshot bytes across the corpus).
    snapshot = {k: v for k, v in snapshot.items() if not k.startswith(_MCP_SRC_PREFIX)}
    log["snapshot"] = snapshot if is_hashed_snapshot(snapshot) else hash_snapshot(snapshot)
    log["schema_version"] = CURRENT_SCHEMA_VERSION

    path.write_text(json.dumps(log, indent=2), encoding="utf-8")
    return True, before, path.stat().st_size


def cmd_rehash(root: Path, *, dry_run: bool) -> int:
    logs = committed_runlogs(root)
    changed = 0
    before_total = after_total = 0
    for p in logs:
        if dry_run:
            log = json.loads(p.read_text(encoding="utf-8"))
            if log.get("schema_version", 0) < CURRENT_SCHEMA_VERSION:
                changed += 1
            continue
        did, before, after = rehash_one(p)
        before_total += before
        after_total += after
        changed += 1 if did else 0

    mb = 1024 * 1024
    if dry_run:
        print(f"rehash --dry-run: {changed} of {len(logs)} run logs would migrate")
    else:
        print(
            f"rehash: migrated {changed} of {len(logs)} run logs; "
            f"{before_total / mb:.1f} MB -> {after_total / mb:.1f} MB "
            f"({(before_total - after_total) / mb:.1f} MB reclaimed)"
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--rehash",
        action="store_true",
        help="migrate pre-v3 run logs to hashed snapshots",
    )
    ap.add_argument("--dry-run", action="store_true", help="report, change nothing")
    ap.add_argument(
        "--runlogs-root",
        type=Path,
        default=RUNLOGS_UNIT,
        help=f"unit runlog root (default: {RUNLOGS_UNIT})",
    )
    args = ap.parse_args(argv)

    if not args.rehash:
        ap.error("nothing to do — pass --rehash")
    return cmd_rehash(args.runlogs_root, dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
