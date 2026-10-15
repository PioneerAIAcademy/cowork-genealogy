#!/usr/bin/env python3
"""Measure what issue #2155's plan-status precondition would refuse.

`research_log_append` refuses a log entry whose `planItemId` belongs to a plan
whose `status` is `superseded` (`supersededPlanItemRefusal` in
`research-log-append.ts`). This replays every successful `research_log_append`
call in the committed e2e corpus against the state that call SAW, rebuilt with
`harness.replay` from the run's `tool_calls` and its fixture's
`starting-research.json`, and counts each op by the status of the plan owning
its `planItemId` at that moment.

Write time, not the final state: a plan active when a search was logged is
often superseded later, and reading the final document would count that search
as a violation it never was.

Coverage is partial and printed. `harness.replay` reads ids out of
`response_summary`, which the capture strip reclaims on older runs, so those
calls are counted as `unparseable` and not judged (`harness/replay.py`'s module
docstring has the history).

Usage:
    cd eval/harness && uv run python scripts/measure_superseded_log_items.py
    ... --json    every non-active hit, for reading each one (ADR-0011 limit 2)
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HARNESS))

from harness.replay import bare_tool_name, parse_tool_result, replay  # noqa: E402

REPO = HARNESS.parents[1]
E2E_RUNLOGS = REPO / "eval" / "runlogs" / "e2e"
E2E_TESTS = REPO / "eval" / "tests" / "e2e"
SIDECAR_SUFFIXES = (".ann.json", ".final-research.json", ".final-tree.gedcomx.json")


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _ops(args: dict) -> list:
    ops = args.get("ops")
    if isinstance(ops, str):
        try:
            ops = json.loads(ops)
        except ValueError:
            ops = None
    return ops if isinstance(ops, list) else [args]


def measure() -> tuple[collections.Counter, list[dict]]:
    counts: collections.Counter = collections.Counter()
    hits: list[dict] = []
    for path in sorted(E2E_RUNLOGS.glob("*/run-*.json")):
        if path.name.endswith(SIDECAR_SUFFIXES):
            continue
        log = _load(path)
        if not log or not isinstance(log.get("tool_calls"), list):
            continue
        slug = path.parent.name
        starting = _load(E2E_TESTS / slug / "starting-research.json") or {}
        calls = log["tool_calls"]
        counts["runs"] += 1
        for i, call in enumerate(calls):
            if bare_tool_name(str(call.get("tool") or "")) != "research_log_append":
                continue
            if call.get("is_error"):
                continue
            result = parse_tool_result(call.get("response_summary"))
            if result is None:
                counts["unparseable_calls"] += 1
                continue
            if result.get("ok") is False:
                continue
            counts["replayed_calls"] += 1
            args = call.get("args") if isinstance(call.get("args"), dict) else {}
            state = None
            for op in _ops(args):
                if not isinstance(op, dict):
                    continue
                pli = op.get("planItemId")
                if not (isinstance(pli, str) and pli.startswith("pli_")):
                    counts["ops_without_plan_item"] += 1
                    continue
                if state is None:
                    state = replay(calls, starting, upto=i).research
                plans = state.get("plans") or []
                plan = next(
                    (p for p in plans if any(it.get("id") == pli for it in (p.get("items") or []))),
                    None,
                )
                if plan is None:
                    counts["ops_item_not_found"] += 1
                    continue
                status = plan.get("status")
                counts[f"ops_on_{status}_plan"] += 1
                if status == "active":
                    continue
                owned = next(it for it in plan["items"] if it.get("id") == pli)
                hits.append({
                    "run": f"{slug}/{path.name}",
                    "call_index": i,
                    "plan_item_id": pli,
                    "plan_id": plan.get("id"),
                    "plan_status": status,
                    "item_status": owned.get("status"),
                    "question_id": plan.get("question_id"),
                    "active_plan_for_question": [
                        p.get("id") for p in plans
                        if p.get("question_id") == plan.get("question_id") and p.get("status") == "active"
                    ],
                })
    return counts, hits


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true", help="print every non-active hit")
    args = parser.parse_args(argv)
    counts, hits = measure()
    if args.json:
        print(json.dumps({"counts": counts, "hits": hits}, indent=1))
        return 0
    for key in sorted(counts):
        print(f"{key:28} {counts[key]}")
    runs = {h["run"] for h in hits}
    print(f"\nnon-active hits: {len(hits)} across {len(runs)} run(s)")
    refused = [h for h in hits if h["plan_status"] == "superseded"]
    print(f"refused by the precondition (superseded): {len(refused)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
