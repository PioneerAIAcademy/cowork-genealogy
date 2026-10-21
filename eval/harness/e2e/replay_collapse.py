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
loudly, never falsely.

**Two rules** (`--rule`, default both). The above is rule `plan-log`. Rule
`plural-id` (T2.3) replays every run of strictly adjacent same-thread
`research_query` calls that differ only in one id key (`personId`,
`assertionId`, `sourceId`, `recordId`) against ONE call carrying the ids as a
list. Its truth is the base build's own singular pages — no Python copy of the
tool's filter table — unioned by item `id` in document order; the list call
must return exactly that, with `count` and `countById` right on every page.
A list answered wrong is `wrong` (exit 1), not an integrity error, because a
pre-T2.3 build answers a list with a silent `count: 0` rather than rejecting
it. A group whose singular replay disagrees with the recorded count is
`unfaithful`, classified by cause: `source-id-unstamped` (the replay does not
model the server-side `source_id` stamp; allowed and counted) or
`ledger-missing-writes` (allowed only for the groups pinned in
`KNOWN_LEDGER_GAPS`); any other is exit 3. It proves the exact-match path
only; the contains-mode sections are proven by the engine's vitest cases.
Turns removed are counted only on runs whose timeline carries message ids.

Exit codes: 0 at least one collapsed group with a non-empty walk, all passed ·
1 the candidate rejected the replacement (plan-log), or answered a list wrong
or past the spill size (plural-id), on any group · 2 selection/usage/build
error, no walk groups, or nothing comparable · 3 integrity error. Precedence
across rules: 3 outranks 1 outranks 0; 2 only when no rule has a non-empty
collapsed group.
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
    calls: list[dict[str, Any]], starting_research: dict[str, Any], run: str = "",
    final_research: dict[str, Any] | None = None,
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
            cache[writers_before] = replay(calls, starting_research, upto=i, final_research=final_research).research
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
# Rule plural-id: finding groups (pure)
# --------------------------------------------------------------------------

#: Mirrors PLURAL_KEYS in research-query.ts.
PLURAL_KEYS = ("personId", "assertionId", "sourceId", "recordId")
#: Filters that may ride along unchanged on every member and into the list call.
FIXED_KEYS = frozenset({"recordRole", "status", "questionId"})
SPILL_CHARS = 50_000
_RECORDED_REJECTION = re.compile(r'\\?"ok\\?"\s*:\s*false')

#: `(run, first call index)` of every group whose replay is short because the
#: ledger is missing writes the final notes hold (T2.3 plan §0.3). A new one is
#: exit 3: diagnose the capture before adding it here.
KNOWN_LEDGER_GAPS = frozenset({
    ("marina-lopez-parents/run-2026-09-16_11-11-58", 99),
    ("marina-lopez-parents/run-2026-09-16_11-11-58", 157),
    ("marina-lopez-parents/run-2026-09-16_11-11-58", 183),
    ("marina-lopez-parents/run-2026-09-16_11-11-58", 233),
    ("marina-lopez-parents/run-2026-09-16_11-11-58", 243),
    ("marina-lopez-parents/run-2026-09-16_11-11-58", 248),
    ("cruz-corona-ancestry/run-2026-09-28_17-18-07", 212),
    ("cruz-corona-ancestry/run-2026-09-28_17-18-07", 290),
    ("cruz-corona-ancestry/run-2026-09-28_17-18-07", 307),
    ("robert-lord-children/run-2026-09-16_16-55-35", 143),
    ("robert-lord-children/run-2026-09-16_16-55-35", 210),
})


@dataclass
class PluralCall:
    index: int
    id: str
    recorded_count: int | None
    message_id: str | None = None


@dataclass
class PluralGroup:
    run: str
    thread: str
    agent_type: str | None
    section: str
    key: str
    fixed: dict[str, str]
    state: dict[str, Any]
    calls: list[PluralCall] = field(default_factory=list)
    final: dict[str, Any] | None = None

    @property
    def ids(self) -> list[str]:
        """Distinct ids in first-seen order: the list the one call sends."""
        return list(dict.fromkeys(c.id for c in self.calls))


def _normal_tool(name: str) -> str:
    bare = bare_tool_name(name)
    return "Skill" if bare.startswith("Skill") else bare


