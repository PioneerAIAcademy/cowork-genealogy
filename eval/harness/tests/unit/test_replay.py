"""Unit vectors for harness/replay.py.

These are the cases that must not silently regress. The *corpus* acceptance
check — replay all 154 committed runs and compare against their
`final-research.json` sidecars — lives in a script rather than here, because it
depends on committed run logs that grow every week; it currently reconstructs
136/154 (88%) with an exact id match on all twelve sections.

Each vector below was written to fail before the behaviour it pins existed.
The escaped-and-truncated one in particular: a strict `json.loads` returns None
for it, which silently dropped 1,629 of ~4,800 writer responses and produced a
replay that reconstructed 1% of runs while looking like it worked.
"""

from harness.replay import parse_tool_result, replay


def _call(tool, args, response, is_error=None):
    return {"tool": f"mcp__genealogy__{tool}", "args": args, "response_summary": response, "is_error": is_error}


OK_Q1 = '[{"type": "text", "text": "{\\n  \\"ok\\": true,\\n  \\"entryId\\": \\"q_001\\"\\n}"}]'


def test_append_uses_the_id_the_tool_reported():
    r = replay([_call("research_append", {"section": "questions", "op": "append", "entry": {"question": "who?"}}, OK_Q1)])
    assert [e["id"] for e in r.research["questions"]] == ["q_001"]
    assert r.applied == 1


def test_a_rejected_call_changes_nothing():
    """~12% of corpus writer calls return ok:false. Applying one invents state."""
    bad = '[{"type": "text", "text": "{\\"ok\\": false, \\"errors\\": [\\"nope\\"]}"}]'
    r = replay([_call("research_append", {"section": "questions", "op": "append", "entry": {}}, bad)])
    assert r.research.get("questions", []) == []
    assert r.rejected == 1 and r.applied == 0


def test_is_error_call_changes_nothing():
    r = replay([_call("research_append", {"section": "questions", "op": "append", "entry": {}}, OK_Q1, is_error=True)])
    assert r.research.get("questions", []) == []
    assert r.rejected == 1


def test_truncated_response_is_still_readable():
    """The ledger truncates. A strict JSON parse returns None here and drops the write."""
    cut = '[{"type": "text", "text": "{\\n  \\"ok\\": true,\\n  \\"entryId\\": \\"a_007\\",\\n  \\"filesWri'
    assert parse_tool_result(cut) is not None
    r = replay([_call("extraction_append", {"section": "assertions", "op": "append", "entry": {}}, cut)])
    assert [e["id"] for e in r.research["assertions"]] == ["a_007"]


def test_batch_log_append_ops_get_the_implied_section():
    """research_log_append carries no `section` in either form — the tool implies log.

    The op shape here is the tool's real one: **flat**, not `{entry: {...}}`. An
    earlier version of this vector fed a nested shape the tool never receives,
    which is why it passed while every replayed log entry was a bare id.
    """
    resp = '[{"type": "text", "text": "{\\"ok\\": true, \\"results\\": [{\\"logId\\": \\"log_001\\"}, {\\"logId\\": \\"log_002\\"}]}"}]'
    ops = [
        {"tool": "record_search", "query": "a", "outcome": "results_found"},
        {"tool": "record_search", "query": "b", "outcome": "nil_result"},
    ]
    r = replay([_call("research_log_append", {"ops": ops}, resp)])
    assert [e["id"] for e in r.research["log"]] == ["log_001", "log_002"]
    assert r.unmodelled == {}


