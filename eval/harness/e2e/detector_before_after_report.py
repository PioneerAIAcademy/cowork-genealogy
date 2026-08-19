"""Before/after replay of a detector correction over committed e2e runs.

Issue #1569: both parts of that issue corrected a detector in
`harness/skill_invocation.py` with no existing corpus instrument to measure the
change against. Rather than build one throwaway script per fix, this module is
reusable: for a named `--detector`, it runs a locally-defined "old" (pre-fix)
replica and the real, current "new" implementation over every applicable
committed run, and reports every run where the two disagree. The same shape
applies to any future detector correction.

This module adds NO instrumentation to a run (same posture as
`guardrail_shadow_report.py` / `latency_report.py`); it's pure analysis over
already-committed data.

CLI (from eval/harness/):
  uv run python -m e2e.detector_before_after_report --detector lane-check
  uv run python -m e2e.detector_before_after_report --detector proof-conclusion-arm
  uv run python -m e2e.detector_before_after_report --detector person-evidence-arm
  uv run python -m e2e.detector_before_after_report --detector lane-check --test bagley-father-1884
  uv run python -m e2e.detector_before_after_report --detector proof-conclusion-arm --since all
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from e2e.runlog_selection import (
    add_since_arg,
    all_result_jsons,
    describe_window,
    filter_since,
    result_jsons_for,
)
from harness.context_policy import bare_tool_name
from harness.skill_invocation import (
    DEDICATED_AGENT_NAMES,
    find_effects_without_invocation,
    find_protected_writes_by_unnamed_delegate,
    owning_skills,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
E2E_FIXTURES = REPO_ROOT / "eval" / "tests" / "e2e"


@dataclass
class Divergence:
    run_file: str
    fixture: str
    old_result: Any
    new_result: Any
    note: str = ""


# --- lane-check: find_protected_writes_by_unnamed_delegate (issue #1569 Part 1) ----


def _lane_check_old(tool_calls: list[dict[str, Any]]) -> list[str]:
    """Pre-fix replica: skips any entry with `is_error: true`. Kept local rather
    than imported — the real function no longer has this bug to import."""
    violations: list[str] = []
    for i, entry in enumerate(tool_calls):
        if entry.get("is_error") is True:
            continue
        tool = entry.get("tool", "")
        args = entry.get("args") or {}
        agent_id = entry.get("agent_id")
        agent_type = entry.get("agent_type")

        if bare_tool_name(tool) == "extraction_append":
            if agent_id is None or agent_type == "record-extractor":
                continue
            violations.append(f"tool_calls[{i}] extraction_append by {agent_type!r}")
            continue

        owners = owning_skills(tool, args)
        if not owners or agent_id is None or agent_type in DEDICATED_AGENT_NAMES:
            continue
        for owner in owners:
            violations.append(f"tool_calls[{i}] {tool} owned by {owner!r}, made by {agent_type!r}")
    return violations


def _lane_check_new(tool_calls: list[dict[str, Any]]) -> list[str]:
    return find_protected_writes_by_unnamed_delegate(tool_calls)


def _lane_check_stamped(tool_calls: list[dict[str, Any]]) -> bool:
    """How much of the corpus can speak to this detector at all, independent of the
    result: most committed runs predate agent-id stamping, so "no divergence" on its
    own reads as "the fix is a no-op" when it is really "the corpus can't show it
    yet"."""
    return any(e.get("agent_id") is not None for e in tool_calls)


def _lane_check_eligible(tool_calls: list[dict[str, Any]]) -> bool:
    """Whether this run COULD show the lane-check divergence at all: an entry that is
    BOTH `is_error: true` and a write this detector flags. Carrying an `agent_id` is
    necessary but not sufficient (an earlier version of this predicate stopped at
    that alone) — a non-owned tool or a call from a dedicated agent exits on the
    classification instead and can never diverge on `is_error`, so the looser test
    overstated how much the corpus proved (found by review — the review's own
    follow-up, self-correcting an earlier suggestion)."""
    return any(e.get("is_error") is True and _lane_check_new([e]) for e in tool_calls)


def _replay_lane_check(paths: list[Path]) -> tuple[list[Divergence], int, int]:
    out: list[Divergence] = []
    eligible = 0
    stamped = 0
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        tool_calls = data.get("tool_calls") or []
        if _lane_check_stamped(tool_calls):
            stamped += 1
        if _lane_check_eligible(tool_calls):
            eligible += 1
        old = _lane_check_old(tool_calls)
        new = _lane_check_new(tool_calls)
        if len(old) != len(new):
            out.append(
                Divergence(
                    run_file=str(path.relative_to(REPO_ROOT)),
                    fixture=path.parent.name,
                    old_result=len(old),
                    new_result=len(new),
                    note=f"{len(new) - len(old):+d} violation(s)",
                )
            )
    return out, eligible, stamped


# --- proof-conclusion-arm: find_effects_without_invocation's relationship/primary-
# --- fact checks (issue #1569 Part 2, was #1368) -----------------------------------


