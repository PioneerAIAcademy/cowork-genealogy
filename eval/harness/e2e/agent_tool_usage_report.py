"""Declared-but-never-called tools per plugin agent, over committed e2e runs.

GitHub issue #1085. A free, post-hoc check: for each plugin agent that declares
tool X and appears in a committed run, did it ever actually call X? It costs
nothing (reads committed files, no model, no network) and catches a class the
static checks structurally cannot — a tool spelled correctly, registered
correctly, and still never used, either because it did not bind or because the
agent body never reaches for it. The worked example is #693 / PR #1082, where
`gps-mentor`'s `tools:` list passed every lint yet lacked the projection tools it
needed, so it read `research.json` front-to-back instead. This is the mechanizable
inverse of that: *declared but never called*.

Pairs with #1084 (a live probe of "declared and actually bound"); this covers
"declared but never reached for" from the committed corpus. `gps-mentor`'s
never-called tools here are the candidates #1084's live probe would target.

Each never-called tool is classified by whether the agent's **body prose** asks
for it, which is what makes the finding actionable (Dallan, PR #1085 review):

- **not mentioned in the body** — granted but never asked for; a candidate to
  drop from the agent's `tools:`.
- **mentioned in the body** — the body tells the agent to call it, yet it never
  does (`gps-mentor`'s two wiki tools). Either the body is not forcing enough, or
  the grant did not bind — and *that* split is exactly what #1084's live probe
  resolves; this offline report cannot.

Adds NO instrumentation to a run (same posture as `corpus_report.py` /
`guardrail_shadow_report.py` / `latency_report.py`): pure analysis over
already-committed data.

## Where the per-agent data comes from

The obsolete `## Sketch` in the issue proposed reconstructing each subagent's
tool window by joining `Agent` call descriptions. That is unnecessary — the
committed runlog is already per-agent, two ways, and this unions both:

1. Every capture carries `subagents[].agent_type` plus a per-turn
   `tool_use:<bare_name>` ledger in `subagents[].turns[].blocks`
   (`subagent_capture._block_label` / `_bare_tool_name`). Args are absent —
   names only, which is all this check needs.
2. Since **PR #1027** (merged 2026-08-03) `tool_calls[]` entries carry
   `agent_type`/`agent_id` directly (the PreToolUse hook attributes in-process).
   This never misses when present, unlike the ephemeral-cache capture, which is
   empty in some runs that did delegate.

The two sources are unioned per `agent_type`. Note the #1027 attribution only
helps runs written after it shipped: pre-#1027 empty-capture runs stay
unattributed, and the coverage line says how many.

A tool counts as *used* if an agent was seen **invoking** it — an attempt, not
necessarily a success. The capture source records `tool_use` blocks with no
success/failure signal; the `tool_calls` source additionally drops entries the
runlog marked `is_error`, so a call the harness recorded as failed does not read
as "used" from that source. The consequence for the columns: a genuinely
never-invoked tool is a real never-called candidate, but a non-empty
`used-but-not-declared` set can be a denied/errored *attempt* the capture source
could not mark, not only a non-binding allow-list — see the column's note.

CLI (from eval/harness/):
  uv run python -m e2e.agent_tool_usage_report                 # last 14 days
  uv run python -m e2e.agent_tool_usage_report --since all     # whole corpus
  uv run python -m e2e.agent_tool_usage_report --test bagley-father-1884
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, NamedTuple

from e2e.runlog_selection import (
    add_since_arg,
    all_result_jsons,
    describe_window,
    filter_since,
    result_jsons_for,
)
from harness.allowed_tools import load_skill_frontmatter
from harness.workspace import DEFAULT_PLUGIN_AGENTS

# Always-in-session, non-MCP tools. Filtered from the `used-but-not-declared`
# column ONLY: a built-in call is never evidence of a non-binding MCP allow-list
# (built-ins bypass it), so leaving them in would make the "should be empty ⇒
# allow-list not binding" invariant fire falsely the first time any agent calls
# `Read`. Mirrors `allowed_tools.baseline`, plus `ToolSearch` (the deferred-tool
# loader Cowork exposes, which shows up in `general-purpose` captures). They are
# NOT filtered from the declared columns — an agent that declares `Read` and uses
# it is a truthful declared-and-used.
BUILTIN_TOOLS = frozenset(
    {"Read", "Glob", "Grep", "Write", "Edit", "Skill", "Task", "ToolSearch"}
)


def bare_tool_name(name: str) -> str:
    """`mcp__genealogy__project_context` -> `project_context`; leave others as-is.

    Collapses BOTH server spellings an agent's `tools:` lists — `mcp__genealogy__X`
    and `mcp__remote-devices__Genealogy_Research__X` — onto the same bare `X`,
    which is why the declared set is built from these rather than the raw entries.
    """
    return name.split("__")[-1] if name.startswith("mcp__") else name


def declared_tools_by_agent(
    agents_dir: Path = DEFAULT_PLUGIN_AGENTS,
) -> dict[str, set[str]]:
    """Bare tool names each plugin agent declares in its `tools:` frontmatter.

    Keyed by the frontmatter `name` (which matches the corpus `agent_type`), the
    dual spellings collapsed to one bare name each. Built-ins (`Read`) pass
    through as-is. Reuses `load_skill_frontmatter`, documented as working on
    agent `.md` files, rather than re-parsing YAML.
    """
    out: dict[str, set[str]] = {}
    for md in sorted(agents_dir.glob("*.md")):
        fm = load_skill_frontmatter(md)
        name = fm.get("name") or md.stem
        out[name] = {bare_tool_name(t) for t in (fm.get("tools") or [])}
    return out


def _agent_body(md: Path) -> str:
    """The prose an agent `.md` carries AFTER its frontmatter — the instructions,
    not the `tools:` grant. Empty for a missing/frontmatter-less file.

    The grant lives in the frontmatter; whether the *body* tells the agent to
    call a tool is the separate question this feeds. So the frontmatter block
    (and its `tools:` list) is deliberately excluded — a tool named only there is
    granted, not asked for.
    """
    if not md.exists():
        return ""
    text = md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return text
    parts = text.split("---", 2)
    return parts[2] if len(parts) >= 3 else text


def agent_bodies_by_agent(
    agents_dir: Path = DEFAULT_PLUGIN_AGENTS,
) -> dict[str, str]:
    """Each plugin agent's body prose, keyed by frontmatter `name`."""
    out: dict[str, str] = {}
    for md in sorted(agents_dir.glob("*.md")):
        fm = load_skill_frontmatter(md)
        name = fm.get("name") or md.stem
        out[name] = _agent_body(md)
    return out


