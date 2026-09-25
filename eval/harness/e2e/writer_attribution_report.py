"""Which subagent wrote a project document, and whether a row says it may.

GitHub issue #2575, observed side. `ownership.json`'s guards all run one way --
every name the manifest lists must resolve to something that ships. Nothing runs
the other way, so a writer that exists in the plugin and is missing from the
manifest was invisible: `record-extractor` held `research_log_append` under all
three spellings, called it across the committed corpus, and appeared in no row.

The blocking guard for that lives in
`packages/engine/mcp-server/tests/packaging/ownership-manifest.test.ts` and reads
the DECLARED grants -- each agent's `tools:` and each skill's `allowed-tools:`.
This is the weaker, complementary pass: what the corpus records an agent
actually calling. It is weaker because a writer that never fired is invisible
here, and it is worth having because it catches what a frontmatter read cannot
-- an agent body calling a tool its `tools:` never declared, and a delegation to
an agent_type that is not a shipped unit at all. It sees subagents only: a
skill's own calls carry no `agent_type`, so an undeclared skill call is
`test_tool_allowlist`'s job (`validators/test_universal.py`), not this one's.

Three classes, and the third is the reason this is a report rather than a gate:

- **listed** -- the caller resolves to a shipped agent or skill and some row
  listing that tool names it: in `callers` or `hookCallers`, or in an
  `agentCallers` entry that names this tool.
- **UNLISTED** -- it resolves, and no row listing that tool names it. A manifest
  gap of exactly the shape #2575 is about, or a grant that should come out.
- **UNBOUND DELEGATION** -- the `agent_type` is neither a shipped agent nor a
  shipped skill, so it can never be listed in any row -- which is why it is its
  own finding: folding it into the unlisted count would report a manifest gap
  that no manifest edit can close. `general-purpose` is the live instance, the
  stand-in the model falls back to when a bare-name `@plugin:<agent>` delegation
  fails to resolve (issue #939), binding none of the agent's `tools:`. Any other
  name here was renamed, retired, or never shipped.

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
from harness.workspace import DEFAULT_PLUGIN_AGENTS, DEFAULT_PLUGIN_SKILLS

#: The agent_type the model falls back to when a `@plugin:<agent>` delegation
#: fails to resolve (issue #939).
GENERAL_PURPOSE = "general-purpose"


def writer_tools() -> set[str]:
    """Every tool any ownership row names as a writer of a project document."""
    return {t for r in rows() for t in (r.get("writerTools") or [])}


def listed_writers() -> dict[str, set[str]]:
    """`writer tool -> the identifiers some row listing it names as a writer`.

    The same listed set the packaging guard reads. `callers` and `hookCallers`
    are permission fields, so they count for every writer tool on their row; an
    `agentCallers` entry (`{agent, tools}`) counts only for the tools it names.
    Still per tool and unioned across rows, because nothing offline can say which
    section a given call went to -- so this finds a caller listed for a tool
    NOWHERE, not a (caller, tool) written on the wrong row.
    """
    out: dict[str, set[str]] = {}
    for row in rows():
        permitted = set(row.get("callers") or []) | set(row.get("hookCallers") or [])
        for tool in row.get("writerTools") or []:
            out.setdefault(tool, set()).update(permitted)
        for entry in row.get("agentCallers") or []:
            for tool in entry["tools"]:
                out.setdefault(tool, set()).add(entry["agent"])
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


def _bare(agent_type: str) -> str:
    """`genealogy-research:<name>` -> `<name>`; a bare name passes through."""
    return agent_type.rsplit(":", 1)[-1]


def _is_general_purpose(pair: "Pair") -> bool:
    """True when every spelling grouped into `pair` is the #939 stand-in."""
    return all(_bare(s) == GENERAL_PURPOSE for s in pair.caller.split(", "))


def identifier_for(agent_type: str, units: set[str]) -> str | None:
    """`agent_type` -> the manifest identifier it is, or None if it is neither.

    Production reports a namespaced `genealogy-research:<name>` as often as the
    bare one, so the tail is taken -- the same normalization the shipped hook's
    `owner_denied` applies to its caller key. `None` means an unbound delegation.
    """
    bare = _bare(agent_type)
    for candidate in (f"agent:{bare}", f"skill:{bare}"):
        if candidate in units:
            return candidate
    return None


class Pair(NamedTuple):
    """One (caller, writer tool) the corpus recorded, with its verdict."""

    caller: str        # every raw `agent_type` spelling seen for it, comma-joined
    identifier: str | None  # `agent:x` / `skill:x`, or None for an unbound delegation
    tool: str
    calls: int
    runs: int
    verdict: str       # "listed" | "unlisted" | "unbound" (the three classes above)


def classify(scan_result, listed: dict[str, set[str]], units: set[str]) -> list[Pair]:
    """Every (caller, writer tool) pair in the scan, verdict attached.

    Keyed on the manifest identifier, not the raw `agent_type`: production
    reports `genealogy-research:<name>` beside the bare `<name>`, and both are
    one caller. Calls sum and runs union across the spellings.
    """
    writers = writer_tools()
    # `pair_runs`, not `pair_calls`: it is built from the per-file union of
    # captures AND #1027 `tool_calls` attribution, so it holds every pair
    # `pair_calls` does plus the ones only attribution saw.
    grouped: dict[tuple[str, str], dict] = {}
    for caller, tool in scan_result.pair_runs:
        if tool not in writers:
            continue
        identifier = identifier_for(caller, units)
        # An unbound caller groups on its bare tail too, so a retired agent's
        # bare and namespaced spellings are one row, like a shipped one's.
        slot = grouped.setdefault(
            (identifier or _bare(caller), tool),
            {"identifier": identifier, "spellings": set(), "calls": 0, "runs": set()},
        )
        slot["spellings"].add(caller)
        slot["calls"] += scan_result.pair_calls.get((caller, tool), 0)
        slot["runs"] |= set(scan_result.pair_runs.get((caller, tool), ()))

    pairs: list[Pair] = []
    for (_, tool), slot in sorted(grouped.items()):
        identifier = slot["identifier"]
        if identifier is None:
            verdict = "unbound"
        elif identifier in listed.get(tool, set()):
            verdict = "listed"
        else:
            verdict = "unlisted"
        pairs.append(
            Pair(
                caller=", ".join(sorted(slot["spellings"])),
                identifier=identifier,
                tool=tool,
                calls=slot["calls"],
                runs=len(slot["runs"]),
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
            "  Not a manifest gap: a name that is not a shipped unit cannot be listed "
            "in any row."
        )
    if any(_is_general_purpose(p) for p in by["unbound"]):
        lines.append(
            f"  {GENERAL_PURPOSE} is the #939 fallback -- a bare-name delegation that "
            "failed to resolve, binding none of the agent's tools:."
        )
    if any(not _is_general_purpose(p) for p in by["unbound"]):
        lines.append(
            "  Any other name here was renamed, retired, or never shipped; its calls "
            "predate the current plugin."
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
            "    one cannot: an agent body calling a tool its `tools:` never "
            "declared. It sees",
            "    subagents only; an undeclared SKILL call is test_tool_allowlist's "
            "job.",
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
            "    NOWHERE, not a (caller, tool) written on the wrong row. Nothing "
            "offline can say",
            "    which section a given call went to. An `agentCallers` entry counts "
            "only for the",
            "    tools it names; `callers`/`hookCallers` count for every writer tool "
            "on their row.",
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