def message_ids(log: dict[str, Any]) -> list[str] | None:
    """The API message id of each `tool_calls[]` entry, or None when the run's
    timeline does not align one-for-one with its ledger (or carries no ids)."""
    calls = log.get("tool_calls") or []
    usage = log.get("usage") if isinstance(log.get("usage"), dict) else {}
    rows = [
        r for r in usage.get("timeline") or []
        if isinstance(r, list) and len(r) >= 5 and r[1] == "assistant" and r[2]
    ]
    flat = [(_normal_tool(str(t)), r[4]) for r in rows for t in r[2]]
    names = [_normal_tool(str(c.get("tool") or "")) if isinstance(c, dict) else None for c in calls]
    if not flat or len(flat) != len(names):
        return None
    if any(a != b or not isinstance(m, str) for (a, m), b in zip(flat, names)):
        return None
    return [m for _, m in flat]


def find_plural_groups(
    calls: list[dict[str, Any]], starting_research: dict[str, Any], run: str = "",
    msg_ids: list[str] | None = None, final_research: dict[str, Any] | None = None,
) -> tuple[list[PluralGroup], list[tuple[str, int, str]]]:
    """`(groups, listed)` — runs of strictly adjacent same-thread
    `research_query` calls varying one PLURAL_KEYS id; `listed` is
    `(run, index, reason)` for every id-keyed call left out of a group."""
    groups: list[PluralGroup] = []
    listed: list[tuple[str, int, str]] = []
    open_groups: dict[str, tuple[tuple, PluralGroup]] = {}
    cache: dict[int, dict[str, Any]] = {}
    writers_before = 0

    def close(thread: str) -> None:
        entry = open_groups.pop(thread, None)
        if entry is not None:
            groups.append(entry[1])

    for i, call in enumerate(calls):
        if not isinstance(call, dict):
            continue
        name = bare_tool_name(str(call.get("tool") or ""))
        if name in WRITERS:
            writers_before += 1
            for thread in list(open_groups):
                close(thread)
            continue
        thread = str(call.get("agent_id") or "main")
        args = call.get("args") if isinstance(call.get("args"), dict) else {}
        keys = [k for k in PLURAL_KEYS if k in args]
        if name != "research_query" or not keys:
            close(thread)
            continue
        reason = None
        rest = set(args) - {"projectPath", "section"} - set(keys)
        if _is_harness_denial(call):
            reason = "harness-denied"
        elif call.get("is_error") or _RECORDED_REJECTION.search(str(call.get("response_summary") or "")):
            reason = "recorded-error"
        elif "offset" in args:
            reason = "offset"
        elif len(keys) > 1 or rest - FIXED_KEYS or not isinstance(args.get("section"), str):
            reason = "extra-args"
        elif not isinstance(args[keys[0]], str) or not all(isinstance(args[k], str) for k in rest):
            reason = "non-string-value"
        if reason is not None:
            listed.append((run, i, reason))
            close(thread)
            continue
        key = keys[0]
        fixed = {k: args[k] for k in sorted(rest)}
        signature = (args["section"], key, tuple(fixed.items()))
        member = PluralCall(
            i, args[key], recorded_count(call.get("response_summary")),
            msg_ids[i] if msg_ids is not None else None,
        )
        entry = open_groups.get(thread)
        if entry is None or entry[0] != signature:
            close(thread)
            if writers_before not in cache:
                cache[writers_before] = replay(calls, starting_research, upto=i, final_research=final_research).research
            entry = open_groups[thread] = (signature, PluralGroup(
                run, thread, call.get("agent_type"), args["section"], key, fixed, cache[writers_before],
            ))
        entry[1].calls.append(member)
    for thread in list(open_groups):
        close(thread)

    collapsible = []
    for g in groups:
        if len(g.calls) < 2:
            listed.extend((run, c.index, "singleton") for c in g.calls)
        else:
            collapsible.append(g)
    return collapsible, listed


# --------------------------------------------------------------------------
# Rule plural-id: replaying one group
# --------------------------------------------------------------------------


@dataclass
class PluralOutcome:
    group: PluralGroup
    status: str  # collapsed | collapsed-empty | unverifiable | unfaithful | wrong | spill
    cause: str | None = None
    reason: str = ""
    walk_calls: int = 0
    plural_calls: int = 0
    walk_chars: int = 0
    plural_chars: int = 0
    largest_page: int = 0
    base_correct: bool | None = None
    recorded_turns: int | None = None

    @property
    def fatal(self) -> bool:
        """An unfaithful group this comparator cannot excuse: exit 3."""
        if self.status != "unfaithful":
            return False
        if self.cause == "source-id-unstamped":
            return False
        if self.cause == "ledger-missing-writes":
            return (self.group.run, self.group.calls[0].index) not in KNOWN_LEDGER_GAPS
        return True


