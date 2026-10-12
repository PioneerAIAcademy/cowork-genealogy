"""`make replay-collapse` — replay each recorded `research_query` walk against
the one call that replaces it. Zero model calls, zero network.

**The question it answers (T2.1).** `research-exhaustiveness` reads a question's
log by walking it: one `research_query {section: "log", planItemId}` call per
plan item, ids handed to it by its own previous read. T2.1 adds
`research_query {section: "log", questionId}`, which returns every entry for the
question's plan items in one call. `make replay-sizes` (T1.4) replays identical
call lists, so it cannot compare a walk with its replacement; this does.

**What it proves, per walk group.**

1. *The walk it compares against is the real one.* Each recorded walk call is
   replayed and its `count` must equal the `count` the run recorded, or exit 3.
   Without that, a wrong `research.json` in the project dir would answer every
   walk with `count: 0`, the replacement with nothing, and "nothing equals
   nothing" would pass.
2. *The replacement returns exactly the right entries.* Its pages, joined, must
   equal an oracle computed here from the same rebuilt state — every log entry
   whose `plan_item_id` is an item of a plan for the question — as full entry
   objects (content, not just ids), with no id on two pages and every page's
   `count` equal to the oracle's length.
3. *It saves calls.* N recorded walk calls → M replacement calls (incl. pages).

**Groups.** In one thread (`agent_id`, else "main"): consecutive
`log × planItemId` calls (exactly `projectPath`, `section`, `planItemId`) whose
plan items belong to one question in the state rebuilt at the first call, with
no writer call (any thread) in between. A call for another question closes the
open group and starts one; an `unowned-item` call (its item is in no plan)
closes it. A group needs two calls; every other walk call is listed with its
reason. Each grouped item's owning question is cross-checked against the run's
committed `final-research.json` (exit 3 on a mismatch).

**Limits, stated.** The recorded `count` lives in `response_summary`, which
`make prune-runlogs STRIP=1` reduces to a remnant with no count: a stripped
run's groups report `unverifiable`, and if every group is, exit 2 — it fails
loudly, never falsely. One collapse rule only (`planItemId` walk →
`questionId`); T2.3 adds rules when it has a concrete second shape.

Exit codes: 0 at least one collapsed group with a non-empty walk, all passed ·
1 the candidate rejected the replacement on any group · 2 selection/usage/build
error, no walk groups, or nothing comparable · 3 integrity error. Precedence:
3 outranks 1 outranks 0.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import re
import shutil
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from e2e.replay_sizes import (
    E2E_TESTS,
    ENGINE_DIR,
    RUNLOGS,
    WRITERS,
    Arm,
    IntegrityError,
    UsageError,
    _check_answer,
    _git,
    _hash_dir,
    _is_harness_denial,
    _parsed,
    _read_json,
    build_version,
    default_base,
    ensure_build_at,
    measure,
    select_runs,
)
from harness.replay import bare_tool_name, replay

WALK_KEYS = frozenset({"projectPath", "section", "planItemId"})
#: Matches both summary shapes the corpus holds: the parsed body
#: (`[{"ok": true, "count": 9, ...}]`) and the raw content list whose text is
#: escaped JSON (`[{"type": "text", "text": "{\\"ok\\":true,\\"count\\":0,...}"}]`).
_RECORDED_COUNT = re.compile(r'\\?"count\\?"\s*:\s*(\d+)')
PAGE = 50


# --------------------------------------------------------------------------
# Finding walk groups (pure)
# --------------------------------------------------------------------------


@dataclass
class WalkCall:
    index: int
    plan_item: str
    recorded_count: int | None


@dataclass
class Group:
    run: str
    thread: str
    agent_type: str | None
    question: str
    state: dict[str, Any]
    calls: list[WalkCall] = field(default_factory=list)


def recorded_count(response_summary: Any) -> int | None:
    """The `count` a recorded `research_query` answer carried, or None."""
    if not isinstance(response_summary, str):
        return None
    m = _RECORDED_COUNT.search(response_summary)
    return int(m.group(1)) if m else None


def owners(research: dict[str, Any]) -> dict[str, str]:
    """`{plan_item_id: question_id}` from `plans[].items[]`."""
    out: dict[str, str] = {}
    for plan in research.get("plans") or []:
        if not isinstance(plan, dict) or not isinstance(plan.get("question_id"), str):
            continue
        for item in plan.get("items") or []:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                out[item["id"]] = plan["question_id"]
    return out


def oracle(research: dict[str, Any], question: str) -> list[dict[str, Any]]:
    """Every log entry whose `plan_item_id` is an item of a plan for `question`."""
    items = {i for i, q in owners(research).items() if q == question}
    return [
        e for e in research.get("log") or []
        if isinstance(e, dict) and e.get("plan_item_id") in items
    ]


def find_walk_groups(
    calls: list[dict[str, Any]], starting_research: dict[str, Any], run: str = ""
) -> tuple[list[Group], list[tuple[str, int, str]]]:
    """`(groups, listed)` — `listed` is `(run, index, reason)` for every walk
    call not in a collapsible group."""
    groups: list[Group] = []
    listed: list[tuple[str, int, str]] = []
    open_groups: dict[str, Group] = {}
    cache: dict[int, dict[str, Any]] = {}
    writers_before = 0

    def close(thread: str) -> None:
        g = open_groups.pop(thread, None)
        if g is not None:
            groups.append(g)

    for i, call in enumerate(calls):
        if not isinstance(call, dict):
            continue
        name = bare_tool_name(str(call.get("tool") or ""))
        if name in WRITERS:
            writers_before += 1
            for thread in list(open_groups):
                close(thread)
            continue
        args = call.get("args") if isinstance(call.get("args"), dict) else {}
        if name != "research_query" or args.get("section") != "log" or "planItemId" not in args:
            continue
        thread = str(call.get("agent_id") or "main")
        if _is_harness_denial(call):
            listed.append((run, i, "harness-denied"))
            continue
        if set(args) - WALK_KEYS:
            listed.append((run, i, "extra-args"))
            continue
        if call.get("is_error"):
            listed.append((run, i, "recorded-error"))
            continue
        if writers_before not in cache:
            cache[writers_before] = replay(calls, starting_research, upto=i).research
        state = cache[writers_before]
        question = owners(state).get(str(args["planItemId"]))
        if question is None:
            listed.append((run, i, "unowned-item"))
            close(thread)
            continue
        walk = WalkCall(i, str(args["planItemId"]), recorded_count(call.get("response_summary")))
        g = open_groups.get(thread)
        if g is None or g.question != question:
            close(thread)
            g = open_groups[thread] = Group(run, thread, call.get("agent_type"), question, state)
        g.calls.append(walk)
    for thread in list(open_groups):
        close(thread)

    collapsible = []
    for g in groups:
        if len(g.calls) < 2:
            listed.extend((run, c.index, "singleton") for c in g.calls)
        else:
            collapsible.append(g)
    return collapsible, listed


def check_ownership(groups: list[Group], final_research: dict[str, Any] | None) -> None:
    """Each grouped item's question must match the run's committed final notes."""
    if not final_research:
        return
    final = owners(final_research)
    for g in groups:
        for c in g.calls:
            if c.plan_item in final and final[c.plan_item] != g.question:
                raise IntegrityError(
                    f"{g.run}#{c.index}: {c.plan_item} belongs to {g.question} in the rebuilt "
                    f"state but to {final[c.plan_item]} in final-research.json"
                )


# --------------------------------------------------------------------------
# Replaying one group
# --------------------------------------------------------------------------


@dataclass
class Outcome:
    group: Group
    status: str  # collapsed | empty-walk | unverifiable | rejected
    walk_calls: int = 0
    replacement_calls: int = 0
    walk_chars: int = 0
    replacement_chars: int = 0
    entries_walked: int = 0
    entries_returned: int = 0
    base_accepts: bool | None = None


def _body(content: list[dict[str, Any]]) -> Any:
    return _parsed("".join(c.get("text", "") for c in content))


async def evaluate_group(g: Group, base, candidate, project: Path, tree: dict | None) -> Outcome:
    out = Outcome(g, "collapsed", walk_calls=len(g.calls))
    if any(c.recorded_count is None for c in g.calls):
        out.status = "unverifiable"
        return out
    (project / "research.json").write_text(json.dumps(g.state), encoding="utf-8")
    (project / "tree.gedcomx.json").write_text(json.dumps(tree or {}), encoding="utf-8")
    before = _hash_dir(project)

    walked_ids: set[str] = set()
    for c in g.calls:
        args = {"projectPath": str(project), "section": "log", "planItemId": c.plan_item}
        where = f"{g.run}#{c.index} walk"
        sizes = []
        for arm in (base, candidate):
            content, is_error = await arm.call("research_query", args, where)
            text = "".join(x.get("text", "") for x in content)
            _check_answer(text, f"{where} [{arm.label}]")
            body = _parsed(text)
            count = body.get("count") if isinstance(body, dict) else None
            if is_error or count != c.recorded_count:
                raise IntegrityError(
                    f"{where} [{arm.label}]: replayed count {count!r} != recorded "
                    f"{c.recorded_count} — the rebuilt state is not what the run read"
                )
            sizes.append(measure(content, is_error))
            if arm is candidate:
                walked_ids.update(
                    e.get("id") for e in body.get("items") or [] if isinstance(e, dict)
                )
        if sizes[0] != sizes[1]:
            raise IntegrityError(f"{where}: walk answer differs between builds ({sizes[0]} vs {sizes[1]})")
        out.walk_chars += sizes[1]
    out.entries_walked = len(walked_ids)
    if all(c.recorded_count == 0 for c in g.calls):
        out.status = "empty-walk"
        return out

    expected = oracle(g.state, g.question)
    expected_by_id = {e.get("id"): e for e in expected}
    cap = math.ceil(len(expected) / PAGE) + 1
    returned: list[dict[str, Any]] = []
    offset, pages = 0, 0
    while True:
        pages += 1
        if pages > cap:
            raise IntegrityError(f"{g.run} {g.question}: replacement paging passed {cap} calls")
        args = {"projectPath": str(project), "section": "log", "questionId": g.question}
        if offset:
            args["offset"] = offset
        where = f"{g.run} {g.question} replacement p{pages}"
        content, is_error = await candidate.call("research_query", args, where)
        text = "".join(x.get("text", "") for x in content)
        _check_answer(text, f"{where} [candidate]")
        body = _parsed(text)
        if is_error or not isinstance(body, dict) or body.get("ok") is not True:
            out.status = "rejected"
            return out
        if body.get("count") != len(expected):
            raise IntegrityError(f"{where}: count {body.get('count')} != oracle {len(expected)}")
        page = [e for e in body.get("items") or [] if isinstance(e, dict)]
        returned.extend(page)
        out.replacement_chars += measure(content, False)
        if not body.get("truncated"):
            break
        offset += len(page)
    out.replacement_calls = pages

    ids = [e.get("id") for e in returned]
    if len(ids) != len(set(ids)):
        raise IntegrityError(f"{g.run} {g.question}: an entry appears on two replacement pages")
    if set(ids) != set(expected_by_id):
        missing = sorted(set(expected_by_id) - set(ids))[:3]
        extra = sorted(set(ids) - set(expected_by_id))[:3]
        raise IntegrityError(
            f"{g.run} {g.question}: replacement entries differ from the oracle "
            f"(missing {missing}, extra {extra})"
        )
    for e in returned:
        if e != expected_by_id[e.get("id")]:
            raise IntegrityError(f"{g.run} {g.question}: entry {e.get('id')} differs from the oracle")
    out.entries_returned = len(returned)

    content, is_error = await base.call(
        "research_query", {"projectPath": str(project), "section": "log", "questionId": g.question},
        f"{g.run} {g.question} replacement [base]",
    )
    out.base_accepts = not is_error and isinstance(_body(content), dict) and _body(content).get("ok") is True
    if _hash_dir(project) != before:
        raise IntegrityError(f"{g.run} {g.question}: a read changed the project files")
    return out


def exit_code(outcomes: list[Outcome]) -> int:
    """1 when any group was rejected; 2 when nothing comparable; else 0.
    (Integrity failures raise before this, so 3 always outranks.)"""
    if any(o.status == "rejected" for o in outcomes):
        return 1
    if not any(o.status == "collapsed" for o in outcomes):
        return 2
    return 0


# --------------------------------------------------------------------------
# Report and CLI
# --------------------------------------------------------------------------


def render(header: list[str], outcomes: list[Outcome], listed: list[tuple[str, int, str]]) -> str:
    out = list(header)
    statuses = Counter(o.status for o in outcomes)
    collapsed = [o for o in outcomes if o.status == "collapsed"]
    n = sum(o.walk_calls for o in collapsed)
    m = sum(o.replacement_calls for o in collapsed)
    out.append(
        f"walk groups found: {len(outcomes)}  ·  "
        + "  ·  ".join(f"{k} {v}" for k, v in sorted(statuses.items()))
    )
    out.append(f"recorded walk calls subsumed (collapsed groups): N = {n}")
    out.append(f"replacement calls incl. pages:                   M = {m}")
    out.append(f"calls removed:                                       {n - m}")
    walk_chars = sum(o.walk_chars for o in collapsed)
    repl_chars = sum(o.replacement_chars for o in collapsed)
    if walk_chars:
        out.append(
            f"answer chars (candidate): walk {walk_chars:,} -> replacement {repl_chars:,} "
            f"({repl_chars - walk_chars:+,}, {100 * (repl_chars - walk_chars) / walk_chars:+.1f}%)"
        )
    out.append(
        f"entries: returned {sum(o.entries_returned for o in collapsed):,} vs walked "
        f"{sum(o.entries_walked for o in collapsed):,}  ·  groups needing >1 page: "
        f"{sum(1 for o in collapsed if o.replacement_calls > 1)}"
    )
    by_caller = Counter(o.group.agent_type or "main thread" for o in collapsed)
    out.append("by caller: " + (", ".join(f"{k} {v}" for k, v in by_caller.most_common()) or "--"))
    judged = [o for o in collapsed if o.base_accepts is not None]
    rejecting = sum(1 for o in judged if not o.base_accepts)
    out.append(
        f"base build rejects the replacement on {rejecting} of {len(judged)} groups "
        "(report-only: expected all while unmerged, none after)"
    )
    reasons = Counter(r for _, _, r in listed)
    out.append("walk calls not in a collapsible group: "
               + (", ".join(f"{k} {v}" for k, v in sorted(reasons.items())) or "none"))
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", help="git ref for the base build (default: merge-base with origin/main)")
    parser.add_argument("--base-build", type=Path)
    parser.add_argument("--candidate-build", type=Path, default=ENGINE_DIR / "build")
    parser.add_argument("--test", help="one fixture slug")
    parser.add_argument("--tracked-only", action="store_true")
    parser.add_argument("--json", type=Path, help="per-group rows (not under eval/runlogs/)")
    args = parser.parse_args(argv)
    try:
        return asyncio.run(_main(args))
    except UsageError as exc:
        print(f"replay-collapse: {exc}", file=sys.stderr)
        return 2
    except IntegrityError as exc:
        print(f"replay-collapse: REPLAY INTEGRITY ERROR — {exc}", file=sys.stderr)
        return 3


async def _main(args: argparse.Namespace) -> int:
    if args.json and RUNLOGS.resolve() in args.json.resolve().parents:
        raise UsageError(f"--json refuses a path under {RUNLOGS} (corpus pollution)")
    runs_logs, untracked = select_runs(args.test, args.tracked_only)
    if not runs_logs:
        raise UsageError("no committed run carries tool_calls[].result_chars for this selection")

    plans: list[tuple[Path, Group, dict | None]] = []
    listed: list[tuple[str, int, str]] = []
    for path, log in runs_logs:
        slug = path.parent.name
        starting = _read_json(E2E_TESTS / slug / "starting-research.json") or {}
        groups, more = find_walk_groups(log["tool_calls"], starting, f"{slug}/{path.stem}")
        check_ownership(groups, _read_json(path.with_name(f"{path.stem}.final-research.json")))
        tree = _read_json(path.with_name(f"{path.stem}.final-tree.gedcomx.json"))
        plans.extend((path, g, tree) for g in groups)
        listed.extend(more)
    if not plans:
        raise UsageError("no walk groups in this selection")

    candidate = args.candidate_build
    cand_version = build_version(candidate)
    if args.base_build:
        base, base_desc = args.base_build, f"build dir {args.base_build}"
    else:
        ref = args.base or default_base()
        base = ensure_build_at(ref)
        base_desc = f"{ref} = {_git('log', '-1', '--format=%h %s', ref)}"
    base_version = build_version(base)

    home = Path(tempfile.mkdtemp(prefix="replay-home-"))
    project = Path(tempfile.mkdtemp(prefix="replay-project-"))
    outcomes: list[Outcome] = []
    try:
        async with Arm("base", base, home) as b, Arm("candidate", candidate, home) as c:
            for _path, g, tree in plans:
                outcomes.append(await evaluate_group(g, b, c, project, tree))
    finally:
        shutil.rmtree(home, ignore_errors=True)
        shutil.rmtree(project, ignore_errors=True)

    header = [
        "replay-collapse — recorded research_query walks vs the one call that replaces them",
        f"base:      {base_desc}  ({base_version})",
        f"candidate: {candidate}  ({cand_version})",
        f"runs: {len(runs_logs)} carrying result_chars"
        + (f" ({untracked} untracked)" if untracked else " (all tracked)"),
    ]
    print(render(header, outcomes, listed), end="")
    if args.json:
        args.json.resolve().write_text(json.dumps([
            {"run": o.group.run, "question": o.group.question, "status": o.status,
             "walk_calls": o.walk_calls, "replacement_calls": o.replacement_calls,
             "walk_chars": o.walk_chars, "replacement_chars": o.replacement_chars}
            for o in outcomes
        ], indent=1), encoding="utf-8")
    return exit_code(outcomes)


if __name__ == "__main__":
    raise SystemExit(main())
