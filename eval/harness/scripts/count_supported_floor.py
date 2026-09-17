"""Count the corpus population reached by the `supported` evidence floor.

Issue #2086. The floor is a `research_append` write-boundary precondition
(`packages/engine/mcp-server/src/tools/research-append.ts::hypothesisSupportedInvariants`)
mirroring the eval validator `test_supported_requires_evidence_floor`
(`eval/harness/validators/test_hypothesis_tracking.py`). Both specs that
document it quote figures from this script, so the figures stay reproducible:

  * `docs/specs/research-append-tool-spec.md` §5 (the `Measured cost:` clause)
  * `docs/specs/guardrail-enforcement-spec.md` §4 (the enforcement-layer row)

**Two passes, because they answer different questions.**

`--ops` walks the write ledger: every `research_append` op that SETS
`status: "supported"`, which is exactly the population the precondition gates.
This is the primary satisfiability result, and it needs no state
reconstruction — both halves of the floor read inputs that move only through
ops visible in `tool_calls[].args`.

`--final` walks committed final states and fixtures, asking how many
`supported` hypotheses stand in violation. Corroboration only: a final-state
scan cannot see the moment a write was made, so it cannot see a promotion made
while a conflict was still `unresolved` and resolved later in the same run —
which is precisely where a false deny would sit. For that direction the
instrument is `eval/harness/harness/replay.py` (`make replay-check`), and only
runs inside the 14-day `response_summary` capture window can answer it.

**A rejected call is not a write.** ~12% of writer calls in the corpus return
`{"ok": false}` (`replay.py`'s module docstring). Those changed nothing on disk
and cannot be a false deny, so `--ops` classifies each op as landed, refused or
outcome-unknown and reports the three separately. Counting attempts rather than
writes overstates the population roughly two-fold on this rule.

**Quarantined runs are excluded by default.** `eval/runlogs/_2491-exploratory-quarantine`
came from a modified `research/SKILL.md` and is "exploratory evidence only,
never as calibration corpus" (lead ruling #2491, 2026-09-15; see that
directory's README). It is a SIBLING of `eval/runlogs/e2e/`, so the
final-state glob misses it by construction while a naive `eval/runlogs/**`
op walk picks it up — which is how the two figures came to be measured over
two different corpora. Pass `--include-quarantine` to report it, as a
separately labelled block rather than pooled into the calibration totals.

CLI (from the repo root):

    python eval/harness/scripts/count_supported_floor.py
    python eval/harness/scripts/count_supported_floor.py --ops --include-quarantine
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
REPO_ROOT = HERE.parents[3]
RUNLOGS = REPO_ROOT / "eval" / "runlogs"

SETTLED = ("resolved", "moot")
QUARANTINE_MARKER = "_2491-exploratory-quarantine"

FINAL_STATE_GLOBS = (
    "eval/runlogs/e2e/*/*.final-research.json",
    "eval/fixtures/scenarios/*/research.json",
    "eval/tests/e2e/**/research.json",
)


# --- the rule itself, kept in one place so both passes apply the same predicate ---


def floor_violations(hypothesis: dict, research: dict) -> list[str]:
    """Return the floor violations for one hypothesis, or [] if it clears.

    Mirrors `hypothesisSupportedInvariants` in research-append.ts and
    `test_supported_requires_evidence_floor`. Conflicts are matched by
    **assertion overlap, never by shared question_id** — see
    `eval/fixtures/scenarios/flynn-unresolved-conflict`, the fixture that
    separates the two.
    """
    if hypothesis.get("status") != "supported":
        return []
    hid = hypothesis.get("id", "?")
    supporting = hypothesis.get("supporting_assertion_ids") or []
    contradicting = hypothesis.get("contradicting_assertion_ids") or []
    linked = set(supporting) | set(contradicting)

    unresolved = [
        c.get("id")
        for c in (research.get("conflicts") or [])
        if isinstance(c, dict)
        and linked & set(c.get("competing_assertion_ids") or [])
        and c.get("status") not in SETTLED
    ]
    if unresolved:
        # The evidence floor is moot once this already fails — the same
        # short-circuit both other planes take.
        return [f"hypotheses[{hid}]: conflict(s) {unresolved} unresolved"]

    by_id = {
        a.get("id"): a for a in (research.get("assertions") or []) if isinstance(a, dict)
    }
    direct = 0
    indirect_sources: set[str] = set()
    for aid in supporting:
        a = by_id.get(aid)
        if not isinstance(a, dict):
            continue  # an id resolving to no assertion counts as nothing
        if a.get("evidence_type") == "direct":
            direct += 1
        elif a.get("evidence_type") == "indirect" and isinstance(a.get("source_id"), str):
            indirect_sources.add(a["source_id"])
    if direct < 1 and len(indirect_sources) < 2:
        return [
            f"hypotheses[{hid}]: no direct supporting assertion and only "
            f"{len(indirect_sources)} distinct indirect source(s)"
        ]
    return []


# --- shared plumbing ---


def is_quarantined(path: Path) -> bool:
    return QUARANTINE_MARKER in path.as_posix()


def load(path: Path) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def call_outcome(call: dict) -> bool | None:
    """True if the call reported `ok: true`, False if `ok: false`, None if the
    outcome is not recoverable from the ledger.

    **The two corpora store this under different keys, and reading only one of
    them is how the first version of this script undercounted.** E2e logs carry
    `response_summary` — a JSON *string* wrapping an inner JSON payload, so the
    quotes arrive escaped. Unit logs carry `response`, already a dict
    (`eval/runlogs/unit/hypothesis-tracking/v1_2026-09-01_13-17-15.json`). The
    first version read `response_summary` only and returned None for every unit
    op — including the one both specs quote as the satisfying call shape, which
    was reported as "outcome unrecoverable" while `{"ok": true}` sat in the same
    object. A reader whose reach excludes one of its own corpora returns a
    smaller number that reads as conservatism (CLAUDE.md, "A new lint must be
    proven to fail").

    Accepts a dict or a string under either key, because the shape is what
    varies between logger versions, not the key alone.
    """
    for key in ("response_summary", "response"):
        raw = call.get(key)
        if isinstance(raw, dict):
            ok = raw.get("ok")
            if isinstance(ok, bool):
                return ok
            continue
        if isinstance(raw, str):
            m = re.search(r'"ok"\s*:\s*(true|false)', raw.replace('\\"', '"'))
            if m:
                return m.group(1) == "true"
    return None


def walk_calls(node: object):
    """Yield every `research_append` tool_call dict anywhere in a run log.

    Walks rather than indexing a known path: the ledger's nesting has moved
    between logger versions, and a hard-coded path silently yields nothing.
    """
    if isinstance(node, dict):
        if str(node.get("tool", "")).endswith("research_append"):
            yield node
        for v in node.values():
            yield from walk_calls(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk_calls(v)


def promote_indices(ops: list) -> list[int]:
    """Indices of the ops in one call that SET a hypothesis to `supported`.

    Indices rather than the ops themselves, because the batch position is
    load-bearing: what precedes a promote in the same `ops[]` is what decides
    whether a live read and a pre-call snapshot can disagree.

    Matches the gate's own condition — `op: "append"`, or an `update` whose
    `fields` names `status`. An update that does not name `status` cannot set
    it, and the gate skips it, so it is not counted here either.
    """
    out = []
    for idx, op in enumerate(ops):
        if not isinstance(op, dict) or op.get("section") != "hypotheses":
            continue
        entry = op.get("entry") or {}
        fields = op.get("fields") or {}
        status = fields.get("status") if "status" in fields else entry.get("status")
        if status == "supported":
            out.append(idx)
    return out


# --- pass 1: the write ledger ---


def run_ops(include_quarantine: bool) -> int:
    buckets: dict[str, list[tuple[Path, str, bool | None]]] = {
        "calibration": [],
        "quarantine": [],
    }
    assertion_first = 0
    conflict_first = 0
    total = 0
    scanned = 0

    for path in sorted(RUNLOGS.rglob("*.json")):
        if path.name.endswith(".ann.json"):
            continue
        if is_quarantined(path) and not include_quarantine:
            continue
        doc = load(path)
        if doc is None:
            continue
        scanned += 1
        for call in walk_calls(doc):
            args = call.get("args") or {}
            ops = args.get("ops") or ([args] if args.get("section") else [])
            for idx in promote_indices(ops):
                op = ops[idx]
                total += 1
                before = [
                    o.get("section") for o in ops[:idx] if isinstance(o, dict)
                ]
                if "assertions" in before:
                    assertion_first += 1
                if "conflicts" in before:
                    conflict_first += 1
                key = "quarantine" if is_quarantined(path) else "calibration"
                buckets[key].append((path, op.get("op", "?"), call_outcome(call)))

    print(f"run logs scanned: {scanned}")
    print()
    for key in ("calibration", "quarantine"):
        rows = buckets[key]
        if not rows and key == "quarantine":
            continue
        landed = [r for r in rows if r[2] is True]
        refused = [r for r in rows if r[2] is False]
        unknown = [r for r in rows if r[2] is None]
        label = "calibration corpus" if key == "calibration" else "QUARANTINED (exploratory only - do not pool)"
        print(f"{label}:")
        print(f"  ops setting status=supported: {len(rows)}  in {len({r[0] for r in rows})} run logs")
        print(f"  landed (ok=true):             {len(landed)}  in {len({r[0] for r in landed})} run logs")
        print(f"  refused (ok=false):           {len(refused)}")
        print(f"  outcome unrecoverable:        {len(unknown)}")
        print()

    # Names the corpora actually examined, not "both" — in default mode no
    # quarantine op was read, and a fixed "both corpora" label overstated the
    # denominator it printed beside.
    examined = "calibration + quarantine" if include_quarantine else "calibration only"
    print(f"batch shape, over every op found ({examined}):")
    print(f"  batches with an `assertions` op ahead of the promote: {assertion_first} of {total}")
    print(f"  batches with a `conflicts` op ahead of the promote:   {conflict_first} of {total}")
    print()
    print("A `conflicts` op ahead of the promote is where a live read and a pre-call")
    print("snapshot can disagree; an `assertions` op ahead of it is the same question")
    print("for half (b).")
    return 0


# --- pass 2: committed final states and fixtures ---


def run_final(include_quarantine: bool) -> int:
    docs = 0
    supported = 0
    violations: list[tuple[Path, str]] = []

    paths: list[Path] = []
    for pattern in FINAL_STATE_GLOBS:
        paths.extend(REPO_ROOT.glob(pattern))
    for path in sorted(set(paths)):
        if is_quarantined(path) and not include_quarantine:
            continue
        research = load(path)
        if not isinstance(research, dict):
            continue
        docs += 1
        for h in research.get("hypotheses") or []:
            if not isinstance(h, dict) or h.get("status") != "supported":
                continue
            supported += 1
            for msg in floor_violations(h, research):
                violations.append((path, msg))

    print(f"documents scanned:            {docs}")
    print(f"supported hypotheses:         {supported}")
    print(f"failing either half:          {len(violations)}")
    for path, msg in violations:
        print(f"  VIOLATION {path.relative_to(REPO_ROOT).as_posix()}: {msg}")
    print()
    print("Corroboration only - a final-state scan cannot see the state a write was")
    print("made against. See this module's docstring.")
    return 1 if violations else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ops", action="store_true", help="write-ledger pass only")
    ap.add_argument("--final", action="store_true", help="final-state pass only")
    ap.add_argument(
        "--include-quarantine",
        action="store_true",
        help=f"also report eval/runlogs/{QUARANTINE_MARKER} (labelled separately, never pooled)",
    )
    args = ap.parse_args(argv)

    # Neither flag means both passes — the default a spec author wants.
    both = not (args.ops or args.final)
    rc = 0
    if args.ops or both:
        print("=== pass 1: the write ledger (primary) ===")
        rc |= run_ops(args.include_quarantine)
        print()
    if args.final or both:
        print("=== pass 2: committed final states (corroboration) ===")
        rc |= run_final(args.include_quarantine)
    return rc


if __name__ == "__main__":
    sys.exit(main())