def _relationship_key_old(r: dict[str, Any]) -> tuple[Any, ...]:
    return (r.get("type"), r.get("person1"), r.get("person2"), r.get("parent"), r.get("child"))


def _proof_conclusion_arm_old(tree: dict[str, Any], starting_tree: dict[str, Any] | None) -> bool:
    """Pre-fix replica: endpoint-only relationship key, count-based primary fact.
    Returns whether the arm's relationship/primary-fact disjunct would have fired
    (proof_summaries is unaffected by this fix, so it's excluded here on purpose —
    a run with a written proof_summary fires under both old and new alike, which
    would mask the actual divergence this replay exists to find)."""
    persons = tree.get("persons") if isinstance(tree.get("persons"), list) else []
    relationships = tree.get("relationships") if isinstance(tree.get("relationships"), list) else []
    starting_persons = (
        (starting_tree or {}).get("persons") if isinstance((starting_tree or {}).get("persons"), list) else []
    )
    starting_primary_counts = {
        p.get("id"): sum(1 for f in (p.get("facts") or []) if isinstance(f, dict) and f.get("primary") is True)
        for p in starting_persons
        if isinstance(p, dict)
    }
    starting_relationship_keys = {
        _relationship_key_old(r)
        for r in ((starting_tree or {}).get("relationships") or [])
        if isinstance(r, dict) and r.get("type") in ("ParentChild", "Couple")
    }

    def _has_new_primary_fact(p: dict[str, Any]) -> bool:
        count = sum(1 for f in (p.get("facts") or []) if isinstance(f, dict) and f.get("primary") is True)
        baseline = 0 if starting_tree is None else starting_primary_counts.get(p.get("id"), 0)
        return count > baseline

    has_primary_fact = any(isinstance(p, dict) and _has_new_primary_fact(p) for p in persons)
    has_conclusion_relationship = any(
        isinstance(r, dict)
        and r.get("type") in ("ParentChild", "Couple")
        and (starting_tree is None or _relationship_key_old(r) not in starting_relationship_keys)
        for r in relationships
    )
    return has_primary_fact or has_conclusion_relationship


def _proof_conclusion_arm_new(tree: dict[str, Any], starting_tree: dict[str, Any] | None) -> bool:
    """Real, current detector — isolate the relationship/primary-fact disjunct by
    running with an empty tool_calls/research so the only way "proof-conclusion"
    can appear in the violations is via that disjunct (proof_summaries is absent,
    person-evidence/conflict-resolution arms need research fields not passed here)."""
    violations = find_effects_without_invocation([], {}, tree, starting_tree=starting_tree)
    return any("proof-conclusion" in v for v in violations)


def _fixture_starting_tree(fixture_slug: str) -> dict[str, Any] | None:
    path = E2E_FIXTURES / fixture_slug / "starting-tree.gedcomx.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _replay_proof_conclusion_arm(paths: list[Path]) -> tuple[list[Divergence], int]:
    """Returns (divergences, n_skipped_no_fixture_starting_tree)."""
    out: list[Divergence] = []
    skipped = 0
    for path in paths:
        final_tree_path = path.with_name(path.name.replace(".json", ".final-tree.gedcomx.json"))
        if not final_tree_path.is_file():
            continue  # this run produced no final tree at all -- not this detector's input
        starting_tree = _fixture_starting_tree(path.parent.name)
        if starting_tree is None:
            skipped += 1
            continue
        final_tree = json.loads(final_tree_path.read_text(encoding="utf-8"))
        old = _proof_conclusion_arm_old(final_tree, starting_tree)
        new = _proof_conclusion_arm_new(final_tree, starting_tree)
        if old != new:
            out.append(
                Divergence(
                    run_file=str(path.relative_to(REPO_ROOT)),
                    fixture=path.parent.name,
                    old_result=old,
                    new_result=new,
                    note="now fires" if new else "no longer fires",
                )
            )
    return out, skipped


# --- person-evidence-arm: find_effects_without_invocation's "did new content
# --- appear" check (issue #1569 follow-on, found by review) ------------------


def _person_evidence_arm_old(
    tree: dict[str, Any], starting_tree: dict[str, Any] | None, research: dict[str, Any]
) -> bool:
    """Pre-fix replica: count-based `_is_new_content_this_run`."""
    persons = tree.get("persons") if isinstance(tree.get("persons"), list) else []
    starting_persons = (
        (starting_tree or {}).get("persons") if isinstance((starting_tree or {}).get("persons"), list) else []
    )
    starting_ids = {p.get("id") for p in starting_persons if isinstance(p, dict)}
    starting_fact_counts = {p.get("id"): len(p.get("facts") or []) for p in starting_persons if isinstance(p, dict)}
    person_evidence = research.get("person_evidence") if isinstance(research.get("person_evidence"), list) else []
    linked_person_ids = {pe.get("person_id") for pe in person_evidence if isinstance(pe, dict)}

    def _has_content(p: dict[str, Any]) -> bool:
        return bool(p.get("facts") or p.get("names"))

    def _is_new_content_this_run(p: dict[str, Any]) -> bool:
        if starting_tree is None:
            return True
        pid = p.get("id")
        if pid not in starting_ids:
            return True
        return len(p.get("facts") or []) > starting_fact_counts.get(pid, 0)

    return any(
        isinstance(p, dict) and _has_content(p) and _is_new_content_this_run(p) and p.get("id") not in linked_person_ids
        for p in persons
    )