def test_log_entries_carry_their_body_not_just_an_id():
    """The whole point of replaying the log: a consumer joins on these fields.

    `research_log_append` takes flat args and renames them on the way in, so
    reading `op["entry"]` (which `research_append` uses) found nothing and the
    section reconstructed as id-shaped shells. The fidelity check compares id
    sets, so it reported a 94-100% `log` match over empty entries.
    """
    resp = '[{"type": "text", "text": "{\\"ok\\": true, \\"logId\\": \\"log_001\\"}"}]'
    args = {
        "projectPath": "/tmp/p",
        "tool": "record_search",
        "query": {"surname": "Flynn"},
        "outcome": "results_found",
        "planItemId": "pli_002",
        "resultsExamined": 5,
        "resultsAvailable": 27,
        "externalSite": {"site": "findagrave", "urlGenerated": "http://x", "captureReceived": True},
    }
    entry = replay([_call("research_log_append", args, resp)]).research["log"][0]
    assert entry["id"] == "log_001"
    assert entry["tool"] == "record_search"
    assert entry["outcome"] == "results_found"
    assert entry["query"] == {"surname": "Flynn"}
    # camelCase inputs are persisted snake_case — the rename the tool performs.
    assert entry["plan_item_id"] == "pli_002"
    assert entry["results_examined"] == 5
    assert entry["results_available"] == 27
    assert entry["external_site"]["url_generated"] == "http://x"
    assert entry["external_site"]["capture_received"] is True
    # Control keys are not entry fields.
    assert "projectPath" not in entry
    # Stamped by the tool from the wall clock / a real sidecar write, so absent
    # rather than invented.
    assert "performed" not in entry and "results_ref" not in entry


def test_a_log_op_with_no_plan_item_gets_an_explicit_null():
    """The tool writes `plan_item_id: null` rather than omitting the key."""
    resp = '[{"type": "text", "text": "{\\"ok\\": true, \\"logId\\": \\"log_001\\"}"}]'
    entry = replay(
        [_call("research_log_append", {"tool": "place_search", "outcome": "nil_result"}, resp)]
    ).research["log"][0]
    assert entry["plan_item_id"] is None


def test_ids_past_a_summarised_batch_are_synthesised_and_counted():
    """A big batch reports only `_first_n`; the rest are reconstructed by convention
    and MUST be counted, so a caller can tell observed fact from inference."""
    resp = (
        '[{"type": "text", "text": "{\\"ok\\": true, \\"results\\": {\\"_summary_truncated\\": true, '
        '\\"_full_length\\": 3, \\"_first_n\\": [{\\"entryId\\": \\"a_001\\"}]}}"}]'
    )
    ops = [{"section": "assertions", "op": "append", "entry": {}} for _ in range(3)]
    r = replay([_call("extraction_append", {"ops": ops}, resp)])
    assert [e["id"] for e in r.research["assertions"]] == ["a_001", "a_002", "a_003"]
    assert r.synthesised_ids == 2


def test_upto_yields_the_state_a_call_would_have_seen():
    """A precondition is judged against the state BEFORE the write it guards."""
    calls = [
        _call("research_append", {"section": "questions", "op": "append", "entry": {}}, OK_Q1),
        _call("research_append", {"section": "questions", "op": "append", "entry": {}},
              '[{"type": "text", "text": "{\\"ok\\": true, \\"entryId\\": \\"q_002\\"}"}]'),
    ]
    assert len(replay(calls, upto=0).research.get("questions", [])) == 0
    assert len(replay(calls, upto=1).research["questions"]) == 1
    assert len(replay(calls).research["questions"]) == 2


def test_starting_research_is_not_mutated():
    start = {"questions": [{"id": "q_001"}]}
    r = replay([_call("research_append", {"section": "questions", "op": "append", "entry": {}},
                      '[{"type": "text", "text": "{\\"ok\\": true, \\"entryId\\": \\"q_002\\"}"}]')],
               starting_research=start)
    assert [e["id"] for e in start["questions"]] == ["q_001"]
    assert [e["id"] for e in r.research["questions"]] == ["q_001", "q_002"]


def test_unknown_writer_is_reported_not_silently_dropped():
    """A replay that ignores a writer looks complete and is not. Tree writers are
    out of scope today and must SAY so.

    The `applied == 0` assertion below is true whether or not the tool is
    reported, so on its own it is a check that cannot fail — and it did not,
    while `unmodelled` came back empty on runs containing tree writes. The
    `unmodelled` assertion is the one that does the work.
    """
    r = replay([_call("tree_edit", {"op": "add_person"}, OK_Q1)])
    assert r.applied == 0
    assert r.unmodelled == {"tool:tree_edit": 1}