def body_mentions(body: str, tool: str) -> bool:
    """True when the agent's body prose references `tool` by its bare name.

    Word-boundary match so `wiki_search` is not found inside a longer token, and
    so a name wrapped in backticks/parens (the usual way the bodies cite a tool,
    e.g. ``` `wiki_search` ```) still matches.
    """
    return re.search(rf"\b{re.escape(tool)}\b", body) is not None


class UsageScan(NamedTuple):
    """What one pass over the corpus collects.

    `used` maps agent_type -> set of bare tool names it was seen calling, unioned
    across both sources. `captures` counts `subagents[]` entries per agent_type.
    The three coverage counters describe attribution reach — see `coverage_line`.
    `problems` holds one message per unreadable file.
    """

    used: dict[str, set[str]]
    captures: Counter
    runs: int
    with_captures: int  # runs with >=1 non-empty subagents entry
    empty_captures: int  # runs with `subagents: []`
    no_field: int  # runs with no `subagents` key at all
    recovered_by_toolcalls: int  # capture-less runs still attributed via tool_calls
    problems: list[str]


def _tools_from_capture(sub: dict[str, Any]) -> set[str]:
    """Bare tool names a single `subagents[]` capture called, from its turn blocks."""
    tools: set[str] = set()
    for turn in sub.get("turns") or []:
        for block in turn.get("blocks") or []:
            if isinstance(block, str) and block.startswith("tool_use:"):
                tools.add(block.split(":", 1)[1])
    return tools


