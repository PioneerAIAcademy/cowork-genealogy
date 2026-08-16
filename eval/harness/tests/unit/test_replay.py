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
    """research_log_append carries no `section` in either form — the tool implies log."""
    resp = '[{"type": "text", "text": "{\\"ok\\": true, \\"results\\": [{\\"logId\\": \\"log_001\\"}, {\\"logId\\": \\"log_002\\"}]}"}]'
    r = replay([_call("research_log_append", {"ops": [{"entry": {"query": "a"}}, {"entry": {"query": "b"}}]}, resp)])
    assert [e["id"] for e in r.research["log"]] == ["log_001", "log_002"]
    assert r.unmodelled == {}


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
    out of scope today and must SAY so."""
    r = replay([_call("tree_edit", {"op": "add_person"}, OK_Q1)])
    assert r.applied == 0