def _text(content: list[dict[str, Any]]) -> str:
    return "".join(x.get("text", "") for x in content)


async def _call(arm, args: dict[str, Any], where: str) -> tuple[list[dict], bool, str, Any]:
    content, is_error = await arm.call("research_query", args, where)
    text = _text(content)
    _check_answer(text, f"{where} [{arm.label}]")
    return content, is_error, text, _parsed(text)


async def _singular_pages(arm, args: dict[str, Any], where: str) -> list[dict[str, Any]]:
    """Every item of a singular answer, paged until `truncated` is false."""
    items: list[dict[str, Any]] = []
    offset, pages = 0, 0
    while True:
        pages += 1
        page_args = dict(args, offset=offset) if offset else dict(args)
        _, is_error, _, body = await _call(arm, page_args, f"{where} p{pages}")
        if is_error or not isinstance(body, dict) or body.get("ok") is not True:
            raise IntegrityError(f"{where} [{arm.label}]: the singular call failed on the rebuilt state")
        page = [e for e in body.get("items") or [] if isinstance(e, dict)]
        items.extend(page)
        if pages > math.ceil((body.get("count") or 0) / PAGE) + 1:
            raise IntegrityError(f"{where} [{arm.label}]: singular paging passed its page cap")
        if not body.get("truncated"):
            return items
        offset += len(page)


def _classify(g: PluralGroup, call: PluralCall, replayed: int, found: list[dict[str, Any]]) -> str:
    """Why a member's replayed count missed its recorded count, read off the
    rebuilt state against the run's committed final notes."""
    final = g.final or {}
    rebuilt = {e.get("id"): e for e in g.state.get(g.section) or [] if isinstance(e, dict)}
    seen = {e.get("id") for e in found}
    shortfall = (call.recorded_count or 0) - replayed
    if shortfall <= 0 or not final:
        return "unclassified"
    finals = [e for e in final.get(g.section) or [] if isinstance(e, dict) and e.get("id") not in seen]
    if g.section == "assertions" and g.key == "sourceId":
        unstamped = [
            e for e in finals
            if e.get("source_id") == call.id and e.get("id") in rebuilt
            and not rebuilt[e.get("id")].get("source_id")
        ]
        if len(unstamped) >= shortfall:
            return "source-id-unstamped"
    # Items the final notes hold naming this id that the replay did not return:
    # absent from the rebuilt state, or present there without the id. Either way
    # a write the ledger did not carry to the replay.
    unwritten = [e for e in finals if call.id in json.dumps(e)]
    if len(unwritten) >= shortfall:
        return "ledger-missing-writes"
    return "unclassified"


def _plural_diffs(
    pages: list[Any], truth: list[dict[str, Any]], expected: dict[str, int],
) -> list[str]:
    """What is wrong with a list call's pages, against the truth — empty when right."""
    diffs: list[str] = []
    returned: list[dict[str, Any]] = []
    for n, body in enumerate(pages, 1):
        if not isinstance(body, dict) or body.get("ok") is not True:
            diffs.append(f"p{n}: the list call was not answered ok ({str(body)[:120]})")
            return diffs
        if body.get("count") != len(truth):
            diffs.append(f"p{n}: count {body.get('count')} != truth {len(truth)}")
        if body.get("countById") != expected:
            diffs.append(f"p{n}: countById {body.get('countById')!r} != {expected!r}")
        returned.extend(e for e in body.get("items") or [] if isinstance(e, dict))
    ids = [e.get("id") for e in returned]
    if len(ids) != len(set(ids)):
        diffs.append("an item appears twice across the pages")
    if returned != truth:
        want = [e.get("id") for e in truth]
        if ids != want:
            diffs.append(f"items {ids[:6]} != truth {want[:6]}")
        else:
            diffs.append("an item's content differs from the singular answer")
    return diffs


