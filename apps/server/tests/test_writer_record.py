"""What a write actually wrote (phase 3 item 4's enabling half).

Change review -- "show me what this session changed and what my conclusion rests on"
-- is the highest-value item in the phase-3 plan, and it is blocked on data that does
not exist. `tool_calls` stores `tool_name` and `input_path` and no payload, so the
structured table cannot answer "what changed". The captured session made 173 writes
(81 findings, 53 search logs, 12 extractions, 8 tree edits) and none is recoverable
from it.

This records the SHAPE of each write -- section, operation, and the ids touched --
not the payload. A diff needs to know what moved, and storing whole entries would put
every record body in the call log.
"""

import re

from pathlib import Path

from proto.worker.writer_record import _WRITERS, writer_record


def test_a_section_append_records_section_op_and_id():
    out = writer_record(
        "mcp__genealogy__research_append",
        # An APPENDED entry carries no id: the tool assigns it, and research_append
        # refuses one that arrives with it. An append's recordable ids are the ones it
        # REFERENCES. Rebuilt from the tool schema in review.
        {"projectPath": "/project", "section": "questions", "op": "append",
         "entry": {"question": "Who?", "person_id": "P-1"}},
    )
    assert out == {"section": "questions", "op": "append", "ids": ["P-1"]}


def test_a_multi_op_call_records_every_section_it_touched():
    out = writer_record(
        "mcp__genealogy__research_append",
        {"ops": [
            {"section": "plans", "op": "update", "entryId": "pl_001"},
            {"section": "plan_items", "op": "update", "entryId": "pli_004", "planId": "pl_001"},
        ]},
    )
    # `pl_001` appears on both ops (as entryId, then as planId) and is recorded once:
    # a diff wants the set of things touched, not a tally.
    assert out == {"section": "plans,plan_items", "op": "update",
                   "ids": ["pl_001", "pli_004"]}


def test_a_log_append_is_recorded_like_any_other_write():
    # The real parameters: this tool has no `entry`, and the id it can reach back to is
    # the plan item the search served. Rebuilt from the tool schema in review.
    out = writer_record("mcp__genealogy__research_log_append",
                        {"projectPath": "/project", "tool": "record_search",
                         "query": {"surname": "Mogan"}, "outcome": "negative",
                         "resultsExamined": 0, "planItemId": "pli_003"})
    assert out == {"section": "log", "op": "append", "ids": ["pli_003"]}


def test_a_read_records_nothing():
    """Only writes belong in a change review. Recording reads would bury the diff."""
    assert writer_record("mcp__genealogy__research_query", {"section": "questions"}) is None
    assert writer_record("mcp__genealogy__record_read", {"ark": "x"}) is None


def test_an_unknown_tool_records_nothing_rather_than_guessing():
    assert writer_record("mcp__genealogy__some_future_tool", {"section": "x"}) is None


def test_a_write_with_no_recoverable_id_still_records_its_section():
    """An id we cannot see is not a reason to lose the fact that a section changed."""
    out = writer_record("mcp__genealogy__research_append",
                        {"section": "researcher_profile", "op": "update", "fields": {"x": 1}})
    assert out == {"section": "researcher_profile", "op": "update", "ids": []}


def test_a_malformed_input_records_nothing_and_does_not_raise():
    """This runs inside the PreToolUse hook. A raising recorder would fail a tool call
    the user was entitled to make.

    An earlier version of this asserted `is None or isinstance(..., dict)` -- a
    tautology that passes for every non-raising return. Each case now asserts what it
    actually expects.
    """
    assert writer_record("mcp__genealogy__research_append", None) is None
    assert writer_record("mcp__genealogy__research_append", "not a dict") is None
    # A non-list `ops` falls through to the single-op path, which has no section.
    assert writer_record("mcp__genealogy__research_append", {"ops": "not a list"})["section"] == ""
    assert writer_record("mcp__genealogy__research_append", {"ops": [None]})["ids"] == []


