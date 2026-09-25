#!/usr/bin/env python3
"""Replay the two log-query `report_*` validators over the committed unit corpus.

`report_log_query_traces_to_record_search_call` (test_search_records.py) and
`report_log_query_traces_to_url_tool_call` (test_search_external_sites.py) are
outside every snapshot, and nothing in CI runs a validator over the committed
run logs, so a check that fires on half the corpus would land green and surface
only in someone else's paid `make eval-skill` run. This is that replay, committed
so its counts stay reproducible after `PLAN.md` is deleted on merge.

Each run is replayed from its run log: `tool_calls` as recorded (responses
included, which is what exact pairing reads), and the log entries the run ADDED
(`file_changes["research.json"].diff.log.added`) as the new entries against an
empty prior log. Prints every firing, one line per claim, and totals per class
and per query source: whether the op passed its `query` or the tool filled it.

Needs the engine build (the validators read the tool vocabulary from it).

Usage (from eval/harness):
    uv run python scripts/replay_log_query_validators.py [--list]
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parents[1]
REPO = HARNESS.parents[1]
sys.path[:0] = [str(HARNESS / "validators"), str(HARNESS)]

import test_search_external_sites as ses  # noqa: E402
import test_search_records as sr  # noqa: E402

def query_source_by_log_id(tool_calls) -> dict[str, str]:
    """Log id -> "explicit" when its research_log_append op passed a `query`, or
    "filled" when the tool filled it from the staged payload. A filled entry in a
    run recorded before the eval mock echoed a search's arguments carries the
    FIXTURE's recorded query, so a firing on it is a harness artifact."""
    out: dict[str, str] = {}
    for c in tool_calls:
        if str(c.get("tool", "")).split("__")[-1] != "research_log_append":
            continue
        args = c.get("args") if isinstance(c.get("args"), dict) else {}
        response = c.get("response") if isinstance(c.get("response"), dict) else {}
        ops = args.get("ops")
        if isinstance(ops, str):
            try:
                ops = json.loads(ops)
            except ValueError:
                ops = None
        if isinstance(ops, list):
            ids = [r.get("logId") if isinstance(r, dict) else None for r in response.get("results") or []]
        else:
            ops, ids = [args], [response.get("logId")]
        for op, log_id in zip(ops, ids):
            if isinstance(log_id, str) and isinstance(op, dict):
                out[log_id] = "filled" if op.get("query") is None else "explicit"
    return out


CHECKS = {
    "search-records": lambda before, after, calls, test: sr.report_log_query_traces_to_record_search_call(before, after, calls),
    "search-external-sites": lambda before, after, calls, test: ses.report_log_query_traces_to_url_tool_call(before, after, calls, test),
}


def main() -> int:
    show = "--list" in sys.argv
    head = subprocess.run(
        ["git", "rev-parse", "--short=9", "HEAD"], cwd=REPO, capture_output=True, text=True, encoding="utf-8", check=True
    ).stdout.strip()
    print(f"HEAD {head}")
    for skill, check in CHECKS.items():
        files = subprocess.run(
            ["git", "ls-files", f"eval/runlogs/unit/{skill}"], cwd=REPO, capture_output=True, text=True, encoding="utf-8", check=True
        ).stdout.split()
        files = [f for f in files if f.endswith(".json") and not f.endswith(".ann.json")]
        runs = judged = fired = 0
        tests_fired: set[str] = set()
        classes: dict[tuple[str, str], int] = {}
        lines: list[str] = []
        for f in files:
            doc = json.loads((REPO / f).read_text(encoding="utf-8"))
            for t in doc.get("tests") or []:
                for run in t.get("runs") or []:
                    runs += 1
                    out = run.get("output") or {}
                    change = (out.get("file_changes") or {}).get("research.json") or {}
                    added = (((change.get("diff") or {}).get("log") or {}).get("added")) or []
                    before = {"research_json": {"log": []}}
                    after = {"research_json": {"log": added}}
                    test = {"type": t.get("test_type")}
                    try:
                        check(before, after, out.get("tool_calls") or [], test)
                        judged += 1
                    except pytest.skip.Exception:
                        continue
                    except AssertionError as e:
                        judged += 1
                        fired += 1
                        tests_fired.add(t.get("test_id"))
                        sources = query_source_by_log_id(out.get("tool_calls") or [])
                        for claim in str(e).splitlines()[1:]:
                            log_id = claim.split("log entry ", 1)[-1].split(" ", 1)[0]
                            key = ("value differs" if "value differs" in claim else "never sent", sources.get(log_id, "unknown"))
                            classes[key] = classes.get(key, 0) + 1
                            lines.append(
                                f"  {Path(f).name} {t.get('test_id')} run {run.get('run_index')} [{key[1]}]: {claim.strip()[2:]}"
                            )
        print(f"\n{skill}: {len(files)} run logs, {runs} runs, {judged} judged, {fired} fired in {len(tests_fired)} test(s)")
        print("  claims: " + (", ".join(f"{n} {cls} ({src} query)" for (cls, src), n in sorted(classes.items())) or "none"))
        print(f"  tests: {', '.join(sorted(tests_fired)) or 'none'}")
        if show:
            print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