async def _plural_pages(arm, args: dict[str, Any], n: int, where: str) -> tuple[list[Any], list[str], bool]:
    """`(bodies, texts, capped)` of a list call paged until `truncated` is false."""
    cap = math.ceil(n / PAGE) + 1
    bodies: list[Any] = []
    texts: list[str] = []
    offset = 0
    while True:
        if len(bodies) >= cap:
            return bodies, texts, True
        page_args = dict(args, offset=offset) if offset else dict(args)
        content, is_error, text, body = await _call(arm, page_args, f"{where} p{len(bodies) + 1}")
        bodies.append(body if not is_error else {"ok": False, "text": text})
        texts.append(text)
        if is_error or not isinstance(body, dict) or not body.get("truncated"):
            return bodies, texts, False
        offset += len(body.get("items") or [])


async def evaluate_plural_group(
    g: PluralGroup, base, candidate, project: Path, tree: dict | None,
) -> PluralOutcome:
    out = PluralOutcome(g, "collapsed", walk_calls=len(g.calls))
    msgs = [c.message_id for c in g.calls]
    if all(m is not None for m in msgs):
        out.recorded_turns = len(set(msgs))
    if any(c.recorded_count is None for c in g.calls):
        out.status = "unverifiable"
        return out
    (project / "research.json").write_text(json.dumps(g.state), encoding="utf-8")
    (project / "tree.gedcomx.json").write_text(json.dumps(tree or {}), encoding="utf-8")
    before = _hash_dir(project)
    single = {"projectPath": str(project), "section": g.section, **g.fixed}

    # 1. The count gate: each member replayed on both builds.
    causes: list[str] = []
    for c in g.calls:
        where = f"{g.run}#{c.index} {g.section}×{g.key}"
        counts = []
        for arm in (base, candidate):
            content, is_error, _, body = await _call(arm, {**single, g.key: c.id}, where)
            count = body.get("count") if isinstance(body, dict) and not is_error else None
            counts.append(count)
            if arm is candidate:
                out.walk_chars += measure(content, is_error)
        if counts[0] != counts[1]:
            raise IntegrityError(f"{where}: base count {counts[0]!r} != candidate {counts[1]!r}")
        if counts[0] != c.recorded_count:
            found = await _singular_pages(base, {**single, g.key: c.id}, where) if counts[0] is not None else []
            causes.append(_classify(g, c, counts[0] or 0, found))
    if causes:
        out.status = "unfaithful"
        out.cause = next((x for x in causes if x == "unclassified"), None) or next(
            (x for x in causes if x == "ledger-missing-writes"), causes[0])
        out.reason = f"replayed counts differ from recorded on {len(causes)} of {len(g.calls)} calls"
        return out

    # 2. The truth: the base build's singular pages, unioned, in document order.
    singular: dict[str, list[dict[str, Any]]] = {}
    for gid in g.ids:
        where = f"{g.run}#{g.calls[0].index} singular {gid}"
        base_items = await _singular_pages(base, {**single, g.key: gid}, where)
        cand_items = await _singular_pages(candidate, {**single, g.key: gid}, where)
        if base_items != cand_items:
            raise IntegrityError(f"{where}: the singular answer differs between builds")
        singular[gid] = base_items
    position = {}
    for n, e in enumerate(g.state.get(g.section) or []):
        if isinstance(e, dict):
            position.setdefault(e.get("id"), n)
    by_id: dict[Any, dict[str, Any]] = {}
    for items in singular.values():
        for e in items:
            if e.get("id") not in position:
                raise IntegrityError(f"{g.run}#{g.calls[0].index}: item {e.get('id')} is not in the rebuilt state")
            by_id.setdefault(e.get("id"), e)
    truth = sorted(by_id.values(), key=lambda e: position[e.get("id")])
    expected = {gid: len(items) for gid, items in singular.items()}

    # 3–6. The one list call on the candidate, checked against the truth.
    plural = {**single, g.key: g.ids}
    where = f"{g.run}#{g.calls[0].index} list"
    bodies, texts, capped = await _plural_pages(candidate, plural, len(truth), where)
    if capped:
        raise IntegrityError(f"{where}: list paging passed {math.ceil(len(truth) / PAGE) + 1} calls")
    out.plural_calls = len(bodies)
    out.plural_chars = sum(len(json.dumps([{"type": "text", "text": t}])) for t in texts)
    out.largest_page = max((len(t) for t in texts), default=0)
    diffs = _plural_diffs(bodies, truth, expected)
    if all(c.recorded_count == 0 for c in g.calls):
        out.status = "collapsed-empty"
    if diffs:
        out.status, out.reason = "wrong", "; ".join(diffs[:3])
    elif out.largest_page > SPILL_CHARS:
        out.status = "spill"
        out.reason = f"a list page is {out.largest_page:,} chars, over the {SPILL_CHARS:,} spill"

    # 7. Report-only: does the base build answer the list correctly?
    base_bodies, _, base_capped = await _plural_pages(base, plural, len(truth), f"{where} [base]")
    out.base_correct = not base_capped and not _plural_diffs(base_bodies, truth, expected)

    if _hash_dir(project) != before:
        raise IntegrityError(f"{where}: a read changed the project files")
    return out


