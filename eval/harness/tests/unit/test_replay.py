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


def test_an_already_logged_re_send_is_not_a_second_append():
    """A re-sent staged ref answers with the existing id and writes nothing."""
    first = '[{"type": "text", "text": "{\\"ok\\": true, \\"logId\\": \\"log_001\\"}"}]'
    again = '[{"type": "text", "text": "{\\"ok\\": true, \\"logId\\": \\"log_001\\", \\"alreadyLogged\\": true}"}]'
    batch = '[{"type": "text", "text": "{\\"ok\\": true, \\"results\\": [{\\"logId\\": \\"log_001\\", \\"alreadyLogged\\": true}, {\\"logId\\": \\"log_002\\"}]}"}]'
    ref = {"stagedResultsRef": "results/.staging/a.json"}
    r = replay([
        _call("research_log_append", dict(ref, notes="first"), first),
        _call("research_log_append", dict(ref, notes="again"), again),
        _call("research_log_append", {"ops": [ref, {"stagedResultsRef": "results/.staging/b.json"}]}, batch),
    ])
    assert [e["id"] for e in r.research["log"]] == ["log_001", "log_002"]
    assert r.research["log"][0]["notes"] == "first"


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

def _with_a011():
    """Starting state holding the assertion the updates below target. Without it
    `_apply_op` reports `update:no-such-id` and the op never applies, which would
    make these tests pass for the wrong reason."""
    return {"assertions": [{"id": "a_011", "place": "Wellburn, Ontario, Canada"}]}


OK_A11 = '[{"type": "text", "text": "{\\n  \\"ok\\": true,\\n  \\"entryId\\": \\"a_011\\"\\n}"}]'


def test_an_assertion_update_reports_its_unmodelled_tree_half():
    """#2472: an assertion `update` touching a mirrored attribute also rewrites
    the tree fact minted from it. The research half IS applied here, so the call
    must not be reported as wholly unmodelled -- but a consumer needing tree
    state would otherwise silently read the pre-call tree as current.

    `applied == 1` is true whether or not the gap is reported, so on its own it
    is a check that cannot fail. The `unmodelled` assertion is the one that
    works; the sibling test above says the same about the whole-tool case.
    """
    r = replay([_call("research_append",
                      {"section": "assertions", "op": "update", "entryId": "a_011",
                       "fields": {"place": "Odessa, Saskatchewan, Canada"}},
                      OK_A11)], starting_research=_with_a011())
    assert r.applied == 1
    assert r.unmodelled == {"tree:research_append:fact-rewrite": 1}


def test_extraction_append_reports_the_same_tree_half():
    """It routes through the same module, so it writes the tree the same way."""
    r = replay([_call("extraction_append",
                      {"section": "assertions", "op": "update", "entryId": "a_011",
                       "fields": {"standard_place": "Odessa, Saskatchewan, Canada"}},
                      OK_A11)], starting_research=_with_a011())
    assert r.unmodelled == {"tree:extraction_append:fact-rewrite": 1}


def test_an_assertion_update_touching_no_mirrored_field_reports_nothing():
    """The other direction. An update that cannot have rewritten a fact must not
    claim a coverage gap, or the counter becomes noise nobody reads."""
    r = replay([_call("research_append",
                      {"section": "assertions", "op": "update", "entryId": "a_011",
                       "fields": {"informant": "official"}},
                      OK_A11)], starting_research=_with_a011())
    assert r.applied == 1
    assert r.unmodelled == {}


def test_an_assertion_APPEND_reports_nothing():
    """Only `update` reaches the rewrite; an append mints an assertion with no
    fact to rewrite yet.

    Carries `fields` rather than the `entry` a real append uses, deliberately:
    with `entry` this passes on the `fields` type check alone and says nothing
    about the `op == "update"` condition it claims to pin. Dropping that
    condition must redden this test, and with `entry` it did not.
    """
    r = replay([_call("research_append",
                      {"section": "assertions", "op": "append",
                       "fields": {"place": "Odessa, Saskatchewan, Canada"}},
                      OK_A11)])
    assert r.unmodelled == {}


