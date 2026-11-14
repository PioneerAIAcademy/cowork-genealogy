"""research_append's own unanchored-person sweep is not the agent's deletion.

When a call resolves the project's last open question, research_append removes
every minted person no relationship connects to an imported person, with the
edges and the person_evidence/rejected_links entries naming them, and reports it
in `validation.warnings` (research-append-tool-spec.md §5.11). Three validators
used to charge that removal to the agent: `test_no_entries_deleted`,
`test_ownership_table` and proof-conclusion's `test_no_tree_write_below_probable`.

Each is tested both ways here: the tool's own reported removal passes, and every
other deletion — an extra link, an edge the agent removed, the same message on a
refused call, no tool call at all — still fails.

States are wrapped as `{"research_json": ..., "tree_gedcomx_json": ...}`: a bare
dict makes the validators skip, and a skip reads as a pass.
"""

import copy
import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_proof_conclusion import test_no_tree_write_below_probable as check_tree_write  # noqa: E402
from test_universal import (  # noqa: E402
    _tool_reported_removal as removal,
    test_no_entries_deleted as check_no_deletes,
    test_ownership_table as check_ownership,
)

_SCENARIO = Path(__file__).resolve().parents[3] / "fixtures" / "scenarios" / "flynn-parentage-disproved"

POSITIVE = {"type": "positive"}
NO_TREE_WRITE = {"type": "positive", "tags": ["no-tree-write"]}
PROOF_CONCLUSION = {"name": "proof-conclusion"}

# What the engine renders for the flynn scenario (unanchoredRemovalMessage).
FLYNN_MESSAGE = (
    "the last open question is resolved, so the minted persons no relationship connects to an "
    "imported person were removed from the tree: 1 person(s): I2 Thomas Flynn; 2 person_evidence "
    "link(s). Tell the researcher, by name, which persons were removed."
)


def message(*persons, links=0, rejected=0, relationships=0):
    parts = [f"{len(persons)} person(s): " + ", ".join(f"{pid} Name{pid}" for pid in persons)]
    if relationships:
        parts.append(f"{relationships} relationship(s)")
    if links:
        parts.append(f"{links} person_evidence link(s)")
    if rejected:
        parts.append(f"{rejected} rejected_links entr(ies)")
    return (
        "the last open question is resolved, so the minted persons no relationship connects to an "
        f"imported person were removed from the tree: {'; '.join(parts)}. Tell the researcher, by "
        "name, which persons were removed."
    )


def append_call(*warnings, ok=True, tool="mcp__genealogy__research_append"):
    return {
        "tool": tool,
        "args": {"projectPath": "/p", "section": "questions", "op": "update", "entryId": "q_001",
                 "fields": {"status": "resolved"}},
        "expected_args": None,
        "matched": {"kind": "live"},
        "response_fixture": "live:research_append",
        "response": {"ok": ok, "section": "questions", "op": "update", "entryId": "q_001",
                     "filesWritten": ["research.json"],
                     "validation": {"valid": True, "warnings": ["a word-budget warning", *warnings]}},
    }


def merge_call(survivor, collapsed):
    return {"tool": "mcp__genealogy__merge_tree_persons", "args": {"projectPath": "/p",
            "merges": [[survivor, collapsed]]}, "matched": {}, "response_fixture": None,
            "response": {"ok": True}}


def person(pid, **extra):
    return {"id": pid, "names": [{"id": f"N{pid}", "preferred": True, "given": f"Name{pid}"}], **extra}


def tree(*pids, relationships=()):
    return {"persons": [person(p) if isinstance(p, str) else p for p in pids],
            "relationships": list(relationships), "sources": []}


def pe(pid, person_id, confidence="probable"):
    return {"id": pid, "assertion_id": f"a_{pid[-3:]}", "person_id": person_id, "confidence": confidence,
            "rationale": "r", "created": "2026-11-01"}


def rj(rid, person_id):
    return {"id": rid, "assertion_id": "a_009", "person_id": person_id, "reason": "not him",
            "created": "2026-11-01"}


def state(tree_doc, person_evidence=(), rejected_links=None, sources=()):
    research = {
        "project": {"id": "proj_001", "objective": "x", "subject_person_ids": ["I1"]},
        "questions": [], "plans": [], "log": [], "sources": list(sources), "assertions": [],
        "person_evidence": list(person_evidence), "conflicts": [], "hypotheses": [], "timelines": [],
        "proof_summaries": [], "evaluations": [], "localities": [],
    }
    if rejected_links is not None:
        research["rejected_links"] = list(rejected_links)
    return {"research_json": research, "tree_gedcomx_json": tree_doc}


