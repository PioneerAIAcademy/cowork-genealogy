"""How often `project_context`'s `nextStep` names the unit the model ran next.

GitHub issue #3523, Part 1. `project_context` returns each question's `nextStep`
(`question-state.ts`, `questionStatus`); the router follows the prose routing
table in `research/SKILL.md`. Nothing measured how often the two agree, and a
quoted figure (40 of 90) could not be reproduced because its method was never
committed. This module is that method, run over committed e2e run JSONs: no live
run, no model, no API spend.

## Method (decided on the issue; do not re-derive)

- A **decision** is a `project_context` call whose `response_summary` carries at
  least one non-null `questionStatuses[].nextStep`. It is paired with the first
  later call that is an `Agent`/`Task` spawn, a `Skill` call or an
  `extraction_append` call, stopping at the next `project_context`. A decision
  with no such call is counted as `unpaired` and dropped.
- **Two populations**, by the `project_context` call's `agent_id`: the router
  (`agent_id` null) and subagents (`agent_id` set). The router reads
  `project_context` about once per run, so a blended figure mostly measures
  subagents.
- **Unit names**: a spawn's `subagent_type`, a Skill call's `skill`, with any
  `genealogy-research:` / `@plugin:` prefix stripped. `extraction_append`,
  `record-structurer`, `record-extractor` and `record-extraction` all read as
  `extraction`, on both sides: the ladder itself said `record-extraction` before
  the extraction contract moved into code. An untyped spawn (`general-purpose`,
  or no `subagent_type`) is `untyped` and never matches.
- A `nextStep`'s unit is its text before the first ` — `, `,` or ` (`
  (`research-exhaustiveness, then proof-conclusion` is `research-exhaustiveness`;
  `extraction (…)` is `extraction`). A decision **matches** when any question's
  unit equals the paired unit. A decision is counted under the unit it matched,
  else under its first question's unit, except that a decision paired with an
  untyped spawn has its own `untyped` row.
- A subagent decision whose nextStep names the reading agent itself is counted
  as **self-named**: the agent read `project_context` in the middle of its own
  step, so the pairing measures the router's next hand-off, not this read. It is
  reported, not removed, so the decided figures stand unchanged.

## Read it with its denominators

`response_summary` is stripped from e2e runs older than 14 days
(`make prune-runlogs STRIP=1`), so with `SINCE=all` most `project_context` calls
cannot be read at all. They are counted as `stripped`, never as disagreement. The
report also prints how many runs contain PR #3494 and PR #3583, which gates
Part 2 of the issue: it needs at least three such runs.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import NamedTuple

from e2e.runlog_selection import (
    add_since_arg,
    all_result_jsons,
    branch_scope_note,
    describe_window,
    filter_since,
    result_jsons_for,
)

# The merge commits Part 2's gate names: PR #3494 and PR #3583.
GATE_COMMITS = {"#3494": "e9b9c5352", "#3583": "2630a8578"}

PREFIXES = ("genealogy-research:", "@plugin:")
EXTRACTION_ALIASES = frozenset(
    {"extraction", "extraction_append", "record-structurer", "record-extractor", "record-extraction"}
)
UNTYPED = "untyped"

# A truncated summary is not valid JSON, so read each nextStep by pattern.
NEXT_STEP_RE = re.compile(r'"nextStep":\s*(null|"((?:[^"\\]|\\.)*)")')
UNIT_CUT_RE = re.compile(r" — |,| \(")


class Decision(NamedTuple):
    run: str
    sha: str
    population: str  # "router" | "subagent"
    steps: tuple[str, ...]
    paired: str
    reader: str = ""  # the subagent that read project_context, normalized

    @property
    def self_named(self) -> bool:
        """The step names the agent reading it: a mid-step read, not a routing choice."""
        return bool(self.reader) and self.reader in self.steps

    @property
    def matched(self) -> bool:
        return self.paired in self.steps

    @property
    def unit(self) -> str:
        if self.paired == UNTYPED:
            return UNTYPED
        return self.paired if self.matched else self.steps[0]


class Scan(NamedTuple):
    decisions: list[Decision]
    unpaired: Counter  # population -> count
    stripped: int
    no_next_step: int
    runs: int


def normalize(name: str) -> str:
    """Strip the plugin prefixes and fold the extraction aliases."""
    n = name.strip()
    for p in PREFIXES:
        if n.startswith(p):
            n = n[len(p):]
    return "extraction" if n in EXTRACTION_ALIASES else n


def next_step_unit(text: str) -> str:
    return normalize(UNIT_CUT_RE.split(text, maxsplit=1)[0])


def next_steps(response_summary: str) -> list[str]:
    """Each non-null nextStep in a project_context summary, as a unit."""
    out = []
    for m in NEXT_STEP_RE.finditer(response_summary):
        if m.group(1) == "null":
            continue
        raw = json.loads(m.group(1))
        if raw:
            out.append(next_step_unit(raw))
    return out


def _bare(tool: str) -> str:
    return tool.rsplit("__", 1)[-1]


def is_project_context(call: dict) -> bool:
    return _bare(str(call.get("tool") or "")) == "project_context"


def paired_unit(call: dict) -> str | None:
    """The unit a call runs, or None when it is not a hand-off the method pairs."""
    tool = str(call.get("tool") or "")
    args = call.get("args") if isinstance(call.get("args"), dict) else {}
    if tool in ("Agent", "Task"):
        st = args.get("subagent_type")
        if not isinstance(st, str) or not st.strip() or normalize(st) == "general-purpose":
            return UNTYPED
        return normalize(st)
    if tool == "Skill":
        skill = args.get("skill")
        return normalize(skill) if isinstance(skill, str) and skill.strip() else None
    if _bare(tool) == "extraction_append":
        return "extraction"
    return None


def scan_run(doc: dict, run: str) -> tuple[list[Decision], Counter, int, int]:
    calls = doc.get("tool_calls") or []
    sha = str(doc.get("git_sha") or "unknown")
    decisions: list[Decision] = []
    unpaired: Counter = Counter()
    stripped = no_step = 0
    for i, call in enumerate(calls):
        if not is_project_context(call):
            continue
        summary = call.get("response_summary")
        if not isinstance(summary, str) or not summary:
            stripped += 1
            continue
        steps = next_steps(summary)
        if not steps:
            no_step += 1
            continue
        population = "subagent" if call.get("agent_id") else "router"
        paired = None
        for later in calls[i + 1:]:
            if is_project_context(later):
                break
            paired = paired_unit(later)
            if paired is not None:
                break
        if paired is None:
            unpaired[population] += 1
            continue
        reader = normalize(str(call.get("agent_type") or "")) if population == "subagent" else ""
        decisions.append(Decision(run, sha, population, tuple(steps), paired, reader))
    return decisions, unpaired, stripped, no_step


def scan(paths: list[Path]) -> Scan:
    decisions: list[Decision] = []
    unpaired: Counter = Counter()
    stripped = no_step = runs = 0
    for p in paths:
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        runs += 1
        d, u, s, n = scan_run(doc, f"{p.parent.name}/{p.stem}")
        decisions += d
        unpaired += u
        stripped += s
        no_step += n
    return Scan(decisions, unpaired, stripped, no_step, runs)


_GATE_CACHE: dict[tuple[str, str], bool | None] = {}


def contains_commit(sha: str, commit: str) -> bool | None:
    """Whether `commit` is an ancestor of `sha`; None when git cannot say."""
    key = (sha, commit)
    if key not in _GATE_CACHE:
        try:
            r = subprocess.run(
                ["git", "merge-base", "--is-ancestor", commit, sha],
                capture_output=True, timeout=30,
            )
            _GATE_CACHE[key] = {0: True, 1: False}.get(r.returncode)
        except (OSError, subprocess.SubprocessError):
            _GATE_CACHE[key] = None
    return _GATE_CACHE[key]


def _rate(m: int, n: int) -> str:
    return f"{m * 100 / n:.0f}%" if n else "-"


def unit_table(decisions: list[Decision]) -> list[str]:
    by_unit: dict[str, list[Decision]] = defaultdict(list)
    for d in decisions:
        by_unit[d.unit].append(d)
    lines = [f"  {'nextStep unit':<28}{'decisions':>10}{'matches':>9}{'rate':>6}   ran instead (top 3)"]
    for unit, ds in sorted(by_unit.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        m = sum(d.matched for d in ds)
        instead = Counter(d.paired for d in ds if not d.matched).most_common(3)
        lines.append(
            f"  {unit:<28}{len(ds):>10}{m:>9}{_rate(m, len(ds)):>6}   "
            + (", ".join(f"{u} x{c}" for u, c in instead) or "-")
        )
    m = sum(d.matched for d in decisions)
    lines.append(f"  {'TOTAL':<28}{len(decisions):>10}{m:>9}{_rate(m, len(decisions)):>6}")
    return lines


def format_report(s: Scan, shas: dict[str, int], gate: dict[str, dict[str, bool | None]]) -> str:
    multi = sum(len(d.steps) > 1 for d in s.decisions)
    lines = [
        f"{len(s.decisions)} paired decision(s) in {s.runs} run(s): "
        f"router {sum(d.population == 'router' for d in s.decisions)}, "
        f"subagent {sum(d.population == 'subagent' for d in s.decisions)}.",
        f"Unpaired (no spawn, Skill or extraction_append before the next project_context): "
        f"router {s.unpaired['router']}, subagent {s.unpaired['subagent']}.",
        f"project_context calls not readable: {s.stripped} with no response_summary (stripped past"
        f" 14 days), {s.no_next_step} with no non-null nextStep.",
        f"Decisions with more than one question carrying a nextStep: {multi}.",
    ]
    both = [sha for sha in shas if all(gate[sha].get(k) for k in GATE_COMMITS)]
    sub = [d for d in s.decisions if d.population == "subagent"]
    lines.append(
        f"Subagent decisions whose nextStep names the reading agent itself: {sum(d.self_named for d in sub)}"
        f" of {len(sub)} ({sum(d.self_named and not d.matched for d in sub)} of the"
        f" {sum(not d.matched for d in sub)} misses). Such a read is the agent checking state"
        " mid-step, so its pairing with the router's next hand-off is not a routing choice."
    )
    lines.append(
        "Part 2 gate (issue #3523, needs >= 3): runs whose git_sha contains "
        + " and ".join(f"PR {k} ({v})" for k, v in GATE_COMMITS.items())
        + f": {sum(shas[sha] for sha in both)}."
    )
    for population in ("router", "subagent"):
        ds = [d for d in s.decisions if d.population == population]
        lines += ["", f"== {population.capitalize()} decisions (agent_id {'null' if population == 'router' else 'set'}) =="]
        lines += unit_table(ds) if ds else ["  none"]
    lines += ["", "== By run git_sha =="]
    for sha in sorted(shas, key=lambda x: (-shas[x], x)):
        marks = " ".join(
            f"{k}={'yes' if gate[sha].get(k) else 'no' if gate[sha].get(k) is False else '?'}"
            for k in GATE_COMMITS
        )
        lines.append(f"\n{sha[:10]}  runs={shas[sha]}  {marks}")
        for population in ("router", "subagent"):
            ds = [d for d in s.decisions if d.sha == sha and d.population == population]
            if ds:
                lines.append(f" {population}:")
                lines += unit_table(ds)
    return "\n".join(lines)


def run_shas(paths: list[Path]) -> dict[str, int]:
    shas: Counter = Counter()
    for p in paths:
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        shas[str(doc.get("git_sha") or "unknown")] += 1
    return dict(shas)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="How often project_context's nextStep names the unit run next, over committed e2e runs (issue #3523).",
    )
    parser.add_argument("--test", default=None, help="Only this fixture slug.")
    add_since_arg(parser)
    args = parser.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        where = f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        print(f"No committed runs found{where}.", file=sys.stderr)
        print(branch_scope_note(), file=sys.stderr)
        return 1

    shas = run_shas(paths)
    gate = {sha: {k: contains_commit(sha, c) for k, c in GATE_COMMITS.items()} for sha in shas}
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(format_report(scan(paths), shas, gate))
    return 0


if __name__ == "__main__":
    sys.exit(main())
