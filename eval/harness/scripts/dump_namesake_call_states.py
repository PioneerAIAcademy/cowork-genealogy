#!/usr/bin/env python3
"""Dump the call-time state the namesake measurement judges (issue #3363).

`packages/engine/mcp-server/dev/measure-namesake-cap.ts` runs this and judges
each line with the shipped TypeScript functions; nothing is judged here. The
state is rebuilt with `harness.replay` from each committed e2e run's
`tool_calls` and its fixture's `starting-research.json`, so a call whose
response the capture strip reclaimed is not applied (`unparseable`).

One JSON line per run, then one per call the measurement reads:

  run     the run's coverage: whether the replay rebuilds its final
          person_evidence exactly (ids and pairings), and its unparseable and
          unmodelled counts.
  append  a research_append call with person_evidence ops that the replay
          applied: its ops, and person_evidence before and after it.
  merge   a merge_tree_persons call: its merges, its outcome, and
          person_evidence and assertion ids at the call.

`append` and `merge` lines also carry the relationships at the call (the
starting tree's, plus tree_edit add_relationship with the ref a
`sourceAssertionId` resolves to, minus tree_correct
relationship removes, before it; a tree write with no recorded outcome counts
as applied when its ops pass today's shape checks), the ids of the research
sources at the call, the starting tree's S ids and its person ids. The S ids a
research source cites come from its final body: the replay keeps what each op
wrote, and the composite persist stamps the S id inside the tool. Assertion and source bodies are
not dumped: the judge reads them from the run's final research by id, since
the replay keeps only what each op wrote.

Usage:
    uv run --no-project python eval/harness/scripts/dump_namesake_call_states.py <out.jsonl>
"""

from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HARNESS))

from harness.replay import bare_tool_name, parse_tool_result, replay  # noqa: E402

REPO = HARNESS.parents[1]
E2E_RUNLOGS = REPO / "eval" / "runlogs" / "e2e"
E2E_TESTS = REPO / "eval" / "tests" / "e2e"
SIDECAR_SUFFIXES = (".ann.json", ".final-research.json", ".final-tree.gedcomx.json")


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _ops(args: dict) -> list:
    ops = args.get("ops")
    if isinstance(ops, str):
        try:
            ops = json.loads(ops)
        except ValueError:
            ops = None
    return [o for o in ops if isinstance(o, dict)] if isinstance(ops, list) else [args]


def _outcome(call: dict) -> str:
    """applied, rejected or unknown, read as harness.replay reads it."""
    if call.get("is_error"):
        return "rejected"
    result = parse_tool_result(call.get("response_summary"))
    if result is None:
        return "unknown"
    return "rejected" if result.get("ok") is False else "applied"


def _bad_refs(node: dict) -> bool:
    src = node.get("sources")
    if not isinstance(src, list) or not src:
        return True
    return any(not isinstance(s, dict) or not isinstance(s.get("ref"), str) or s.get("ref") == "" for s in src)


def _tree_write_landed(call: dict, ops: list) -> bool:
    """A tree write with no recorded outcome landed unless an op fails today's
    shape checks: a sourced relationship or fact with no usable ref."""
    outcome = _outcome(call)
    if outcome != "unknown":
        return outcome == "applied"
    for op in ops:
        if op.get("operation") == "add_relationship" and isinstance(op.get("relationship"), dict) and not op.get("sourceAssertionId"):
            if _bad_refs(op["relationship"]):
                return False
        if op.get("operation") == "add_fact" and isinstance(op.get("fact"), dict) and _bad_refs(op["fact"]):
            return False
    return True


def _next_relationship_id(rels: list) -> str:
    top = 0
    for r in rels:
        rid = str(r.get("id") or "")
        if rid.startswith("R") and rid[1:].isdigit():
            top = max(top, int(rid[1:]))
    return f"R{top + 1}"


def _assertion_ref(final: dict, assertion_id) -> str | None:
    """The S id an add_relationship's `sourceAssertionId` resolves to, read
    from the final research: the assertion's source's description id."""
    if not isinstance(assertion_id, str):
        return None
    assertion = next((a for a in final.get("assertions") or [] if isinstance(a, dict) and a.get("id") == assertion_id), None)
    if assertion is None:
        return None
    source = next((x for x in final.get("sources") or [] if isinstance(x, dict) and x.get("id") == assertion.get("source_id")), None)
    ref = (source or {}).get("gedcomx_source_description_id")
    return ref if isinstance(ref, str) and ref else None


def _pairing(e: dict) -> tuple:
    return (e.get("id"), e.get("assertion_id"), e.get("person_id"))


