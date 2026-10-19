#!/usr/bin/env python3
"""Corpus measurement behind the negative-evidence guardrail (#986).

`docs/specs/guardrail-enforcement-spec.md` section 4 records this gate as
**enforcing**, and ADR-0011 limit 2 requires that every refusal a new gate
adds be replayed over the committed corpus and read individually before it
ships. This script is that replay, committed so the figure in the spec stays
reproducible after `PLAN.md` is deleted on merge.

The rule: an assertion whose basis is a recorded ABSENCE must carry
`record_role: "absent"` and `informant_proximity: "researcher"`.

Two details make the count reproducible, and both were wrong in earlier
hand-runs:

  * The basis is `git ls-files '*.json'`, NOT a filesystem glob. A glob pulls
    in the gitignored `packages/engine/mcp-server/build/` tree and inflates
    every figure.
  * It descends into tool-call `args` and into JSON embedded in strings, so
    an assertion a run SUBMITTED is counted even when it was refused and so
    never reached a persisted document. Counting only `*.final-research.json`
    misses those, which is what the issue's own snippet did.

**Object counts are the reproducible figures.** The number of distinct
underlying ASSERTIONS is smaller, because one assertion appears repeatedly:
as the write-call argument, as the persisted copy, and once per retry
re-send. Collapsing those is a judgement about which re-sends are the same
assertion, so this script prints several mechanical keys rather than naming
one: quote the object count, and treat any assertion-level number as a hand
count that has to be shown its working.

**These are eval-corpus counts, not production** (`docs/architecture.md` 9.4
gap 3). Do not quote a rate off them.

Usage:  python3 eval/harness/scripts/measure_negative_evidence.py
"""

from __future__ import annotations

import collections
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # eval/harness

from harness.record_basis import record_basis_of  # noqa: E402

# The closed enum from docs/specs/schemas/enums.schema.json. A value outside
# it is already refused by the validator's own enum check, so a violation
# carrying one is not a refusal this gate ADDS.
PROXIMITY_ENUM = {
    "self", "witness", "household_member", "family_not_present",
    "researcher", "official_duty", "unknown",
}


def tracked_json_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "*.json"],
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout
    return [f for f in out.split("\0") if f and "node_modules" not in f]


SKIPPED: list[tuple[str, str]] = []


def find_negatives(path: str) -> list[tuple[str, dict]]:
    """Every object whose basis is a recorded absence, however deeply nested.

    Matched through `record_basis_of`, which reads BOTH spellings on purpose:
    this walks the frozen run-log corpus, which is never migrated, so most of
    the population still carries the pre-2026-09-18 field name. Reading only
    the current spelling would collapse the figure toward zero, and a broken
    instrument is indistinguishable from a real finding.

    A file that cannot be parsed is RECORDED, not silently dropped. This script
    is the durable evidence for an `enforcing` row, so a file that contributed
    nothing because it failed to parse must not be indistinguishable from one
    that genuinely held no negatives: a silent under-count reads as a measured
    zero.
    """
    found: list[tuple[str, dict]] = []

    def walk(node, where: str, depth: int = 0) -> None:
        if depth > 60:
            return
        if isinstance(node, dict):
            if record_basis_of(node) == "absent":
                found.append((where, node))
            for key, value in node.items():
                walk(value, f"{where}/{key}", depth + 1)
        elif isinstance(node, list):
            for i, value in enumerate(node):
                walk(value, f"{where}[{i}]", depth + 1)
        elif (
            isinstance(node, str)
            and ("record_basis" in node or "evidence_type" in node)
            and len(node) < 4_000_000
        ):
            try:
                walk(json.loads(node), f"{where}(str)", depth + 1)
            except ValueError:
                pass

    try:
        with open(path, encoding="utf-8") as handle:
            walk(json.load(handle), "")
    except (ValueError, OSError) as exc:
        SKIPPED.append((path, type(exc).__name__))
        return []
    return found


def already_refused(assertion: dict) -> str | None:
    """Why the document is rejected TODAY, independently of this gate."""
    if "record_role" not in assertion:
        return "checkRequired (no record_role)"
    if "informant_proximity" not in assertion:
        # checkEnum is guarded by `if ("informant_proximity" in a)`, so an
        # absent key is refused by checkRequired, not by the enum check.
        return "checkRequired (no informant_proximity)"
    if assertion.get("informant_proximity") not in PROXIMITY_ENUM:
        return "checkEnum (proximity off-enum)"
    return None


def main() -> int:
    files = tracked_json_files()
    negatives: list[tuple[str, str, dict]] = []
    for path in files:
        for where, assertion in find_negatives(path):
            negatives.append((path, where, assertion))

    violating = [
        (p, w, a) for p, w, a in negatives
        if a.get("record_role") != "absent"
        or a.get("informant_proximity") != "researcher"
    ]
    old = [(p, w, a) for p, w, a in violating if already_refused(a)]
    new = [(p, w, a) for p, w, a in violating if not already_refused(a)]

    print(f"git-tracked JSON files scanned : {len(files) - len(SKIPPED)}"
          f" of {len(files)} tracked")
    if SKIPPED:
        print(f"  UNPARSEABLE, contributed nothing : {len(SKIPPED)}")
        for path, kind in SKIPPED:
            print(f"     {path}  ({kind})")
    print(f"negative-assertion objects     : {len(negatives)}")
    print(f"violating objects              : {len(violating)}")
    print(f"  already refused today        : {len(old)}")
    print(f"  NET-NEW objects              : {len(new)}   <- the reproducible figure")

    print("\nalready refused today, by cause:")
    causes = collections.Counter(
        f"{p.split('/')[-2]}  [{already_refused(a)}]" for p, _, a in old
    )
    for label, count in sorted(causes.items()):
        print(f"   {count:>2}x {label}")

    # No single mechanical key collapses re-sends correctly; print several so
    # a reader can see the spread instead of trusting one number.
    keys = {
        "none (raw objects)": lambda p, a: id(a),
        "(file, id)": lambda p, a: (p, a.get("id")),
        "value": lambda p, a: a.get("value"),
        "(record_id, role, proximity)": lambda p, a: (
            a.get("record_id"), a.get("record_role"), a.get("informant_proximity")
        ),
    }
    print("\nnet-new under each mechanical dedupe key:")
    for label, keyfn in keys.items():
        print(f"   {len({keyfn(p, a) for p, _, a in new}):>3}  {label}")
    print("\n(The spec quotes the object count. Any assertion-level number is a")
    print(" hand collapse and must show its working.)")

    print("\nnet-new by file:")
    per_file = collections.Counter(
        f"{p}  {a.get('id') or '(no id)'}" for p, _, a in new
    )
    for label, count in sorted(per_file.items()):
        print(f"   {count:>2}x {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