def passes(check, *args, **kwargs):
    try:
        check(*args, **kwargs)
    except pytest.skip.Exception as skipped:
        pytest.fail(f"the validator skipped, which would read as a pass: {skipped}")


def fails(check, *args, **kwargs):
    try:
        with pytest.raises(AssertionError):
            check(*args, **kwargs)
    except pytest.skip.Exception as skipped:
        pytest.fail(f"the validator skipped, which would read as a pass: {skipped}")


# --- the helper -------------------------------------------------------------

BEFORE = tree("I1", "I2")
AFTER = tree("I1")


def test_names_the_person_the_tool_removed():
    assert removal([append_call(message("I2", links=2))], BEFORE) == {"I2"}


def test_names_every_listed_person():
    assert removal([append_call(message("I2", "I3"))], tree("I1", "I2", "I3")) == {"I2", "I3"}


@pytest.mark.parametrize("tool", [
    "mcp__genealogy__research_append",
    "mcp__remote-devices__Genealogy_Research__research_append",
    "mcp__Genealogy_Research__research_append",
])
def test_every_server_spelling(tool):
    assert removal([append_call(message("I2"), tool=tool)], BEFORE) == {"I2"}


def test_a_refused_call_removes_nothing():
    assert removal([append_call(message("I2"), ok=False)], BEFORE) == set()


@pytest.mark.parametrize("ok", [None, "missing", 1, "true"])
def test_a_response_whose_ok_is_not_true_removes_nothing(ok):
    call = append_call(message("I2"))
    if ok == "missing":
        del call["response"]["ok"]
    else:
        call["response"]["ok"] = ok
    assert removal([call], BEFORE) == set()


def test_a_merge_survivor_minted_during_the_run_counts():
    calls = [merge_call("I3", "I2"), append_call(message("I3"))]
    assert removal(calls, BEFORE) == {"I3"}
    assert removal(calls[1:], BEFORE) == set()


def test_a_refused_merge_adds_no_candidate():
    refused = merge_call("I3", "I2")
    refused["response"] = {"ok": False}
    assert removal([refused, append_call(message("I3"))], BEFORE) == set()


@pytest.mark.parametrize("response", [None, "the last open question is resolved, so the minted persons I2", {}, {"ok": True},
                                      {"ok": True, "validation": None}, {"ok": True, "validation": {"warnings": "I2"}}])
def test_a_response_without_the_warning_removes_nothing(response):
    call = append_call()
    call["response"] = response
    assert removal([call], BEFORE) == set()


def test_a_reworded_message_removes_nothing():
    reworded = message("I2").replace("the last open question is resolved", "the final question closed")
    assert removal([append_call(reworded)], BEFORE) == set()


def test_the_prefix_must_open_the_warning():
    assert removal([append_call("note: " + message("I2"))], BEFORE) == set()


def test_another_tool_with_the_same_words_removes_nothing():
    assert removal([append_call(message("I2"), tool="mcp__genealogy__tree_edit")], BEFORE) == set()


def test_a_named_id_not_in_the_before_tree_is_not_counted():
    assert removal([append_call(message("I7"))], BEFORE) == set()


def test_a_person_not_named_is_not_the_tool_s():
    assert removal([append_call(message("I2"))], tree("I1", "I2", "I3")) == {"I2"}


def test_an_id_is_matched_as_a_whole_word():
    assert removal([append_call(message("I22"))], tree("I1", "I2", "I22")) == {"I22"}


def test_an_id_inside_a_name_is_not_listed():
    named = message("I3").replace("I3 NameI3", "I3 I2 Smith")
    assert removal([append_call(named)], tree("I1", "I2", "I3")) == {"I3"}


def test_no_tool_calls_removes_nothing():
    assert removal(None, BEFORE) == set()


# --- test_no_entries_deleted --------------------------------------------------

LINKS_BEFORE = [pe("pe_001", "I1"), pe("pe_002", "I2"), pe("pe_003", "I2")]
LINKS_AFTER = [pe("pe_001", "I1")]


def test_no_deletes_passes_the_tool_s_removal():
    passes(check_no_deletes, state(BEFORE, LINKS_BEFORE), state(AFTER, LINKS_AFTER),
           tool_calls=[append_call(message("I2", links=2))])


def test_no_deletes_still_fails_an_extra_deletion():
    fails(check_no_deletes, state(BEFORE, LINKS_BEFORE), state(AFTER, []),
          tool_calls=[append_call(message("I2", links=2))])