def dump(out_path: Path) -> collections.Counter:
    counts: collections.Counter = collections.Counter()
    with out_path.open("w", encoding="utf-8") as out:
        for path in sorted(E2E_RUNLOGS.glob("*/run-*.json")):
            if path.name.endswith(SIDECAR_SUFFIXES):
                continue
            slug = path.parent.name
            run_ref = f"{slug}/{path.name}"
            if not (E2E_TESTS / slug / "fixture.json").exists():
                counts["skipped: no fixture"] += 1
                continue
            final = _load(path.with_name(path.name[: -len(".json")] + ".final-research.json"))
            log = _load(path)
            if final is None or not log or not isinstance(log.get("tool_calls"), list):
                counts["skipped: no run log or final research"] += 1
                continue
            calls = log["tool_calls"]
            starting = _load(E2E_TESTS / slug / "starting-research.json") or {}
            start_tree = _load(E2E_TESTS / slug / "starting-tree.gedcomx.json") or {}
            starting_ids = sorted({p.get("id") for p in start_tree.get("persons") or [] if isinstance(p, dict) and p.get("id")})
            start_s_ids = {s.get("id") for s in start_tree.get("sources") or [] if isinstance(s, dict) and s.get("id")}

            whole = replay(calls, starting)
            replayed_pe = sorted(map(_pairing, whole.research.get("person_evidence") or []))
            final_pe = sorted(map(_pairing, final.get("person_evidence") or []))
            fidelity = bool(final_pe) and replayed_pe == final_pe
            counts["runs"] += 1
            counts["runs whose person_evidence the replay rebuilds exactly"] += fidelity
            counts["unparseable calls"] += whole.unparseable
            out.write(json.dumps({
                "kind": "run", "run": run_ref, "slug": slug, "fidelity": fidelity,
                "captures_stripped": bool(log.get("captures_stripped")),
                "unparseable": whole.unparseable, "unmodelled": whole.unmodelled,
            }, ensure_ascii=False) + "\n")

            rels = [dict(r) for r in start_tree.get("relationships") or [] if isinstance(r, dict)]
            for i, call in enumerate(calls):
                if not isinstance(call, dict):
                    continue
                name = bare_tool_name(str(call.get("tool") or ""))
                args = call.get("args") if isinstance(call.get("args"), dict) else {}
                if name in ("research_append", "merge_tree_persons"):
                    pe_ops = [o for o in _ops(args) if o.get("section") == "person_evidence"] if name == "research_append" else []
                    if name == "research_append" and (not pe_ops or _outcome(call) != "applied"):
                        continue
                    before = replay(calls, starting, upto=i).research
                    line = {
                        "kind": "append" if name == "research_append" else "merge",
                        "run": run_ref, "slug": slug, "call": i,
                        "relationships": [dict(r) for r in rels],
                        "starting_s_ids": sorted(start_s_ids),
                        "source_ids": [x.get("id") for x in before.get("sources") or [] if isinstance(x, dict)],
                        "starting_ids": starting_ids,
                        "pe_before": before.get("person_evidence") or [],
                    }
                    if name == "research_append":
                        line["ops"] = pe_ops
                        line["pe_after"] = replay(calls, starting, upto=i + 1).research.get("person_evidence") or []
                        counts["append calls dumped"] += 1
                    else:
                        line["merges"] = args.get("merges")
                        line["outcome"] = _outcome(call)
                        line["assertion_ids"] = [x.get("id") for x in before.get("assertions") or [] if isinstance(x, dict)]
                        counts["merge calls dumped"] += 1
                    out.write(json.dumps(line, ensure_ascii=False) + "\n")
                elif name in ("tree_edit", "tree_correct"):
                    ops = _ops(args)
                    if not _tree_write_landed(call, ops):
                        continue
                    for op in ops:
                        if name == "tree_edit" and op.get("operation") == "add_relationship" and isinstance(op.get("relationship"), dict):
                            rel = dict(op["relationship"])
                            rel["id"] = _next_relationship_id(rels)
                            ref = _assertion_ref(final, op.get("sourceAssertionId"))
                            if ref and not rel.get("sources"):
                                rel["sources"] = [{"ref": ref}]
                            rels.append(rel)
                        elif name == "tree_correct" and op.get("operation") == "remove" and op.get("relationshipId") and not op.get("factId"):
                            rels = [r for r in rels if r.get("id") != op["relationshipId"]]
    return counts


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    counts = dump(Path(argv[0]))
    for key in sorted(counts):
        print(f"{key}: {counts[key]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
