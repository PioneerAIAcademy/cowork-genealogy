#!/usr/bin/env python3
"""Measure what research_log_append's stored-collection precondition would refuse.

`research_log_append` refuses an `external_site` op whose `urlGenerated` names a
collection (an Ancestry collection id, a MyHeritage collection page) whose key is
not in `external-collections.json`, unless the url is already in the log and the
op opens no new hand-off (`preflightStoredCollection` in research-log-append.ts).

This replays every successful `research_log_append` call in the committed e2e and
unit corpus at write time. The log the call saw is rebuilt with
`harness.replay`; the stored list it saw is approximated as every collection key
in the responses of earlier `external_links_search` and `research_query` calls,
plus a unit scenario's seeded `external-collections.json`. The file itself is not
committed with a run, and the capture keeps under ~1,500 characters of each
response, so a list seen that way is partial and a refusal against it is
`unjudgeable`, not a catch. An e2e run that records its stored keys
(`external_collection_keys`, since the stored list landed) is judged against that
exact list instead. Every refusal is printed for reading (ADR-0011 limit 2: the
bar is inspection, not a rate).

Usage:
    cd eval/harness && uv run python scripts/measure_log_collection_urls.py
    ... --json    every refused op, for reading each one
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HARNESS))

from harness.replay import bare_tool_name, parse_tool_result, replay  # noqa: E402

REPO = HARNESS.parents[1]
RUNLOGS = REPO / "eval" / "runlogs"
E2E_TESTS = REPO / "eval" / "tests" / "e2e"
UNIT_TESTS = REPO / "eval" / "tests" / "unit"
SCENARIOS = REPO / "eval" / "fixtures" / "scenarios"
SIDECAR_SUFFIXES = (".ann.json", ".final-research.json", ".final-tree.gedcomx.json")

# Mirrors external-collections-store.ts `collectionKey` / `namesCollection`.
ANCESTRY_ID = re.compile(r"ancestry\.[a-z.]+/search/collections/(\d+)/?(?:[?#]|$)|[?&]dbid=(\d+)", re.I)
MYHERITAGE = re.compile(r"myheritage\.[a-z.]+/research/collection-\d+", re.I)
URL = re.compile(r"https?://[^\s\"'\\<>]+")


def names_collection(url: str) -> bool:
    return bool((ANCESTRY_ID.search(url) and re.search(r"ancestry\.", url, re.I)) or MYHERITAGE.search(url))


def collection_key(url: str) -> str:
    m = ANCESTRY_ID.search(url)
    if m and re.search(r"ancestry\.", url, re.I):
        return f"ancestry:{m.group(1) or m.group(2)}"
    if MYHERITAGE.search(url):
        return re.split(r"[?#]", url)[0]
    return url


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _obj(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def _ops(args: dict) -> list:
    ops = _obj(args.get("ops"))
    return ops if isinstance(ops, list) else [args]


def _keys_in(text) -> set[str]:
    blob = text if isinstance(text, str) else json.dumps(text)
    return {collection_key(u) for u in URL.findall(blob) if names_collection(u)}


def _unit_scenarios() -> dict[str, str]:
    out = {}
    for f in UNIT_TESTS.glob("*/*.json"):
        d = _load(f)
        if isinstance(d, dict) and isinstance(d.get("test"), dict):
            scenario = (d.get("input") or {}).get("scenario")
            if isinstance(scenario, str):
                out[d["test"].get("id")] = scenario
    return out


def _runs():
    """(label, tool_calls, starting research, seeded keys) per recorded run."""
    for path in sorted((RUNLOGS / "e2e").glob("*/run-*.json")):
        if path.name.endswith(SIDECAR_SUFFIXES):
            continue
        log = _load(path)
        if isinstance(log, dict) and isinstance(log.get("tool_calls"), list):
            starting = _load(E2E_TESTS / path.parent.name / "starting-research.json") or {}
            recorded = log.get("external_collection_keys")
            exact = (
                {k for keys in recorded.values() for k in keys} if isinstance(recorded, dict) else None
            )
            yield f"e2e {path.parent.name}/{path.name}", log["tool_calls"], starting, exact
    scenarios = _unit_scenarios()
    for path in sorted((RUNLOGS / "unit").glob("*/*.json")):
        if path.name.endswith(SIDECAR_SUFFIXES) or path.name.startswith("scratch_"):
            continue
        log = _load(path)
        if not isinstance(log, dict) or not isinstance(log.get("tests"), list):
            continue
        for test in log["tests"]:
            scenario = scenarios.get(test.get("id"))
            starting = _load(SCENARIOS / scenario / "research.json") if scenario else None
            seeded = _keys_in(_load(SCENARIOS / scenario / "external-collections.json") or "") if scenario else set()
            for n, run in enumerate(test.get("runs") or []):
                calls = (run.get("output") or {}).get("tool_calls")
                if isinstance(calls, list):
                    yield f"unit {path.parent.name}/{path.name} {test.get('id')}#{n}", calls, starting or {}, (seeded, False)


def measure() -> tuple[collections.Counter, list[dict]]:
    counts: collections.Counter = collections.Counter()
    refused: list[dict] = []
    for label, calls, starting, known in _runs():
        counts["runs"] += 1
        # `known`: the exact recorded key set (judged), or (seeded, False) / None
        # for a list rebuilt from capped responses (unjudgeable when it misses).
        exact = isinstance(known, set)
        stored = set(known) if exact else set(known[0]) if isinstance(known, tuple) else set()
        for i, call in enumerate(calls):
            tool = bare_tool_name(str(call.get("tool") or ""))
            response = call.get("response_summary") or call.get("response")
            if tool in ("external_links_search", "research_query"):
                if not exact:
                    stored |= _keys_in(response or "")
                continue
            if tool != "research_log_append" or call.get("is_error"):
                continue
            result = parse_tool_result(response) if response is not None else None
            if result is not None and result.get("ok") is False:
                continue
            args = _obj(call.get("args") or call.get("input")) or {}
            log_seen = None
            for op in _ops(args):
                site = _obj(op.get("externalSite")) if isinstance(op, dict) else None
                url = site.get("urlGenerated") if isinstance(site, dict) else None
                if not isinstance(url, str) or not names_collection(url.strip()):
                    continue
                url = url.strip()
                counts["ops_naming_a_collection"] += 1
                if exact:
                    counts["ops_in_runs_with_a_recorded_list"] += 1
                if log_seen is None:
                    try:
                        log_seen = replay(calls, starting, upto=i).research.get("log") or []
                    except Exception:  # noqa: BLE001 - an unreplayable run is counted, not fatal
                        log_seen = list(starting.get("log") or [])
                        counts["replay_failed_calls"] += 1
                logged = {
                    (e.get("external_site") or {}).get("url_generated", "").strip()
                    for e in log_seen if isinstance(e, dict) and isinstance(e.get("external_site"), dict)
                }
                opens = op.get("outcome") == "partial" and site.get("captureReceived") is False
                if url in logged and not opens:
                    counts["ops_exempt_already_logged"] += 1
                    continue
                if collection_key(url) in stored:
                    counts["ops_stored"] += 1
                    continue
                counts["ops_refused_judged" if exact else "ops_refused_unjudgeable"] += 1
                refused.append({
                    "judged": exact,
                    "run": label,
                    "call_index": i,
                    "url": url,
                    "outcome": op.get("outcome"),
                    "capture_received": site.get("captureReceived"),
                    "stored_keys_seen": sorted(stored),
                    "already_logged": url in logged,
                })
    return counts, refused


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true", help="print every refused op")
    args = parser.parse_args(argv)
    counts, refused = measure()
    if args.json:
        print(json.dumps({"counts": counts, "refused": refused}, indent=1))
        return 0
    for key in sorted(counts):
        print(f"{key:28} {counts[key]}")
    judged = [r for r in refused if r["judged"]]
    print(f"\nrefused against a recorded list: {len(judged)}")
    print(f"refused against a capped rebuild (unjudgeable): {len(refused) - len(judged)} across "
          f"{len({r['run'] for r in refused if not r['judged']})} run(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