def test_a_batch_reports_once_per_qualifying_op():
    """The gap is per-op, not per-call: two corrected assertions are two facts."""
    r = replay([_call("research_append",
                      {"ops": [
                          {"section": "assertions", "op": "update", "entryId": "a_011",
                           "fields": {"place": "Odessa, Saskatchewan, Canada"}},
                          {"section": "assertions", "op": "update", "entryId": "a_012",
                           "fields": {"date": "1925"}},
                          {"section": "questions", "op": "update", "entryId": "q_001",
                           "fields": {"status": "resolved"}},
                      ]},
                      OK_A11)],
                 starting_research={"assertions": [{"id": "a_011"}, {"id": "a_012"}],
                                    "questions": [{"id": "q_001"}]})
    assert r.unmodelled == {"tree:research_append:fact-rewrite": 2}


_HAND_OFF_URL = "https://www.findagrave.com/memorial/search?lastname=Flynn"
OK_HAND_OFF = (
    '[{"type": "text", "text": "{\n  \\"ok\\": true,\n  \\"url\\": \\"' + _HAND_OFF_URL + '\\",'
    '\n  \\"access\\": \\"free\\",\n  \\"logId\\": \\"log_001\\"\n}"}]'
)
OK_NO_LOG = (
    '[{"type": "text", "text": "{\n  \\"ok\\": true,\n  \\"url\\": \\"' + _HAND_OFF_URL + '\\",'
    '\n  \\"access\\": \\"free\\"\n}"}]'
)


def test_a_builder_hand_off_replays_as_its_log_entry():
    """The builder writes the in-flight external_site entry when given projectPath."""
    args = {"site": "findagrave", "attributes": {"surname": "Flynn"}, "projectPath": "/p", "planItemId": "pli_002"}
    r = replay([_call("build_external_search_url", args, OK_HAND_OFF)])
    (entry,) = r.research["log"]
    assert entry["id"] == "log_001"
    assert entry["plan_item_id"] == "pli_002"
    assert entry["outcome"] == "partial"
    assert entry["query"] == {"surname": "Flynn"}
    assert entry["external_site"] == {"site": "findagrave", "url_generated": _HAND_OFF_URL, "capture_received": False}
    assert r.synthesised_ids == 0
    assert not r.unmodelled


def test_a_builder_call_without_projectpath_replays_as_nothing():
    """No projectPath, no write — and no invented id, which the generic path would mint."""
    r = replay([_call("build_external_search_url", {"site": "findagrave", "attributes": {"surname": "Flynn"}}, OK_NO_LOG)])
    assert r.research.get("log", []) == []
    assert r.synthesised_ids == 0
    assert not r.unmodelled


def test_a_builder_call_whose_ledger_lost_the_logid_is_not_invented():
    args = {"site": "findagrave", "attributes": {"surname": "Flynn"}, "projectPath": "/p"}
    r = replay([_call("build_external_search_url", args, OK_NO_LOG)])
    assert r.research.get("log", []) == []
    assert r.synthesised_ids == 0


# The record-id form of extraction_append (#3312), as the e2e ledger records it:
# one string, the tool's records list, a logId and srcId per record.
STAGED_ARGS = {"projectPath": "/p", "recordIds": ["ark:/61903/1:1:AAA", "ark:/61903/1:1:BBB"], "questionIds": ["q_001"]}
STAGED_RESP = (
    '[{"ok": true, "records": [{"recordId": "ark:/61903/1:1:AAA", "status": "extracted", '
    '"summary": "x", "logId": "log_004", "srcId": "src_001", "warnings": []}, '
    '{"recordId": "ark:/61903/1:1:BBB", "status": "extracted", "summary": "y", '
    '"logId": "log_005", "srcId": "src_002", "warnings": []}]}]'
)
STAGED_FINAL = {
    "log": [{"id": "log_004", "tool": "record_read"}, {"id": "log_005", "tool": "record_read"},
            {"id": "log_009", "tool": "record_search"}],
    "sources": [{"id": "src_001", "log_entry_id": "log_004"}, {"id": "src_002", "log_entry_id": "log_005"},
                {"id": "src_003", "log_entry_id": "log_009"}],
    "assertions": [{"id": "a_001", "log_entry_id": "log_004"}, {"id": "a_002", "log_entry_id": "log_004"},
                   {"id": "a_003", "log_entry_id": "log_005"}, {"id": "a_004", "log_entry_id": "log_009"}],
}