def test_an_input_that_explodes_under_inspection_is_swallowed():
    """Forces the except branch, which nothing reached before: a mapping whose .get
    raises is the shape a real SDK payload can take."""

    class Hostile(dict):
        def get(self, *a, **k):  # noqa: D102
            raise RuntimeError("boom")

    assert writer_record("mcp__genealogy__research_append", Hostile()) is None


def test_the_record_stays_small():
    """The point is the SHAPE of the write, not its payload -- a 6 KB entry must not
    land in the call log."""
    out = writer_record(
        "mcp__genealogy__research_append",
        {"section": "assertions", "op": "append",
         "entry": {"id": "a_001", "text": "x" * 6000}},
    )
    assert out == {"section": "assertions", "op": "append", "ids": ["a_001"]}


# --- The shapes the CAPTURED session actually contains -----------------------------
#
# A first version read `section`/`op` generically and covered only research_append --
# 46 of the capture's 173 writer calls (27%) fell through to None. The other writers
# do not carry a section at all; each one HAS an implicit section, and that is what
# the recorder must know.

def test_a_log_append_records_the_log_section_without_being_told():
    out = writer_record(
        "mcp__genealogy__research_log_append",
        {"projectPath": "/project", "tool": "external_links_search",
         "outcome": "partial", "resultsExamined": 50},
    )
    assert out["section"] == "log" and out["op"] == "append"


def test_a_log_append_in_ops_form_records_the_plan_item_it_belongs_to():
    out = writer_record(
        "mcp__genealogy__research_log_append",
        {"ops": [{"tool": "record_search", "outcome": "negative",
                  "resultsExamined": 17, "planItemId": "pli_004"}]},
    )
    assert out["section"] == "log"
    assert "pli_004" in out["ids"], "a diff must be able to reach the plan item"


def test_project_create_records_the_project_section():
    out = writer_record("mcp__genealogy__project_create",
                        {"projectPath": "/project", "objective": "Determine whether..."})
    assert out == {"section": "project", "op": "create", "ids": []}


def test_the_tree_writers_record_the_tree():
    for tool, op in (("tree_edit", "edit"), ("tree_correct", "correct"),
                     ("merge_tree_persons", "merge"), ("materialize_facts", "materialize")):
        out = writer_record(f"mcp__genealogy__{tool}", {"projectPath": "/project"})
        assert out["section"] == "tree", f"{tool} writes the tree"
        assert out["op"] == op


def test_extraction_append_records_its_own_section():
    out = writer_record("mcp__genealogy__extraction_append",
                        {"projectPath": "/project", "assertions": [{"id": "a_001"}]})
    assert out["section"] == "extractions"


def test_no_writer_in_the_capture_falls_through_to_none():
    """The regression this file exists for: every writer tool the captured session
    used must characterise, whatever its input shape."""
    # research_append is excluded deliberately: it is the ONLY writer that names its
    # section in the call, so a call that names none is malformed and has no section
    # to record. Every other writer's section is implied by the tool itself.
    for tool in ("research_log_append", "extraction_append", "materialize_facts",
                 "tree_edit", "tree_correct", "merge_tree_persons", "project_create"):
        out = writer_record(f"mcp__genealogy__{tool}", {"projectPath": "/project"})
        assert out is not None, f"{tool} recorded nothing"
        assert out["section"], f"{tool} recorded no section"


# ── The id reach-back, widened (blocker 3 of the #3262 self-review) ──────────────
# Before this, `_ID_FIELDS` carried only the camelCase half, so most writers recorded
# `ids: []` and "what changed this session" reached back to nothing.

def test_a_research_append_update_records_the_entry_it_changed():
    """`entryId` is research_append's update parameter and was absent, so EVERY update
    recorded no id at all."""
    out = writer_record("research_append", {"section": "person_evidence", "op": "update",
                                            "entryId": "pe_001", "fields": {"confidence": "probable"}})
    assert out is not None and out["ids"] == ["pe_001"]


