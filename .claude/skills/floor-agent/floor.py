#!/usr/bin/env python3
"""Read unit and e2e run logs while moving an agent to a cheaper model.

  floor.py reds   <log>                      non-pass runs, what failed in each, and the agent's cost profile
  floor.py tally  <label>=<log> [...]        each test's outcomes across several logs
  floor.py run    <log> <test>:<run> [...]   one run's calls, failed validators and the judge's reason
  floor.py gaps   <log> [...]                calls that matched no canned answer
  floor.py usage  <agent> [--since DATE]     real e2e spawns: calls per tool, largest prompt, time

<log> is a unit run log (scratch_*.json or v*.json). <test> is the test id or its
suffix after the skill name ("021" for ut_search_records_021). Stdlib only; reads, never writes.
"""

from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import statistics
import sys

CODE = {"pass": ".", "partial": "p", "fail": "F", "aborted": "A"}
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def short(test_id: str, skill: str) -> str:
    prefix = "ut_" + skill.replace("-", "_") + "_"
    return test_id[len(prefix):] if test_id.startswith(prefix) else test_id


def bare(tool: str | None) -> str:
    return (tool or "").split("__")[-1]


def find_test(log: dict, name: str) -> dict:
    hits = [t for t in log["tests"] if t["test_id"] == name or t["test_id"].endswith("_" + name)]
    if len(hits) != 1:
        sys.exit(f"{name!r} matches {len(hits)} tests in this log")
    return hits[0]


def agent_spawns(log: dict):
    for t in log["tests"]:
        for r in t["runs"]:
            for s in r.get("subagents") or []:
                if s.get("agent_type") == log["skill"]:
                    yield s


def cmd_reds(args) -> None:
    log = load(args.log)
    skill = log["skill"]
    runs = [r for t in log["tests"] for r in t["runs"]]
    print("runs", len(runs), dict(collections.Counter(r["outcome"] for r in runs)))
    cost: collections.Counter = collections.Counter()
    for r in runs:
        for model, u in (r.get("model_usage") or {}).items():
            cost[model] += u.get("costUSD", 0)
    print("cost by model", {k: round(v, 2) for k, v in cost.items()})
    spawns = list(agent_spawns(log))
    if spawns:
        out = [s["usage"]["output_tokens"] for s in spawns]
        dur = [s.get("duration_seconds") or 0 for s in spawns]
        peak = sorted(s.get("peak_window_tokens") or 0 for s in spawns)
        models = collections.Counter(tuple(s.get("models") or []) for s in spawns)
        print(
            f"{skill}: {len(spawns)} spawns on {dict(models)}; median output {statistics.median(out):.0f} tok, "
            f"{statistics.median(dur):.0f}s, {statistics.median([s['num_assistant_turns'] for s in spawns]):.0f} turns; "
            f"largest prompt median {statistics.median(peak):.0f} max {peak[-1]}"
        )
    print()
    for t in log["tests"]:
        for r in t["runs"]:
            if r["outcome"] == "pass":
                continue
            print(f"{short(t['test_id'], skill):28s} run{r['run_index']} {r['outcome']:8s} {r.get('aborted_reason') or ''}")
            for v in (r.get("validators") or {}).get("results") or []:
                if v.get("outcome") == "failed":
                    print(f"      VALIDATOR {v.get('name')}: {(v.get('error') or '')[:160]}")
            low = [(d["name"], d["score"]) for d in (r.get("judge") or {}).get("dimensions") or [] if d.get("score") in (1, 2)]
            if low:
                print("      JUDGE " + ", ".join(f"{n}={s}" for n, s in low))


def cmd_tally(args) -> None:
    logs = []
    for spec in args.logs:
        label, _, path = spec.partition("=")
        if not path:
            sys.exit(f"{spec!r}: write <label>=<log>")
        logs.append((label, load(path)))
    tests: dict[str, dict[str, str]] = {}
    for label, log in logs:
        for t in log["tests"]:
            tests.setdefault(short(t["test_id"], log["skill"]), {})[label] = "".join(CODE[r["outcome"]] for r in t["runs"])
    labels = [label for label, _ in logs]
    print(f"{'test':30s}" + "".join(f"{label:>14s}" for label in labels) + "   red runs")
    rows = []
    for name, by in tests.items():
        red = sum(by.get(label, "").count("F") + by.get(label, "").count("A") for label in labels)
        rows.append((red, name, by))
    for red, name, by in sorted(rows, key=lambda row: (-row[0], row[1])):
        if red or any("p" in by.get(label, "") for label in labels):
            print(f"{name:30s}" + "".join(f"{by.get(label, '-'):>14s}" for label in labels) + f"   {red}")
    print(f"\ntests with no red run in any log: {sum(1 for red, _, _ in rows if red == 0)} of {len(rows)}")
    for label, log in logs:
        outcomes = collections.Counter(r["outcome"] for t in log["tests"] for r in t["runs"])
        print(f"  {label:14s} " + "  ".join(f"{k} {outcomes.get(k, 0)}" for k in ("pass", "partial", "fail", "aborted")))


