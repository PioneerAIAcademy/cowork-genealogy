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
  treewrite  a tree_edit or tree_correct call that landed (a recorded success,
          or no recorded outcome with ops that pass today's shape checks)
          whose ops cite a record onto a person's fact or name: those ops,
          its outcome, and person_evidence, assertion and source ids at the
          call.
  shapes  the call shapes the namesake register rows quote, over every
          committed run whatever each call's outcome.

`append`, `merge` and `treewrite` lines also carry the relationships at the call (the
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


CITING_OPS = {"tree_edit": ("add_fact", "add_name"), "tree_correct": ("update_fact", "update_name")}


def _cites_onto_person(tool: str, op: dict) -> bool:
    """An op that cites a source ref onto a person's fact or name: tree_edit's
    add_fact and add_name, tree_correct's update_fact and update_name, on a
    person rather than a relationship."""
    if op.get("operation") not in CITING_OPS.get(tool, ()) or op.get("relationshipId"):
        return False
    node = op.get("fact") if op.get("operation") in ("add_fact", "update_fact") else op.get("name")
    sources = node.get("sources") if isinstance(node, dict) else None
    return isinstance(sources, list) and any(isinstance(x, dict) and isinstance(x.get("ref"), str) and x.get("ref") for x in sources)


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


RANK = {"speculative": 0, "possible": 1, "probable": 2, "confident": 3}


def _shapes(calls: list, starting: dict, run_ref: str, counts: collections.Counter, runs: dict) -> None:
    """Count, over every call whatever its outcome: speculative person_evidence
    appends; person_evidence updates, those naming superseded_by and those
    clearing it; confidence updates that lower a link (its confidence before
    the call from harness.replay); tree_correct relationship removes; and
    merge_tree_persons calls with more than one pair."""
    for i, call in enumerate(calls):
        if not isinstance(call, dict):
            continue
        name = bare_tool_name(str(call.get("tool") or ""))
        args = call.get("args") if isinstance(call.get("args"), dict) else {}
        if name == "merge_tree_persons":
            merges = args.get("merges")
            if isinstance(merges, str):
                try:
                    merges = json.loads(merges)
                except ValueError:
                    merges = None
            if isinstance(merges, list) and len(merges) > 1:
                counts["merge calls with more than one pair"] += 1
        elif name == "tree_correct":
            for op in _ops(args):
                if op.get("operation") == "remove" and op.get("relationshipId") and not op.get("factId"):
                    counts["relationship removes"] += 1
                    runs["runs with a relationship remove"].add(run_ref)
        elif name == "research_append":
            for op in _ops(args):
                if op.get("section") != "person_evidence":
                    continue
                if op.get("op", "append") == "append":
                    entry = op.get("entry") if isinstance(op.get("entry"), dict) else {}
                    if entry.get("confidence") == "speculative":
                        counts["speculative person_evidence appends"] += 1
                        counts[f"speculative person_evidence appends, {_outcome(call)}"] += 1
                        runs["runs with a speculative person_evidence append"].add(run_ref)
                    continue
                if op.get("op") != "update":
                    continue
                fields = op.get("fields") if isinstance(op.get("fields"), dict) else {}
                counts["person_evidence updates"] += 1
                if "superseded_by" in fields:
                    counts["person_evidence updates naming superseded_by"] += 1
                    if not fields.get("superseded_by"):
                        counts["person_evidence updates clearing superseded_by"] += 1
                if "confidence" in fields:
                    counts["person_evidence confidence updates"] += 1
                    prior = next(
                        (e for e in replay(calls, starting, upto=i).research.get("person_evidence") or []
                         if isinstance(e, dict) and e.get("id") == op.get("entryId")),
                        None,
                    )
                    was, now = RANK.get((prior or {}).get("confidence")), RANK.get(fields.get("confidence"))
                    if prior is None:
                        counts["person_evidence confidence updates on an entry the replay lacks"] += 1
                    elif was is not None and now is not None and now < was:
                        counts["person_evidence confidence lowerings"] += 1


def dump(out_path: Path) -> collections.Counter:
    counts: collections.Counter = collections.Counter()
    shapes: collections.Counter = collections.Counter()
    shape_runs: dict = collections.defaultdict(set)
    with out_path.open("w", encoding="utf-8") as out:
        for path in sorted(E2E_RUNLOGS.glob("*/run-*.json")):
            if path.name.endswith(SIDECAR_SUFFIXES):
                continue
            slug = path.parent.name
            run_ref = f"{slug}/{path.name}"
            whole_log = _load(path)
            if whole_log and isinstance(whole_log.get("tool_calls"), list):
                shapes["runs"] += 1
                _shapes(whole_log["tool_calls"], _load(E2E_TESTS / slug / "starting-research.json") or {}, run_ref, shapes, shape_runs)
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
            counts["unmodelled calls"] += sum(whole.unmodelled.values())
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
                        after = replay(calls, starting, upto=i + 1).research
                        line["ops"] = pe_ops
                        line["pe_after"] = after.get("person_evidence") or []
                        line["source_ids_after"] = [x.get("id") for x in after.get("sources") or [] if isinstance(x, dict)]
                        line["assertion_ids_after"] = [x.get("id") for x in after.get("assertions") or [] if isinstance(x, dict)]
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
                    citing = [op for op in ops if _cites_onto_person(name, op)]
                    if citing:
                        before = replay(calls, starting, upto=i).research
                        out.write(json.dumps({
                            "kind": "treewrite", "run": run_ref, "slug": slug, "call": i, "tool": name,
                            "outcome": _outcome(call), "ops": citing, "merges": [],
                            "relationships": [dict(r) for r in rels],
                            "starting_s_ids": sorted(start_s_ids),
                            "source_ids": [x.get("id") for x in before.get("sources") or [] if isinstance(x, dict)],
                            "assertion_ids": [x.get("id") for x in before.get("assertions") or [] if isinstance(x, dict)],
                            "starting_ids": starting_ids,
                            "pe_before": before.get("person_evidence") or [],
                        }, ensure_ascii=False) + "\n")
                        counts["tree write calls dumped"] += 1
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
        for key, runs in shape_runs.items():
            shapes[key] = len(runs)
        out.write(json.dumps({"kind": "shapes", **dict(sorted(shapes.items()))}, ensure_ascii=False) + "\n")
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