def test_no_deletes_fails_on_a_refused_call():
    fails(check_no_deletes, state(BEFORE, LINKS_BEFORE), state(AFTER, LINKS_AFTER),
          tool_calls=[append_call(message("I2", links=2), ok=False)])


def test_no_deletes_fails_with_no_tool_calls():
    fails(check_no_deletes, state(BEFORE, LINKS_BEFORE), state(AFTER, LINKS_AFTER))


def test_no_deletes_passes_rejected_links_the_tool_removed():
    passes(check_no_deletes, state(BEFORE, LINKS_BEFORE, [rj("rj_001", "I2")]),
           state(AFTER, LINKS_AFTER, []), tool_calls=[append_call(message("I2", links=2, rejected=1))])


def test_no_deletes_still_fails_a_rejection_of_a_surviving_person():
    fails(check_no_deletes, state(BEFORE, LINKS_BEFORE, [rj("rj_001", "I2"), rj("rj_002", "I1")]),
          state(AFTER, LINKS_AFTER, []), tool_calls=[append_call(message("I2", links=2, rejected=1))])


def test_no_deletes_still_fails_another_section():
    source = {"id": "src_001", "title": "t"}
    fails(check_no_deletes, state(BEFORE, LINKS_BEFORE, sources=[source]), state(AFTER, LINKS_AFTER),
          tool_calls=[append_call(message("I2", links=2))])


def test_no_deletes_passes_when_a_later_write_reuses_the_removed_id():
    passes(check_no_deletes, state(BEFORE, LINKS_BEFORE), state(tree("I1", "I2"), LINKS_AFTER),
           tool_calls=[append_call(message("I2", links=2))])


def test_no_deletes_fails_cleanly_on_a_person_id_that_is_not_a_string():
    odd = {**pe("pe_002", "I2"), "person_id": ["I2"]}
    fails(check_no_deletes, state(BEFORE, [pe("pe_001", "I1"), odd]), state(AFTER, LINKS_AFTER),
          tool_calls=[append_call(message("I2", links=1))])
    fails(ownership, state(BEFORE, [pe("pe_001", "I1"), odd]), state(AFTER, LINKS_AFTER),
          tool_calls=[append_call(message("I2", links=1))])


def test_only_the_two_swept_sections_are_exempt():
    before, after = state(BEFORE, LINKS_BEFORE), state(AFTER, LINKS_AFTER)
    before["research_json"]["namesakes"] = [{"id": "ns_001", "person_id": "I2", "record_persona_ids": []}]
    after["research_json"]["namesakes"] = []
    calls = [append_call(message("I2", links=2))]
    fails(check_no_deletes, before, after, tool_calls=calls)
    fails(ownership, before, after, tool_calls=calls)


def test_no_deletes_passes_a_merge_then_the_sweep():
    before = state(tree("I1", "I2", "I9"), [*LINKS_BEFORE, pe("pe_005", "I9")])
    after = state(AFTER, LINKS_AFTER)
    calls = [merge_call("I2", "I9"), append_call(message("I2", links=3))]
    passes(check_no_deletes, before, after, tool_calls=calls)
    fails(check_no_deletes, before, after, tool_calls=calls[1:])


MINTED_SURVIVOR = [merge_call("I3", "I2"), append_call(message("I3", links=2))]


def test_no_deletes_passes_a_merge_into_a_person_minted_during_the_run():
    passes(check_no_deletes, state(BEFORE, LINKS_BEFORE), state(AFTER, LINKS_AFTER), tool_calls=MINTED_SURVIVOR)
    fails(check_no_deletes, state(BEFORE, LINKS_BEFORE), state(AFTER, []), tool_calls=MINTED_SURVIVOR)


# --- test_ownership_table -----------------------------------------------------

def ownership(before, after, tool_calls=None):
    check_ownership(before, after, PROOF_CONCLUSION, POSITIVE, tool_calls=tool_calls)


def test_ownership_passes_the_tool_s_removal():
    passes(ownership, state(BEFORE, LINKS_BEFORE), state(AFTER, LINKS_AFTER),
           tool_calls=[append_call(message("I2", links=2))])


def test_ownership_still_fails_an_extra_deletion():
    fails(ownership, state(BEFORE, LINKS_BEFORE), state(AFTER, []),
          tool_calls=[append_call(message("I2", links=2))])


def test_ownership_still_fails_an_edit_beside_the_removal():
    fails(ownership, state(BEFORE, LINKS_BEFORE), state(AFTER, [pe("pe_001", "I1", confidence="confident")]),
          tool_calls=[append_call(message("I2", links=2))])