def test_a_record_id_extraction_is_read_back_from_the_final_notes():
    """The arguments carry no assertions, so the generic path wrote one empty
    log entry and none of them: every later assertions query replayed short."""
    r = replay([_call("extraction_append", STAGED_ARGS, STAGED_RESP)], final_research=STAGED_FINAL)
    assert [e["id"] for e in r.research["log"]] == ["log_004", "log_005"]
    assert [e["id"] for e in r.research["sources"]] == ["src_001", "src_002"]
    assert [e["id"] for e in r.research["assertions"]] == ["a_001", "a_002", "a_003"]
    assert r.research["log"][0] == {"id": "log_004", "tool": "record_read"}
    # The call carries questionIds, so it may also have tied a re-found record
    # to them, which no argument shows (issue #3516): reported, not guessed.
    assert r.applied == 7 and r.unmodelled == {"extraction_append:question-tie": 1}


def test_a_record_id_extraction_without_final_notes_is_reported_not_guessed():
    r = replay([_call("extraction_append", STAGED_ARGS, STAGED_RESP)])
    assert r.research.get("log", []) == [] and r.research.get("assertions", []) == []
    assert r.unmodelled == {"tool:extraction_append:record-ids": 1, "extraction_append:question-tie": 1}


def test_a_person_id_extraction_is_reported_and_adds_no_log_entry():
    """extraction_append({ personId }) extracts and links attachments its
    arguments do not carry; the generic path would have read it as a log entry."""
    resp = '[{"ok": true, "records": [], "extracted": 0, "linked": 0, "skipped": 0, "summary": "s"}]'
    r = replay([_call("extraction_append", {"projectPath": "/p", "personId": "I1"}, resp)])
    assert r.research.get("log", []) == []
    assert r.unmodelled == {"extraction_append:person-links": 1}


def test_a_plan_item_completion_is_reported():
    args = {k: v for k, v in STAGED_ARGS.items() if k != "questionIds"}
    resp = STAGED_RESP.replace('"warnings": []}]}]', '"warnings": []}], "planItems": {"completed": ["pli_001"]}}]')
    r = replay([_call("extraction_append", args, resp)], final_research=STAGED_FINAL)
    assert r.unmodelled == {"extraction_append:plan-items": 1}


def test_a_record_id_extraction_does_not_duplicate_what_is_already_there():
    start = {"log": [{"id": "log_004", "tool": "record_read"}], "sources": [], "assertions": [{"id": "a_001", "log_entry_id": "log_004"}]}
    r = replay([_call("extraction_append", STAGED_ARGS, STAGED_RESP)], start, final_research=STAGED_FINAL)
    assert [e["id"] for e in r.research["log"]] == ["log_004", "log_005"]
    assert [e["id"] for e in r.research["assertions"]] == ["a_001", "a_002", "a_003"]


def test_a_record_id_extraction_the_final_notes_lack_is_reported():
    resp = STAGED_RESP.replace("log_005", "log_099")
    r = replay([_call("extraction_append", STAGED_ARGS, resp)], final_research=STAGED_FINAL)
    assert [e["id"] for e in r.research["assertions"]] == ["a_001", "a_002"]
    assert r.unmodelled == {"extraction_append:not-in-final": 1, "extraction_append:question-tie": 1}


def test_a_rejected_record_id_extraction_changes_nothing():
    bad = '[{"ok": false, "errors": ["no staged record"]}]'
    r = replay([_call("extraction_append", STAGED_ARGS, bad)], final_research=STAGED_FINAL)
    assert r.research.get("assertions", []) == []
    assert r.rejected == 1


def test_an_ops_shaped_extraction_ignores_the_final_notes():
    """The op form still replays its own arguments; final notes are not a shortcut."""
    resp = '[{"type": "text", "text": "{\\"ok\\": true, \\"results\\": [{\\"entryId\\": \\"a_009\\"}]}"}]'
    args = {"ops": [{"section": "assertions", "op": "append", "entry": {"value": "v"}}]}
    r = replay([_call("extraction_append", args, resp)], final_research=STAGED_FINAL)
    assert r.research["assertions"] == [{"value": "v", "id": "a_009"}]


# A long answer is cut by the capture (`_summary_truncated`), so the logIds of
# the later records never reach the replay. The call's own recordIds are never
# cut; each is back-filled from the final log entry whose query names it.
TRUNC_FINAL = {
    "log": [{"id": "log_004", "tool": "record_read", "query": {"recordId": "ark:/61903/1:1:AAA"}},
            {"id": "log_005", "tool": "record_read", "query": {"recordId": "ark:/61903/1:1:BBB"}},
            {"id": "log_009", "tool": "record_read", "query": {"recordId": "ark:/61903/1:1:BBB"}}],
    "sources": [{"id": "src_001", "log_entry_id": "log_004"}, {"id": "src_002", "log_entry_id": "log_005"},
                {"id": "src_003", "log_entry_id": "log_009"}],
    "assertions": [{"id": "a_001", "log_entry_id": "log_004"}, {"id": "a_003", "log_entry_id": "log_005"},
                   {"id": "a_004", "log_entry_id": "log_009"}],
}
TRUNC_ARGS = {"projectPath": "/p", "recordIds": ["ark:/61903/1:1:AAA", "ark:/61903/1:1:BBB"]}


