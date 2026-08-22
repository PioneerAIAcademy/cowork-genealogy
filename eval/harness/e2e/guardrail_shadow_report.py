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
post-hoc families below, whose graduations are live questions.

**Stored and replayed are different questions.** Each family is printed twice: a
STORED count, read from what a run wrote into `guardrail_shadow_violations` when
it ran, and — under `--replay` — a REPLAYED count, recomputed now from the run's
committed final state. A stored count reads 0 over every run made before that
check shipped, so on a corpus that is 84% July it measures the corpus's age
rather than the behaviour. Read `--replay` before concluding a check never fires.

This module adds NO instrumentation to a run (same posture as
`latency_report.py`); it's pure analysis over already-committed data.

CLI (from eval/harness/):
  uv run python -m e2e.guardrail_shadow_report
  uv run python -m e2e.guardrail_shadow_report --windows 10,20,40,80,150
  uv run python -m e2e.guardrail_shadow_report --windows 40 --detail
  uv run python -m e2e.guardrail_shadow_report --test bagley-father-1884
  uv run python -m e2e.guardrail_shadow_report --replay --since all
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
    find_citation_nulling_in_conclusions,
    find_relationship_writes_without_warnings_check,
    find_unguarded_protected_writes,
    find_unpersisted_conflict_resolutions,
    PERSON_EVIDENCE_DENY_KIND,
    same_person_scored_ids,
    unguarded_new_person_evidence_links,
    WARNINGS_UNCHECKED_KIND,
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

    This is the STORED read. It reports what a run recorded when it ran, so a
    check reads 0 over every run made before it shipped — on today's corpus that
    is most of it. **It is not evidence that a check never fires**; for that, read
    `replay_post_hoc` (the three post-hoc families) or `replay_provenance` (#963),
    which recompute from committed state.

    This docstring used to say the stored families could not be replayed at all,
    giving as the reason that citation-nulling and conflict-unpersisted "are
    post-hoc reads of the final research.json". That is backwards: being a
    post-hoc read of a **committed sidecar** is exactly what makes them
    replayable, and replaying them turned two of the three zeros above into real
    counts. Only the #963 gap has a genuine replay caveat — it is a lower bound,
    because the live hook may not see a same-turn `same_person` while the replay
    always sees the full prefix.

    All families share `guardrail_shadow_violations` and are told apart by their
    `kind`, so each passes its own predicate here. Unreadable files are skipped
    with a stderr note, never raised.
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
    prior `same_person`). Identified by the `detail` key, which the stored
    sources set — but EXCLUDING the other `detail`-carrying kinds counted in
    their own buckets: #1133 citation-nulling (`scan_citation_nulling`), #1317
    conflict-unpersisted (`scan_conflict_unpersisted`), and deny-mode provenance
    (`PERSON_EVIDENCE_DENY_KIND`).
    """
    return _scan_stored(
        paths,
        lambda v: "detail" in v
        and v.get("kind")
        not in (
            CITATION_NULLING_KIND,
            CONFLICT_UNPERSISTED_KIND,
            PERSON_EVIDENCE_DENY_KIND,
            WARNINGS_UNCHECKED_KIND,
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


def scan_warnings_unchecked(paths: list[Path]) -> list[dict[str, Any]]:
    """The issue-#1193 warnings-unchecked shadow entries STORED in each run's
    `guardrail_shadow_violations` (a new ParentChild/Couple relationship written
    with no `person_warnings` call). Identified by
    `kind == WARNINGS_UNCHECKED_KIND`.
    """
    return _scan_stored(paths, lambda v: v.get("kind") == WARNINGS_UNCHECKED_KIND)


@dataclass
class RunInputs:
    """Everything a replay may need for ONE committed run, loaded once.

    Each check asks for ITSELF whether this run is scannable, via the two
    `missing_for_*` methods below — the research-only checks need
    `final_research` and nothing else, while the warnings check additionally
    needs `final_tree` and `seed_tree`. A single shared skip list would drop a run
    from all three denominators because one check's input was absent (see
    `PostHocReplay`).

    The requirements are expressed as **field reads, not as string matching on a
    skip message**. An earlier draft filtered a shared `missing: list[str]` by
    comparing against one message's exact wording; rewording the message would
    have silently stopped excluding it, and the warnings check would then have
    skipped every run whose only absent input was a research sidecar it never
    reads. Each method returns the reason to skip, or None to scan.
    """

    slug: str
    display_path: str
    run_log: dict[str, Any] | None = None
    final_research: dict[str, Any] | None = None
    final_tree: dict[str, Any] | None = None
    seed_tree: dict[str, Any] | None = None

    @property
    def tool_calls(self) -> list[dict[str, Any]]:
        return (self.run_log or {}).get("tool_calls") or []

    def missing_for_research_only(self) -> str | None:
        """Why `find_citation_nulling_in_conclusions` /
        `find_unpersisted_conflict_resolutions` cannot read this run, or None."""
        if self.run_log is None:
            return "unreadable run log"
        if self.final_research is None:
            return "no readable final-research.json sidecar"
        return None

    def missing_for_warnings(self) -> str | None:
        """Why `find_relationship_writes_without_warnings_check` cannot read this
        run, or None. The seed tree is required, not optional: without it the
        detector treats every relationship as new, which manufactures exactly the
        violation being measured."""
        if self.run_log is None:
            return "unreadable run log"
        absent = [
            name
            for name, value in (
                ("no readable final-tree.gedcomx.json sidecar", self.final_tree),
                ("no readable starting-tree.gedcomx.json", self.seed_tree),
            )
            if value is None
        ]
        return ", ".join(absent) or None


def _load_json(path: Path) -> dict[str, Any] | None:
    """Parse one JSON file, or None if it cannot be read as a JSON OBJECT.

    The `isinstance` check is load-bearing, not defensive noise: a sidecar that
    parses to a JSON array is not None, so without it the value passes every
    `is None` skip test and then reaches `.get(...)`, raising `AttributeError`
    and aborting the whole report instead of naming one run as unreadable.
    `UnicodeDecodeError` is caught for the same reason — it is a `ValueError`,
    not an `OSError`, so a file with invalid UTF-8 would otherwise propagate.
    """
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return None
    return parsed if isinstance(parsed, dict) else None


def load_run_inputs(path: Path, *, fixtures_root: Path = E2E_FIXTURES) -> RunInputs:
    """Load one committed run's log, both final-state sidecars, and its fixture's
    seed tree, recording what was absent rather than raising.

    The sidecar names mirror `e2e/result.py`'s writer (`{stem}.final-research.json`
    / `{stem}.final-tree.gedcomx.json`), which is why replaying from them is
    faithful: the orchestrator writes them from the same post-run reads the live
    detectors saw.

    Serves `replay_post_hoc`. **`replay_provenance` deliberately does not use it**,
    though the plan for this change said it would. Two reasons found on contact:
    that function needs only the run log and the seed — routing it through a
    four-input loader would parse ~19 MB of final-state sidecars it never reads,
    twice over, since `--replay` now runs both replays — and its skip message
    carries the exception type (`unreadable run log (JSONDecodeError)`) plus a
    stderr note, which this loader does not preserve. Merging them would trade a
    real diagnostic for a cosmetic de-duplication. They are two loaders because
    they load two different things.

    The near-identical copies in `e2e/corpus_report.py` (`recompute_tally`) and
    `e2e/detector_before_after_report.py` are left alone for a separate reason:
    each carries its own skip semantics, and folding them in would widen a change
    whose subject is this module.
    """
    try:
        display_path = str(path.relative_to(REPO_ROOT))
    except ValueError:
        display_path = str(path)  # outside REPO_ROOT (ad hoc/test usage) -- show absolute
    slug = path.parent.name
    return RunInputs(
        slug=slug,
        display_path=display_path,
        run_log=_load_json(path),
        final_research=_load_json(path.with_name(f"{path.stem}.final-research.json")),
        final_tree=_load_json(path.with_name(f"{path.stem}.final-tree.gedcomx.json")),
        seed_tree=_load_json(fixtures_root / slug / "starting-tree.gedcomx.json"),
    )


@dataclass
class CheckReplay:
    """One post-hoc check's replay over a corpus: what it found, over how many
    runs it could actually read, and which runs it could not.

    `runs_scanned` is that check's OWN denominator. A count without one is
    unreadable — the whole defect this module is being changed to fix is a number
    printed against a corpus it silently could not see.

    **It counts runs READ, not runs that could fire**, which is a weaker claim
    than `ProvenanceReplay.runs_linking` makes and is deliberate: these are
    behaviour-PRESENCE numbers ("does this shape occur at all"), not conditional
    rates. Both research-only checks are gated on a non-empty `proof_summaries`
    and warnings-unchecked on a new relationship, so some scanned runs could
    never have fired. Do not read `4 of 157` as a rate over eligible runs; it is
    4 occurrences across a corpus of 157 that were readable.
    """

    violations: list[dict[str, Any]] = field(default_factory=list)
    runs_scanned: int = 0
    skipped: list[str] = field(default_factory=list)


@dataclass
class PostHocReplay:
    """`replay_post_hoc`'s result: one `CheckReplay` per check, never a shared one.

    The three checks read different inputs — `find_citation_nulling_in_conclusions`
    and `find_unpersisted_conflict_resolutions` take only the final research.json,
    while `find_relationship_writes_without_warnings_check` also needs the final
    tree and the fixture's seed tree. On today's corpus exactly one run
    (`william-ferber-ancestry`, a committed run log with no fixture directory)
    has no seed tree, so a shared denominator would report the two research-only
    checks over 156 runs when they can be computed over 157, and would discard
    any violation that run held in them.
    """

    citation: CheckReplay = field(default_factory=CheckReplay)
    conflict: CheckReplay = field(default_factory=CheckReplay)
    warnings: CheckReplay = field(default_factory=CheckReplay)


def _record(
    check: CheckReplay, violations: list[dict[str, Any]], inputs: RunInputs
) -> None:
    """Count this run against `check`'s denominator and file its violations,
    each tagged with the source file so an aggregate stays traceable back to a
    transcript. Scanning is recorded whether or not anything fired — a check that
    read a run cleanly is part of its own denominator."""
    check.runs_scanned += 1
    for v in violations:
        check.violations.append(
            {**v, "file": inputs.display_path, "fixture": inputs.slug}
        )


def replay_post_hoc(
    paths: list[Path], *, fixtures_root: Path = E2E_FIXTURES
) -> PostHocReplay:
    """Recompute the three post-hoc shadow checks from each run's COMMITTED final
    state, instead of reading what a run stored.

    Why this exists. `scan_citation_nulling`, `scan_conflict_unpersisted` and
    `scan_warnings_unchecked` above read `guardrail_shadow_violations` — what a run
    recorded when it ran. Each check therefore reads zero over every run made
    before it shipped, and all three landed in August against a corpus that is 84%
    July. That is not a measurement of the behaviour; it is a measurement of the
    corpus's age. Replaying answers the question the stored counts were being read
    as answering: does this shape occur at all?

    **What this claims, and what it does not.** This is a BEHAVIOUR-PRESENCE
    measurement, not a per-run compliance score. `docs/specs/e2e-test-spec.md`
    ("Historical runs") withholds the latter — a replay only scores a run if the
    checks are pinned to the version that run executed, and nothing records that
    version per run — and `docs/architecture.md` says not to quote a violation
    rate at all. Nothing here writes an `axes_from_runlog` verdict or moves a
    committed run's outcome, and the formatter prints counts against denominators
    rather than rates. One check is genuinely affected by the version gap:
    `find_unpersisted_conflict_resolutions`'s predicate was corrected after it
    first shipped, so replaying it over older runs measures today's rule rather
    than the rule those runs ran under. For "did this shape ever occur" that is
    the right direction, but it is not a historical compliance figure.

    Skip discipline follows `replay_provenance` and `recompute_tally`: a run
    missing an input a check needs is NAMED in that check's `skipped` and excluded
    from that check's denominator, never counted as a clean zero. A count that
    quietly shrank reads as a clean corpus — which is the failure being fixed.

    **The seed tree is today's, not the one that run started from.** Warnings are
    diffed against `eval/tests/e2e/<slug>/starting-tree.gedcomx.json` as it exists
    in the current checkout, and five committed fixtures have had their
    relationship key set changed after runs against them already existed
    (`crowder-grandparents`, `scotland-thomson-grandparents`, `young-marriage-1828`,
    `anders-monsen-ancestry`, `teitje-harkema-parents-1833` — teitje gained 25
    relationship keys the day after its only committed run). Replaying all runs
    whose run-time seed blob is recoverable changed no count as of 2026-08-22, so
    this is a live hazard rather than a current error. It is the fixture-side twin
    of the predicate-version gap noted above.
    """
    out = PostHocReplay()
    for path in paths:
        inputs = load_run_inputs(path, fixtures_root=fixtures_root)
        where = f"{inputs.slug}/{path.name}"

        # The two research-only checks. Neither takes a tree or a seed, so a run
        # with no seed tree is still fully scannable for them.
        research_skip = inputs.missing_for_research_only()
        if research_skip:
            out.citation.skipped.append(f"{where}: {research_skip}")
            out.conflict.skipped.append(f"{where}: {research_skip}")
        else:
            _record(
                out.citation,
                find_citation_nulling_in_conclusions(inputs.final_research),
                inputs,
            )
            _record(
                out.conflict,
                find_unpersisted_conflict_resolutions(inputs.final_research),
                inputs,
            )

        warnings_skip = inputs.missing_for_warnings()
        if warnings_skip:
            out.warnings.skipped.append(f"{where}: {warnings_skip}")
        else:
            _record(
                out.warnings,
                find_relationship_writes_without_warnings_check(
                    inputs.tool_calls, inputs.final_tree, starting_tree=inputs.seed_tree
                ),
                inputs,
            )
    return out


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


def format_post_hoc_replay(replay: PostHocReplay) -> str:
    """The three post-hoc checks REPLAYED, each against its own denominator.

    Prints per-check denominators rather than one corpus size because the checks
    read different inputs and therefore cover different numbers of runs. Counts,
    never rates: see `replay_post_hoc` on what a behaviour-presence replay does
    and does not claim.
    """
    lines = ["", "Post-hoc checks REPLAYED from each run's committed final state:"]
    # `per_run` says whether this check's headline number is its violation count
    # or its affected-RUN count. warnings-unchecked emits at most one record per
    # run today, so printing len(violations) under a "run(s)" noun happens to be
    # true — and would silently become a relationship count labelled "runs" the
    # moment that detector is refined to emit one record per new relationship,
    # which is what the other two already do per source and per question.
    for label, unit, per_run, check in (
        ("citation-nulling", "concluded source(s) with a null/empty citation string", False, replay.citation),
        ("conflict-unpersisted", "concluded question(s) relying on an unpersisted conflict resolution", False, replay.conflict),
        ("warnings-unchecked", "run(s) that wrote a new ParentChild/Couple relationship without calling person_warnings", True, replay.warnings),
    ):
        affected = len({v["file"] for v in check.violations})
        headline = affected if per_run else len(check.violations)
        lines.append(
            f"  {label:<22} {headline:>4} {unit}, "
            f"across {affected} run(s), of {check.runs_scanned} scanned."
        )
        if check.skipped:
            lines.append(f"    Skipped {len(check.skipped)}:")
            lines.extend(f"      {s}" for s in check.skipped)
    lines.append(
        "  Behaviour presence over the committed corpus, not a per-run compliance score."
    )
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
        "\n§7.5 conflict-unpersisted check (issue #1317, shadow): "
        f"{len(violations)} concluded question(s) relying on an unpersisted "
        f"conflict resolution, across {affected} run(s)."
    )


def format_warnings_unchecked(violations: list[dict[str, Any]]) -> str:
    """One flat count — a fact about the final tree + tool_calls, not a windowed
    scan. This is the number the graduation decision (shadow → mandatory
    person_warnings call in the orchestrator, issue #1193 question b) is gated
    on."""
    affected = len({v["file"] for v in violations})
    return (
        "\n§7 warnings-unchecked check (issue #1193, shadow): "
        f"{len(violations)} run(s) wrote a new ParentChild/Couple relationship "
        f"without calling person_warnings, across {affected} run(s)."
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Replay the §7 shadow window and report the §8/§7.5 post-hoc families "
            "over committed e2e runs, stored and (with --replay) recomputed."
        )
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
            "additionally RECOMPUTE all four post-hoc families instead of only reading "
            "what runs stored: the #963 provenance check from tool_calls + each "
            "fixture's committed seed tree, and the three §7/§7.5 checks from each run's "
            "committed final-research / final-tree sidecars. The stored path sees only "
            "runs made after each check shipped, which on today's corpus is a small "
            "minority; this reads the whole historical corpus."
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

    warnings_unchecked = scan_warnings_unchecked(paths)
    print(format_warnings_unchecked(warnings_unchecked))

    # `fixtures_root=E2E_FIXTURES` is passed EXPLICITLY rather than left to the
    # parameter default. A default is bound once, when the `def` executes at
    # import, so a test that reassigns the module global cannot reach it — which
    # made the seed-tree lookup here untestable, and left the test that pins this
    # very wiring passing while warnings-unchecked silently scanned nothing.
    # Naming it here makes it a module-global read at CALL time.
    replay = replay_provenance(paths, fixtures_root=E2E_FIXTURES) if args.replay else None
    if replay is not None:
        print(format_provenance_replay(replay))

    post_hoc = replay_post_hoc(paths, fixtures_root=E2E_FIXTURES) if args.replay else None
    if post_hoc is not None:
        print(format_post_hoc_replay(post_hoc))

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
        print(f"\nWarnings unchecked (issue #1193), {len(warnings_unchecked)}:")
        for v in warnings_unchecked:
            print(f"  {v['fixture']:<35} {v['detail']}")
        if replay is not None:
            print(f"\nReplayed provenance gaps (issue #1231), {len(replay.violations)}:")
            for v in replay.violations:
                print(f"  {v['fixture']:<35} idx={v['index']:<4} {v['detail']}")
        if post_hoc is not None:
            for label, check in (
                ("citation-nulling", post_hoc.citation),
                ("conflict-unpersisted", post_hoc.conflict),
                ("warnings-unchecked", post_hoc.warnings),
            ):
                print(f"\nReplayed {label}, {len(check.violations)}:")
                for v in check.violations:
                    print(f"  {v['fixture']:<35} {v['detail']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
