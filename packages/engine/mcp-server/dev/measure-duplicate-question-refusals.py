#!/usr/bin/env python3
"""Measure what a duplicate-question refusal on `research_append` would refuse.

Issue #3689 lead 3. Replays every successful `questions` append in the committed
e2e corpus against the state that call SAW (rebuilt with eval/harness's
`harness.replay` from the run's `tool_calls` and its fixture's
`starting-research.json`), and judges each new question by three candidate rules:

  R0  the issue's plain rule: refuse while another unresolved question has no
      plan and no log entry, unless the new question names it in `depends_on`
      or `unblocks`.
  R1  refuse when the new question's normalised text equals an unresolved
      question's (case, whitespace and punctuation folded).
  R2  refuse when its word set overlaps an unresolved question's by a Jaccard
      index of at least 0.9.

Ops in one `ops[]` batch are judged against the same pre-call snapshot, so
siblings written together never refuse each other, as `research_append`'s
`newQuestionWhileSearchInFlightInvariants` already does.

Calls whose `response_summary` was stripped cannot be replayed and are counted,
not guessed (see eval/harness/harness/replay.py's module docstring).

Offline; no FamilySearch session needed. Not shipped in any artifact.

Usage (from the repo root):
    cd eval/harness && uv run python ../../packages/engine/mcp-server/dev/measure-duplicate-question-refusals.py [--list]
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "eval" / "harness"))

from harness.replay import bare_tool_name, parse_tool_result, replay  # noqa: E402

E2E_RUNLOGS = REPO / "eval" / "runlogs" / "e2e"
E2E_TESTS = REPO / "eval" / "tests" / "e2e"
SIDECARS = (".ann.json", ".final-research.json", ".final-tree.gedcomx.json")
NAMED = {
    "cruz-corona-ancestry/run-2026-09-10_11-46-05.json": "must ALLOW (two different facts)",
    "heinrich-dewus-children-death/run-2026-08-06_07-25-30.json": "issue's duplicate: call 112 was refused, 113 is its retry",
}


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _words(text: str) -> set[str]:
    return set(_norm(text).split())


def _jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def _ops(args: dict) -> list:
    ops = args.get("ops")
    if isinstance(ops, str):
        try:
            ops = json.loads(ops)
        except ValueError:
            ops = None
    return ops if isinstance(ops, list) else [args]


def judge(state: dict, entry: dict) -> dict[str, bool]:
    questions = [q for q in state.get("questions") or [] if q.get("status") != "resolved"]
    planned = {p.get("question_id") for p in state.get("plans") or []}
    plan_item_question = {
        it.get("id"): p.get("question_id")
        for p in state.get("plans") or []
        for it in p.get("items") or []
    }
    logged = {plan_item_question.get(e.get("plan_item_id")) for e in state.get("log") or []}
    named = set(entry.get("depends_on") or []) | set(entry.get("unblocks") or [])
    text = entry.get("question") or ""
    r0 = any(
        q.get("id") not in planned and q.get("id") not in logged and q.get("id") not in named
        for q in questions
    )
    r1 = any(_norm(q.get("question")) == _norm(text) and _norm(text) for q in questions)
    r2 = any(_jaccard(_words(q.get("question")), _words(text)) >= 0.9 for q in questions)
    return {"R0": r0, "R1": r1, "R2": r2}


def measure():
    counts = collections.Counter()
    per_run: dict[str, collections.Counter] = {}
    hits: list[dict] = []
    for path in sorted(E2E_RUNLOGS.glob("*/run-*.json")):
        if path.name.endswith(SIDECARS):
            continue
        log = _load(path)
        if not log or not isinstance(log.get("tool_calls"), list):
            continue
        run = f"{path.parent.name}/{path.name}"
        starting = _load(E2E_TESTS / path.parent.name / "starting-research.json") or {}
        calls = log["tool_calls"]
        counts["runs"] += 1
        for i, call in enumerate(calls):
            if bare_tool_name(str(call.get("tool") or "")) != "research_append" or call.get("is_error"):
                continue
            args = call.get("args") if isinstance(call.get("args"), dict) else {}
            appends = [
                op for op in _ops(args)
                if isinstance(op, dict) and op.get("section") == "questions" and op.get("op") == "append"
            ]
            if not appends:
                continue
            result = parse_tool_result(call.get("response_summary"))
            if result is None:
                counts["unparseable_calls"] += 1
                continue
            if result.get("ok") is False:
                continue
            state = replay(calls, starting, upto=i).research
            counts["question_appends"] += len(appends)
            for op in appends:
                verdict = judge(state, op.get("entry") or {})
                for rule, refused in verdict.items():
                    if refused:
                        per_run.setdefault(run, collections.Counter())[rule] += 1
                        counts[f"{rule}_refusals"] += 1
                if any(verdict.values()):
                    hits.append({"run": run, "call": i, **verdict,
                                 "question": (op.get("entry") or {}).get("question", "")[:110]})
    return counts, per_run, hits


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--list", action="store_true", help="print every refused append")
    args = parser.parse_args(argv)
    counts, per_run, hits = measure()
    for key in sorted(counts):
        print(f"{key:24} {counts[key]}")
    for rule in ("R0", "R1", "R2"):
        runs = [r for r, c in per_run.items() if c[rule]]
        print(f"{rule}: refuses at least one call in {len(runs)} of {counts['runs']} runs")
    print("\nnamed cases:")
    for run, want in NAMED.items():
        c = per_run.get(run, collections.Counter())
        print(f"  {run}  [{want}]  R0={c['R0']} R1={c['R1']} R2={c['R2']}")
    if args.list:
        print()
        for h in hits:
            print(f"  {h['run']} call {h['call']}  R0={int(h['R0'])} R1={int(h['R1'])} R2={int(h['R2'])}  {h['question']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
