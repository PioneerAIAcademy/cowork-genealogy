"""Direct tests for the handed-plan-item validators (issue #3581).

`validators/` is not collected by `make harness-test` (pyproject sets
testpaths = ["tests"]), so a validator's real pass/fail set otherwise appears
only inside a paid per-skill run. These run each one over inputs it must accept
and inputs it must reject.
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import (  # noqa: E402
    test_delegation_hands_plan_item_verbatim as research_check,
    test_search_spawns_cover_each_open_item as fans_out_check,
)
from test_search_records import (  # noqa: E402
    test_handed_plan_item_skips_research_query as skips_check,
    test_handed_subject_skips_tree_read as subject_check,
    test_mismatched_handed_plan_item_is_queried as mismatch_check,
)

ITEM = {
    "id": "pli_001",
    "sequence": 1,
    "record_type": "vital_record",
    "jurisdiction": "Hamre prestegjeld, Hordaland, Norway",
    "rationale": "Search for Unna \u2014 the distinctive patronymic narrows results.",
    "fallback_for": None,
    "status": "planned",
}

SUBJECT = {
    "subjectId": "I1",
    "names": [{"given": "Unna", "surname": "Hamre", "type": "BirthName"}],
    "birth": {"year": 1845, "place": "Hamre, Norway"},
    "death": None,
}


def call(tool, **args):
    return {"tool": f"mcp__genealogy__{tool}", "args": args, "input": args}


# --- search-records: item handed, no research_query -------------------------

HANDED = {"tags": ["search", "handed-plan-item"]}
MISMATCH = {"tags": ["search", "handed-plan-item-mismatch"]}
UNTAGGED = {"tags": ["search"]}


def test_skip_check_ignores_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        skips_check([call("research_query", section="plans")], UNTAGGED)


def test_skip_check_passes_when_no_research_query_was_made():
    skips_check([call("record_search", surname="Flynn"), call("research_log_append")], HANDED)


def test_skip_check_fails_when_research_query_was_made():
    with pytest.raises(AssertionError, match="still called research_query"):
        skips_check([call("research_query", section="plans"), call("record_search")], HANDED)


def test_skip_check_fails_on_a_query_after_the_search_too():
    with pytest.raises(AssertionError):
        skips_check([call("record_search"), call("research_query", section="plans")], HANDED)


# --- search-records: mismatched id must be queried first --------------------

def test_mismatch_check_ignores_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        mismatch_check([call("record_search")], UNTAGGED)


def test_mismatch_check_passes_when_the_item_is_read_before_searching():
    mismatch_check([call("research_query", section="plans"), call("record_search")], MISMATCH)


def test_mismatch_check_fails_when_the_item_is_never_read():
    with pytest.raises(AssertionError, match="no research_query was made"):
        mismatch_check([call("record_search")], MISMATCH)


def test_mismatch_check_fails_when_the_search_ran_first():
    with pytest.raises(AssertionError, match="came after the first record_search"):
        mismatch_check([call("record_search"), call("research_query", section="plans")], MISMATCH)


# --- research: the spawn carries the item verbatim --------------------------

RTEST = {"tags": ["routing", "routes-to:search-records", "asserts-delegation-plan-item"]}
BEFORE = {"tree_gedcomx_json": {"persons": [{"id": "I1"}, {"id": "I2"}]}, "research_json": {"project": {"subject_person_ids": ["I1"]}, "plans": [{"id": "pl_001", "status": "active", "items": [ITEM]}]}}


def spawn(prompt):
    return {"tool": None, "args": {"subagent_type": "search-records", "prompt": prompt}}


def block(item, fence=False):
    body = json.dumps(item, indent=2, ensure_ascii=False)
    return ("```json\n" + body + "\n```") if fence else body


def test_research_check_ignores_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        research_check({"tags": ["routing", "routes-to:search-records"]}, [], BEFORE)


def test_research_check_passes_on_a_verbatim_block():
    prompt = f"planItemId: pli_001\nplanId: pl_001\nprojectPath: /p\nplan_item:\n{block(ITEM)}\nsubject:\n{block(SUBJECT)}"
    research_check(RTEST, [spawn(prompt)], BEFORE)


def test_research_check_passes_on_a_fenced_and_escaped_block():
    escaped = json.dumps(ITEM, indent=2)  # ensure_ascii escapes the em dash
    prompt = f"planItemId: pli_001\nplanId: pl_001\nplan_item:\n```json\n{escaped}\n```\nsubject:\n{block(SUBJECT)}"
    research_check(RTEST, [spawn(prompt)], BEFORE)


def test_research_check_fails_when_the_plan_id_is_not_handed():
    prompt = f"planItemId: pli_001\nprojectPath: /p\nplan_item:\n{block(ITEM)}"
    with pytest.raises(AssertionError, match="does not hand the parent plan id pl_001"):
        research_check(RTEST, [spawn(prompt)], BEFORE)


def test_research_check_fails_when_no_subject_is_handed():
    prompt = f"planItemId: pli_001\nplanId: pl_001\nplan_item:\n{block(ITEM)}"
    with pytest.raises(AssertionError, match="no subject JSON block"):
        research_check(RTEST, [spawn(prompt)], BEFORE)


def test_research_check_fails_when_the_subject_is_not_in_the_tree():
    other = dict(SUBJECT, subjectId="I9")
    prompt = f"planItemId: pli_001\nplanId: pl_001\nplan_item:\n{block(ITEM)}\nsubject:\n{block(other)}"
    with pytest.raises(AssertionError, match="is not a person in the tree"):
        research_check(RTEST, [spawn(prompt)], BEFORE)


def test_research_check_fails_when_no_plan_item_block_is_sent():
    with pytest.raises(AssertionError, match="no plan_item JSON block"):
        research_check(RTEST, [spawn("planItemId: pli_001\nplanId: pl_001\nprojectPath: /p")], BEFORE)


def test_research_check_fails_when_the_item_is_summarised():
    summary = dict(ITEM, rationale="Search for Unna.")
    prompt = f"planItemId: pli_001\nplanId: pl_001\nplan_item:\n{block(summary)}\nsubject:\n{block(SUBJECT)}"
    with pytest.raises(AssertionError, match=r"not verbatim; differs on \['rationale'\]"):
        research_check(RTEST, [spawn(prompt)], BEFORE)


def test_research_check_fails_when_a_field_is_dropped():
    trimmed = {k: v for k, v in ITEM.items() if k != "fallback_for"}
    prompt = f"planItemId: pli_001\nplanId: pl_001\nplan_item:\n{block(trimmed)}\nsubject:\n{block(SUBJECT)}"
    with pytest.raises(AssertionError, match=r"differs on \['fallback_for'\]"):
        research_check(RTEST, [spawn(prompt)], BEFORE)


def test_research_check_fails_when_no_search_records_was_spawned():
    with pytest.raises(AssertionError, match="No recorded spawn"):
        research_check(RTEST, [], BEFORE)



# --- research: a spawn hands exactly one item (issue #4441) -----------------

ITEM_2 = dict(ITEM, id="pli_002", sequence=2, record_type="church")
BEFORE_2 = {
    "tree_gedcomx_json": BEFORE["tree_gedcomx_json"],
    "research_json": {
        "project": {"subject_person_ids": ["I1"]},
        "plans": [{"id": "pl_001", "status": "active", "items": [ITEM, ITEM_2]}],
    },
}


def handed(item, id_line=None):
    """A spawn prompt handing ``item``, with ``id_line`` in place of the usual one."""
    line = f"planItemId: {item['id']}" if id_line is None else id_line
    return f"{line}\nplanId: pl_001\nprojectPath: /p\nplan_item:\n{block(item)}\nsubject:\n{block(SUBJECT)}"


def expect_fail(check, *args) -> str:
    """A must-fail case: an AssertionError, never a skip."""
    with pytest.raises(BaseException) as excinfo:
        check(*args)
    assert excinfo.typename == "AssertionError", excinfo.typename
    return str(excinfo.value)


@pytest.mark.parametrize(
    "id_line", ["Plan item ID: pli_001", "planItemId=pli_001", "**planItemId:** `pli_001`", ""]
)
def test_research_check_passes_on_every_id_line_spelling_and_on_none(id_line):
    research_check(RTEST, [spawn(handed(ITEM, id_line))], BEFORE)


def test_research_check_reads_the_item_from_the_block_not_from_prose():
    """umbelina-shaped: the prompt names an earlier item in prose. pli_001 is open
    and listed first, so the old first-id-in-the-prompt lookup read pli_001."""
    prompt = "pli_001 returned no death record; this is the church records fallback.\n" + handed(ITEM_2)
    research_check(RTEST, [spawn(prompt)], BEFORE_2)


def test_research_check_fails_on_two_id_lines():
    prompt = "planItemId: pli_001\n" + handed(ITEM_2)
    assert "2 plan item id lines" in expect_fail(research_check, RTEST, [spawn(prompt)], BEFORE_2)


def test_research_check_fails_on_two_plan_item_blocks():
    prompt = handed(ITEM, "") + f"\nplan_item:\n{block(ITEM_2)}"
    assert "2 plan_item blocks" in expect_fail(research_check, RTEST, [spawn(prompt)], BEFORE_2)


def test_research_check_fails_when_the_id_line_disagrees_with_the_block():
    prompt = handed(ITEM_2, "planItemId: pli_001")
    assert "id line names 'pli_001'" in expect_fail(research_check, RTEST, [spawn(prompt)], BEFORE_2)


def test_research_check_does_not_count_a_plan_item_id_key_as_a_block():
    prompt = handed(ITEM, "") + '\nlog: {"plan_item_id": "pli_001"}'
    research_check(RTEST, [spawn(prompt)], BEFORE)


# --- research: one search agent per open item (issue #4441) ----------------

FANS = {
    "tags": ["routing", "routes-to:search-records", "fans-out-plan-items"],
    "user_message": "Keep researching this project. Run the open searches on the plan, and don't check in with me between them.",
}


def test_fans_out_check_ignores_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        fans_out_check({"tags": ["routing"]}, [spawn(handed(ITEM))], BEFORE_2)


def test_fans_out_check_passes_on_one_spawn_per_item_and_does_not_skip():
    fans_out_check(FANS, [spawn(handed(ITEM)), spawn(handed(ITEM_2, "Plan item ID: pli_002"))], BEFORE_2)


def test_fans_out_check_allows_router_prose_sharing_few_words_with_the_message():
    prose = "The researcher asked to keep going without check-ins. Run the census search.\n"
    fans_out_check(FANS, [spawn(prose + handed(ITEM)), spawn(handed(ITEM_2))], BEFORE_2)


def test_fans_out_check_fails_on_one_spawn_for_two_items():
    prompt = handed(ITEM) + f"\nplan_item:\n{block(ITEM_2)}"
    assert "1 search-records spawns for 2" in expect_fail(fans_out_check, FANS, [spawn(prompt)], BEFORE_2)


def test_fans_out_check_fails_on_two_spawns_for_the_same_item():
    msg = expect_fail(fans_out_check, FANS, [spawn(handed(ITEM)), spawn(handed(ITEM))], BEFORE_2)
    assert "handed plan items ['pli_001', 'pli_001']" in msg


def test_fans_out_check_fails_when_an_item_is_not_dispatched():
    assert "1 search-records spawns for 2" in expect_fail(fans_out_check, FANS, [spawn(handed(ITEM))], BEFORE_2)


@pytest.mark.parametrize(
    "relay",
    [
        "Keep researching this project. Run the open searches on the plan, and don't check in with me between them.",
        "the researcher said: run the open searches on the PLAN and don\u2019t check in",
    ],
)
def test_fans_out_check_fails_when_a_spawn_carries_the_researchers_words(relay):
    prompt = relay + "\n" + handed(ITEM)
    msg = expect_fail(fans_out_check, FANS, [spawn(prompt), spawn(handed(ITEM_2))], BEFORE_2)
    assert "consecutive words of the researcher's message" in msg


def test_fans_out_check_ignores_a_fallback_item():
    fallback = dict(ITEM_2, fallback_for="pli_001")
    third = dict(ITEM, id="pli_003", sequence=3)
    before = {
        "tree_gedcomx_json": BEFORE["tree_gedcomx_json"],
        "research_json": {"plans": [{"id": "pl_001", "status": "active", "items": [ITEM, fallback, third]}]},
    }
    fans_out_check(FANS, [spawn(handed(ITEM)), spawn(handed(third))], before)


# --- search-records: subject handed, no tree Read ---------------------------

SUBJECT_HANDED = {"tags": ["search", "handed-plan-item", "handed-subject"]}


def read(path):
    return {"tool": "Read", "args": {"file_path": path}}


def test_subject_check_ignores_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        subject_check([read("/w/tree.gedcomx.json")], [], UNTAGGED)


def test_subject_check_passes_without_a_tree_read():
    subject_check([read("/w/other.json")], [call("record_search", subjectId="I1")], SUBJECT_HANDED)


def test_subject_check_fails_when_the_tree_is_read():
    with pytest.raises(AssertionError, match="still read the tree"):
        subject_check(
            [read("C:" + chr(92) + "w" + chr(92) + "tree.gedcomx.json")],
            [call("record_search", subjectId="I1")],
            SUBJECT_HANDED,
        )


def test_subject_check_fails_when_the_subject_id_is_not_passed():
    with pytest.raises(AssertionError, match="not called with the handed subjectId"):
        subject_check([], [call("record_search", surname="Flynn")], SUBJECT_HANDED)