def test_a_record_cut_from_a_truncated_summary_is_back_filled():
    resp = ('[{"ok": true, "records": {"_summary_truncated": true, "_full_length": 2, "_first_n": '
            '[{"recordId": "ark:/61903/1:1:AAA", "status": "extracted", "logId": "log_004"}]}}]')
    r = replay([_call("extraction_append", TRUNC_ARGS, resp)], final_research=TRUNC_FINAL)
    # BBB's EARLIEST entry, log_005 -- never the later call's log_009.
    assert [e["id"] for e in r.research["log"]] == ["log_004", "log_005"]
    assert [e["id"] for e in r.research["assertions"]] == ["a_001", "a_003"]


def test_a_record_cut_mid_entry_is_back_filled():
    """The cut fell after BBB's recordId and before its logId."""
    resp = ('[{"ok": true, "records": {"_summary_truncated": true, "_full_length": 2, "_first_n": '
            '[{"recordId": "ark:/61903/1:1:AAA", "status": "extracted", "logId": "log_004"}, '
            '{"recordId": "ark:/61903/1:1:BBB", "status": "extracted", "summ...')
    r = replay([_call("extraction_append", TRUNC_ARGS, resp)], final_research=TRUNC_FINAL)
    assert [e["id"] for e in r.research["log"]] == ["log_004", "log_005"]


def test_a_record_the_truncated_summary_shows_refused_is_not_back_filled():
    """It wrote nothing; the final notes' entry for it belongs to a later call."""
    resp = ('[{"ok": true, "records": {"_summary_truncated": true, "_full_length": 2, "_first_n": '
            '[{"recordId": "ark:/61903/1:1:AAA", "status": "extracted", "logId": "log_004"}, '
            '{"recordId": "ark:/61903/1:1:BBB", "status": "refused", "summary": "no"}]}}]')
    r = replay([_call("extraction_append", TRUNC_ARGS, resp)], final_research=TRUNC_FINAL)
    assert [e["id"] for e in r.research["log"]] == ["log_004"]


def test_an_untruncated_summary_is_never_back_filled():
    resp = '[{"ok": true, "records": [{"recordId": "ark:/61903/1:1:AAA", "status": "extracted", "logId": "log_004"}]}]'
    r = replay([_call("extraction_append", TRUNC_ARGS, resp)], final_research=TRUNC_FINAL)
    assert [e["id"] for e in r.research["log"]] == ["log_004"]


def test_a_documents_extraction_is_read_back_from_the_final_notes():
    """The user-provided-documents form writes its source, log entry and
    assertions host-side exactly as the record-id form does."""
    final = {"log": [{"id": "log_029", "tool": "user_provided", "query": {"recordId": "src_001"}}],
             "sources": [{"id": "src_007", "log_entry_id": "log_029"}],
             "assertions": [{"id": "a_050", "log_entry_id": "log_029"}]}
    resp = '[{"ok": true, "records": [{"recordId": "src_001", "status": "extracted", "logId": "log_029"}]}]'
    r = replay([_call("extraction_append", {"projectPath": "/p", "documents": [{"text": "t"}]}, resp)],
               final_research=final)
    assert [e["id"] for e in r.research["sources"]] == ["src_007"]
    assert [e["id"] for e in r.research["assertions"]] == ["a_050"]


def test_a_record_extracted_twice_back_fills_the_second_entry():
    """BBB was extracted once already (log_005); the second, truncated call wrote
    log_009, the next entry for it -- never the one the replay already holds."""
    first = '[{"ok": true, "records": [{"recordId": "ark:/61903/1:1:BBB", "status": "extracted", "logId": "log_005"}]}]'
    second = ('[{"ok": true, "records": {"_summary_truncated": true, "_full_length": 2, "_first_n": '
              '[{"recordId": "ark:/61903/1:1:AAA", "status": "extracted", "logId": "log_004"}]}}]')
    r = replay([_call("extraction_append", {"projectPath": "/p", "recordIds": ["ark:/61903/1:1:BBB"]}, first),
                _call("extraction_append", TRUNC_ARGS, second)], final_research=TRUNC_FINAL)
    assert [e["id"] for e in r.research["log"]] == ["log_005", "log_004", "log_009"]


