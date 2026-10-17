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
V2 and runs V7 with no delegation exemption. Each validator is reported as
judged / skipped / failing runs, so a zero on a population it never judged is
visible as such; V7 also counts the values it flagged.

Usage (from the repo root):
    uv run --project eval/harness python eval/harness/scripts/replay_record_structurer_validators.py
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

import test_record_structurer as rs  # noqa: E402

SUITES = ("record-structurer", "extraction-append", "record-extraction")


def committed(pattern: str) -> list[Path]:
    """Tracked files only, so an uncommitted local run log cannot move the counts."""
    out = subprocess.run(["git", "ls-files", pattern], cwd=REPO, capture_output=True, text=True, encoding="utf-8", check=True)
    return [REPO / line for line in out.stdout.splitlines() if line]


def delegations(skill: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for path in committed(f"eval/tests/unit/{skill}/*.json"):
        spec = json.loads(path.read_text(encoding="utf-8"))
        test_id = (spec.get("test") or {}).get("id")
        delegation = (spec.get("input") or {}).get("delegation")
        if test_id and delegation:
            out[test_id] = delegation
    return out


def outcome(fn, **kwargs) -> tuple[str, str]:
    try:
        fn(**kwargs)
    except pytest.skip.Exception:
        return "skip", ""
    except AssertionError as e:
        return "fail", str(e)
    return "pass", ""


def flagged_values(added: list[dict], tool_calls: list, test: dict) -> int:
    """V7 one assertion at a time, so the count is of values, not of message text."""
    n = 0
    for a in added:
        state, _ = outcome(
            rs.test_value_holds_no_derivation,
            before_state={"research_json": {"assertions": []}},
            after_state={"research_json": {"assertions": [a]}},
            tool_calls=tool_calls,
            test=test,
        )
        n += state == "fail"
    return n


def replay(skill: str) -> None:
    known = delegations(skill)
    for log_path in committed(f"eval/runlogs/unit/{skill}/v*.json"):
        if log_path.name.endswith(".ann.json"):
            continue
        log = json.loads(log_path.read_text(encoding="utf-8"))
        counts = {v: {"pass": 0, "skip": 0, "fail": 0} for v in ("V2", "V7")}
        runs = assertions = values = 0
        firing: list[str] = []
        for test in log.get("tests") or []:
            delegation = known.get(test.get("test_id"))
            vtest = {"delegation": delegation} if delegation else {}
            for run in test.get("runs") or []:
                out = run.get("output") or {}
                tool_calls = out.get("tool_calls") or []
                added = ((((out.get("file_changes") or {}).get("research.json") or {}).get("diff") or {}).get("assertions") or {}).get("added") or []
                runs += 1
                assertions += len(added)
                v2, v2_msg = outcome(rs.test_document_record_ids_were_delegated, tool_calls=tool_calls, test=vtest)
                v7, v7_msg = outcome(
                    rs.test_value_holds_no_derivation,
                    before_state={"research_json": {"assertions": []}},
                    after_state={"research_json": {"assertions": added}},
                    tool_calls=tool_calls,
                    test=vtest,
                )
                counts["V2"][v2] += 1
                counts["V7"][v7] += 1
                where = f"{test.get('test_id')} run {run.get('run_index')}"
                if v2 == "fail":
                    firing.append(f"  V2 {where}: {v2_msg[:200]}")
                if v7 == "fail":
                    values += flagged_values(added, tool_calls, vtest)
                    firing.append(f"  V7 {where}: {v7_msg[:200]}")
        summary = "; ".join(f"{v} judged {c['pass'] + c['fail']}, skipped {c['skip']}, failing {c['fail']}" for v, c in counts.items())
        print(f"{skill}/{log_path.name}: {runs} runs, {assertions} added assertions; {summary}; V7 flagged {values} values")
        for line in firing:
            print(line)


def main() -> int:
    for skill in SUITES:
        replay(skill)
    return 0


if __name__ == "__main__":
    sys.exit(main())
