"""Which subagent wrote a project document, and whether a row says it may.

GitHub issue #2575, observed side. `ownership.json`'s guards all run one way --
every name the manifest lists must resolve to something that ships. Nothing runs
the other way, so a writer that exists in the plugin and is missing from the
manifest was invisible: `record-extractor` held `research_log_append` under all
three spellings, called it across the committed corpus, and appeared in no row.

The blocking guard for that lives in
`packages/engine/mcp-server/tests/packaging/ownership-manifest.test.ts` and reads
the STATIC grants -- each agent's `tools:` and each skill's `allowed-tools:`.
This is the weaker, complementary pass: what the corpus records an agent
actually calling. It is weaker because a writer that never fired is invisible
here, and it is worth having because it catches the case the static side
structurally cannot -- a body that calls a tool its frontmatter never granted,
and a delegation to an agent_type that is not a shipped unit at all.

Three classes, and the third is the reason this is a report rather than a gate:

- **listed** -- the caller resolves to a shipped agent or skill and some row
  listing that tool names it in `callers`, `hookCallers` or `agentCallers`.
- **UNLISTED** -- it resolves, and no row listing that tool names it. A manifest
  gap of exactly the shape #2575 is about, or a grant that should come out.
- **UNBOUND DELEGATION** -- the `agent_type` is neither a shipped agent nor a
  shipped skill. `general-purpose` is the live instance: the stand-in the model
  falls back to when a bare-name `@plugin:<agent>` delegation fails to resolve
  (issue #939). It binds none of the agent's `tools:`/`disallowedTools:`, and it
  can never be listed in any row -- so it is its own finding, and folding it into
  the unlisted count would report a manifest gap that no manifest edit can close.

Adds NO instrumentation to a run (same posture as `agent_tool_usage_report.py`,
`corpus_report.py`, `latency_report.py`): pure analysis over committed data.

## Why this one is not windowed by default

Every other e2e reader defaults to 14 days because it aggregates a rate and
mixing eras corrupts it. This reader answers a structural question -- does the
manifest name the writers that exist -- and a gap does not become untrue by
ageing. A windowed run today reads 27 of the 189 committed logs and finds a
strict subset of the same pairs, which reads as "fewer gaps" rather than "less
evidence". `--since` is still available for a freshness view.

CLI (from eval/harness/):
  uv run python -m e2e.writer_attribution_report                  # whole corpus
  uv run python -m e2e.writer_attribution_report --since 14       # last 14 days
  uv run python -m e2e.writer_attribution_report --test ferber-death
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import NamedTuple

from e2e.agent_tool_usage_report import declared_tools_by_agent, scan
from e2e.runlog_selection import (
    add_since_arg,
    all_result_jsons,
    branch_scope_note,
    describe_window,
    filter_since,
    result_jsons_for,
)
from harness.ownership import rows
from harness.workspace import DEFAULT_PLUGIN_AGENTS

#: The plugin's skills, beside the agents the harness already resolves.
DEFAULT_PLUGIN_SKILLS = DEFAULT_PLUGIN_AGENTS.parent / "skills"


def writer_tools() -> set[str]:
    """Every tool any ownership row names as a writer of a project document."""
    return {t for r in rows() for t in (r.get("writerTools") or [])}


def listed_writers() -> dict[str, set[str]]:
    """`writer tool -> the identifiers some row listing it names as a writer`.

    Unions `callers`, `hookCallers` and `agentCallers` across every row that
    lists the tool, which is the same permitted set the packaging guard reads.
    Per tool and unioned across rows, because nothing offline can say which
    section a given call went to -- so this finds a caller listed for a tool
    NOWHERE, not one listed on the wrong row.
    """
    out: dict[str, set[str]] = {}
    for row in rows():
        names = set(row.get("callers") or [])
        names |= set(row.get("hookCallers") or [])
        names |= set(row.get("agentCallers") or [])
        for tool in row.get("writerTools") or []:
            out.setdefault(tool, set()).update(names)
    return out


def shipped_units(
    agents_dir: Path = DEFAULT_PLUGIN_AGENTS,
    skills_dir: Path = DEFAULT_PLUGIN_SKILLS,
) -> set[str]:
    """`agent:<name>` / `skill:<name>` for everything the plugin ships."""
    units = {f"agent:{name}" for name in declared_tools_by_agent(agents_dir)}
    if skills_dir.is_dir():
        units |= {
            f"skill:{d.name}" for d in skills_dir.iterdir() if (d / "SKILL.md").exists()
        }
    return units


def identifier_for(agent_type: str, units: set[str]) -> str | None:
    """`agent_type` -> the manifest identifier it is, or None if it is neither.

    Production reports a namespaced `genealogy-research:<name>` as often as the
    bare one, so the tail is taken -- the same normalization the shipped hook's
    `owner_denied` applies to its caller key. `None` means an unbound delegation.
    """
    bare = agent_type.rsplit(":", 1)[-1]
    for candidate in (f"agent:{bare}", f"skill:{bare}"):
        if candidate in units:
            return candidate
    return None


class Pair(NamedTuple):
    """One (caller, writer tool) the corpus recorded, with its verdict."""

    caller: str        # the raw `agent_type` as the runlog carried it
    identifier: str | None  # `agent:x` / `skill:x`, or None for an unbound delegation
    tool: str
    calls: int
    runs: int
    verdict: str       # "listed" | "unlisted" | "unbound"


def classify(scan_result, listed: dict[str, set[str]], units: set[str]) -> list[Pair]:
    """Every (caller, writer tool) pair in the scan, verdict attached."""
    writers = writer_tools()
    pairs: list[Pair] = []
    # The union of both keyed sources, not `pair_calls` alone. `pair_runs` is the
    # superset: it is built from the per-file union of captures AND #1027
    # `tool_calls` attribution, while `pair_calls` counts capture blocks only. A
    # pair the capture source missed entirely would otherwise be dropped here —
    # which is the one source that never misses when present.
    keys = sorted(set(scan_result.pair_calls) | set(scan_result.pair_runs))
    for caller, tool in keys:
        if tool not in writers:
            continue
        calls = scan_result.pair_calls.get((caller, tool), 0)
        identifier = identifier_for(caller, units)
        if identifier is None:
            verdict = "unbound"
        elif identifier in listed.get(tool, set()):
            verdict = "listed"
        else:
            verdict = "unlisted"
        pairs.append(
            Pair(
                caller=caller,
                identifier=identifier,
                tool=tool,
                calls=calls,
                runs=len(scan_result.pair_runs.get((caller, tool), ())),
                verdict=verdict,
            )
        )
    return pairs


def format_report(pairs: list[Pair], scan_result) -> str:
    """Three sections, unlisted first, each pair named individually."""
    by = {v: [p for p in pairs if p.verdict == v] for v in ("unlisted", "unbound", "listed")}
    lines = [
        f"{len(pairs)} (caller, writer tool) pair(s) attributed across "
        f"{scan_result.runs} readable run(s).",
        "",
    ]

    lines.append(f"UNLISTED -- no ownership row names this writer ({len(by['unlisted'])}):")
    if not by["unlisted"]:
        lines.append("  (none) -- every attributed writer is named by a row listing its tool")
    for p in by["unlisted"]:
        lines.append(
            f"  {p.identifier} -> {p.tool}: {p.calls} call(s) in {p.runs} run(s)"
        )
    lines.append("")

    lines.append(
        f"UNBOUND DELEGATION -- agent_type is neither a shipped agent nor a "
        f"shipped skill ({len(by['unbound'])}):"
    )
    if not by["unbound"]:
        lines.append("  (none)")
    for p in by["unbound"]:
        lines.append(f"  {p.caller} -> {p.tool}: {p.calls} call(s) in {p.runs} run(s)")
    if by["unbound"]:
        lines.append(
            "  Not a manifest gap and not waivable: a stand-in that is not a shipped "
            "unit cannot be listed in any row. It is the #939 fallback -- a bare-name "
            "delegation that failed to resolve, binding none of the agent's tools:."
        )
    lines.append("")

    lines.append(f"listed ({len(by['listed'])}):")
    for p in by["listed"]:
        lines.append(f"  {p.identifier} -> {p.tool}: {p.calls} call(s) in {p.runs} run(s)")
    lines.append("")

    lines.extend(
        [
            "Limits (this is a report, not a gate):",
            "  - The BLOCKING direction is static, in ownership-manifest.test.ts: it "
            "reads each",
            "    agent's `tools:` and each skill's `allowed-tools:`. This pass is "
            "weaker -- a",
            "    writer that never fired in the corpus is invisible here -- and "
            "catches what that",
            "    one structurally cannot: a body calling a tool its frontmatter never "
            "granted.",
            "  - Attribution is partial. A run with no subagent capture and no "
            "#1027-tagged",
            "    tool_calls contributes nothing, so absence of a pair is not proof "
            "the write",
            "    never happened.",
            "  - `calls` counts INVOCATIONS from the capture source only; a pair "
            "recovered purely",
            "    from `tool_calls` attribution shows 0 calls and a non-zero run "
            "count.",
            "  - An ATTEMPT is not a write. The capture source carries no "
            "success signal, so a",
            "    call the shipped hook DENIED (`owner_denied`) looks identical "
            "to one that landed;",
            "    only the `tool_calls` source drops `is_error`. So an UNLISTED "
            "pair can be a write",
            "    that was correctly refused \u2014 check the run before widening a "
            "row to admit it.",
            "  - Per tool and unioned across rows: this finds a caller listed for a "
            "writer tool",
            "    NOWHERE, not one listed on the wrong row. Nothing offline can say "
            "which section",
            "    a given call went to.",
        ]
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    # The house pattern (`e2e/author.py`). A Windows console defaults to cp1252
    # and dies on the arrows and box glyphs a report prints; the team this is
    # written for is on Windows. Guarded by tests/unit/test_encoding_lint.py.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(
        description=(
            "Which subagent wrote a project document, and whether an ownership "
            "row says it may (issue #2575)."
        )
    )
    ap.add_argument("--test", help="restrict to one fixture slug")
    # `all`, not the house 14 days: see the module docstring. A manifest gap does
    # not become untrue by ageing, and a window would read a strict subset of the
    # same pairs as "fewer gaps".
    add_since_arg(ap, default="all")
    args = ap.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        where = f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        print(f"No committed runs found{where}.", file=sys.stderr)
        print(branch_scope_note(), file=sys.stderr)
        return 1

    scan_result = scan(paths)
    for problem in scan_result.problems:
        print(f"  skip {problem}", file=sys.stderr)

    pairs = classify(scan_result, listed_writers(), shipped_units())

    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(format_report(pairs, scan_result))
    # A wholly-unreadable corpus is a failure, not an empty success (matches
    # agent_tool_usage_report): a caller keying on the exit code must tell the
    # two apart. An UNLISTED pair does NOT change the exit code -- this is a
    # report, and the gate is the packaging test.
    return 0 if scan_result.runs else 1


if __name__ == "__main__":
    sys.exit(main())
