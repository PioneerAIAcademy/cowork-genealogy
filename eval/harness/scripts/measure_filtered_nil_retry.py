#!/usr/bin/env python3
"""Measure what issue #3432's filtered-nil-retry precondition would refuse.

``research_log_append`` refuses a zero-hit ``fulltext_search`` log op that set a
post-search filter and has no unfiltered retry — a sibling ``fulltext_search``
with the same ``keywords``/``nlQuery`` whose filter-key set is a strict subset of
this op's, in the same batch or already in ``log[]``
(``filteredNilRetryInvariants`` in ``research-log-append.ts``). This replays that
pure guard over every ``fulltext_search`` log op in the committed unit and e2e run
logs and counts the ops it would refuse.

Scope matches the guard EXACTLY: an op's candidate siblings are every OTHER op in
the SAME ``research_log_append`` call (order-independent — the guard judges the
whole resolved batch) plus every ``fulltext_search`` op persisted by an EARLIER
call in the run (``log[]``). An order-dependent "at-or-before" scan would
wrongly refuse the ``ut_search_full_text_002`` shape, which batches the unfiltered
retry after the filtered op.

Each op's effective query is reconstructed the way the tool resolves it: the op's
own ``query`` when present, else the ``fulltext_search`` call whose response staged
the op's ``stagedResultsRef`` (its echoed arguments). Zero-hit = a staged ref whose
``returnedCount`` is 0 (defensive — a real zero-hit ``fulltext_search`` stages
nothing, so this branch does not arise in practice), or no ref with
``resultsExamined`` 0 and ``resultsAvailable`` 0/absent (the reachable nil path).

Per ADR-0011 ("the bar is inspection, not a rate") a clean scan prints its
denominators, so a 0 reads as "examined N, refused 0" rather than "looked at
nothing". Re-derive rather than quote: a re-run replaces a skill's run log.

Usage::

    cd eval/harness && uv run python scripts/measure_filtered_nil_retry.py
    ... --json   every refused op, for reading each one (ADR-0011 limit 2)
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[1]
REPO = HARNESS.parents[1]
UNIT_RUNLOGS = REPO / "eval" / "runlogs" / "unit"
E2E_RUNLOGS = REPO / "eval" / "runlogs" / "e2e"

# The post-search filter keys on a fulltext_search query (research-log-append.ts
# FULLTEXT_FILTER_KEYS). keywords/nlQuery are the search TERMS, name is exempt.
FILTER_KEYS = (
    "place",
    "recordPlace0",
    "recordPlace1",
    "recordPlace2",
    "recordPlace3",
    "recordType",
    "yearFrom",
    "yearTo",
)


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _bare(tool: str) -> str:
    return str(tool or "").rsplit("__", 1)[-1]


def _has(v) -> bool:
    return v is not None and v != ""


def _term(v) -> str:
    return str(v) if _has(v) else ""


def _filters(query) -> frozenset[str]:
    if not isinstance(query, dict):
        return frozenset()
    return frozenset(k for k in FILTER_KEYS if _has(query.get(k)))


def _ops(args: dict) -> list:
    ops = args.get("ops")
    if isinstance(ops, str):
        try:
            ops = json.loads(ops)
        except ValueError:
            ops = None
    if isinstance(ops, list):
        return [o for o in ops if isinstance(o, dict)]
    # single-op form: the op fields sit at the top level
    return [args] if args.get("tool") or args.get("outcome") else []


def _staged_ref_to_query(tool_calls: list) -> dict:
    """Map each staged resultsRef to the fulltext_search call's echoed arguments,
    so an op that omitted `query` (filled from the staged echo) can be read."""
    out: dict = {}
    for c in tool_calls:
        if _bare(c.get("tool")) != "fulltext_search":
            continue
        resp = c.get("response")
        if not isinstance(resp, dict):
            # e2e logs carry response_summary (a JSON string), possibly stripped
            rs = c.get("response_summary")
            if isinstance(rs, str):
                try:
                    resp = json.loads(rs)
                except ValueError:
                    resp = None
        ref = (resp or {}).get("staged", {}).get("resultsRef") if isinstance(resp, dict) else None
        if isinstance(ref, str) and isinstance(c.get("args"), dict):
            out[ref] = c["args"]
    return out


def _returned_count(op: dict, call: dict, idx: int):
    """Per-op returnedCount from the research_log_append RESULT, or None when the
    response is absent/stripped. Only matters for the defensive ref-present
    branch, which does not arise for a real zero-hit fulltext search."""
    resp = call.get("response")
    if not isinstance(resp, dict):
        rs = call.get("response_summary")
        if isinstance(rs, str):
            try:
                resp = json.loads(rs)
            except ValueError:
                return None
    if not isinstance(resp, dict):
        return None
    results = resp.get("results")
    if isinstance(results, list) and idx < len(results) and isinstance(results[idx], dict):
        return results[idx].get("returnedCount")
    return resp.get("returnedCount")


class Run:
    """One independent research.json: a unit (test, run_index) or one e2e run.

    A refusal is only trustworthy when every fulltext query in the run resolved
    and the run's captures were not stripped — otherwise an unfiltered-retry
    sibling that omitted its `query` (filled from a staged echo we can no longer
    read) may be invisible, making the refusal a measurement artifact rather than
    guard behavior. `degraded` marks such a run so the headline figure counts only
    reliable refusals."""

    def __init__(self, label: str, tool_calls: list, counts: collections.Counter, stripped: bool = False):
        self.label = label
        self.calls = [c for c in tool_calls if isinstance(c, dict)]
        self.ref_to_query = _staged_ref_to_query(self.calls)
        self.counts = counts
        self.stripped = stripped
        self.unresolved = 0

    def _effective_query(self, op: dict):
        q = op.get("query")
        if isinstance(q, dict):
            return q
        ref = op.get("stagedResultsRef")
        if isinstance(ref, str) and ref not in ("", "null"):
            return self.ref_to_query.get(ref)
        return None

    def _zero_hit(self, op: dict, call: dict, idx: int) -> bool:
        # An errored search (fixture_not_found, upstream error) is not a filtered
        # nil — the filter never ran, so there is nothing to retry — mirroring the
        # engine gate. This is why ut_search_full_text_014 leaves the row. #3592.
        if op.get("outcome") == "error":
            return False
        ref = op.get("stagedResultsRef")
        if isinstance(ref, str) and ref not in ("", "null"):
            rc = _returned_count(op, call, idx)
            if rc is None:
                self.counts["ref_ops_count_unreadable"] += 1
                return False
            return rc == 0
        examined = op.get("resultsExamined")
        available = op.get("resultsAvailable")
        return examined == 0 and (available is None or available == 0)

    def _is_fulltext(self, op: dict) -> bool:
        return op.get("tool") == "fulltext_search"

    def scan(self, hits: list) -> None:
        persisted: list[dict] = []  # fulltext {query} from earlier calls (log[])
        run_hits: list = []
        for call in self.calls:
            if _bare(call.get("tool")) != "research_log_append":
                continue
            args = call.get("args") if isinstance(call.get("args"), dict) else {}
            ops = _ops(args)
            resolved = []  # (op, effective_query, zero_hit) for every fulltext op
            for idx, op in enumerate(ops):
                if not self._is_fulltext(op):
                    continue
                q = self._effective_query(op)
                resolved.append((op, q, self._zero_hit(op, call, idx)))
            batch_queries = [q for (_o, q, _z) in resolved]
            for op, q, zero in resolved:
                self.counts["fulltext_ops"] += 1
                if not isinstance(q, dict):
                    self.counts["fulltext_ops_query_unresolved"] += 1
                    self.unresolved += 1
                    continue
                filt = _filters(q)
                if filt:
                    self.counts["filtered_fulltext_ops"] += 1
                if not zero or not filt:
                    continue
                if _has(q.get("name")):
                    continue
                kw, nl = _term(q.get("keywords")), _term(q.get("nlQuery"))
                if kw == "" and nl == "":
                    continue
                self.counts["filtered_zero_hit_ops"] += 1
                # Candidate siblings: every OTHER op in this batch + log[].
                siblings = [sq for sq in batch_queries if sq is not q and isinstance(sq, dict)]
                siblings += [sq for sq in persisted if isinstance(sq, dict)]
                if any(
                    _term(sq.get("keywords")) == kw
                    and _term(sq.get("nlQuery")) == nl
                    and _filters(sq) < filt  # strict subset
                    for sq in siblings
                ):
                    continue
                run_hits.append(
                    {"run": self.label, "keywords": kw, "nlQuery": nl, "filters": sorted(filt)}
                )
            persisted.extend(q for q in batch_queries if isinstance(q, dict))
        # A run with stripped captures or any unresolved query cannot be trusted
        # to have surfaced every unfiltered-retry sibling, so its refusals are
        # bucketed as degraded rather than counted in the headline figure.
        degraded = self.stripped or self.unresolved > 0
        bucket = "refused_degraded" if degraded else "refused"
        self.counts[bucket] += len(run_hits)
        for h in run_hits:
            h["degraded"] = degraded
            hits.append(h)


def measure() -> tuple[collections.Counter, list]:
    counts: collections.Counter = collections.Counter()
    hits: list = []
    for path in sorted(UNIT_RUNLOGS.glob("*/v*.json")):
        if path.name.endswith(".ann.json"):
            continue
        log = _load(path)
        if not isinstance(log, dict) or not isinstance(log.get("tests"), list):
            continue
        counts["unit_run_logs"] += 1
        slug = path.parent.name
        for t in log["tests"]:
            for r in t.get("runs", []):
                tcs = (r.get("output") or {}).get("tool_calls") or []
                counts["runs"] += 1
                Run(f"{slug}/{path.name}::{t.get('test_id')}#{r.get('run_index')}", tcs, counts).scan(hits)
    for path in sorted(E2E_RUNLOGS.glob("*/run-*.json")):
        if path.name.endswith((".ann.json", ".final-research.json", ".final-tree.gedcomx.json")):
            continue
        log = _load(path)
        if not isinstance(log, dict) or not isinstance(log.get("tool_calls"), list):
            continue
        counts["e2e_run_logs"] += 1
        stripped = bool(log.get("captures_stripped"))
        if stripped:
            counts["e2e_runs_captures_stripped"] += 1
        counts["runs"] += 1
        Run(f"e2e/{path.parent.name}/{path.name}", log["tool_calls"], counts, stripped=stripped).scan(hits)
    return counts, hits


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true", help="print every refused op")
    args = parser.parse_args(argv)
    counts, hits = measure()
    if args.json:
        print(json.dumps({"counts": counts, "hits": hits}, indent=1))
        return 0
    for key in sorted(counts):
        print(f"{key:34} {counts[key]}")
    reliable_runs = {h["run"].split("::")[0] for h in hits if not h["degraded"]}
    print(
        f"\nREFUSED (reliable): {counts['refused']} of {counts['filtered_zero_hit_ops']} filtered "
        f"zero-hit fulltext ops, across {counts['runs']} runs in {len(reliable_runs)} run log(s). "
        f"A further {counts['refused_degraded']} refusals fall in runs with stripped captures or "
        f"an unresolved query, where an unfiltered-retry sibling may be unreadable — reported "
        f"separately, not trusted. ({counts['fulltext_ops']} fulltext ops examined.)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
