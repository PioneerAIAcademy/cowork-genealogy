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

from proto.web.writer_record import writer_record


def test_a_section_append_records_section_op_and_id():
    out = writer_record(
        "mcp__genealogy__research_append",
        {"projectPath": "/project", "section": "questions", "op": "append",
         "entry": {"id": "q_001", "question": "Who?"}},
    )
    assert out == {"section": "questions", "op": "append", "ids": ["q_001"]}


def test_a_multi_op_call_records_every_section_it_touched():
    out = writer_record(
        "mcp__genealogy__research_append",
        {"ops": [
            {"section": "plans", "op": "append", "entry": {"id": "pl_001"}},
            {"section": "log", "op": "append", "entry": {"id": "log_004"}},
        ]},
    )
    assert out == {"section": "plans,log", "op": "append", "ids": ["pl_001", "log_004"]}


def test_a_log_append_is_recorded_like_any_other_write():
    out = writer_record("mcp__genealogy__research_log_append",
                        {"entry": {"id": "log_009", "query": {"surname": "Mogan"}}})
    assert out["ids"] == ["log_009"]


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
