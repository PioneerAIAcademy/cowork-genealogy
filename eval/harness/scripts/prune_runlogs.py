#!/usr/bin/env python3
"""Maintenance sweeps over the committed run-log corpora.

    --rehash              migrate pre-v3 unit run logs: snapshot content ->
                          sha256 digests, dropping the dead mcp-server/src keys.
    --prune-unit K        one-time backfill to the keep-newest-K rule the
                          harness now applies on every write (harness.runlog).
    --strip-e2e-captures  reduce `response_summary` to its replay remnant in
                          e2e run logs past the cutoff, keeping tool / args /
                          is_error and the ids `harness/replay.py` reads back.

Run via `make prune-runlogs`. Read-modify-write over
`eval/runlogs/unit/<skill>/*.json` and `eval/runlogs/e2e/<slug>/run-*.json`;
scratch and partial logs are gitignored local artifacts and are never touched.

Rehash is exact, not approximate: a pre-v3 snapshot stores the *normalized*
content, which is the same string `build_snapshot` hashes, so digests computed
here are identical to what a fresh run would produce. No re-run is needed.

The two corpora key retention differently on purpose. Unit is keyed on **rank**
(keep the newest K candidates) because an age rule would delete the only run log
for an untouched skill and break `check_runlogs` rule 2 on its next edit. E2e is
keyed on **age**, and strips rather than deletes, because it has no such
per-skill invariant to protect — `RUNLOG_PATH_RE` in `scripts/check_runlogs.py`
matches `eval/runlogs/unit/` only, and 27 of 105 e2e fixtures already carry zero
committed run logs with nothing failing. Matching the retention key to the query
key (`harness/since_window.py`, 14 days) is the point.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
HARNESS_DIR = HERE.parent
sys.path.insert(0, str(HARNESS_DIR))

from harness.replay import parse_tool_result  # noqa: E402
from harness.runlog import prune_old_candidates  # noqa: E402
from harness.since_window import DEFAULT_SINCE_DAYS, run_date  # noqa: E402
from harness.snapshot import _MCP_SRC_PREFIX, hash_snapshot, is_hashed_snapshot  # noqa: E402
from harness.versioning import DEFAULT_KEEP_CANDIDATES, prunable_candidates  # noqa: E402

REPO_ROOT = HARNESS_DIR.parents[1]
RUNLOGS_UNIT = REPO_ROOT / "eval" / "runlogs" / "unit"
RUNLOGS_E2E = REPO_ROOT / "eval" / "runlogs" / "e2e"

CURRENT_SCHEMA_VERSION = 3

# Marks a run log the sweep has already stripped, so a re-sweep is a no-op and
# a reader can tell "this run made no tool calls worth summarizing" apart from
# "the summaries were reclaimed". Absent on every log written by the harness.
CAPTURES_STRIPPED_KEY = "captures_stripped"

# The calibration triple. `e2e/calibrate_judge.py` hard-errors when the
# `final-tree` sibling is missing (:271, :328) and its docstring at :33 says it
# reads the siblings, "never `run-<ts>.json`" — so these three are exactly the
# files this sweep must never touch at any age, and `run-<ts>.json` is exactly
# the one it may.
_E2E_SIBLING_SUFFIXES = (
    ".ann.json",
    ".final-research.json",
    ".final-tree.gedcomx.json",
)

# The one exception to "nothing reads `response_summary` back". These four runs
# are the sole calibration evidence for `CONSECUTIVE_TOOL_SEARCH_MISSES`
# (issue #941): `tests/unit/test_e2e_mcp_health.py` replays them through the
# real detector, which decides a ToolSearch miss by matching a marker *inside*
# `response_summary`. Stripping them breaks the three positive tests loudly and
# — worse — turns the healthy-run control into a vacuous pass, since a run with
# no summaries can never trip the backstop.
#
# Keyed on (fixture, filename) so an unrelated fixture reusing a timestamp
# cannot silently inherit the exemption. `test_e2e_mcp_health.py` asserts this
# set still covers everything it pins, so the two cannot drift apart.
E2E_STRIP_EXEMPT = frozenset(
    {
        ("william-ferber-origins", "run-2026-07-29_02-09-46.json"),
        ("william-ferber-origins", "run-2026-07-29_12-16-49.json"),
        ("william-ferber-origins", "run-2026-07-29_17-05-11.json"),
        ("william-ferber-origins", "run-2026-07-29_18-46-15.json"),
    }
)


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


def cmd_prune_unit(root: Path, *, keep: int, dry_run: bool) -> int:
    """Backfill the keep-newest-K rule across every skill dir.

    The harness prunes on write from now on, so this only has to catch up the
    backlog the manual tier never cleared: 312 candidates, 0 released.
    """
    if not root.is_dir():
        print(f"no unit runlog root at {root}")
        return 0

    total_removed = 0
    freed = 0
    for skill_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        before = [p for p in skill_dir.iterdir() if p.is_file()]
        if dry_run:
            names = [p.name for p in before]
            total_removed += len(prunable_candidates(names, keep=keep))
            continue
        sizes = {p.name: p.stat().st_size for p in before}
        removed = prune_old_candidates(skill_dir, keep=keep)
        total_removed += len(removed)
        freed += sum(sizes.get(p.name, 0) for p in removed)

    mb = 1024 * 1024
    if dry_run:
        print(f"prune --dry-run: {total_removed} candidate run log(s) would be removed")
    else:
        print(
            f"prune: removed {total_removed} file(s) (run logs + annotations), "
            f"{freed / mb:.1f} MB reclaimed; keeping the newest {keep} per skill"
        )
    return 0


def committed_e2e_runlogs(root: Path) -> list[Path]:
    """Every committed e2e run log, oldest-first within each fixture.

    Only `run-<ts>.json` itself. The three calibration siblings are excluded by
    suffix rather than by a `run-*.json` glob, because all three *also* match
    that glob — `run-<ts>.ann.json` and friends would otherwise be swept.
    """
    out: list[Path] = []
    if not root.is_dir():
        return out
    for fixture_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        for p in sorted(fixture_dir.iterdir()):
            if not p.is_file() or not p.name.endswith(".json"):
                continue
            if p.name.endswith(_E2E_SIBLING_SUFFIXES):
                continue
            if p.name.startswith("scratch_") or p.name.startswith(".partial_"):
                continue
            if (fixture_dir.name, p.name) in E2E_STRIP_EXEMPT:
                continue
            out.append(p)
    return out


def replay_remnant(response_summary: Any) -> str | None:
    """The smallest `response_summary` that `harness/replay.py` can still read.

    **Why a remnant and not a plain drop.** The strip shipped believing nothing
    read this field back; `replay.py` does, and reconstructs `research.json` from
    it. It needs exactly three things, all recovered here through `replay`'s own
    parser so there is one implementation of the parsing:

      * the `entryId` / `logId` values, in order — what each write actually created;
      * `ok`, since a rejected call changed nothing and must not be applied;
      * `_full_length` on a summarised batch, which is how ids the ledger never
        recorded get reconstructed by convention instead of silently dropped.

    Measured over the corpus, that is **0.4% of the bytes** the full summaries
    occupy, against the 24% of a run log they account for — so keeping it costs
    essentially nothing and restores the engine outright. Returns None when there
    is nothing worth keeping, so the field is dropped as before.
    """
    parsed = parse_tool_result(response_summary)
    if not parsed:
        return None
    ids = parsed.get("ids") or []
    full_length = parsed.get("full_length")
    if not ids and full_length is None and parsed.get("ok") is None:
        return None
    remnant: dict[str, Any] = {"ok": parsed.get("ok")}
    if ids:
        remnant["results"] = [{"entryId": i} for i in ids]
    if full_length is not None:
        remnant["_full_length"] = full_length
    return json.dumps(remnant)


def strip_captures_one(path: Path, *, cutoff: date) -> tuple[bool, int, int]:
    """Reduce `response_summary` to its replay remnant in one e2e run log.

    Returns (changed, bytes_before, bytes_after). Leaves the file untouched —
    byte-identical, not merely equivalent — when it is newer than the cutoff,
    carries no parseable date, or has already been stripped.

    Was a plain drop until 2026-08-23. Measured then: 133 of the 134 already
    stripped runs could no longer be replayed, against 18 of the 23 unstripped
    ones that could — the strip was destroying the replay engine's only input.
    Those 134 are not recoverable; this keeps it from happening to the rest.
    """
    before = path.stat().st_size

    day = run_date(path)
    if day is None or day >= cutoff:
        return False, before, before

    log = json.loads(path.read_text(encoding="utf-8"))
    if log.get(CAPTURES_STRIPPED_KEY):
        return False, before, before

    for call in log.get("tool_calls") or []:
        if not isinstance(call, dict):
            continue
        remnant = replay_remnant(call.get("response_summary"))
        if remnant is None:
            call.pop("response_summary", None)
        else:
            call["response_summary"] = remnant
    log[CAPTURES_STRIPPED_KEY] = True

    path.write_text(json.dumps(log, indent=2), encoding="utf-8")
    return True, before, path.stat().st_size


def cmd_strip_e2e_captures(root: Path, *, days: int, dry_run: bool) -> int:
    """Sweep the e2e corpus, reclaiming the one field nothing reads back.

    `response_summary` is the largest field in an e2e run log, at 24% of its
    bytes. It was believed to have no programmatic reader, and this docstring
    enumerated four that take `tool` / `args` / `is_error` only
    (`e2e/calibrate_judge.py`, `e2e/guardrail_shadow_report.py`,
    `e2e/runlog_selection.py`, `scripts/check_e2e_fixtures.py`) plus
    `e2e/mcp_health.py`, which reads summaries in-flight and never off disk.

    **That enumeration was incomplete, and the cost was the replay engine.**
    `harness/replay.py` reconstructs `research.json` from the `entryId` each
    writer reported back — inside this field. By the time it was noticed, 134 of
    157 committed runs were stripped and 133 of those could no longer be
    replayed, which read as an 88% -> 13% collapse in reconstruction fidelity and
    looked like a regression in an engine nobody had touched.

    So the sweep now keeps a **replay remnant** rather than dropping the field:
    ids, `ok`, and a batch's `_full_length`, measured at 0.4% of the summary
    bytes. Everything else still goes, and the human "diagnose the run that just
    happened" workflows are still served by the 14-day query window rather than
    by the archive.
    """
    if not root.is_dir():
        print(f"no e2e runlog root at {root}")
        return 0

    cutoff = _cutoff_date(days)
    logs = committed_e2e_runlogs(root)
    changed = 0
    before_total = after_total = 0
    for p in logs:
        if dry_run:
            day = run_date(p)
            if day is None or day >= cutoff:
                continue
            log = json.loads(p.read_text(encoding="utf-8"))
            if log.get(CAPTURES_STRIPPED_KEY):
                continue
            changed += 1
            continue
        did, before, after = strip_captures_one(p, cutoff=cutoff)
        before_total += before
        after_total += after
        changed += 1 if did else 0

    mb = 1024 * 1024
    if dry_run:
        print(
            f"strip-e2e-captures --dry-run: {changed} of {len(logs)} e2e run "
            f"log(s) would be stripped (older than {days} days)"
        )
    else:
        print(
            f"strip-e2e-captures: stripped {changed} of {len(logs)} e2e run "
            f"log(s) older than {days} days; "
            f"{before_total / mb:.1f} MB -> {after_total / mb:.1f} MB "
            f"({(before_total - after_total) / mb:.1f} MB reclaimed)"
        )
    return 0


def _cutoff_date(days: int) -> date:
    """Runs dated strictly before this are eligible."""
    return date.today() - timedelta(days=days)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--rehash",
        action="store_true",
        help="migrate pre-v3 run logs to hashed snapshots",
    )
    ap.add_argument(
        "--prune-unit",
        nargs="?",
        type=int,
        const=DEFAULT_KEEP_CANDIDATES,
        metavar="K",
        help=f"keep the newest K candidates per skill (default: {DEFAULT_KEEP_CANDIDATES})",
    )
    ap.add_argument(
        "--strip-e2e-captures",
        nargs="?",
        type=int,
        const=DEFAULT_SINCE_DAYS,
        metavar="DAYS",
        help=(
            "drop response_summary from e2e run logs older than DAYS "
            f"(default: {DEFAULT_SINCE_DAYS}, matching the reader window)"
        ),
    )
    ap.add_argument("--dry-run", action="store_true", help="report, change nothing")
    ap.add_argument(
        "--runlogs-root",
        type=Path,
        default=RUNLOGS_UNIT,
        help=f"unit runlog root (default: {RUNLOGS_UNIT})",
    )
    ap.add_argument(
        "--e2e-runlogs-root",
        type=Path,
        default=RUNLOGS_E2E,
        help=f"e2e runlog root (default: {RUNLOGS_E2E})",
    )
    args = ap.parse_args(argv)

    if not args.rehash and args.prune_unit is None and args.strip_e2e_captures is None:
        ap.error(
            "nothing to do — pass --rehash, --prune-unit and/or --strip-e2e-captures"
        )

    rc = 0
    if args.rehash:
        rc |= cmd_rehash(args.runlogs_root, dry_run=args.dry_run)
    if args.prune_unit is not None:
        rc |= cmd_prune_unit(
            args.runlogs_root, keep=args.prune_unit, dry_run=args.dry_run
        )
    if args.strip_e2e_captures is not None:
        rc |= cmd_strip_e2e_captures(
            args.e2e_runlogs_root,
            days=args.strip_e2e_captures,
            dry_run=args.dry_run,
        )
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