def test_ownership_still_fails_an_append_beside_the_removal():
    fails(ownership, state(BEFORE, LINKS_BEFORE), state(AFTER, [*LINKS_AFTER, pe("pe_009", "I1")]),
          tool_calls=[append_call(message("I2", links=2))])


def test_ownership_fails_on_a_refused_call():
    fails(ownership, state(BEFORE, LINKS_BEFORE), state(AFTER, LINKS_AFTER),
          tool_calls=[append_call(message("I2", links=2), ok=False)])


def test_ownership_fails_with_no_tool_calls():
    fails(ownership, state(BEFORE, LINKS_BEFORE), state(AFTER, LINKS_AFTER))


def test_ownership_passes_rejected_links_the_tool_removed():
    passes(ownership, state(BEFORE, LINKS_BEFORE, [rj("rj_001", "I2")]), state(AFTER, LINKS_AFTER, []),
           tool_calls=[append_call(message("I2", links=2, rejected=1))])


def test_ownership_passes_a_merge_then_the_sweep():
    before = state(tree("I1", "I2", "I9"), [*LINKS_BEFORE, pe("pe_005", "I9")])
    after = state(AFTER, LINKS_AFTER)
    calls = [merge_call("I2", "I9"), append_call(message("I2", links=3))]
    passes(ownership, before, after, tool_calls=calls)
    fails(ownership, before, after, tool_calls=calls[1:])


def test_ownership_passes_a_merge_into_a_person_minted_during_the_run():
    passes(ownership, state(BEFORE, LINKS_BEFORE), state(AFTER, LINKS_AFTER), tool_calls=MINTED_SURVIVOR)
    fails(ownership, state(BEFORE, LINKS_BEFORE), state(AFTER, []), tool_calls=MINTED_SURVIVOR)


# --- test_no_tree_write_below_probable ------------------------------------------

def tree_write(before, after, tool_calls=None):
    check_tree_write({"tree_gedcomx_json": before}, {"tree_gedcomx_json": after}, NO_TREE_WRITE,
                     tool_calls=tool_calls)


def couple(rid, a, b):
    return {"id": rid, "type": "Couple", "person1": a, "person2": b}


def parent_child(rid, parent, child):
    return {"id": rid, "type": "ParentChild", "parent": parent, "child": child}


def test_tree_passes_the_tool_s_removal():
    passes(tree_write, BEFORE, AFTER, tool_calls=[append_call(message("I2"))])


def test_tree_passes_a_swept_couple_and_their_edge():
    before = tree("I1", "I2", "I3", relationships=[couple("R1", "I2", "I3")])
    passes(tree_write, before, tree("I1"), tool_calls=[append_call(message("I2", "I3", relationships=1))])


def test_tree_fails_an_edge_the_agent_cut_to_a_surviving_person():
    before = tree("I1", "I2", relationships=[parent_child("R1", "I2", "I1")])
    fails(tree_write, before, tree("I1"), tool_calls=[append_call(message("I2"))])


def test_tree_passes_a_swept_edge_whose_other_end_names_no_person():
    before = tree("I1", "I2", relationships=[couple("R1", "I2", "I99")])
    passes(tree_write, before, tree("I1"), tool_calls=[append_call(message("I2", relationships=1))])


def test_tree_keeps_an_edge_with_no_endpoints_in_the_comparison():
    stray = {"id": "R9", "type": "Couple"}
    before = tree("I1", "I2", relationships=[stray])
    passes(tree_write, before, tree("I1", relationships=[stray]), tool_calls=[append_call(message("I2"))])


def test_tree_fails_a_relationship_added_below_probable():
    after = tree("I1", relationships=[parent_child("R1", "I3", "I1")])
    fails(tree_write, BEFORE, after, tool_calls=[append_call(message("I2"))])


def test_tree_fails_on_a_refused_call():
    fails(tree_write, BEFORE, AFTER, tool_calls=[append_call(message("I2"), ok=False)])


def test_tree_fails_with_no_tool_calls():
    fails(tree_write, BEFORE, AFTER)


def tree_call(args, ok=True, written=("tree.gedcomx.json",), tool="mcp__genealogy__tree_edit"):
    return {"tool": tool, "args": {"projectPath": "/p", **args}, "matched": {}, "response_fixture": None,
            "response": {"ok": ok, "filesWritten": list(written)}}