def scan(paths: list[Path]) -> UsageScan:
    """Union the tools each agent_type called across every committed run.

    Every read of one runlog — parse AND per-entry traversal — happens inside the
    `try`, and no running total is touched until all of them succeed (the
    `corpus_report.tally` contract). A malformed file (bad JSON, `subagents:
    [null]`, a non-list `tool_calls`) lands in `problems` exactly once and
    contributes to no counter, so the reported run count and the usage sets stay
    consistent. The `except` mirrors `corpus_report`'s, `TypeError` included.
    """
    used: dict[str, set[str]] = {}
    captures: Counter = Counter()
    runs = with_captures = empty_captures = no_field = recovered = 0
    problems: list[str] = []

    for path in paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            subs = data.get("subagents")
            subs_list = subs if isinstance(subs, list) else []
            raw_calls = data.get("tool_calls")
            tool_calls = raw_calls if isinstance(raw_calls, list) else []

            # Compute this file's contribution into locals first; only merge into
            # the running totals below, after every read has succeeded.
            file_used: dict[str, set[str]] = {}
            file_captures: Counter = Counter()
            for sub in subs_list:
                if not isinstance(sub, dict):
                    continue
                agent = sub.get("agent_type")
                if not agent:
                    continue  # a capture with no agent_type can't be attributed
                file_captures[agent] += 1
                file_used.setdefault(agent, set()).update(_tools_from_capture(sub))

            # #1027 attribution: fold in tool_calls tagged with an agent_type,
            # skipping entries the runlog marked `is_error` — a call the harness
            # recorded as failed or denied did not "work", so it must not read as
            # `used` (a denied write would otherwise surface as "not binding").
            toolcall_attr = False
            for call in tool_calls:
                if not isinstance(call, dict) or call.get("is_error"):
                    continue
                agent = call.get("agent_type")
                name = bare_tool_name(call.get("tool") or "")
                if not agent or not name:
                    continue
                toolcall_attr = True
                file_used.setdefault(agent, set()).add(name)
        except (OSError, json.JSONDecodeError, TypeError, AttributeError) as e:
            problems.append(f"{path}: {e}")
            continue

        runs += 1
        for agent, tools in file_used.items():
            used.setdefault(agent, set()).update(tools)
        captures.update(file_captures)

        # Bucket on the SHAPE of `subagents`, not on whether any entry was
        # attributable: a non-empty list IS a captured delegation even if a
        # missing .meta.json left its entries without an agent_type. Misreporting
        # that as `subagents: []` is what finding 3 flagged.
        if subs_list:
            with_captures += 1
        elif isinstance(subs, list):
            empty_captures += 1
            # A capture-less run the #1027 path still attributed — the reason both
            # sources are unioned. (0 in the pre-#1027 corpus; see module docstring.)
            if toolcall_attr:
                recovered += 1
        else:
            no_field += 1

    return UsageScan(
        used, captures, runs, with_captures, empty_captures, no_field, recovered, problems
    )


class AgentDiff(NamedTuple):
    agent: str
    captures: int
    declared_and_used: list[str]
    declared_never_used: list[str]
    used_not_declared: list[str]
    # Subset of declared_never_used the agent's BODY prose references. The split
    # is the actionable one (Dallan, PR #1085 review): a never-called tool the
    # body never mentions is dead weight in `tools:` — a delete candidate; one the
    # body DOES ask for (gps-mentor's wikis) is a body-clarity or binding gap, the
    # latter being what #1084's live probe exists to disambiguate.
    mentioned_in_body: list[str]


def diff_agents(
    declared: dict[str, set[str]],
    scan_result: UsageScan,
    bodies: dict[str, str] | None = None,
) -> tuple[list[AgentDiff], dict[str, set[str]]]:
    """Per plugin agent, the three-way split; plus the unattributed non-plugin set.

    `general-purpose` (and any agent_type with no `tools:` frontmatter) is NOT a
    plugin agent: folding it into the diff makes its whole tool set
    "used-but-not-declared" and reads as *the allow-list is not binding*, which is
    false. It is returned separately for a stand-alone section.

    `bodies` maps agent name -> body prose (from `agent_bodies_by_agent`); each
    never-called tool is tagged with whether that prose mentions it. Omit it (or
    pass `None`) and every never-called tool is treated as un-mentioned.
    """
    bodies = bodies or {}
    diffs: list[AgentDiff] = []
    for agent in sorted(declared):
        dec = declared[agent]
        used = scan_result.used.get(agent, set())
        never_used = sorted(dec - used)
        body = bodies.get(agent, "")
        diffs.append(
            AgentDiff(
                agent=agent,
                captures=scan_result.captures.get(agent, 0),
                declared_and_used=sorted(dec & used),
                declared_never_used=never_used,
                # Built-ins bypass the MCP allow-list, so they can never evidence a
                # non-binding grant — drop them from this column only.
                used_not_declared=sorted((used - dec) - BUILTIN_TOOLS),
                mentioned_in_body=[t for t in never_used if body_mentions(body, t)],
            )
        )

    unattributed = {
        agent: tools
        for agent, tools in scan_result.used.items()
        if agent not in declared
    }
    return diffs, unattributed


def coverage_line(s: UsageScan) -> str:
    """How much of the corpus this could attribute — the issue's explicit ask.

    Absence of a call is sometimes absence of a capture, so the report states
    which runs it could and could not attribute rather than averaging over both.
    """
    scanned = f"Attribution coverage: {s.with_captures} of {s.runs} readable run(s) carried a subagent capture"
    if s.problems:
        # State the skipped count on stdout too. `describe_window` counts every
        # windowed file (readable + not); this line counts only the readable
        # ones, so without saying so the two run counts on stdout disagree.
        scanned += f" ({len(s.problems)} unreadable, excluded — see stderr)"
    parts = [
        scanned,
        f"  {s.empty_captures} had `subagents: []`, {s.no_field} had no `subagents` "
        f"field (pre-capture runs)",
    ]
    if s.empty_captures:
        parts.append(
            f"  of the empty-capture runs, {s.recovered_by_toolcalls} were still "
            f"attributed via tool_calls (#1027)"
        )
    return "\n".join(parts)


