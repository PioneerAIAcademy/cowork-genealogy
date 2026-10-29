#!/usr/bin/env python3
"""Measure what issue #3592's completion-record-type precondition would refuse.

`research_append` refuses marking a plan item `completed` when its `record_type`
has a known vocabulary and no `log[]` entry attributed to it names a search of
that type (`planItemCompletionRecordTypeInvariants` in `research-append.ts` —
the content half of the completion check; the probate/land case behind
`ut_search_full_text_016`/`_020`). This replays that guard over every plan-item
completion in the committed unit and e2e run logs and counts the refusals, so a
**false refusal** (a legitimate completion the open-vocabulary map would wrongly
reject) is caught before the guard enforces — the step done for #3432.

Each run is reconstructed in order from its starting scenario: `research_log_append`
appends to `log[]`, `research_append` plan_items/plans ops move item status and
carry record_type. At each transition of an item to `completed`, the guard is
evaluated against the accumulated state (all live attributed entries, as the
writer sees them).

Per ADR-0011 ("inspection, not a rate") a clean scan prints its denominators.
Re-derive rather than quote: a re-run replaces a skill's run log.

Usage::

    cd eval/harness && uv run python scripts/measure_plan_item_completion_record_type.py
    ... --json   every refused completion, for reading each one (ADR-0011 limit 2)
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[1]
REPO = HARNESS.parents[1]
UNIT_RUNLOGS = REPO / "eval" / "runlogs" / "unit"
E2E_RUNLOGS = REPO / "eval" / "runlogs" / "e2e"
UNIT_TESTS = REPO / "eval" / "tests" / "unit"
E2E_TESTS = REPO / "eval" / "tests" / "e2e"
SCENARIOS = REPO / "eval" / "fixtures" / "scenarios"

# Ported from planItemCompletionRecordTypeInvariants / the eval validator
# RECORD_TYPE_TERMS. The three must agree.
RECORD_TYPE_TERMS = {
    # No bare "estate": land in "real estate" / British-Irish estate records.
    "probate": ("executor", "executrix", "administrator", "administratrix",
                "appraise", "appraisement", "inventory", "bequeath", "testament",
                "heir", "legatee", "probate"),
    "church": ("baptism", "baptismal", "christen", "confirmation", "burial"),
    "church_record": ("baptism", "baptismal", "christen", "confirmation", "burial"),
    "vital": ("birth", "death", "marriage"),
    "vital_record": ("birth", "death", "marriage"),
    "marriage": ("marriage", "wedding", "banns", "matrimon"),
    "census": ("census", "household", "dwelling", "enumerat"),
    "naturalization": ("naturaliz", "declaration of intent"),
    "obituary": ("obituary", "death notice"),
}


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _bare(tool: str) -> str:
    return str(tool or "").rsplit("__", 1)[-1]


def _ops(args: dict) -> list:
    ops = args.get("ops")
    if isinstance(ops, str):
        try:
            ops = json.loads(ops)
        except ValueError:
            ops = None
    if isinstance(ops, list):
        return [o for o in ops if isinstance(o, dict)]
    return [args] if args.get("section") or args.get("tool") or args.get("outcome") else []


def _guard_refuses(record_type: str, attributed: list) -> bool:
    """planItemCompletionRecordTypeInvariants, verbatim: fires when the type has a
    vocabulary, something is attributed, and none of it names that type."""
    terms = RECORD_TYPE_TERMS.get(str(record_type or "").lower())
    if not terms:
        return False
    if not attributed:
        return False  # the structural gate's job, not this one's
    haystack = " ".join(
        f"{e.get('tool', '')} {e.get('notes', '')} {json.dumps(e.get('query') or {}, ensure_ascii=False)}"
        for e in attributed
    ).lower()
    # Leading word-boundary only (r"\bterm"); see the engine guard + validator.
    return not any(re.search(r"\b" + re.escape(t), haystack) for t in terms)


def _seed_items(research: dict) -> dict:
    """{item_id: {record_type, status}} from a starting research.json."""
    out = {}
    for plan in (research.get("plans") or []):
        for it in (plan.get("items") or []):
            if isinstance(it, dict) and isinstance(it.get("id"), str):
                out[it["id"]] = {"record_type": it.get("record_type"), "status": it.get("status")}
    return out


def _seed_log(research: dict) -> list:
    out = []
    for e in (research.get("log") or []):
        if isinstance(e, dict):
            out.append({"plan_item_id": e.get("plan_item_id"), "tool": e.get("tool"),
                        "notes": e.get("notes"), "query": e.get("query")})
    return out


def scan_run(tool_calls: list, starting: dict, label: str, counts: collections.Counter, hits: list) -> None:
    items = _seed_items(starting)
    log = _seed_log(starting)
    for c in tool_calls:
        if not isinstance(c, dict):
            continue
        tool = _bare(c.get("tool"))
        args = c.get("args") if isinstance(c.get("args"), dict) else {}
        if tool == "research_log_append":
            for op in _ops(args):
                log.append({"plan_item_id": op.get("planItemId"), "tool": op.get("tool"),
                            "notes": op.get("notes"), "query": op.get("query")})
            continue
        if tool != "research_append":
            continue
        for op in _ops(args):
            section = op.get("section")
            # Collect (item_id, record_type, new_status, prior_status) touched by this op.
            touched = []
            if section == "plan_items":
                iid = op.get("entryId") if op.get("op") == "update" else (op.get("entry") or {}).get("id")
                fields = op.get("fields") if op.get("op") == "update" else (op.get("entry") or {})
                if isinstance(iid, str) and isinstance(fields, dict) and "status" in fields:
                    prior = items.get(iid, {})
                    rt = fields.get("record_type", prior.get("record_type"))
                    touched.append((iid, rt, fields.get("status"), prior.get("status")))
            elif section == "plans":
                entry = op.get("fields") if op.get("op") == "update" else (op.get("entry") or {})
                for it in (entry.get("items") or []) if isinstance(entry, dict) else []:
                    if isinstance(it, dict) and isinstance(it.get("id"), str) and it.get("status"):
                        prior = items.get(it["id"], {})
                        touched.append((it["id"], it.get("record_type", prior.get("record_type")),
                                        it.get("status"), prior.get("status")))
            for iid, rt, new_status, prior_status in touched:
                items[iid] = {"record_type": rt, "status": new_status}
                if new_status != "completed" or prior_status == "completed":
                    continue
                counts["completions"] += 1
                attributed = [e for e in log if e.get("plan_item_id") == iid]
                if not attributed:
                    counts["completions_unattributed"] += 1  # structural gate's domain
                    continue
                if str(rt or "").lower() in RECORD_TYPE_TERMS:
                    counts["completions_with_vocab"] += 1
                if _guard_refuses(rt, attributed):
                    counts["refused"] += 1
                    hits.append({"run": label, "item": iid, "record_type": rt,
                                 "attributed_tools": [e.get("tool") for e in attributed]})


def measure() -> tuple[collections.Counter, list]:
    counts: collections.Counter = collections.Counter()
    hits: list = []
    for path in sorted(UNIT_RUNLOGS.glob("*/v*.json")):
        if path.name.endswith(".ann.json"):
            continue
        log = _load(path)
        if not isinstance(log, dict) or not isinstance(log.get("tests"), list):
            continue
        counts["unit_run_logs"] += 1
        for t in log["tests"]:
            scenario = (t.get("input") or {}).get("scenario") or t.get("scenario")
            starting = _load(SCENARIOS / str(scenario) / "research.json") or {} if scenario else {}
            for r in t.get("runs", []):
                counts["runs"] += 1
                scan_run((r.get("output") or {}).get("tool_calls") or [], starting,
                         f"{path.parent.name}/{path.name}::{t.get('test_id')}", counts, hits)
    for path in sorted(E2E_RUNLOGS.glob("*/run-*.json")):
        if path.name.endswith((".ann.json", ".final-research.json", ".final-tree.gedcomx.json")):
            continue
        log = _load(path)
        if not isinstance(log, dict) or not isinstance(log.get("tool_calls"), list):
            continue
        counts["e2e_run_logs"] += 1
        starting = _load(E2E_TESTS / path.parent.name / "starting-research.json") or {}
        counts["runs"] += 1
        scan_run(log["tool_calls"], starting, f"e2e/{path.parent.name}/{path.name}", counts, hits)
    return counts, hits


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true", help="print every refused completion")
    args = parser.parse_args(argv)
    counts, hits = measure()
    if args.json:
        print(json.dumps({"counts": counts, "hits": hits}, indent=1))
        return 0
    for key in sorted(counts):
        print(f"{key:30} {counts[key]}")
    runs = {h["run"].split("::")[0] for h in hits}
    print(f"\nREFUSED: {counts['refused']} of {counts['completions_with_vocab']} completions of a "
          f"vocabulary-bearing record_type ({counts['completions']} plan-item completions examined "
          f"across {counts['runs']} runs), in {len(runs)} run log(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
