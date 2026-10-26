#!/usr/bin/env python3
"""Replay `test_identity_links_follow_their_persona` (issue #3713) over the committed
person-evidence unit corpus.

The validator gates every person-evidence run, and nothing in CI runs a validator over
committed run logs, so a check that fired on correct runs would land green and surface
only in someone else's paid `make eval-skill`. This is that replay, committed so its
counts stay reproducible after `PLAN.md` is deleted on merge.

Each run is replayed from its run log: `tool_calls` as recorded (the live
`materialize_facts` responses included), the run's scenario `research.json` as the
before state, and the after state built from it plus the run's own
`file_changes["research.json"].diff` (`assertions` and `person_evidence`, added and
modified). A run is JUDGED when it adds at least one identity link (a new `pe_` link
of a fact the validator counts as a persona's own); the rest pass vacuously and are
counted as skipped, so a zero failing over a population it never judged is visible.

Exit 0 when nothing fails and at least MIN_JUDGED_SHARE of the runs were judged; 1
otherwise, so a replay that judges nothing (or only a sliver) cannot pass.

Usage (from the repo root):
    uv run --project eval/harness python eval/harness/scripts/replay_person_evidence_link_validator.py
"""

from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parents[1]
REPO = HARNESS.parents[1]
sys.path[:0] = [str(HARNESS / "validators"), str(HARNESS)]

import test_person_evidence as pe  # noqa: E402

SKILL = "person-evidence"
SCENARIOS = REPO / "eval" / "fixtures" / "scenarios"
# A share, not a count: the harness keeps only the newest five candidate logs, so one
# prune took the count from 95 of 154 runs to 84 of 136 (2026-10-25) -- 62% both times.
# A blind check drives the share to 0.
MIN_JUDGED_SHARE = 0.5


def committed(pattern: str) -> list[Path]:
    """Tracked files only, so an uncommitted local run log cannot move the counts;
    one a pending prune has deleted is skipped, not read."""
    out = subprocess.run(["git", "ls-files", pattern], cwd=REPO, capture_output=True,
                         text=True, encoding="utf-8", check=True)
    return [REPO / line for line in out.stdout.splitlines() if line and (REPO / line).exists()]


def apply(section: list, diff: dict) -> list:
    """`section` with a run's `added` entries appended and `modified` ones replaced by id."""
    out = [copy.deepcopy(e) for e in section]
    by_id = {e.get("id"): i for i, e in enumerate(out)}
    for entry in diff.get("modified") or []:
        after = entry.get("after") if isinstance(entry, dict) and "after" in entry else entry
        if isinstance(after, dict) and after.get("id") in by_id:
            out[by_id[after["id"]]] = after
    out += [e for e in diff.get("added") or [] if isinstance(e, dict)]
    return out


def identity_links(before: dict, after: dict) -> int:
    """How many links the check itself judges on this run (its own helper)."""
    return sum(len(labels) for by_person in pe.identity_links_by_persona(before, after).values()
               for labels in by_person.values())


def main() -> int:
    judged = skipped = failing = runs = links = 0
    for log_path in committed(f"eval/runlogs/unit/{SKILL}/v*.json"):
        if log_path.name.endswith(".ann.json"):
            continue
        log = json.loads(log_path.read_text(encoding="utf-8"))
        log_judged = log_failing = 0
        for test in log.get("tests") or []:
            scenario = SCENARIOS / str(test.get("scenario") or "") / "research.json"
            if not scenario.is_file():
                continue
            base = json.loads(scenario.read_text(encoding="utf-8"))
            for run in test.get("runs") or []:
                out = run.get("output") or {}
                diff = (((out.get("file_changes") or {}).get("research.json") or {})
                        .get("diff") or {})
                after = copy.deepcopy(base)
                for section in ("assertions", "person_evidence"):
                    after[section] = apply(base.get(section) or [], diff.get(section) or {})
                runs += 1
                n = identity_links(base, after)
                links += n
                try:
                    pe.test_identity_links_follow_their_persona(
                        before_state={"research_json": base},
                        after_state={"research_json": after},
                        tool_calls=out.get("tool_calls") or [],
                    )
                except pytest.skip.Exception:
                    skipped += 1
                    continue
                except AssertionError as e:
                    failing += 1
                    log_failing += 1
                    print(f"  FAIL {log_path.name} {test.get('test_id')} run "
                          f"{run.get('run_index')}: {str(e)[:300]}")
                if n:
                    judged += 1
                    log_judged += 1
                else:
                    skipped += 1
        print(f"{SKILL}/{log_path.name}: judged {log_judged}, failing {log_failing}")
    share = judged / runs if runs else 0.0
    print(f"total: {runs} runs, judged {judged} ({share:.0%}), skipped {skipped}, failing "
          f"{failing}; {links} identity links checked (floor {MIN_JUDGED_SHARE:.0%} judged)")
    return 0 if failing == 0 and share >= MIN_JUDGED_SHARE else 1


if __name__ == "__main__":
    sys.exit(main())