def cmd_run(args) -> None:
    log = load(args.log)
    for spec in args.runs:
        name, _, index = spec.rpartition(":")
        run = find_test(log, name)["runs"][int(index)]
        print(f"\n=== {name} run{index} {run['outcome']} {run.get('aborted_reason') or ''}")
        for v in (run.get("validators") or {}).get("results") or []:
            if v.get("outcome") == "failed":
                print(f"  VALIDATOR {v.get('name')} | {(v.get('error') or '')[:300]}")
        for c in run["output"].get("tool_calls") or []:
            matched = c.get("matched") or {}
            call_args = {k: v for k, v in (c.get("args") or {}).items() if k not in ("projectPath", "subjectId")}
            resp = c.get("response") if isinstance(c.get("response"), dict) else {}
            extra = [k for k in resp if k not in ("results", "query", "collections", "staged", "ranked", "returned", "offset", "hasMore", "paginationCappedAt")]
            print(f"  {bare(c.get('tool'))} [{matched.get('kind')}] {json.dumps(call_args, ensure_ascii=False)[:args.width]} -> {extra[:8]}")
        for d in (run.get("judge") or {}).get("dimensions") or []:
            if d.get("score") == 1:
                print(f"  JUDGE {d['name']}=1: {(d.get('rationale') or '')[:args.width * 2]}")
                break
        if args.reply:
            for a in run["output"].get("agent_returns") or []:
                print("  REPLY", (a.get("text") or "")[:2000])


def cmd_gaps(args) -> None:
    for path in args.logs:
        log = load(path)
        print("=====", path)
        for t in log["tests"]:
            for r in t["runs"]:
                for i, c in enumerate(r["output"].get("tool_calls") or []):
                    kind = (c.get("matched") or {}).get("kind")
                    if kind in ("none", None, "unknown_args_refused"):
                        call_args = {k: v for k, v in (c.get("args") or {}).items() if k != "projectPath"}
                        print(f"{short(t['test_id'], log['skill'])} run{r['run_index']} {r['outcome']} "
                              f"#{i} {bare(c.get('tool'))} [{kind}] {json.dumps(call_args, ensure_ascii=False)[:260]}")


def cmd_usage(args) -> None:
    calls: collections.Counter = collections.Counter()
    using: collections.Counter = collections.Counter()
    peaks, durations = [], []
    for path in glob.glob(os.path.join(REPO, "eval", "runlogs", "e2e", "*", "run-*.json")):
        name = os.path.basename(path)
        if ".final-" in name or ".ann" in name or name[4:14] < args.since:
            continue
        for s in load(path).get("subagents") or []:
            if s.get("agent_type") != args.agent:
                continue
            seen = set()
            for message in s.get("tool_messages") or []:
                for tool in message:
                    calls[tool] += 1
                    seen.add(tool)
            using.update(seen)
            peaks.append(s.get("peak_window_tokens") or 0)
            durations.append(s.get("duration_seconds") or 0)
    n = len(peaks)
    if not n:
        sys.exit(f"no {args.agent} spawn in e2e runs since {args.since}")
    peaks.sort()
    print(f"{args.agent}: {n} spawns since {args.since}; median {statistics.median(durations):.0f}s; "
          f"largest prompt median {statistics.median(peaks):.0f}, max {peaks[-1]}, over 100K in {sum(p > 100_000 for p in peaks)}")
    for tool, count in calls.most_common():
        print(f"  {tool:26s} {count:5d} calls  in {using[tool]:3d} of {n} spawns")
    print("A tool in the agent's `tools:` that is not listed above was never called.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("reds"); p.add_argument("log"); p.set_defaults(fn=cmd_reds)
    p = sub.add_parser("tally"); p.add_argument("logs", nargs="+"); p.set_defaults(fn=cmd_tally)
    p = sub.add_parser("run"); p.add_argument("log"); p.add_argument("runs", nargs="+")
    p.add_argument("--width", type=int, default=300); p.add_argument("--reply", action="store_true"); p.set_defaults(fn=cmd_run)
    p = sub.add_parser("gaps"); p.add_argument("logs", nargs="+"); p.set_defaults(fn=cmd_gaps)
    p = sub.add_parser("usage"); p.add_argument("agent"); p.add_argument("--since", default="0000-00-00"); p.set_defaults(fn=cmd_usage)
    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
