"""`make unit-pg-parity` — each skill's newest `--store pg` run against its
newest file-store run (U15).

A skill's Postgres results may span several `--store pg` logs (a run that
stopped part-way, then the missing tests by `--test`); they are merged, the
newest log's result winning for a test that appears twice.

A Postgres run is judged by parity, not graded on its own: the question is
whether moving every live tool call onto PgS3ProjectStore changed anything. Per
skill, over the tests present in both runs, it prints the outcome flips and
every live tool response that reads as a store fault (a Postgres, S3 or
prelude error, a ref the Postgres store refused) or a node subprocess timeout.

An outcome flip with no store fault behind it is the model's run-to-run wobble
— the skill run has no temperature — and the line says so; a store fault is
the finding. Exit 1 when any live response carries a store fault, else 0.

Zero API spend — pure formatting over run logs.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from harness.mock_mcp import NODE_EVAL_TIMEOUT_PATTERN
from skill_latency_report import UNIT_RUNLOGS
from unit_run_compare import _load
from unit_run_report import run_logs

UNIT_PG_RUNLOGS = UNIT_RUNLOGS.parent / "unit-pg"

#: What a live response says when the Postgres side, not the tool, failed:
#: PgS3ProjectStore's own refusals and absent-ref text (which names the
#: harness's `h-<run>-…` project id), the prelude's errors, the S3 SDK's error
#: names, and the transport. Not a bare `S3`: GedcomX source ids are `S1`, `S3`…
STORE_FAULT = re.compile(
    r"PgS3|pg_store_prelude|not this store's project|escapes the project|"
    r"is a JSON document; |does not exist in project h-|postgres|"
    r"NoSuchKey|NoSuchBucket|SignatureDoesNotMatch|RequestTimeTooSkewed|S3ServiceException|"
    r"ECONNREFUSED|ETIMEDOUT|connection terminated",
    re.IGNORECASE,
)


def by_time(paths: list[Path]) -> list[tuple[Path, dict[str, Any]]]:
    loaded = [(p, log) for p in paths if (log := _load(p)) is not None]
    loaded.sort(key=lambda pl: (str(pl[1].get("timestamp") or ""), pl[0].name))
    return loaded


def newest(paths: list[Path]) -> tuple[Path, dict[str, Any]] | None:
    loaded = by_time(paths)
    return loaded[-1] if loaded else None


def live_faults(test: dict[str, Any]) -> tuple[int, list[str], list[str]]:
    """(live calls, store-fault lines, timeout lines) across a test's runs: a
    live response that reads as a store fault, and every `pg_store_fault`
    warning — what the prelude recorded from any node process, the mock-side
    pipelines that swallow their failures included."""
    calls = 0
    faults: list[str] = []
    timeouts: list[str] = []
    for run in test.get("runs") or []:
        for w in (run.get("output") or {}).get("warnings") or []:
            if w.get("kind") == "pg_store_fault":
                for f in w.get("faults") or [{"op": "?", "message": w.get("advisory", "")}]:
                    faults.append(f"{f.get('op', '?')} (recorded by the prelude): {f.get('message', '')[:240]}")
        for call in (run.get("output") or {}).get("tool_calls") or []:
            if (call.get("matched") or {}).get("kind") != "live":
                continue
            calls += 1
            text = json.dumps(call.get("response"), ensure_ascii=False)
            tool = str(call.get("tool", "?")).rsplit("__", 1)[-1]
            if m := STORE_FAULT.search(text):
                start = max(0, m.start() - 80)
                faults.append(f"{tool}: …{text[start:m.end() + 120]}…")
            if NODE_EVAL_TIMEOUT_PATTERN.search(text):
                timeouts.append(tool)
    return calls, faults, timeouts


def compare(skill: str, pg_root: Path, fs_root: Path) -> tuple[list[str], bool]:
    pg_logs = by_time(run_logs(skill, root=pg_root))
    if not pg_logs:
        return [f"{skill}: no --store pg run log"], False
    fs = newest(run_logs(skill, root=fs_root)) if (fs_root / skill).is_dir() else None
    merged: dict[Any, dict[str, Any]] = {}
    for _, log in pg_logs:
        for t in log["tests"]:
            merged[t.get("test_id")] = t
    pg_log = {"tests": list(merged.values())}
    pg_names = ", ".join(p.name for p, _ in pg_logs)
    by_fs = {t.get("test_id"): t for t in (fs[1]["tests"] if fs else [])}
    lines: list[str] = []
    flips: list[str] = []
    calls = 0
    any_fault = False
    for t in pg_log["tests"]:
        n, faults, timeouts = live_faults(t)
        calls += n
        tid = t.get("test_id")
        before = by_fs.get(tid, {}).get("outcome")
        if before is not None and before != t.get("outcome"):
            flips.append(f"    {tid}: {before} → {t.get('outcome')}{'' if faults else ' (no store fault)'}")
        for f in faults:
            any_fault = True
            lines.append(f"    STORE FAULT {tid} {f}")
        for tool in timeouts:
            lines.append(f"    node timeout {tid} {tool}")
    shared = sum(1 for t in pg_log["tests"] if t.get("test_id") in by_fs)
    passed = sum(1 for t in pg_log["tests"] if t.get("outcome") == "pass")
    fs_note = f"vs {fs[0].name}" if fs else "no file-store log to compare"
    head = (
        f"{skill}: {pg_names} {fs_note} — {passed}/{len(pg_log['tests'])} pass on pg, "
        f"{shared} shared, {len(flips)} flip(s), {calls} live call(s), "
        f"{sum(1 for x in lines if 'STORE FAULT' in x)} store fault(s)"
    )
    return [head, *flips, *lines], any_fault


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--skill", help="one skill (default: every skill with a --store pg log)")
    parser.add_argument("--pg-root", type=Path, default=UNIT_PG_RUNLOGS)
    parser.add_argument("--fs-root", type=Path, default=UNIT_RUNLOGS)
    args = parser.parse_args(argv)
    skills = (
        [args.skill]
        if args.skill
        else sorted(p.name for p in args.pg_root.iterdir() if p.is_dir()) if args.pg_root.is_dir() else []
    )
    if not skills:
        print(f"no --store pg run logs under {args.pg_root}", file=sys.stderr)
        return 2
    faulted = False
    for skill in skills:
        out, fault = compare(skill, args.pg_root, args.fs_root)
        faulted = faulted or fault
        print("\n".join(out))
    return 1 if faulted else 0


if __name__ == "__main__":
    raise SystemExit(main())
