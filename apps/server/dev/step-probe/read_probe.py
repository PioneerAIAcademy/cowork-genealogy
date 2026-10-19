#!/usr/bin/env python3
"""Turn a `step-probe.jsonl` into phase 0's eight answers.

Usage:  python3 read_probe.py [path/to/step-probe.jsonl]

Separate from the recorder on purpose. The recorder runs in the VM under a hook
timeout and must never raise; this runs afterwards on a developer's machine with
the whole log in hand, so the judgement lives here where it can be re-run over a
log without re-running the session.

THE CONTROL GATE

Every answer below is "the log does not contain X". That sentence is only a
finding when the log contains something -- otherwise it describes an uninstalled
probe. `PreToolUse` is the control (ADR-0005 measured it live in Cowork,
2026-07-30), so a log with no `PreToolUse` lines is reported VOID and no answer
is printed. Refusing is the whole point: an empty log formatted as eight
negatives is how a measurement becomes eight wrong beliefs.
"""
import collections
import json
import os
import sys

VOID = "VOID"
YES = "YES"
NO = "NO"
UNKNOWN = "UNKNOWN"

STEP_TOOLS = ("Agent", "Task", "Skill")


def load(path):
    rows, bad = [], 0
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except Exception:  # noqa: BLE001
                    bad += 1
    except FileNotFoundError:
        return None, 0
    return rows, bad


def by_event(rows):
    out = collections.defaultdict(list)
    for r in rows:
        out[r.get("hook_event_name") or "(none)"].append(r)
    return out


