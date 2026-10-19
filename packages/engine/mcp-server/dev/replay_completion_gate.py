#!/usr/bin/env python3
"""Replay the completion gate's blocking-conflict predicate over the e2e corpus.

The evidence trail behind `docs/specs/guardrail-enforcement-spec.md` §5
"Blocking conflicts before completion". ADR-0011 limit 2's bar is inspection
rather than a rate: this prints the per-run refusal list so each one can be
read, not just a count.

Four readings are replayed so a narrowing or a widening can be compared against
what shipped:

  declared  the two declared arms alone — what the gate read before
  derived   declared, plus "disputes an assertion tied to any question" (SHIPPED)
  narrow    derived, but only assertions tied to a still-OPEN question
  source    declared, plus "shares a source_id with a relied-on assertion" —
            the reading `disputedSourceIds` already uses for two other gates

Every figure this prints describes the eval corpus. There is no production
telemetry (`docs/architecture.md` §9.4), so none of it says whether the gate is
right for a real researcher.

Usage, from the repo root:

    python3 packages/engine/mcp-server/dev/replay_completion_gate.py
"""

from __future__ import annotations

import glob
import json
import os
import sys

CORPUS = "eval/runlogs/e2e/*/run-*.final-research.json"


def arr(value: object) -> list:
    return value if isinstance(value, list) else []


def declared(conflict: dict) -> bool:
    """The two arms the gate read before: a named question, or an identity conflict.

    `identity_question` is the question's TEXT (schema: `string | null`), never a
    boolean — an early `=== true` reading was unsatisfiable dead code.
    """
    question = conflict.get("identity_question")
    return (isinstance(question, str) and question.strip() != "") or len(
        arr(conflict.get("blocks_question_ids"))
    ) > 0


def main() -> int:
    files = sorted(glob.glob(CORPUS))
    if not files:
        print(f"no corpus files matched {CORPUS} — run from the repo root", file=sys.stderr)
        return 1

    conflicts_total = 0
    neither_field = 0
    by_status: dict[str, int] = {}
    completed_runs = 0
    unresolved_in_completed = 0
    # reading -> (conflicts it sees, runs it refuses)
    seen = {k: 0 for k in ("declared", "derived", "narrow", "source")}
    refused: dict[str, set] = {k: set() for k in seen}
    newly_refused: dict[str, list] = {}
    # run -> [(conflict id, arm, [(question, summary, tier) it already invalidates])]
    inspection: dict[str, list] = {}

    for path in files:
        run = os.path.basename(os.path.dirname(path))
        with open(path, encoding="utf-8") as handle:
            doc = json.load(handle)

        assertions = arr(doc.get("assertions"))
        for conflict in arr(doc.get("conflicts")):
            conflicts_total += 1
            status = conflict.get("status")
            by_status[status] = by_status.get(status, 0) + 1
            if not declared(conflict):
                neither_field += 1

        if (doc.get("project") or {}).get("status") != "completed":
            continue
        completed_runs += 1

        # Assertion ids some question claims, and the subset whose question is
        # still open — the narrowing the shipped predicate deliberately rejects.
        open_questions = {
            q.get("id")
            for q in arr(doc.get("questions"))
            if q.get("status") != "resolved" and not q.get("resolved")
        }
        tied = {a.get("id") for a in assertions if arr(a.get("extracted_for_question_ids"))}
        tied_open = {
            a.get("id")
            for a in assertions
            if any(q in open_questions for q in arr(a.get("extracted_for_question_ids")))
        }
        source_of = {
            a.get("id"): a.get("source_id")
            for a in assertions
            if isinstance(a.get("source_id"), str)
        }
        # Project-wide, matching `disputedSourceIds`, which maps source -> conflicts
        # for the whole document and leaves the per-summary check to its caller.
        relied_sources = {
            source_of.get(aid)
            for summary in arr(doc.get("proof_summaries"))
            for aid in arr(summary.get("supporting_assertion_ids"))
        } - {None}
        # For the ADR-0011 limit 2 inspection: each summary's claimed tier and the
        # sources it rests on. `conflictedSourceInvariants` refuses any tier other
        # than `not_proved`/`disproved` when a non-resolved conflict disputes a
        # source that summary relies on — so this says whether a refused document
        # was already invalid before this gate ever saw it.
        #
        # Deliberately NOT scoped by question, because the shipped invariant is
        # not: it reads the summary's own `supporting_assertion_ids` against
        # `disputedSourceIds` for the whole document and never consults
        # `blocks_question_ids`. An earlier draft here scoped by question and
        # under-counted by two as a result.
        claimed_tiers = [
            (
                summary.get("id"),
                summary.get("question_id"),
                summary.get("tier"),
                {source_of.get(aid) for aid in arr(summary.get("supporting_assertion_ids"))}
                - {None},
            )
            for summary in arr(doc.get("proof_summaries"))
        ]

        for conflict in arr(doc.get("conflicts")):
            if conflict.get("status") != "unresolved":
                continue
            unresolved_in_completed += 1
            competing = arr(conflict.get("competing_assertion_ids"))
            is_declared = declared(conflict)
            arms = {
                "declared": is_declared,
                "derived": is_declared or any(a in tied for a in competing),
                "narrow": is_declared or any(a in tied_open for a in competing),
                "source": is_declared
                or bool({source_of.get(a) for a in competing} & relied_sources),
            }
            for reading, hit in arms.items():
                if hit:
                    seen[reading] += 1
                    refused[reading].add(run)
            if arms["derived"] and not is_declared:
                newly_refused.setdefault(run, []).append(conflict.get("id"))
            if not arms["derived"]:
                continue
            disputed = {source_of.get(aid) for aid in competing} - {None}
            hits = [
                (qid, ps_id, tier)
                for ps_id, qid, tier, ps_sources in claimed_tiers
                if tier not in (None, "not_proved", "disproved") and (disputed & ps_sources)
            ]
            inspection.setdefault(run, []).append(
                (conflict.get("id"), "declared" if is_declared else "derived", hits)
            )

    print(f"corpus: {len(files)} final-state files, {completed_runs} completed runs")
    print(f"conflicts: {conflicts_total} ({by_status}); {neither_field} carry neither declared field")
    print(f"unresolved conflicts held by completed runs: {unresolved_in_completed}")
    print()
    print(f"{'reading':10s} {'conflicts seen':>14s} {'runs refused':>13s}")
    for reading in ("declared", "derived", "narrow", "source"):
        marker = "  <- shipped" if reading == "derived" else ""
        print(f"{reading:10s} {seen[reading]:>14d} {len(refused[reading]):>13d}{marker}")
    print()
    print("ADR-0011 limit 2 inspection — every refusal the shipped reading produces.")
    print("`already invalid` lists this question's summaries whose tier sits above")
    print("`not_proved` on a source the conflict disputes, which")
    print("`conflictedSourceInvariants` refuses independently of this gate.")
    clean = 0
    for run in sorted(refused["derived"]):
        print(f"  {run}")
        for conflict_id, arm, hits in inspection.get(run, []):
            if hits:
                clean += 1
                detail = ", ".join(f"{qid}/{ps}={tier}" for qid, ps, tier in hits)
                print(f"    {conflict_id} [{arm}] already invalid: {detail}")
            else:
                print(f"    {conflict_id} [{arm}] already invalid: NONE — inspect by hand")
    total = sum(len(v) for v in inspection.values())
    print()
    print(f"refused conflicts already invalid under conflictedSourceInvariants: {clean} of {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