def test_a_read_tool_is_not_reported_as_a_coverage_gap():
    """Only writers count. Listing every read would bury the real gap in noise."""
    r = replay([_call("record_search", {"surname": "Flynn"}, OK_Q1)])
    assert r.unmodelled == {}


def test_synthesised_plan_item_ids_do_not_collide():
    """`plan_items` nests into `plans[].items` — there is no top-level array.

    Reading `state["plan_items"]` therefore always found nothing, so every id
    past the ledger's truncation point came out `pli_001`. Duplicate ids then
    make the update-by-id path match the wrong item.
    """
    resp = (
        '[{"type": "text", "text": "{\\"ok\\": true, \\"results\\": {\\"_summary_truncated\\": true, '
        '\\"_full_length\\": 3, \\"_first_n\\": [{\\"entryId\\": \\"pli_001\\"}]}}"}]'
    )
    ops = [{"section": "plan_items", "op": "append", "entry": {}} for _ in range(3)]
    r = replay([_call("research_append", {"ops": ops}, resp)], {"plans": [{"id": "pl_001", "items": []}]})
    ids = [it["id"] for it in r.research["plans"][0]["items"]]
    assert ids == ["pli_001", "pli_002", "pli_003"]
    assert len(ids) == len(set(ids))


def test_a_batched_update_past_the_id_cut_finds_its_target():
    """An UPDATE names its target in `op["entryId"]`; the response only echoes
    it. A summarised batch records only `_first_n` ids, so every update past
    that cut arrives with no reported id — and the lookup consulted `id`, which
    an update payload does not carry. The op was dropped as `no-such-id` while
    naming its target in plain sight."""
    resp = (
        '[{"type": "text", "text": "{\\"ok\\": true, \\"results\\": {\\"_summary_truncated\\": true, '
        '\\"_full_length\\": 2, \\"_first_n\\": [{\\"entryId\\": \\"q_001\\"}]}}"}]'
    )
    ops = [
        {"section": "questions", "op": "update", "entryId": "q_001", "fields": {"status": "exhaustive_declared"}},
        {"section": "questions", "op": "update", "entryId": "q_002", "fields": {"status": "resolved"}},
    ]
    r = replay(
        [_call("research_append", {"ops": ops}, resp)],
        {"questions": [{"id": "q_001", "status": "open"}, {"id": "q_002", "status": "open"}]},
    )
    assert [q["status"] for q in r.research["questions"]] == ["exhaustive_declared", "resolved"]
    assert "update:no-such-id:questions" not in r.unmodelled


def test_a_batched_plan_item_update_past_the_cut_finds_its_target():
    """The plan_items path nests into `plans[].items` and carries its own copy
    of the id lookup. It bites hardest here: a status flip across several items
    is the op most often batched."""
    resp = (
        '[{"type": "text", "text": "{\\"ok\\": true, \\"results\\": {\\"_summary_truncated\\": true, '
        '\\"_full_length\\": 2, \\"_first_n\\": [{\\"entryId\\": \\"pli_001\\"}]}}"}]'
    )
    ops = [
        {"section": "plan_items", "op": "update", "entryId": "pli_001", "fields": {"status": "completed"}},
        {"section": "plan_items", "op": "update", "entryId": "pli_002", "fields": {"status": "skipped"}},
    ]
    r = replay(
        [_call("research_append", {"ops": ops}, resp)],
        {"plans": [{"id": "pl_001", "items": [
            {"id": "pli_001", "status": "in_progress"},
            {"id": "pli_002", "status": "in_progress"},
        ]}]},
    )
    assert [i["status"] for i in r.research["plans"][0]["items"]] == ["completed", "skipped"]
