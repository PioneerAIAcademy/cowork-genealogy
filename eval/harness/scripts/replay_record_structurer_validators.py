#!/usr/bin/env python3
"""Replay V2 and V7 (issue #2019, via #2479) over the committed unit corpus.

`test_document_record_ids_were_delegated` and `test_value_holds_no_derivation`
(test_record_structurer.py) are outside every snapshot, and nothing in CI runs a
validator over committed run logs, so a check that fires on correct runs would
land green and surface only in someone else's paid `make eval-skill` run. This is
that replay, committed so its counts stay reproducible after `PLAN.md` is deleted
on merge.

Each run is replayed from its run log: `tool_calls` as recorded, and the
assertions the run ADDED (`file_changes["research.json"].diff.assertions.added`)
against an empty prior list. Run logs record no `input`, so each run's
delegation is loaded from `eval/tests/unit/<skill>/*.json` by `test.id`; a test
with no delegation, or whose file is gone (the record-extraction suite's), skips
V2 and runs V7 with no record-text exemption.

Usage (from the repo root):
    uv run --project eval/harness python eval/harness/scripts/replay_record_structurer_validators.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parents[1]
REPO = HARNESS.parents[1]
sys.path[:0] = [str(HARNESS / "validators"), str(HARNESS)]

import test_record_structurer as rs  # noqa: E402

SUITES = ("record-structurer", "extraction-append", "record-extraction")


def delegations(skill: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for path in sorted((REPO / "eval/tests/unit" / skill).glob("*.json")):
        spec = json.loads(path.read_text(encoding="utf-8"))
        test_id = (spec.get("test") or {}).get("id")
        delegation = (spec.get("input") or {}).get("delegation")
        if test_id and delegation:
            out[test_id] = delegation
    return out


def outcome(fn, **kwargs) -> str:
    try:
        fn(**kwargs)
    except pytest.skip.Exception:
        return "skip"
    except AssertionError as e:
        return f"FAIL {e}"
    return "pass"


def replay(skill: str) -> None:
    known = delegations(skill)
    for log_path in sorted((REPO / "eval/runlogs/unit" / skill).glob("v*.json")):
        if log_path.name.endswith(".ann.json"):
            continue
        log = json.loads(log_path.read_text(encoding="utf-8"))
        runs = v2_hits = v7_hits = v7_values = assertions = 0
        firing: list[str] = []
        for test in log.get("tests") or []:
            delegation = known.get(test.get("test_id"))
            for run in test.get("runs") or []:
                out = run.get("output") or {}
                added = ((((out.get("file_changes") or {}).get("research.json") or {}).get("diff") or {}).get("assertions") or {}).get("added") or []
                runs += 1
                assertions += len(added)
                vtest = {"delegation": delegation} if delegation else {}
                v2 = outcome(rs.test_document_record_ids_were_delegated, tool_calls=out.get("tool_calls") or [], test=vtest)
                v7 = outcome(
                    rs.test_value_holds_no_derivation,
                    before_state={"research_json": {"assertions": []}},
                    after_state={"research_json": {"assertions": added}},
                    test=vtest,
                )
                if v2.startswith("FAIL"):
                    v2_hits += 1
                    firing.append(f"  V2 {test.get('test_id')} run {run.get('run_index')}: {v2[:200]}")
                if v7.startswith("FAIL"):
                    v7_hits += 1
                    v7_values += v7.count("; ") + 1
                    firing.append(f"  V7 {test.get('test_id')} run {run.get('run_index')}: {v7[:200]}")
        print(f"{skill}/{log_path.name}: {runs} runs, {assertions} added assertions, V2 failing runs {v2_hits}, V7 failing runs {v7_hits} ({v7_values} values)")
        for line in firing:
            print(line)


def main() -> int:
    for skill in SUITES:
        replay(skill)
    return 0


if __name__ == "__main__":
    sys.exit(main())