def test_an_appended_entry_records_what_it_REFERENCES():
    """An append's own id does not exist yet -- PreToolUse runs before the tool assigns
    it -- but the ids it points AT do, and they are the reach-back a diff needs."""
    out = writer_record("research_append", {"section": "person_evidence", "op": "append",
                                            "entry": {"assertion_id": "a_007", "person_id": "I3"}})
    assert out is not None
    assert "a_007" in out["ids"] and "I3" in out["ids"]


def test_an_appended_entry_records_no_id_of_its_own():
    """The other half of the same fact, asserted as the ABSENCE of an assigned id rather
    than as `ids == []`, which would be false now that referenced ids are recorded."""
    out = writer_record("research_append", {"section": "person_evidence", "op": "append",
                                            "entry": {"assertion_id": "a_007", "person_id": "I3"}})
    assert out is not None and not [i for i in out["ids"] if i.startswith("pe_")]


def test_array_ids_are_recorded():
    """`extraction_append` takes `recordIds`/`questionIds` as LISTS, which a string-only
    check can never pick up -- so every extraction recorded nothing."""
    out = writer_record("extraction_append", {"recordIds": ["r_1", "r_2"], "questionIds": ["q_9"]})
    assert out is not None
    assert {"r_1", "r_2", "q_9"} <= set(out["ids"])


def test_a_merge_records_both_sides():
    """`merge_tree_persons` carries its ids as `merges: [[survivor, collapsed]]` -- no
    field NAME reaches them, so it is matched by shape. A merge is the change a review
    most needs to trace, and it recorded nothing at all."""
    out = writer_record("merge_tree_persons", {"merges": [["I1", "I2"], ["I5", "I6"]]})
    assert out is not None
    assert {"I1", "I2", "I5", "I6"} <= set(out["ids"])


def test_the_tree_writers_reach_back_to_what_they_touched():
    """tree_edit / tree_correct / materialize_facts all took id parameters the list
    did not carry."""
    for tool, payload, expected in (
        ("tree_edit", {"relationshipId": "r_1", "sourceAssertionId": "a_2"}, {"r_1", "a_2"}),
        ("tree_correct", {"factId": "f_3", "relationshipId": "r_4"}, {"f_3", "r_4"}),
        ("materialize_facts", {"recordId": "rec_5"}, {"rec_5"}),
    ):
        out = writer_record(tool, payload)
        assert out is not None, tool
        assert expected <= set(out["ids"]), f"{tool} recorded {out['ids']}"


def test_a_malformed_id_shape_is_ignored_rather_than_crashing():
    """The recorder must never raise: it runs inside a PreToolUse hook, and an exception
    there fails a tool call the user was entitled to make."""
    out = writer_record("merge_tree_persons", {"merges": [None, ["I1", 7], "nope", []]})
    assert out is not None and out["ids"] == ["I1"]


# ── the list cannot silently fall behind the engine ─────────────────────────────

TOOL_RESULT_TS = (
    Path(__file__).resolve().parents[3]
    / "packages" / "engine" / "mcp-server" / "src" / "tool-result.ts"
)


def _ts_list(name: str) -> set[str]:
    body = re.search(
        rf"export const {name} = \[(.*?)\] as const",
        TOOL_RESULT_TS.read_text(encoding="utf-8"),
        re.S,
    )
    assert body, f"{name} not found in tool-result.ts"
    return set(re.findall(r'"([a-z_]+)"', body.group(1)))


def test_every_engine_document_writer_is_characterised():
    """Read the ENGINE's list, never a hand copy of it.

    The sibling tests restate the tool names, so they pass while a real writer
    records NULL -- which is how `tree_forget`, `timeline_build` and
    `build_external_search_url` were missed until review. Derived from
    `tool-result.ts`, adding a writer there fails here until it is characterised.
    """
    writers = _ts_list("OK_FALSE_IS_FAILURE") - _ts_list("NOT_A_DOCUMENT_WRITER")
    assert set(_WRITERS) == writers, {
        "missing": sorted(writers - set(_WRITERS)),
        "extra": sorted(set(_WRITERS) - writers),
    }
