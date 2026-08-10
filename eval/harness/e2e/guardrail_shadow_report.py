"""Replay of the §7 shadow-mode recency window over committed e2e runs.

docs/specs/guardrail-enforcement-spec.md §7. Every committed e2e runlog persists
its full `tool_calls` list, so
`harness.skill_invocation.find_unguarded_protected_writes` can be replayed
against the whole historical corpus for free — no new API spend.

**This is no longer a calibration tool, and `GUARDRAIL_SHADOW_WINDOW` is not a
knob waiting to be tuned.** §7 is shadow-only permanently: its success gate reads
`Skill` entries, which carry launch acknowledgements, and no instrument available
to the harness observes skill *completion* (spec §7, "What the success gate can
and cannot see"; `e2e/skill_episode_report.py` is the measurement). The window
barely changes the count from 10 to 150, which was the early tell. What this
report is still for: reading the shadow signal as measurement, and the §8/§7.5
stored families below, whose graduations are live questions.

This module adds NO instrumentation to a run (same posture as
`latency_report.py`); it's pure analysis over already-committed data.

CLI (from eval/harness/):
  uv run python -m e2e.guardrail_shadow_report
  uv run python -m e2e.guardrail_shadow_report --windows 10,20,40,80,150
  uv run python -m e2e.guardrail_shadow_report --windows 40 --detail
  uv run python -m e2e.guardrail_shadow_report --test bagley-father-1884
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from e2e.runlog_selection import (
    add_since_arg,
    all_result_jsons,
    describe_window,
    filter_since,
    is_result_json as _is_result_json,
    result_jsons_for,
)
from harness.skill_invocation import (
    CITATION_NULLING_KIND,
    CONFLICT_UNPERSISTED_KIND,
    find_unguarded_protected_writes,
    PERSON_EVIDENCE_DENY_KIND,
    same_person_scored_ids,
    unguarded_new_person_evidence_links,
)

REPO_ROOT = Path(__file__).resolve().parents[3]

DEFAULT_WINDOWS = (10, 20, 40, 80, 150)

# Committed fixture inputs, for --replay's seed trees. Defined locally rather
# than imported from `e2e.orchestrator` (which owns the canonical
# DEFAULT_FIXTURES_ROOT) so this analysis-only module keeps its "no Claude Agent
# SDK import" posture — the same reason `validate_fixture.py` defines its own.
E2E_FIXTURES = REPO_ROOT / "eval" / "tests" / "e2e"


def scan_one(path: Path, *, window: int) -> list[dict[str, Any]]:
    """Violations `find_unguarded_protected_writes` reports for one committed
    run at a given window size. Each violation is enriched with the source
    file so a multi-run aggregate stays traceable back to a transcript."""
    data = json.loads(path.read_text(encoding="utf-8"))
    tool_calls = data.get("tool_calls") or []
    violations = find_unguarded_protected_writes(tool_calls, window=window)
    try:
        display_path = str(path.relative_to(REPO_ROOT))
    except ValueError:
        display_path = str(path)  # outside REPO_ROOT (e.g. ad hoc/test usage) -- show absolute
    for v in violations:
        v["file"] = display_path
        v["fixture"] = path.parent.name
    return violations


def scan_corpus(paths: list[Path], *, windows: list[int]) -> dict[int, list[dict[str, Any]]]:
    """Violations per window size, across every path given."""
    by_window: dict[int, list[dict[str, Any]]] = {w: [] for w in windows}
    for path in paths:
        try:
            for w in windows:
                by_window[w].extend(scan_one(path, window=w))
        except (json.JSONDecodeError, OSError) as e:
            print(f"  skip {path}: {e}", file=sys.stderr)
    return by_window


def format_summary(by_window: dict[int, list[dict[str, Any]]], *, n_runs: int) -> str:
    lines = [f"Scanned {n_runs} committed run(s).", ""]
    lines.append(f"{'window':>8}  {'violations':>10}  {'runs affected':>14}  by-skill breakdown")
    for w in sorted(by_window):
        violations = by_window[w]
        affected = len({v["file"] for v in violations})
        by_skill: dict[str, int] = {}
        for v in violations:
            by_skill[v["required_skill"]] = by_skill.get(v["required_skill"], 0) + 1
        skill_str = ", ".join(f"{k}={v}" for k, v in sorted(by_skill.items()))
        lines.append(f"{w:>8}  {len(violations):>10}  {affected:>14}  {skill_str or '(none)'}")
    return "\n".join(lines)


def format_detail(violations: list[dict[str, Any]]) -> str:
    lines = []
    for v in violations:
        lines.append(
            f"  {v['fixture']:<35} idx={v['index']:<4} tool={v['tool']:<30} "
            f"needs={v['required_skill']:<24} q={v.get('question_id')}"
        )
    return "\n".join(lines) if lines else "  (none)"


def _scan_stored(
    paths: list[Path], keep: Callable[[dict[str, Any]], bool]
) -> list[dict[str, Any]]:
    """Read STORED shadow entries across a corpus, keeping those `keep` selects,
    each enriched with its source file/fixture.

    Read rather than replayed, unlike the §7 sweep above: that check is a pure
    function of `tool_calls` at a given window, so it can be recomputed for any
    window from a committed log. The stored families are not — the #963
    provenance gap depends on the seed tree and on what the live hook could see;
    the #1133 citation-nulling class is a post-hoc read of the final
    research.json. Both share `guardrail_shadow_violations` and are told apart by
    their keys, so each family passes its own predicate here. Unreadable files
    are skipped with a stderr note, never raised.
    """
    out: list[dict[str, Any]] = []
    for path in paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            print(f"  skip {path}: {e}", file=sys.stderr)
            continue
        for v in data.get("guardrail_shadow_violations") or []:
            if not isinstance(v, dict) or not keep(v):
                continue
            try:
                display_path = str(path.relative_to(REPO_ROOT))
            except ValueError:
                display_path = str(path)
            out.append({**v, "file": display_path, "fixture": path.parent.name})
    return out


def scan_provenance(paths: list[Path]) -> list[dict[str, Any]]:
    """The issue-#963 provenance shadow entries STORED in each run's
    `guardrail_shadow_violations` (a `person_evidence` link written with no
    prior `same_person`). Identified by the `detail` key, which only the stored
    sources set — but EXCLUDING the #1133 citation-nulling class, which also
    carries `detail` and is counted separately by `scan_citation_nulling`.
    """
    return _scan_stored(
        paths,
        lambda v: "detail" in v
        and v.get("kind")
        not in (
            CITATION_NULLING_KIND,
            CONFLICT_UNPERSISTED_KIND,
            PERSON_EVIDENCE_DENY_KIND,
        ),
    )


def scan_citation_nulling(paths: list[Path]) -> list[dict[str, Any]]:
    """The issue-#1133 citation-nulling shadow entries STORED in each run's
    `guardrail_shadow_violations` (a source backing a written conclusion whose
    ESM citation string is empty). Identified by `kind == CITATION_NULLING_KIND`.
    """
    return _scan_stored(paths, lambda v: v.get("kind") == CITATION_NULLING_KIND)


def scan_conflict_unpersisted(paths: list[Path]) -> list[dict[str, Any]]:
    """The issue-#1317 conflict-unpersisted shadow entries STORED in each run's
    `guardrail_shadow_violations` (a written conclusion relying on a resolved
    conflict that no `conflicts[]` entry backs). Identified by
    `kind == CONFLICT_UNPERSISTED_KIND`.
    """
    return _scan_stored(paths, lambda v: v.get("kind") == CONFLICT_UNPERSISTED_KIND)
@dataclass
class ProvenanceReplay:
    """What `replay_provenance` recovers from a corpus of committed runs.

    `runs_linking` is the denominator the fire RATE is read against — runs that
    link any `person_evidence` at all. A run that links nobody cannot produce a
    gap, so counting it would understate the rate.
    """

    violations: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    runs_scanned: int = 0
    runs_linking: int = 0


def _links_any_person_evidence(tool: str, args: dict[str, Any] | None) -> bool:
    """Whether this call appends any `person_evidence` at all.

    Derived from `unguarded_new_person_evidence_links` with both exclusion sets
    empty — with nothing seeded and nothing scored, every linked id is returned —
    rather than re-walking `ops` here. That keeps ONE implementation of the
    op-shape parsing (`{section, op, entry|fields|flat}`), which is the part that
    has historically drifted.
    """
    return bool(unguarded_new_person_evidence_links(tool, args, scored_ids=set(), starting_ids=set()))


def replay_provenance(
    paths: list[Path], *, fixtures_root: Path = E2E_FIXTURES
) -> ProvenanceReplay:
    """Recompute the #963 provenance check from `tool_calls` + each fixture's
    COMMITTED seed tree, instead of reading what a run stored.

    Why this exists (issue #1231). `scan_provenance` can only see runs made after
    #1178 merged, which on today's corpus is none of them — so the 144 committed
    runs are unreadable without a replay. It also lets a candidate rule variant
    be scored against history before it ships, which is what deciding the
    `record_search`-only narrowing needs.

    **This is a LOWER BOUND on what the live hook records.** The hook runs from a
    spawned control-request task while `tool_calls` is appended by the message
    loop, so a `same_person` issued in the same turn as the write may not be
    visible to it yet; the replay always sees the full prefix and therefore
    clears some gaps the hook would have recorded. It is deliberately NOT a lower
    bound in the other direction: slicing `tool_calls[:i]` reproduces the hook's
    "only calls already made" scope, so link-then-score stays a gap here exactly
    as it is there (and a pass for the whole-run post-run detector).

    The `is_error` success gate inside `same_person_scored_ids` is a no-op on
    this corpus — no committed log carries the key — which is harmless rather
    than a silent divergence: `docs/specs/e2e-test-spec.md` measured that none of
    the corpus's error-shaped entries is a `same_person`, `research_append`, or
    `extraction_append`.

    **The corpus is branch-scoped.** This reads `eval/runlogs/e2e/` as it exists
    in the CURRENT checkout, so a graded run committed on an unmerged branch is
    invisible — it is not skipped, it is never seen, and nothing here can say so.
    Two are known: `katalin-horak-son` and `heinrich-dewus-children-death`, both
    on `land-heinrich-dewus-children-fixture`, and the latter is the first run
    ever to store live entries for this check. Read any rate off an up-to-date
    `main` with in-flight fixture PRs merged, or it is biased at exactly the
    moment it is used.

    A run whose fixture has no committed `starting-tree.gedcomx.json` is NAMED in
    `skipped` and excluded from both counts, never silently dropped — with no
    baseline every person reads as new, which would manufacture exactly the
    violations this measures. An unreadable run log is recorded the same way, for
    the same reason: a count that quietly shrank reads as a clean corpus.

    Writes that never landed (`is_error: true`) are skipped, which is what keeps
    a deny-mode run from double-counting — a blocked attempt and its retry are
    one logical gap, not two.
    """
    out = ProvenanceReplay()
    for path in paths:
        slug = path.parent.name
        seed_path = fixtures_root / slug / "starting-tree.gedcomx.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            # Recorded, not just warned. A stderr line vanishes from the printed
            # summary, which then reads as "covered everything" — the same
            # failure the missing-seed-tree branch below avoids.
            print(f"  skip {path}: {e}", file=sys.stderr)
            out.skipped.append(f"{slug}/{path.name}: unreadable run log ({type(e).__name__})")
            continue
        try:
            seed = json.loads(seed_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            out.skipped.append(f"{slug}/{path.name}: no readable {seed_path.name}")
            continue

        persons = seed.get("persons") if isinstance(seed.get("persons"), list) else []
        starting = {p["id"] for p in persons if isinstance(p, dict) and isinstance(p.get("id"), str)}
        tool_calls = data.get("tool_calls") or []

        out.runs_scanned += 1
        try:
            display_path = str(path.relative_to(REPO_ROOT))
        except ValueError:
            display_path = str(path)

        links = False
        for i, entry in enumerate(tool_calls):
            tool = entry.get("tool", "")
            args = entry.get("args") or {}
            # A write that never landed is not a write. A PreToolUse DENY is
            # recorded here with `is_error: true` (e2e-test-spec §8.1.1), so on a
            # deny-mode run the blocked attempt AND the retry would each count —
            # double-counting one logical gap and inflating the fire rate this
            # exists to measure. Ordinary failed writes drop out for the same
            # reason: they linked nobody. Same success-gating
            # `same_person_scored_ids` and `find_unguarded_protected_writes`
            # already apply. No effect on today's corpus, where no committed log
            # carries the key at all — so the baseline does not move.
            if entry.get("is_error") is True:
                continue
            if not _links_any_person_evidence(tool, args):
                continue
            links = True
            unguarded = unguarded_new_person_evidence_links(
                tool,
                args,
                scored_ids=same_person_scored_ids(tool_calls[:i]),
                starting_ids=starting,
            )
            for pid in unguarded:
                out.violations.append(
                    {
                        "index": i,
                        "tool": "research_append",
                        "required_skill": "person-evidence",
                        "question_id": None,
                        "detail": f"person_evidence link for new tree person {pid} with no prior same_person",
                        "file": display_path,
                        "fixture": slug,
                    }
                )
        if links:
            out.runs_linking += 1
    return out


def format_provenance_replay(replay: ProvenanceReplay) -> str:
    """The replayed fire RATE, against the runs that could have produced a gap.

    Prints the denominator rather than a bare count because the graduation
    decision (issue #1231 prereq 1) is a rate judgment — "is a deny a nudge or a
    wall" — and an absolute is unreadable as one.
    """
    affected_runs = len({v["file"] for v in replay.violations})
    affected_fixtures = len({v["fixture"] for v in replay.violations})
    lines = [
        "",
        f"§8 provenance check REPLAYED over {replay.runs_scanned} run(s): "
        f"{affected_runs} of {replay.runs_linking} run(s) that link a person have "
        f"≥1 gap ({len(replay.violations)} link(s), {affected_fixtures} fixture(s)).",
        "  A lower bound: the live hook may not see a same-turn same_person; the replay always does.",
    ]
    if replay.skipped:
        lines.append(f"  Skipped {len(replay.skipped)} run(s) with no committed seed tree:")
        lines.extend(f"    {s}" for s in replay.skipped)
    return "\n".join(lines)


def format_provenance(violations: list[dict[str, Any]]) -> str:
    """One flat count — no window column, because the #963 check has no window
    (`same_person` is a required call, so "was it called for this person" is a
    fact). Runs written before the check shipped simply contribute nothing."""
    affected = len({v["file"] for v in violations})
    lines = [
        "",
        f"§8 live provenance check (issue #963, shadow): {len(violations)} "
        f"person_evidence link(s) with no prior same_person, across {affected} run(s).",
    ]
    return "\n".join(lines)


def format_citation_nulling(violations: list[dict[str, Any]]) -> str:
    """One flat count — no window column, like `format_provenance`: the #1133
    check is a fact about the final research.json, not a windowed recency scan.
    This is the number the graduation decision (shadow → hard §7.5 compliance
    check) is gated on."""
    affected = len({v["file"] for v in violations})
    return (
        "\n§7.5 citation-nulling check (issue #1133, shadow): "
        f"{len(violations)} concluded source(s) with a null/empty citation "
        f"string, across {affected} run(s)."
    )


def format_conflict_unpersisted(violations: list[dict[str, Any]]) -> str:
    """One flat count, like the other post-hoc checks: a fact about the final
    research.json, not a windowed recency scan. This is the number the
    graduation decision (shadow → hard gate) is gated on for issue #1317."""
    affected = len({v["file"] for v in violations})
    return (
        "\nconflict-unpersisted check (issue #1317, shadow): "
        f"{len(violations)} concluded question(s) relying on an unpersisted "
        f"conflict resolution, across {affected} run(s)."
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Replay the §7 shadow window and the stored shadow families over committed e2e runs."
    )
    ap.add_argument("--test", help="scan every committed run for this fixture slug only")
    ap.add_argument(
        "--windows",
        default=",".join(str(w) for w in DEFAULT_WINDOWS),
        help=f"comma-separated window sizes to compare (default: {','.join(str(w) for w in DEFAULT_WINDOWS)})",
    )
    ap.add_argument("--detail", action="store_true", help="also print every violation at the smallest window given")
    ap.add_argument(
        "--replay",
        action="store_true",
        help=(
            "additionally RECOMPUTE the #963 provenance check from tool_calls + each "
            "fixture's committed seed tree, instead of only reading what runs stored. "
            "The stored path sees only runs made after #1178 merged; this reads the "
            "whole historical corpus (issue #1231)."
        ),
    )
    add_since_arg(ap)
    args = ap.parse_args(argv)

    windows = sorted({int(w) for w in args.windows.split(",") if w.strip()})
    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        print("No committed runs found.", file=sys.stderr)
        return 1

    by_window = scan_corpus(paths, windows=windows)
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(format_summary(by_window, n_runs=len(paths)))

    provenance = scan_provenance(paths)
    print(format_provenance(provenance))

    citation_nulling = scan_citation_nulling(paths)
    print(format_citation_nulling(citation_nulling))

    conflict_unpersisted = scan_conflict_unpersisted(paths)
    print(format_conflict_unpersisted(conflict_unpersisted))
    replay = replay_provenance(paths) if args.replay else None
    if replay is not None:
        print(format_provenance_replay(replay))

    if args.detail:
        smallest = min(windows)
        print(f"\nViolations at window={smallest}:")
        print(format_detail(by_window[smallest]))
        print(f"\nProvenance gaps (issue #963), {len(provenance)}:")
        for v in provenance:
            print(f"  {v['fixture']:<35} idx={v['index']:<4} {v['detail']}")
        print(f"\nCitation nulling (issue #1133), {len(citation_nulling)}:")
        for v in citation_nulling:
            print(f"  {v['fixture']:<35} {v['detail']}")
        print(f"\nConflict unpersisted (issue #1317), {len(conflict_unpersisted)}:")
        for v in conflict_unpersisted:
            print(f"  {v['fixture']:<35} {v['detail']}")
        if replay is not None:
            print(f"\nReplayed provenance gaps (issue #1231), {len(replay.violations)}:")
            for v in replay.violations:
                print(f"  {v['fixture']:<35} idx={v['index']:<4} {v['detail']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