@pytest.mark.parametrize("call", [
    tree_call({"operation": "update_fact", "personId": "I2", "factId": "F1", "fact": {"primary": True}}),
    tree_call({"ops": [{"operation": "add_relationship", "relationship": {"type": "ParentChild", "parent": "I2", "child": "I9"}}]}),
    tree_call({"operation": "remove", "personId": "I2", "factId": "F1"}, tool="mcp__genealogy__tree_correct"),
    tree_call({"merges": [["I2", "I8"]]}, written=("tree.gedcomx.json", "research.json"), tool="mcp__genealogy__merge_tree_persons"),
    tree_call({"personId": "I2", "assertionIds": ["a_003"]}, tool="mcp__Genealogy_Research__materialize_facts"),
])
def test_tree_fails_a_write_to_a_person_the_sweep_then_removed(call):
    fails(tree_write, BEFORE, AFTER, tool_calls=[call, append_call(message("I2"))])


@pytest.mark.parametrize("call", [
    tree_call({"operation": "add_source", "source": {"title": "1850 census"}}),
    tree_call({"operation": "update_fact", "personId": "I2", "factId": "F1"}, ok=False),
    tree_call({"operation": "update_fact", "personId": "I2", "factId": "F1"}, written=("research.json",)),
    tree_call({"operation": "update_fact", "personId": "I2", "factId": "F1"}, tool="mcp__genealogy__tree_query"),
])
def test_tree_passes_a_call_that_wrote_no_swept_person(call):
    passes(tree_write, BEFORE, AFTER, tool_calls=[call, append_call(message("I2"))])


def test_tree_reads_both_trees_as_the_healer_leaves_them():
    before = tree("I1", person("I2", facts=[]), person("I3", facts=[]))
    after = tree("I1", person("I2"))
    passes(tree_write, before, after, tool_calls=[append_call(message("I3"))])


def test_tree_ignores_a_run_not_tagged_no_tree_write():
    with pytest.raises(pytest.skip.Exception):
        check_tree_write({"tree_gedcomx_json": BEFORE}, {"tree_gedcomx_json": AFTER}, POSITIVE)


# --- the real flynn-parentage-disproved scenario (ut_proof_conclusion_006, _d3c) ---

def _flynn():
    research = json.loads((_SCENARIO / "research.json").read_text(encoding="utf-8"))
    tree_doc = json.loads((_SCENARIO / "tree.gedcomx.json").read_text(encoding="utf-8"))
    before = {"research_json": research, "tree_gedcomx_json": tree_doc}
    after = copy.deepcopy(before)
    after["research_json"]["questions"][0]["status"] = "resolved"
    after["research_json"]["person_evidence"] = [
        e for e in after["research_json"]["person_evidence"] if e["person_id"] != "I2"
    ]
    after["tree_gedcomx_json"]["persons"] = [p for p in after["tree_gedcomx_json"]["persons"] if p["id"] != "I2"]
    return before, after


def test_flynn_disproved_sweep_passes_all_three():
    before, after = _flynn()
    calls = [append_call(FLYNN_MESSAGE)]
    check_no_deletes(before, after, tool_calls=calls)
    check_ownership(before, after, PROOF_CONCLUSION, POSITIVE, tool_calls=calls)
    check_tree_write(before, after, NO_TREE_WRITE, tool_calls=calls)


def test_flynn_disproved_sweep_without_the_tool_s_report_fails_all_three():
    before, after = _flynn()
    fails(check_no_deletes, before, after)
    fails(check_ownership, before, after, PROOF_CONCLUSION, POSITIVE)
    fails(check_tree_write, before, after, NO_TREE_WRITE)


def test_flynn_an_extra_link_deleted_beside_the_sweep_fails():
    before, after = _flynn()
    after["research_json"]["person_evidence"] = []
    calls = [append_call(FLYNN_MESSAGE)]
    fails(check_no_deletes, before, after, tool_calls=calls)
    fails(check_ownership, before, after, PROOF_CONCLUSION, POSITIVE, tool_calls=calls)


# --- the prefix the validators read is the one the engine writes -------------

_ENGINE_SOURCE = Path(__file__).resolve().parents[4] / "packages" / "engine" / "mcp-server" / "src" / "tools" / "research-append.ts"


def test_the_engine_message_opens_with_the_validators_prefix():
    from test_universal import _UNANCHORED_REMOVAL_PREFIX

    source = _ENGINE_SOURCE.read_text(encoding="utf-8")
    start = source.index("function unanchoredRemovalMessage(")
    body = source[start: source.index("\n}\n", start)]
    assert "`" + _UNANCHORED_REMOVAL_PREFIX in body, (
        "unanchoredRemovalMessage no longer opens with _UNANCHORED_REMOVAL_PREFIX: reword both together"
    )
