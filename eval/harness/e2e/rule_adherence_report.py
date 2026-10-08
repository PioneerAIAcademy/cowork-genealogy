"""Per-instruction adherence over committed e2e runs.

GitHub issue #2483.  A free, post-hoc instrument: for each registered rule
(an instruction in a shipped agent or skill body), how many *episodes* —
occasions the instruction applied — obeyed it?  It costs nothing (reads
committed files, no model, no network) and catches a class the existing
``make e2e-agent-tools`` set-membership check cannot: a tool called at
half the required rate reads as ``used``; this reports the actual count
beside its denominator.

Each rule names:

- ``id`` — a unique slug
- ``file`` — the shipped body containing the instruction (repo-relative)
- ``instruction`` — verbatim text that must appear in ``file`` today
- ``introduced`` — the commit SHA that added the instruction
- an *episode* predicate (which captures / calls the rule applies to)
- an *obeyed* predicate (whether the episode followed the instruction)
- optional *observable_tool* / *observable_pattern* (see the three checks below)

Rule presence is part of the episode predicate: a run made before the
instruction existed is not an episode and leaves the denominator.
Attribution is via ``git_sha`` (ancestry) when present, else the
run-filename timestamp against the introduced commit's committer date.
The report prints how many episodes were dated each way.

The report prints **counts with their denominators, never a rate, and does
not gate on them** — per ``docs/architecture.md`` §9.4 gap 3.

**Limitation (issue #3045):** the e2e log drops tool calls made by a
background subagent, so obeyed counts here are a floor — a call that
happened but was not captured cannot raise the count.  Committed runs
are converged states (failed runs are re-run), so every count is a floor
rather than an estimate.

CLI (from eval/harness/):
  uv run python -m e2e.rule_adherence_report                    # last 14 days
  uv run python -m e2e.rule_adherence_report --since all        # whole corpus
  uv run python -m e2e.rule_adherence_report --rule <id>
  uv run python -m e2e.rule_adherence_report --test <slug>
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, NamedTuple

from e2e.agent_tool_usage_report import bare_tool_name, tools_from_capture
from e2e.runlog_selection import (
    REPO_ROOT,
    add_since_arg,
    all_result_jsons,
    branch_scope_note,
    describe_window,
    filter_since,
    result_jsons_for,
    run_date,
)


# ---------------------------------------------------------------------------
# Rule dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AdherenceRule:
    """One registered instruction whose adherence is measured."""

    id: str
    file: str  # repo-relative path to shipped body
    instruction: str  # verbatim text, checked against file on disk
    introduced: str  # commit SHA that added the instruction
    agent: str  # agent_type the rule applies to
    enumerate_episodes: Callable[[dict], list[dict]]
    is_obeyed: Callable[[dict, dict], bool]
    observable_tool: str | None = None
    observable_pattern: str | None = None


# ---------------------------------------------------------------------------
# Shared constants — used in both predicates and RULES so a typo in one
# cannot silently diverge from the other (review comment #3).
# ---------------------------------------------------------------------------

_GPS_MENTOR = "gps-mentor"
_PROJECT_CONTEXT = "project_context"
_RESEARCH_JSON = "research.json"


# ---------------------------------------------------------------------------
# Episode + obeyed helpers for the two seed rules
# ---------------------------------------------------------------------------


def _gps_mentor_tool_using_captures(run_data: dict) -> list[dict]:
    """Episodes for rule 1: gps-mentor subagent captures with >= 1 tool call."""
    episodes: list[dict] = []
    for sub in run_data.get("subagents") or []:
        if not isinstance(sub, dict):
            continue
        if sub.get("agent_type") != _GPS_MENTOR:
            continue
        called = tools_from_capture(sub)
        if called:
            episodes.append(sub)
    return episodes


def _capture_called_project_context(episode: dict, run_data: dict) -> bool:
    """Obeyed for rule 1: capture called ``project_context`` (any spelling).

    Checks BOTH the capture's own ``tool_use:`` blocks and the run's
    ``tool_calls[]`` entries attributed to ``gps-mentor``.  The two data
    sources record the same call in different shapes — ``tool_use:project_context``
    in the capture blocks, ``mcp__genealogy__project_context`` in tool_calls —
    and a reader matching one but not the other scores a legitimate run as a
    violation.  Uses ``bare_tool_name`` so the ``mcp__remote-devices__…``
    spelling needs no special case.
    """
    # Source 1: capture blocks
    called = tools_from_capture(episode)
    if _PROJECT_CONTEXT in called:
        return True
    # Source 2: tool_calls attribution
    for tc in run_data.get("tool_calls") or []:
        if not isinstance(tc, dict):
            continue
        if tc.get("agent_type") != _GPS_MENTOR:
            continue
        if bare_tool_name(tc.get("tool") or tc.get("name") or "") == _PROJECT_CONTEXT:
            return True
    return False


def _gps_mentor_read_calls(run_data: dict) -> list[dict]:
    """Episodes for rule 2: Read calls in tool_calls[] attributed to gps-mentor."""
    episodes: list[dict] = []
    for tc in run_data.get("tool_calls") or []:
        if not isinstance(tc, dict):
            continue
        if tc.get("agent_type") != _GPS_MENTOR:
            continue
        tool = bare_tool_name(tc.get("tool") or tc.get("name") or "")
        if tool == "Read":
            episodes.append(tc)
    return episodes


def _read_does_not_open_research_json(episode: dict, _run_data: dict) -> bool:
    """Obeyed for rule 2: args do not name ``research.json``."""
    args = episode.get("args") or {}
    return _RESEARCH_JSON not in json.dumps(args)


# ---------------------------------------------------------------------------
# Rule registry — the two seed rules
# ---------------------------------------------------------------------------

RULES: list[AdherenceRule] = [
    AdherenceRule(
        id="gps-mentor-opens-with-project-context",
        file="packages/engine/plugin/agents/gps-mentor.md",
        instruction="Open every invocation with:",
        introduced="09c8195d3",
        agent=_GPS_MENTOR,
        enumerate_episodes=_gps_mentor_tool_using_captures,
        is_obeyed=_capture_called_project_context,
        observable_tool=_PROJECT_CONTEXT,
    ),
    AdherenceRule(
        id="gps-mentor-no-research-json-read",
        file="packages/engine/plugin/agents/gps-mentor.md",
        instruction="**Do not open `research.json`.**",
        introduced="09c8195d3",
        agent=_GPS_MENTOR,
        enumerate_episodes=_gps_mentor_read_calls,
        is_obeyed=_read_does_not_open_research_json,
        observable_pattern=_RESEARCH_JSON,
    ),
]


# ---------------------------------------------------------------------------
# Post-rule dating: git ancestry + filename-date fallback
# ---------------------------------------------------------------------------

_introduced_date_cache: dict[str, date | None] = {}


def _introduced_date(sha: str) -> date | None:
    """Committer date of the ``introduced`` commit, cached.

    Returns ``None`` when git is unavailable or the commit is unknown locally
    (e.g. a shallow clone).
    """
    if sha in _introduced_date_cache:
        return _introduced_date_cache[sha]
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%ci", sha],
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=str(REPO_ROOT),
        )
        if result.returncode != 0:
            _introduced_date_cache[sha] = None
            return None
        # Output: "2026-07-31 15:59:11 -0600\n"
        dt = datetime.strptime(result.stdout.strip()[:10], "%Y-%m-%d").date()
        _introduced_date_cache[sha] = dt
        return dt
    except (OSError, ValueError):
        _introduced_date_cache[sha] = None
        return None


def _is_ancestor(ancestor: str, descendant: str) -> bool | None:
    """True if ``ancestor`` is an ancestor of ``descendant``.

    Returns ``None`` on any git failure (commit unknown, not a repo, etc.).
    """
    try:
        result = subprocess.run(
            ["git", "merge-base", "--is-ancestor", ancestor, descendant],
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=str(REPO_ROOT),
        )
        if result.returncode == 0:
            return True
        if result.returncode == 1:
            return False
        return None  # exit 128 or other error
    except OSError:
        return None


def is_post_rule(
    rule: AdherenceRule, run_data: dict, run_path: Path
) -> tuple[bool, str]:
    """Whether a run was made after the rule's instruction existed.

    Returns ``(is_post, method)`` where method is ``"git_sha"``,
    ``"filename_date"``, or ``"unknown"``.
    """
    # Prefer git_sha ancestry when available
    git_sha = run_data.get("git_sha")
    if git_sha:
        result = _is_ancestor(rule.introduced, git_sha)
        if result is not None:
            return (result, "git_sha")
    # Fall back to filename date vs introduced commit date
    rd = run_date(run_path)
    intro_d = _introduced_date(rule.introduced)
    if rd is not None and intro_d is not None:
        return (rd > intro_d, "filename_date")
    # Neither method worked — conservatively exclude
    return (False, "unknown")


# ---------------------------------------------------------------------------
# Scan results
# ---------------------------------------------------------------------------


class RuleResult(NamedTuple):
    """Counts for one rule over the scanned corpus."""

    rule_id: str
    episodes: int
    obeyed: int
    not_obeyed: int
    dated_by_sha: int
    dated_by_filename: int
    dated_unknown: int
    pre_rule_excluded: int
    has_observable_tool: bool  # did the observable_tool appear?
    has_observable_pattern: bool  # did the observable_pattern appear?


# ---------------------------------------------------------------------------
# Stale-rule check
# ---------------------------------------------------------------------------


def check_stale_rules(rules: list[AdherenceRule]) -> list[str]:
    """Return error messages for rules whose instruction is not in the file."""
    errors: list[str] = []
    for rule in rules:
        path = REPO_ROOT / rule.file
        if not path.exists():
            errors.append(
                f"stale rule: {rule.id} — file not found: {rule.file}"
            )
            continue
        text = path.read_text(encoding="utf-8")
        if rule.instruction not in text:
            errors.append(
                f"stale rule: {rule.id} — instruction not found in {rule.file}"
            )
    return errors


# ---------------------------------------------------------------------------
# Corpus scan
# ---------------------------------------------------------------------------


def scan_rules(
    paths: list[Path], rules: list[AdherenceRule]
) -> tuple[list[RuleResult], list[str]]:
    """Scan the corpus and evaluate each rule.

    Returns ``(results, problems)`` — one ``RuleResult`` per rule, plus a
    list of per-file error messages for unreadable runs.
    """
    problems: list[str] = []

    # Per-rule accumulators
    n_rules = len(rules)
    episodes_count = [0] * n_rules
    obeyed_count = [0] * n_rules
    dated_sha = [0] * n_rules
    dated_filename = [0] * n_rules
    dated_unknown = [0] * n_rules
    pre_rule_excluded = [0] * n_rules

    # For the observable_tool check: collect all bare tool names in the corpus
    all_tools_in_corpus: set[str] = set()
    # For the observable_pattern check: per-rule, track if pattern appeared
    pattern_seen = [False] * n_rules

    for path in paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
            problems.append(f"{path}: {e}")
            continue

        # Collect all tools in this run for the observable_tool check
        for sub in data.get("subagents") or []:
            if isinstance(sub, dict):
                all_tools_in_corpus.update(tools_from_capture(sub))
        for tc in data.get("tool_calls") or []:
            if isinstance(tc, dict):
                name = bare_tool_name(tc.get("tool") or tc.get("name") or "")
                if name:
                    all_tools_in_corpus.add(name)

        for i, rule in enumerate(rules):
            post, method = is_post_rule(rule, data, path)
            if not post:
                pre_rule_excluded[i] += 1
                continue

            rule_episodes = rule.enumerate_episodes(data)

            if method == "git_sha":
                dated_sha[i] += len(rule_episodes)
            elif method == "filename_date":
                dated_filename[i] += len(rule_episodes)
            else:
                dated_unknown[i] += len(rule_episodes)
            episodes_count[i] += len(rule_episodes)
            for ep in rule_episodes:
                if rule.is_obeyed(ep, data):
                    obeyed_count[i] += 1
                # Check observable_pattern: does the pattern appear in any
                # episode's args?
                if rule.observable_pattern and not pattern_seen[i]:
                    args = ep.get("args") or {}
                    if rule.observable_pattern in json.dumps(args):
                        pattern_seen[i] = True

    results: list[RuleResult] = []
    for i, rule in enumerate(rules):
        has_tool = (
            rule.observable_tool in all_tools_in_corpus
            if rule.observable_tool
            else True
        )
        has_pattern = pattern_seen[i] if rule.observable_pattern else True
        results.append(
            RuleResult(
                rule_id=rule.id,
                episodes=episodes_count[i],
                obeyed=obeyed_count[i],
                not_obeyed=episodes_count[i] - obeyed_count[i],
                dated_by_sha=dated_sha[i],
                dated_by_filename=dated_filename[i],
                dated_unknown=dated_unknown[i],
                pre_rule_excluded=pre_rule_excluded[i],
                has_observable_tool=has_tool,
                has_observable_pattern=has_pattern,
            )
        )
    return results, problems


# ---------------------------------------------------------------------------
# Post-scan checks
# ---------------------------------------------------------------------------


def check_results(
    rules: list[AdherenceRule], results: list[RuleResult]
) -> list[str]:
    """Return error messages for unobservable or zero-denominator rules."""
    errors: list[str] = []
    for rule, r in zip(rules, results):
        if not r.has_observable_tool:
            errors.append(
                f"rule unobservable: {rule.id} — tool `{rule.observable_tool}` "
                f"appears nowhere in the corpus"
            )
        if not r.has_observable_pattern:
            errors.append(
                f"rule unobservable: {rule.id} — pattern `{rule.observable_pattern}` "
                f"appears in no episode's args"
            )
        if r.episodes == 0:
            errors.append(
                f"rule {rule.id} has zero episodes — check agent name and "
                f"introduced commit"
            )
    return errors


# ---------------------------------------------------------------------------
# Report formatting
# ---------------------------------------------------------------------------


def format_report(
    rules: list[AdherenceRule], results: list[RuleResult]
) -> str:
    lines: list[str] = []
    for rule, r in zip(rules, results):
        lines.append(f"Rule: {rule.id}")
        lines.append(f"  file: {rule.file}")
        lines.append(f'  instruction: "{rule.instruction}"')
        dating_parts = []
        if r.dated_by_sha:
            dating_parts.append(f"dated by git_sha: {r.dated_by_sha}")
        if r.dated_by_filename:
            dating_parts.append(f"by filename: {r.dated_by_filename}")
        if r.dated_unknown:
            dating_parts.append(f"undated: {r.dated_unknown}")
        dating_str = f"  ({', '.join(dating_parts)})" if dating_parts else ""
        lines.append(f"  episodes: {r.episodes}{dating_str}")
        lines.append(f"    obeyed: {r.obeyed} of {r.episodes}")
        lines.append(f"    not obeyed: {r.not_obeyed} of {r.episodes}")
        lines.append(f"  pre-rule runs excluded: {r.pre_rule_excluded}")
        lines.append("")
    lines.extend([
        "Limits (this is a report, not a gate):",
        "  - Counts, not rates. Do not gate on these numbers (§9.4 gap 3).",
        "  - Obeyed counts are a floor: the e2e log drops tool calls made by a",
        "    background subagent (issue #3045), and committed runs are converged",
        "    states (re-runs replace failures), so every count here is a minimum.",
        "  - A date is a weaker signal than a SHA, because a branch run can",
        "    postdate a merge without containing it. The two are never folded.",
        "  - Corpus scans age; this windows to 14 days by default (SINCE=all",
        "    to opt out).",
    ])
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(
        description=(
            "Per-instruction adherence over committed e2e runs (issue #2483)."
        )
    )
    ap.add_argument("--rule", help="restrict to one rule by id")
    ap.add_argument("--test", help="restrict to one fixture slug")
    add_since_arg(ap)
    args = ap.parse_args(argv)

    # Select rules
    selected = list(RULES)
    if args.rule:
        selected = [r for r in RULES if r.id == args.rule]
        if not selected:
            known = ", ".join(r.id for r in RULES)
            print(
                f"Unknown rule: {args.rule!r}. Known rules: {known}",
                file=sys.stderr,
            )
            return 1

    # Check staleness before spending time on the corpus
    stale_errors = check_stale_rules(selected)
    if stale_errors:
        for msg in stale_errors:
            print(msg, file=sys.stderr)
        return 1

    # Load and window the corpus
    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        where = f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        print(f"No committed runs found{where}.", file=sys.stderr)
        print(branch_scope_note(), file=sys.stderr)
        return 1

    # Scan
    results, problems = scan_rules(paths, selected)
    for problem in problems:
        print(f"  skip {problem}", file=sys.stderr)

    # Post-scan checks — run safety checks against the whole corpus so a
    # rule with zero episodes in the window (because it is being obeyed)
    # does not exit non-zero (review comment #2).
    result_errors = check_results(selected, scan_rules(all_result_jsons(), selected)[0])
    if result_errors:
        # Print the report first so the numbers are visible alongside the error
        print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
        print(format_report(selected, results))
        print()
        for msg in result_errors:
            print(msg, file=sys.stderr)
        return 1

    # Success — print report
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(format_report(selected, results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