OK_PS1 = '[{"type": "text", "text": "{\\n  \\"ok\\": true,\\n  \\"entryId\\": \\"ps_001\\"\\n}"}]'


def test_a_proof_summary_edits_update_is_replayed():
    """#3542 lead 2c: research_append accepted each `old` where it occurred once, so the
    replay reproduces the write where it occurs once in the replayed text too. A
    `fields` part on the same op applies beside it."""
    start = {"proof_summaries": [{"id": "ps_001", "narrative_markdown": "born in 1850", "tier": "probable"}]}
    r = replay([_call("research_append",
                      {"section": "proof_summaries", "op": "update", "entryId": "ps_001",
                       "fields": {"tier": "possible"},
                       "edits": [{"field": "narrative_markdown", "old": "1850", "new": "1851"}]},
                      OK_PS1)], starting_research=start)
    assert r.unmodelled == {}
    assert r.research["proof_summaries"][0] == {"id": "ps_001", "narrative_markdown": "born in 1851", "tier": "possible"}


def test_an_edit_the_replayed_text_cannot_show_is_reported_unmodelled():
    """The replayed narrative lacks `old` (it was written by a call the replay did not
    model), so the edit is a gap, and the `fields` part still applies."""
    start = {"proof_summaries": [{"id": "ps_001", "narrative_markdown": "born in 1849", "tier": "probable"}]}
    r = replay([_call("research_append",
                      {"section": "proof_summaries", "op": "update", "entryId": "ps_001",
                       "fields": {"tier": "possible"},
                       "edits": [{"field": "narrative_markdown", "old": "1850", "new": "1851"}]},
                      OK_PS1)], starting_research=start)
    assert r.unmodelled == {"proof_summaries:edits": 1}
    assert r.research["proof_summaries"][0]["narrative_markdown"] == "born in 1849"
    assert r.research["proof_summaries"][0]["tier"] == "possible"


def test_a_proof_summary_fields_update_reports_nothing():
    """The other direction: an ordinary update is modelled, so no gap is claimed."""
    start = {"proof_summaries": [{"id": "ps_001", "narrative_markdown": "born in 1850"}]}
    r = replay([_call("research_append",
                      {"section": "proof_summaries", "op": "update", "entryId": "ps_001",
                       "fields": {"narrative_markdown": "born in 1851"}},
                      OK_PS1)], starting_research=start)
    assert r.unmodelled == {}
    assert r.research["proof_summaries"][0]["narrative_markdown"] == "born in 1851"


def test_an_edits_only_update_the_replay_cannot_show_is_not_counted_applied():
    """An op that is all `edits`, none of which the replayed text can show, changed
    nothing the replay modelled: a gap, not an apply. "0" occurs twice here."""
    start = {"proof_summaries": [{"id": "ps_001", "narrative_markdown": "born in 1800"}]}
    r = replay([_call("research_append",
                      {"section": "proof_summaries", "op": "update", "entryId": "ps_001",
                       "edits": [{"field": "narrative_markdown", "old": "0", "new": "1"}]},
                      OK_PS1)], starting_research=start)
    assert r.unmodelled == {"proof_summaries:edits": 1}
    assert r.applied == 0


OK_EV1 = '[{"type": "text", "text": "{\\n  \\"ok\\": true,\\n  \\"entryId\\": \\"ev_001\\"\\n}"}]'


def test_evaluation_append_is_applied_to_evaluations():
    """gps-mentor writes `evaluations` only through `evaluation_append` (#1491).
    Skipping it left every verdict out of the replay while `unmodelled` stayed
    empty, so the gap read as full coverage."""
    r = replay([_call("evaluation_append", {"section": "evaluations", "op": "append", "entry": {"focus": "on-demand"}}, OK_EV1)])
    assert [e["id"] for e in r.research["evaluations"]] == ["ev_001"]
    assert r.applied == 1 and r.unmodelled == {}


def test_evaluation_append_with_no_section_still_means_evaluations():
    r = replay([_call("evaluation_append", {"op": "append", "entry": {"focus": "on-demand"}}, OK_EV1)])
    assert [e["id"] for e in r.research["evaluations"]] == ["ev_001"]
    assert "log" not in r.research or r.research["log"] == []