def _person_evidence_arm_new(
    tree: dict[str, Any], starting_tree: dict[str, Any] | None, research: dict[str, Any]
) -> bool:
    """Real, current detector — isolate the person-evidence disjunct with empty
    tool_calls (so "person-evidence" is never in invoked) and a tree-only
    research dict carrying just person_evidence, so no other arm can contribute
    a violation string containing "person-evidence"."""
    person_evidence = research.get("person_evidence") if isinstance(research.get("person_evidence"), list) else []
    violations = find_effects_without_invocation(
        [], {"person_evidence": person_evidence}, tree, starting_tree=starting_tree
    )
    return any("person-evidence" in v for v in violations)


def _replay_person_evidence_arm(paths: list[Path]) -> tuple[list[Divergence], int]:
    """Returns (divergences, n_skipped_no_fixture_starting_tree)."""
    out: list[Divergence] = []
    skipped = 0
    for path in paths:
        final_tree_path = path.with_name(path.name.replace(".json", ".final-tree.gedcomx.json"))
        final_research_path = path.with_name(path.name.replace(".json", ".final-research.json"))
        if not final_tree_path.is_file() or not final_research_path.is_file():
            continue  # this run produced no final tree/research at all -- not this detector's input
        starting_tree = _fixture_starting_tree(path.parent.name)
        if starting_tree is None:
            skipped += 1
            continue
        final_tree = json.loads(final_tree_path.read_text(encoding="utf-8"))
        final_research = json.loads(final_research_path.read_text(encoding="utf-8"))
        old = _person_evidence_arm_old(final_tree, starting_tree, final_research)
        new = _person_evidence_arm_new(final_tree, starting_tree, final_research)
        if old != new:
            out.append(
                Divergence(
                    run_file=str(path.relative_to(REPO_ROOT)),
                    fixture=path.parent.name,
                    old_result=old,
                    new_result=new,
                    note="now fires" if new else "no longer fires",
                )
            )
    return out, skipped


DETECTORS: dict[str, Callable[[list[Path]], Any]] = {
    "lane-check": _replay_lane_check,
    "person-evidence-arm": _replay_person_evidence_arm,
    "proof-conclusion-arm": _replay_proof_conclusion_arm,
}


def format_divergences(name: str, divergences: list[Divergence]) -> str:
    if not divergences:
        return f"\n{name}: no divergence — old and new agree on every run scanned."
    lines = [f"\n{name}: {len(divergences)} run(s) where old and new disagree:"]
    for d in divergences:
        lines.append(f"  {d.fixture:<35} {d.run_file}: old={d.old_result} new={d.new_result} ({d.note})")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Replay a detector correction (old vs new) over committed e2e runs."
    )
    ap.add_argument("--detector", required=True, choices=sorted(DETECTORS), help="which detector correction to replay")
    ap.add_argument("--test", help="scan only this fixture slug")
    add_since_arg(ap)
    args = ap.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    paths = filter_since(all_paths, args.since)
    if not paths:
        print("No committed runs found.", file=sys.stderr)
        return 1

    print(describe_window(args.since, n_runs=len(paths), n_total=len(all_paths)))

    # Explicit per-detector branches, not a DETECTORS[args.detector](paths) dispatch:
    # each detector's replay has a different "how much of the corpus could even show
    # this" caveat to print (an eligible count, a skipped count, or none), so this
    # stays hand-wired. The final `else: raise` is load-bearing, not defensive
    # boilerplate -- a 4th detector added to DETECTORS without a matching branch here
    # would otherwise fall through to lane-check's replay while printing the NEW
    # detector's name on the header: a silently wrong report, not a crash (found by
    # review).
    if args.detector == "proof-conclusion-arm":
        divergences, skipped = _replay_proof_conclusion_arm(paths)
        if skipped:
            print(f"Skipped {skipped} run(s): no matching fixture starting-tree.gedcomx.json.")
        print(format_divergences(args.detector, divergences))
    elif args.detector == "person-evidence-arm":
        divergences, skipped = _replay_person_evidence_arm(paths)
        if skipped:
            print(f"Skipped {skipped} run(s): no matching fixture starting-tree.gedcomx.json.")
        print(format_divergences(args.detector, divergences))
    elif args.detector == "lane-check":
        divergences, eligible, stamped = _replay_lane_check(paths)
        print(
            f"{stamped} of {len(paths)} run(s) carry agent-id stamping at all; {eligible} of those "
            "could express this divergence (an errored call this detector flags)."
        )
        print(format_divergences(args.detector, divergences))
    else:
        raise AssertionError(f"unhandled detector {args.detector!r} -- add a branch above, not just a DETECTORS entry")
    return 0


if __name__ == "__main__":
    sys.exit(main())