def format_report(
    diffs: list[AgentDiff],
    unattributed: dict[str, set[str]],
    scan_result: UsageScan,
) -> str:
    lines = [coverage_line(scan_result), ""]

    for d in diffs:
        lines.append(f"{d.agent}  ({d.captures} capture(s))")
        if not d.captures and not scan_result.used.get(d.agent):
            # Declared but never seen in any run — say so rather than printing its
            # whole tools: list as "never used", which would read as a defect.
            lines.append("  never appeared in a captured run — nothing to diff")
            lines.append("")
            continue
        lines.append(
            f"  declared & used ({len(d.declared_and_used)}): "
            f"{', '.join(d.declared_and_used) or '(none)'}"
        )
        # Named individually AND classified by whether the body asks for the tool
        # — the deliverable, and what makes it actionable (delete vs. clarify).
        if not d.declared_never_used:
            lines.append("  declared, NEVER called (0): (none)")
        else:
            lines.append(f"  declared, NEVER called ({len(d.declared_never_used)}):")
            mentioned = set(d.mentioned_in_body)
            for tool in d.declared_never_used:
                if tool in mentioned:
                    action = "mentioned in body → clarify the body, or a binding gap (#1084)"
                else:
                    action = "not in body → candidate to drop from tools:"
                lines.append(f"    {tool:22} {action}")
        # Should be empty. A non-empty set is usually the allow-list not binding —
        # but the capture source counts attempts with no success/failure signal,
        # so a denied/errored attempt the runlog couldn't mark can also land here.
        lines.append(
            f"  used, NOT declared ({len(d.used_not_declared)}): "
            f"{', '.join(d.used_not_declared) or '(none)'}"
        )
        lines.append("")

    if unattributed:
        lines.append("Unattributed delegations (non-plugin agent_types) —")
        lines.append("  not diffed: no `tools:` frontmatter to compare against.")
        for agent in sorted(unattributed):
            tools = sorted(unattributed[agent])
            lines.append(
                f"  {agent} ({scan_result.captures.get(agent, 0)} capture(s)): "
                f"{', '.join(tools)}"
            )
        lines.append("")

    lines.extend(
        [
            "Limits (this is a report, not a gate):",
            "  - A never-called tool is a candidate, not a defect. `not in body` "
            "→ likely drop it",
            "    from `tools:`; `mentioned in body` → clarify the body or check "
            "binding (#1084).",
            "    The body scan is a whole-word name match — it cannot tell a "
            "genuine call site",
            "    from a mere mention, only presence from absence.",
            "  - Capture coverage is partial (see the coverage line) — absence of "
            "a call is",
            "    sometimes absence of a capture, not proof the tool was never "
            "reached for.",
            "  - `used` means invoked (attempted), not succeeded: the capture "
            "source carries no",
            "    success/failure signal, so a declared-&-used tool may have only "
            "ever errored, and a",
            "    `used, NOT declared` entry can be a denied/errored attempt, not a "
            "binding failure.",
            "  - Corpus scans age; this windows to 14 days by default (SINCE=all "
            "to opt out).",
            "    A retroactive whole-corpus scan can measure a doctrine's landing "
            "date rather",
            "    than a real gap — split on that date (the #1006 445-violation "
            "scan, settled",
            "    2026-08-01 as a real gap by exactly that method).",
        ]
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Declared-but-never-called tools per plugin agent, over committed "
            "e2e runs (issue #1085)."
        )
    )
    ap.add_argument("--test", help="restrict to one fixture slug")
    add_since_arg(ap)
    args = ap.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        where = f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        print(f"No committed runs found{where}.", file=sys.stderr)
        return 1

    scan_result = scan(paths)
    for problem in scan_result.problems:
        print(f"  skip {problem}", file=sys.stderr)

    declared = declared_tools_by_agent()
    bodies = agent_bodies_by_agent()
    diffs, unattributed = diff_agents(declared, scan_result, bodies)

    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(format_report(diffs, unattributed, scan_result))
    # A wholly-unreadable corpus is a failure, not an empty success (matches
    # corpus_report): a caller keying on the exit code must tell the two apart.
    return 0 if scan_result.runs else 1


if __name__ == "__main__":
    sys.exit(main())
