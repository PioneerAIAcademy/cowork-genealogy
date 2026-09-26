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

- **listed** -- the caller resolves to a shipped agent or skill and the
  manifest names it on every row the tool reaches for it: in `callers`, in
  `hookCallers` (for `research_append`), or in an `agentCallers` entry that
  names this tool.
- **UNLISTED** -- it resolves, and some row the tool reaches for it does not
  name it. A manifest gap of exactly the shape #2575 is about, or a grant that
  should come out.
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
from harness.context_policy import _guard
from harness.ownership import load_manifest, rows
from harness.ts_consts import ts_string_list
from harness.workspace import DEFAULT_PLUGIN_AGENTS, DEFAULT_PLUGIN_SKILLS

#: The agent_type the model falls back to when a `@plugin:<agent>` delegation
#: fails to resolve (issue #939).
GENERAL_PURPOSE = "general-purpose"


#: The manifest's `hookRouting`, the one copy the packaging guard
#: (`tests/packaging/hook-lanes.ts`) reads too: the tool the plugin hook routes
#: by section -- the one `hookCallers` permits -- and each tree row that tool
#: writes, mapped to the research.json section whose op writes it.
_HOOK_ROUTING = load_manifest()["hookRouting"]
HOOK_ROUTED_TOOL: str = _HOOK_ROUTING["tool"]
TREE_ROW_VIA: dict[str, str] = dict(_HOOK_ROUTING["treeRowsVia"])


def writer_tools() -> set[str]:
    """Every tool the ENGINE ships that writes a project document.

    `OK_FALSE_IS_FAILURE` minus `NOT_A_DOCUMENT_WRITER`, read out of
    `src/tool-result.ts` -- the vocabulary the packaging guard uses. Never the
    manifest's own `writerTools`: a newly shipped writer that no row lists yet
    would then be filtered out here and read as "0 UNLISTED", which is the one
    gap this report exists to surface.
    """
    return set(ts_string_list("OK_FALSE_IS_FAILURE")) - set(
        ts_string_list("NOT_A_DOCUMENT_WRITER")
    )


def _names(row: dict, ident: str, tool: str) -> bool:
    """Whether `row` names `ident` as a writer of it with `tool`.

    `callers` counts for every writer tool on its row; `hookCallers` for
    `research_append` only, the one tool the hook routes; an `agentCallers`
    entry (`{agent, tools}`) for the tools it names.
    """
    if tool not in (row.get("writerTools") or []):
        return False
    if ident in (row.get("callers") or []):
        return True
    if tool == HOOK_ROUTED_TOOL and ident in (row.get("hookCallers") or []):
        return True
    return any(
        e["agent"] == ident and tool in e["tools"] for e in row.get("agentCallers") or []
    )


def _reaches(row: dict, ident: str, tool: str) -> bool | None | str:
    """Whether `ident` can write `row` with `tool`; None when nothing static says.

    `"identity"` when the row's `toolAuthorized` names the tool: it is
    authorized there for every caller, so the row need name no one for it.
    Every other writer tool but `research_append` writes the rows its `writerTools`
    entries name. An agent's `research_append` reaches what the shipped hook
    leaves it: its lane, minus sections routed to another agent. A skill's is
    confined by nothing static -- the unit plane checks its rows at run time.
    """
    if tool not in (row.get("writerTools") or []):
        return False
    if tool in (row.get("toolAuthorized") or []):
        return "identity"
    if tool != HOOK_ROUTED_TOOL:
        return True
    if not ident.startswith("agent:"):
        return None
    agent = ident[len("agent:"):]
    section = row.get("section")
    via = section if row.get("artifact") == "research.json" else TREE_ROW_VIA.get(section)
    if via is None:
        return False
    owner = _guard.OWNED_SECTIONS.get(via)
    if owner is not None and owner != agent:
        return False
    return via in _guard.AGENT_WRITABLE_SECTIONS.get(agent, frozenset())


def listed_writers() -> dict[str, set[str]]:
    """`writer tool -> the identifiers the manifest lists for it`, per row.

    The same rule the packaging guard enforces: an identifier is listed for a
    tool when the manifest names it on EVERY row that tool reaches for it, so a
    caller named on one row and missing from another it writes is unlisted. A
    skill's `research_append` reaches rows nothing static decides, so for that
    pair being named on any row is what counts.
    """
    all_rows = rows()
    tools = {t for r in all_rows for t in r.get("writerTools") or []}
    idents = {
        i
        for r in all_rows
        for i in [
            *(r.get("callers") or []),
            *(r.get("hookCallers") or []),
            *(e["agent"] for e in r.get("agentCallers") or []),
        ]
    }
    out: dict[str, set[str]] = {}
    for tool in tools:
        for ident in idents:
            every = [(_names(r, ident, tool), _reaches(r, ident, tool)) for r in all_rows]
            by_identity = any(v == "identity" for _, v in every)
            pairs = [(n, v) for n, v in every if v != "identity"]
            if any(v is None for _, v in pairs):
                listed = any(n for n, _ in pairs)
            else:
                reached = [n for n, v in pairs if v is True]
                listed = all(reached) and (bool(reached) or by_identity)
            if listed:
                out.setdefault(tool, set()).add(ident)
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

    lines.append(
        f"UNLISTED -- a row this writer's tool reaches does not name it ({len(by['unlisted'])}):"
    )
    if not by["unlisted"]:
        lines.append("  (none) -- every attributed writer is named on every row its tool reaches")
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
            "  - Per row, the packaging guard's rule: a caller is listed for a tool "
            "only when a row",
            "    names it on every row that tool reaches for it. A skill's "
            "`research_append` reaches",
            "    rows nothing static decides, so for that pair any naming row "
            "counts. An",
            "    `agentCallers` entry counts only for the tools it names, "
            "`hookCallers` for",
            "    `research_append` only, and `callers` for every writer tool on its "
            "row.",
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