def exit_code_plural(outcomes: list[PluralOutcome]) -> int:
    """3 an unexcused unfaithful group; 1 any wrong or spill; 0 at least one
    non-empty collapsed group; else 2."""
    if any(o.fatal for o in outcomes):
        return 3
    if any(o.status in ("wrong", "spill") for o in outcomes):
        return 1
    if not any(o.status == "collapsed" for o in outcomes):
        return 2
    return 0


def aggregate_exit(codes: list[int]) -> int:
    """Across rules: 3 outranks 1 outranks 0; 2 only when no rule passed."""
    for code in (3, 1, 0):
        if code in codes:
            return code
    return 2


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


RULES = ("plan-log", "plural-id")
_PASSED = ("collapsed", "collapsed-empty")
SHOW_FAILURES = 20


def _n_to_m(outcomes: list[PluralOutcome]) -> str:
    n = sum(o.walk_calls for o in outcomes)
    m = sum(o.plural_calls for o in outcomes)
    return f"{n} -> {m} ({len(outcomes)} groups)"


def render_plural(
    header: list[str], outcomes: list[PluralOutcome], listed: list[tuple[str, int, str]],
    runs_with_ids: int, runs: int,
) -> str:
    out = list(header) + ["", "rule plural-id — adjacent one-id research_query calls vs one call with a list"]
    statuses = Counter(o.status for o in outcomes)
    out.append(
        f"groups found: {len(outcomes)}  ·  "
        + ("  ·  ".join(f"{k} {v}" for k, v in sorted(statuses.items())) or "none")
    )
    causes = Counter(o.cause for o in outcomes if o.status == "unfaithful")
    out.append("unfaithful: " + (", ".join(f"{k} {v}" for k, v in sorted(causes.items())) or "none"))
    passed = [o for o in outcomes if o.status in _PASSED]
    for status in _PASSED:
        out.append(f"{status + ':':<17}N -> M = {_n_to_m([o for o in passed if o.status == status])}")
    n = sum(o.walk_calls for o in passed)
    m = sum(o.plural_calls for o in passed)
    out.append(f"{'total:':<17}N -> M = {_n_to_m(passed)}")
    out.append(f"calls removed:   {n - m}")
    timed = [o for o in passed if o.recorded_turns is not None]
    out.append(
        f"turns removed:   {sum(o.recorded_turns - o.plural_calls for o in timed)} "
        f"(over {len(timed)} of {len(passed)} groups; runs with message ids: {runs_with_ids} of {runs})"
    )
    walk_chars = sum(o.walk_chars for o in passed)
    plural_chars = sum(o.plural_chars for o in passed)
    if walk_chars:
        out.append(
            f"answer chars (candidate): walk {walk_chars:,} -> list {plural_chars:,} "
            f"({plural_chars - walk_chars:+,}, {100 * (plural_chars - walk_chars) / walk_chars:+.1f}%)"
        )
    largest = max((o.largest_page for o in outcomes), default=0)
    out.append(f"largest list page: {largest:,} chars (spill at {SPILL_CHARS:,})")
    callers: dict[str, list[PluralOutcome]] = {}
    shapes: dict[str, list[PluralOutcome]] = {}
    for o in passed:
        callers.setdefault(o.group.agent_type or "main thread", []).append(o)
        shapes.setdefault(f"{o.group.section} × {o.group.key}", []).append(o)
    for title, table in (("by caller", callers), ("by section × key", shapes)):
        out.append(f"{title}:")
        for k, rows in sorted(table.items(), key=lambda kv: -sum(o.walk_calls for o in kv[1])):
            out.append(f"  {k}: {_n_to_m(rows)}")
    judged = [o for o in outcomes if o.base_correct is not None]
    out.append(
        f"base build answers the list correctly on {sum(1 for o in judged if o.base_correct)} of "
        f"{len(judged)} groups (report-only: none before T2.3, all after)"
    )
    failing = [o for o in outcomes if o.status in ("wrong", "spill") or o.fatal]
    for o in failing[:SHOW_FAILURES]:
        what = f"{o.status} ({o.cause})" if o.status == "unfaithful" else o.status
        hint = (" — diagnose the capture before adding it to KNOWN_LEDGER_GAPS"
                if o.cause == "ledger-missing-writes" else "")
        out.append(f"  {what}: {o.group.run}#{o.group.calls[0].index} "
                   f"{o.group.section} × {o.group.key} — {o.reason}{hint}")
    if len(failing) > SHOW_FAILURES:
        out.append(f"  … and {len(failing) - SHOW_FAILURES} more (--json lists every group)")
    reasons = Counter(r for _, _, r in listed)
    out.append("id-keyed calls not in a group: "
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
    parser.add_argument("--rule", choices=RULES, help="one rule (default: both)")
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

    rules = [args.rule] if args.rule else list(RULES)
    plans: list[tuple[Path, Group, dict | None]] = []
    listed: list[tuple[str, int, str]] = []
    plural_plans: list[tuple[PluralGroup, dict | None]] = []
    plural_listed: list[tuple[str, int, str]] = []
    runs_with_ids = 0
    for path, log in runs_logs:
        slug = path.parent.name
        starting = _read_json(E2E_TESTS / slug / "starting-research.json") or {}
        final = _read_json(path.with_name(f"{path.stem}.final-research.json"))
        tree = _read_json(path.with_name(f"{path.stem}.final-tree.gedcomx.json"))
        if "plan-log" in rules:
            groups, more = find_walk_groups(log["tool_calls"], starting, f"{slug}/{path.stem}", final)
            check_ownership(groups, final)
            plans.extend((path, g, tree) for g in groups)
            listed.extend(more)
        if "plural-id" in rules:
            ids = message_ids(log)
            runs_with_ids += ids is not None
            pgroups, more = find_plural_groups(log["tool_calls"], starting, f"{slug}/{path.stem}", ids, final)
            for g in pgroups:
                g.final = final
            plural_plans.extend((g, tree) for g in pgroups)
            plural_listed.extend(more)
    if not plans and not plural_plans:
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
    plural_outcomes: list[PluralOutcome] = []
    try:
        async with Arm("base", base, home) as b, Arm("candidate", candidate, home) as c:
            for _path, g, tree in plans:
                outcomes.append(await evaluate_group(g, b, c, project, tree))
            for g, tree in plural_plans:
                plural_outcomes.append(await evaluate_plural_group(g, b, c, project, tree))
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
    codes = []
    if "plan-log" in rules:
        print(render(header + (["", "rule plan-log"] if len(rules) > 1 else []), outcomes, listed), end="")
        codes.append(exit_code(outcomes) if plans else 2)
    if "plural-id" in rules:
        print(render_plural([] if "plan-log" in rules else header, plural_outcomes, plural_listed,
                            runs_with_ids, len(runs_logs)), end="")
        codes.append(exit_code_plural(plural_outcomes))
    if args.json:
        args.json.resolve().write_text(json.dumps([
            {"rule": "plan-log", "run": o.group.run, "question": o.group.question, "status": o.status,
             "section": "log", "key": "planItemId", "cause": None, "turns": None,
             "walk_calls": o.walk_calls, "replacement_calls": o.replacement_calls,
             "walk_chars": o.walk_chars, "replacement_chars": o.replacement_chars}
            for o in outcomes
        ] + [
            {"rule": "plural-id", "run": o.group.run, "index": o.group.calls[0].index,
             "agent_type": o.group.agent_type, "status": o.status, "section": o.group.section,
             "key": o.group.key, "cause": o.cause, "reason": o.reason, "turns": o.recorded_turns,
             "walk_calls": o.walk_calls, "replacement_calls": o.plural_calls,
             "walk_chars": o.walk_chars, "replacement_chars": o.plural_chars}
            for o in plural_outcomes
        ], indent=1), encoding="utf-8")
    return aggregate_exit(codes)


if __name__ == "__main__":
    raise SystemExit(main())