def answer(rows):
    ev = by_event(rows)
    pre = ev.get("PreToolUse", [])
    ups = ev.get("UserPromptSubmit", [])
    out = []

    # 1. PreToolUse on Agent|Task|Skill main-thread calls.
    #    Main thread = no agent_id, the same discriminator the shipped hook and
    #    the worker's decision arm both use.
    step_calls = [
        r for r in pre if r.get("tool_name") in STEP_TOOLS and not r.get("agent_id")
    ]
    seen_tools = sorted({r.get("tool_name") for r in pre if r.get("tool_name")})
    # Zero is UNKNOWN, not NO: "no such call was made" and "the hook did not see
    # it" leave the same log. The 2026-10-19 Cowork run made none -- the model
    # answered the research prompt with direct tool calls -- and this line used
    # to print NO for it.
    out.append(
        (
            "1. PreToolUse fires on main-thread Agent|Task|Skill",
            YES if step_calls else UNKNOWN,
            f"{len(step_calls)} such call(s); tools seen overall: {seen_tools or 'none'}"
            + (
                ""
                if step_calls
                else ". Check the session: if no skill or agent ran, item 1 was "
                "not exercised"
            ),
        )
    )

    # 2. UserPromptSubmit fires, and carries the prompt text.
    if not ups:
        verdict, detail = NO, "no UserPromptSubmit lines"
    else:
        with_text = [r for r in ups if r.get("has_prompt_text")]
        verdict = YES if with_text else "FIRES-WITHOUT-TEXT"
        detail = f"{len(ups)} line(s), {len(with_text)} carrying prompt text"
    out.append(("2. UserPromptSubmit fires and carries the prompt", verdict, detail))

    # 3. prompt_id presence and semantics. Semantics = does it hold steady across
    #    one turn's calls and change between turns? Answerable only with >1 value.
    ids = [r.get("prompt_id") for r in rows if r.get("prompt_id")]
    if not ids:
        verdict, detail = NO, "no line carried prompt_id"
    else:
        uniq = sorted(set(ids))
        verdict = YES
        detail = f"{len(ids)} line(s), {len(uniq)} distinct value(s)"
        if len(uniq) == 1:
            detail += " -- one turn only; re-run with 2+ turns to read its semantics"
    out.append(("3. prompt_id present", verdict, detail))

    # 4. transcript_path readable.
    seen = [r for r in rows if (r.get("transcript") or {}).get("present")]
    if not seen:
        verdict, detail = NO, "no line carried transcript_path"
    else:
        ok = [r for r in seen if (r.get("transcript") or {}).get("readable")]
        verdict = YES if ok else NO
        details = sorted(
            {
                str((r.get("transcript") or {}).get("detail"))
                for r in seen
                if not (r.get("transcript") or {}).get("readable")
            }
        )
        detail = f"{len(ok)}/{len(seen)} readable"
        if details:
            detail += f"; failures: {details}"
    out.append(("4. transcript_path readable from the hook", verdict, detail))

    # 5. Denies honoured. The log cannot answer this alone -- it records that the
    #    deny was EMITTED; whether the runtime honoured it and the model then
    #    reported and ended is read off the session. Say so rather than scoring it.
    canary = [
        r
        for r in pre
        if "STEP_PROBE_CANARY" in json.dumps(r.get("payload", {}).get("tool_input", {}))
    ]
    out.append(
        (
            "5. Denies honoured (needs the session transcript too)",
            "EMITTED" if canary else "NOT-EXERCISED",
            f"{len(canary)} canary call(s) denied by the probe; confirm in the session "
            "that the model surfaced STEP_PROBE_CANARY_DENIED_BY_STEP_PROBE and then ended",
        )
    )

    # 6. Sibling calls visible: more than one tool call inside one turn. Grouped
    #    by prompt_id when there is one, else by session_id.
    key = "prompt_id" if ids else "session_id"
    groups = collections.Counter(r.get(key) for r in pre)
    multi = {k: n for k, n in groups.items() if k and n > 1}
    out.append(
        (
            "6. Sibling calls visible within a turn",
            YES if multi else UNKNOWN,
            f"grouped by {key}: {len(multi)} group(s) with >1 call "
            f"(max {max(multi.values()) if multi else 0})",
        )
    )

    # 7. The project readable from the hook's cwd.
    readable = [
        r
        for r in rows
        if ((r.get("project") or {}).get("research.json") or {}).get("readable")
    ]
    cwds = sorted({(r.get("project") or {}).get("cwd") for r in rows if r.get("project")})
    reasons = sorted(
        {
            str(((r.get("project") or {}).get("research.json") or {}).get("detail"))
            for r in rows
            if not ((r.get("project") or {}).get("research.json") or {}).get("readable")
        }
    )
    out.append(
        (
            "7. research.json readable from the hook's cwd",
            YES if readable else NO,
            f"{len(readable)}/{len(rows)} line(s); cwd(s): {cwds}; reasons: {reasons}",
        )
    )

    # 8. A file the hook writes is readable on its next call. The counter is what
    #    makes this honest: a file present every call but always reading 1 means
    #    each invocation got a fresh filesystem, which is a NO wearing a yes.
    reads = [r.get("state", {}).get("read") for r in rows]
    carried = [v for v in reads if isinstance(v, int)]
    out.append(
        (
            "8. A file the hook wrote survives to its next call",
            YES if carried else NO,
            f"{len(carried)}/{len(rows)} line(s) read a prior value; "
            f"highest seen: {max(carried) if carried else 0}",
        )
    )
    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "step-probe.jsonl"
    )
    rows, bad = load(path)

    if rows is None:
        print(f"{VOID}: no log at {path}. The probe did not run, or wrote elsewhere "
              f"(check STEP_PROBE_LOG).")
        return 2
    if not rows:
        print(f"{VOID}: {path} is empty. The probe did not fire at all.")
        return 2

    ev = by_event(rows)
    print(f"log: {path}")
    print(f"lines: {len(rows)}" + (f" ({bad} unparseable)" if bad else ""))
    print("events: " + ", ".join(f"{k}={len(v)}" for k, v in sorted(ev.items())))
    print()

    if not ev.get("PreToolUse"):
        print(
            f"{VOID}: no PreToolUse lines. That event is the control -- ADR-0005\n"
            "measured it firing in live Cowork on 2026-07-30, so its absence means the\n"
            "probe is not installed, not that the other events do not fire. No answers\n"
            "printed: an empty log formatted as negatives is eight wrong beliefs."
        )
        return 2

    width = max(len(q) for q, _, _ in answer(rows))
    for question, verdict, detail in answer(rows):
        print(f"{question.ljust(width)}  {verdict}")
        print(f"{' ' * width}  {detail}")
        print()

    print("SessionStart: " + (
        f"{len(ev['SessionStart'])} line(s) -- CONTRADICTS ADR-0005, re-measure"
        if ev.get("SessionStart")
        else "0 lines, consistent with ADR-0005 (does not fire in Cowork)"
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
