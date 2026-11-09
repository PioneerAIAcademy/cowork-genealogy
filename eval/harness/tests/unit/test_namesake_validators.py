"""Direct tests for the namesake validators of issue #3363, PR 3: the pool row
and the other-parents row in search-records, the row checks of its two
co-writers (search-images, search-full-text), the person-evidence hand-back all
three owe, and the router's handing of the subject's parents.

`validators/` is not collected by `make harness-test`, so a validator's real
pass/fail set otherwise appears only inside a paid per-skill run. Each check is
run here over inputs it must accept and inputs it must reject, and a rejection
is matched on its message, so a check that fails for the wrong reason is red.
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

import test_research as research  # noqa: E402
import test_search_full_text as fulltext  # noqa: E402
import test_search_images as images  # noqa: E402
import test_search_records as records  # noqa: E402
from validators_lib import has_subject_block, namesake_bare_id  # noqa: E402


def state(*, log=(), namesakes=()):
    return {
        "research_json": {
            "project": {"subject_person_ids": ["I1"]},
            "log": list(log),
            "namesakes": list(namesakes),
        }
    }


BEFORE = state()


def row(**fields):
    base = {"id": "ns_001", "person_id": "I1", "name": "Patrick Flynn", "place": "Schuylkill", "record_ids": []}
    base.update(fields)
    return base


def call(tool, args=None, response=None):
    args = args or {}
    return {"tool": f"mcp__genealogy__{tool}", "args": args, "input": args, "response": response}


# --- shared helpers --------------------------------------------------------


@pytest.mark.parametrize(
    "value, bare",
    [
        ("ark:/61903/1:1:QV9N-KX83", "QV9N-KX83"),
        ("https://familysearch.org/ark:/61903/1:1:QV9N-KX83", "QV9N-KX83"),
        ("QV9N-KX83", "QV9N-KX83"),
        ("ark:/61903/3:1:3Q9M-CS1Z-9Q7S", "3Q9M-CS1Z-9Q7S"),
        ("007936749_00012", "007936749_00012"),
        (" 007936749_00012 ", "007936749_00012"),
    ],
)
def test_bare_id_reduces_each_spelling_to_one(value, bare):
    assert namesake_bare_id(value) == bare


@pytest.mark.parametrize(
    "delegation, expected",
    [
        ("planItemId: pli_006\nsubject:\n{\n  \"subjectId\": \"I1\"\n}", True),
        ("planItemId: pli_006\nsubject:\n```json\n{\"subjectId\": \"I1\"}\n```", True),
        ("planItemId: pli_006\n  subject: {\"subjectId\": \"I1\"}", True),
        ("Browse the volume for the subject: Thomas Flynn's will", False),
        ("planItemId: pli_006\nprojectPath: /p", False),
        (None, False),
    ],
)
def test_subject_block_is_read_only_from_its_own_line(delegation, expected):
    assert has_subject_block(delegation) is expected


# --- search-records: the pool row --------------------------------------------

POOL = {"tags": ["search", "namesake-pool-row"]}
SEARCH_LOG = {"id": "log_007", "tool": "record_search"}
POOL_NOTES = "pool: Q7FB-T45 (son of Thomas, bapt. 1845) and Q7FB-M45 (son of Michael, bapt. 1845); neither tied nor ruled out."


def pool_after(*rows):
    return state(log=[SEARCH_LOG], namesakes=rows)


def test_pool_check_ignores_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        records.test_namesake_pool_row_recorded(BEFORE, pool_after(), {"tags": ["search"]})


def test_pool_check_passes_on_one_pool_row():
    records.test_namesake_pool_row_recorded(
        BEFORE, pool_after(row(notes=POOL_NOTES, log_entry_ids=["log_007"])), POOL
    )


def test_pool_check_passes_on_ark_spellings_in_the_notes():
    notes = "pool: ark:/61903/1:1:Q7FB-T45 and https://familysearch.org/ark:/61903/1:1:Q7FB-M45, neither ruled out"
    records.test_namesake_pool_row_recorded(BEFORE, pool_after(row(notes=notes, log_entry_ids=["log_007"])), POOL)


@pytest.mark.parametrize(
    "rows, message",
    [
        ((), "expected exactly one namesakes row, the pool, and got 0"),
        ((row(notes=POOL_NOTES, record_ids=["Q7FB-T45"], log_entry_ids=["log_007"]),), "lists none of its candidates"),
        ((row(notes=POOL_NOTES.replace("Q7FB-M45", "the other"), log_entry_ids=["log_007"]),), r"\['Q7FB-M45'\]"),
        ((row(notes="Q7FB-T45 and Q7FB-M45: a pool", log_entry_ids=["log_007"]),), "notes start 'pool:'"),
        ((row(notes=POOL_NOTES, log_entry_ids=["log_001"]),), "none of them a record_search"),
        ((row(notes=POOL_NOTES, person_id="I2", log_entry_ids=["log_007"]),), "not a subject of the project"),
        (
            (
                row(notes=POOL_NOTES, log_entry_ids=["log_007"]),
                row(id="ns_002", record_ids=["Q7FB-M45"], notes="other parents", log_entry_ids=["log_007"]),
            ),
            "and got 2",
        ),
    ],
    ids=["no-row", "lists-a-candidate", "names-one", "no-pool-prefix", "wrong-log", "not-a-subject", "plus-parents-row"],
)
def test_pool_check_rejects(rows, message):
    with pytest.raises(AssertionError, match=message):
        records.test_namesake_pool_row_recorded(BEFORE, pool_after(*rows), POOL)


# --- search-records: the other parents ground --------------------------------

OTHER = {"tags": ["search", "namesake-row", "namesake-other-parents"]}


def test_other_parents_check_passes_on_the_son_of_michael():
    after = pool_after(row(record_ids=["Q7FM-M70"], notes="other parents", log_entry_ids=["log_007"]))
    records.test_namesake_other_parents_row(BEFORE, after, OTHER)


@pytest.mark.parametrize(
    "rows, message",
    [
        ((), "and got 0"),
        ((row(record_ids=["Q7FM-T70"], notes="x", log_entry_ids=["log_007"]),), "not the son of Michael"),
        ((row(record_ids=["Q7FM-M70", "ark:/61903/1:1:Q7FM-T70"], notes="x"),), "whose groom's parents match"),
        ((row(record_ids=[], notes="pool: Q7FM-T70 and Q7FM-M70"),), "not the son of Michael"),
    ],
    ids=["no-row", "matching-groom", "both-grooms", "pool-instead"],
)
def test_other_parents_check_rejects(rows, message):
    with pytest.raises(AssertionError, match=message):
        records.test_namesake_other_parents_row(BEFORE, pool_after(*rows), OTHER)


def test_row_check_rejects_a_pool_row_where_a_ground_is_stated():
    after = pool_after(row(notes=POOL_NOTES, log_entry_ids=["log_007"], record_persona_ids={"x": "p"}))
    with pytest.raises(AssertionError, match="is a pool row"):
        records.test_namesake_row_recorded(BEFORE, after, {"tags": ["namesake-row"]})


def test_row_check_still_passes_a_stated_ground_row():
    after = pool_after(
        row(record_ids=["L4XK-2PQ"], notes="died 1882", log_entry_ids=["log_007"], record_persona_ids={"L4XK-2PQ": "P1"})
    )
    records.test_namesake_row_recorded(BEFORE, after, {"tags": ["namesake-row"]})


# --- the hand-back, once per writer ------------------------------------------

WARNING = {"warnings": ["namesake 'ns_001' recorded for 'I1': 2 probable or confident link(s) ... 'pe_004' ... 'pe_005'"]}
WARNED_WRITE = call("research_append", {"section": "namesakes", "op": "append", "entry": {}}, WARNING)
TAG = {"tags": ["namesake-warning"]}
CHECKS = [
    ("search-records", records.test_namesake_warning_handed_to_person_evidence),
    ("search-images", images.test_namesake_warning_handed_to_person_evidence),
    ("search-full-text", fulltext.test_namesake_warning_handed_to_person_evidence),
]


def reply(agent, text):
    return [{"subagent_type": agent, "text": text}]


@pytest.mark.parametrize("agent, check", CHECKS, ids=[a for a, _ in CHECKS])
def test_hand_back_passes_when_every_warned_link_is_named(agent, check):
    text = "ns_001 written\nHand-back: person-evidence — namesake ns_001 recorded for I1; links pe_004, pe_005 are untied"
    check([WARNED_WRITE], reply(agent, text), "", TAG)


@pytest.mark.parametrize("agent, check", CHECKS, ids=[a for a, _ in CHECKS])
def test_hand_back_passes_in_prose_with_no_line(agent, check):
    text = "ns_001 written. The person-evidence agent owns pe_004 and pe_005; it ties them or lowers them."
    check([WARNED_WRITE], reply(agent, text), "", TAG)


@pytest.mark.parametrize("agent, check", CHECKS, ids=[a for a, _ in CHECKS])
def test_hand_back_fails_when_person_evidence_is_not_named(agent, check):
    with pytest.raises(AssertionError, match="never names person-evidence"):
        check([WARNED_WRITE], reply(agent, "ns_001 written; pe_004 and pe_005 are untied."), "", TAG)


@pytest.mark.parametrize("agent, check", CHECKS, ids=[a for a, _ in CHECKS])
def test_hand_back_fails_when_a_warned_link_is_missing(agent, check):
    text = "Hand-back: person-evidence — namesake ns_001 recorded for I1; links pe_004 are untied"
    with pytest.raises(AssertionError, match=r"omits warned links \['pe_005'\]"):
        check([WARNED_WRITE], reply(agent, text), "", TAG)


@pytest.mark.parametrize("agent, check", CHECKS, ids=[a for a, _ in CHECKS])
def test_hand_back_does_not_count_a_longer_id(agent, check):
    text = "The person-evidence agent owns pe_0040 and pe_005."
    with pytest.raises(AssertionError, match=r"omits warned links \['pe_004'\]"):
        check([WARNED_WRITE], reply(agent, text), "", TAG)


def test_hand_back_reads_only_the_named_agents_return():
    text = "Hand-back: person-evidence — namesake ns_001 recorded for I1; links pe_004, pe_005 are untied"
    with pytest.raises(AssertionError, match="never names person-evidence"):
        images.test_namesake_warning_handed_to_person_evidence([WARNED_WRITE], reply("search-records", text), "", TAG)


# --- search-images: the page row ----------------------------------------------

IMG = {"tags": ["browse", "namesake-row"]}
BROWSE_LOG = {"id": "log_020", "tool": "image_search"}
READ_BY_ID = call("image_transcribe", {"imageId": "007936749_00012", "projectPath": "/p"})
READ_BY_ARK = call("image_transcribe", {"ark": "ark:/61903/3:1:3Q9M-CS1Z-9Q7S", "projectPath": "/p"})


def img_after(*rows):
    return state(log=[BROWSE_LOG], namesakes=rows)


def test_image_row_passes_on_the_image_id_as_passed():
    after = img_after(row(record_ids=["007936749_00012"], log_entry_ids=["log_020"], notes="died 1882"))
    images.test_namesake_row_recorded(BEFORE, after, [READ_BY_ID], IMG)


def test_image_row_passes_on_the_ark_when_the_page_was_read_by_ark():
    after = img_after(row(record_ids=["ark:/61903/3:1:3Q9M-CS1Z-9Q7S"], log_entry_ids=["log_020"], notes="died 1882"))
    images.test_namesake_row_recorded(BEFORE, after, [READ_BY_ARK], IMG)


@pytest.mark.parametrize(
    "record_ids, logs, message",
    [
        (["L4XK-2PQ"], ["log_020"], "is not an imageId or ark"),
        (["images/007936749_00012.json"], ["log_020"], "is not an imageId or ark"),
        (["results/.staging/abc.json"], ["log_020"], "is not an imageId or ark"),
        (["ark:/61903/3:1:3Q9M-CS1Z-9Q7S"], ["log_020"], "is not an imageId or ark"),
        ([], ["log_020"], "lists no id"),
        (["007936749_00012"], ["log_001"], "none of them a image_search log"),
    ],
    ids=["persona-id", "image-ref", "staged-ref", "ark-not-read", "empty", "wrong-log"],
)
def test_image_row_rejects(record_ids, logs, message):
    after = img_after(row(record_ids=record_ids, log_entry_ids=logs, notes="died 1882"))
    with pytest.raises(AssertionError, match=message):
        images.test_namesake_row_recorded(BEFORE, after, [READ_BY_ID], IMG)


def test_image_row_rejects_no_row():
    with pytest.raises(AssertionError, match="recorded no namesakes row"):
        images.test_namesake_row_recorded(BEFORE, img_after(), [READ_BY_ID], IMG)


# --- search-full-text: the hit row --------------------------------------------

FTS = {"tags": ["fulltext", "namesake-row"]}
FTS_LOG = {"id": "log_030", "tool": "fulltext_search"}
HIT = "https://familysearch.org/ark:/61903/3:1:3Q9M-CSQ7-1XYZ"
SEARCH = call("fulltext_search", {"keywords": "+Flynn"}, {"results": [{"id": HIT, "title": "Deed"}]})


@pytest.mark.parametrize("listed", [HIT, "ark:/61903/3:1:3Q9M-CSQ7-1XYZ", "3Q9M-CSQ7-1XYZ"])
def test_hit_row_passes_on_any_spelling_of_the_hit_id(listed):
    after = state(log=[FTS_LOG], namesakes=[row(record_ids=[listed], log_entry_ids=["log_030"], notes="adult in 1834")])
    fulltext.test_namesake_row_recorded(BEFORE, after, [SEARCH], FTS)


def test_hit_row_passes_on_a_stringified_response():
    stringified = call("fulltext_search", {"keywords": "+Flynn"}, json.dumps({"results": [{"id": HIT}]}))
    after = state(log=[FTS_LOG], namesakes=[row(record_ids=[HIT], log_entry_ids=["log_030"])])
    fulltext.test_namesake_row_recorded(BEFORE, after, [stringified], FTS)


def test_hit_row_rejects_an_id_the_search_never_returned():
    after = state(log=[FTS_LOG], namesakes=[row(record_ids=["3Q9M-OTHER-0000"], log_entry_ids=["log_030"])])
    with pytest.raises(AssertionError, match="is not the id of a hit"):
        fulltext.test_namesake_row_recorded(BEFORE, after, [SEARCH], FTS)


# --- no subject, no rows (both co-writers) -----------------------------------

NO_SUBJECT = {"tags": ["browse"], "delegation": "Browse the probate volume.\n\nprojectPath: <workspace>"}
WITH_SUBJECT = {"tags": ["browse"], "delegation": "planItemId: pli_006\nsubject:\n{\"subjectId\": \"I1\"}"}


@pytest.mark.parametrize("module", [images, fulltext], ids=["search-images", "search-full-text"])
def test_no_subject_check_passes_with_no_row(module):
    module.test_no_namesake_row_without_subject(BEFORE, state(), NO_SUBJECT)


@pytest.mark.parametrize("module", [images, fulltext], ids=["search-images", "search-full-text"])
def test_no_subject_check_fails_on_a_row(module):
    with pytest.raises(AssertionError, match="no subject was handed"):
        module.test_no_namesake_row_without_subject(BEFORE, state(namesakes=[row()]), NO_SUBJECT)


@pytest.mark.parametrize("test", [WITH_SUBJECT, {"tags": ["browse"]}], ids=["subject-handed", "no-delegation"])
def test_no_subject_check_skips(test):
    with pytest.raises(pytest.skip.Exception):
        images.test_no_namesake_row_without_subject(BEFORE, state(namesakes=[row()]), test)


# --- research: the subject's parents ------------------------------------------

ITEM = {
    "id": "pli_001",
    "sequence": 1,
    "record_type": "vital_record",
    "jurisdiction": "Hamre, Norway",
    "rationale": "Search for Unna.",
    "fallback_for": None,
    "status": "planned",
}
PERSONS = [{"id": i} for i in ("I1", "I2", "I3", "I4")]


def tree(*parents):
    return {
        "persons": PERSONS,
        "relationships": [{"id": f"R{n}", "type": "ParentChild", "parent": p, "child": "I1"} for n, p in enumerate(parents)],
    }


def before(*parents, question=None):
    plan = {"id": "pl_001", "status": "active", "items": [ITEM]}
    research_json = {"project": {"subject_person_ids": ["I1"]}, "plans": [plan]}
    if question is not None:
        plan["question_id"] = "q_001"
        research_json["questions"] = [{"id": "q_001", "question": question}]
    return {"tree_gedcomx_json": tree(*parents), "research_json": research_json}


def records_spawn(subject, *, indent=2):
    body = json.dumps(subject, indent=indent)
    prompt = f"planItemId: pli_001\nplanId: pl_001\nplan_item:\n{json.dumps(ITEM, indent=2)}\nsubject:\n{body}"
    return {"tool": None, "args": {"subagent_type": "search-records", "prompt": prompt}}


RTEST = {"tags": ["routing", "routes-to:search-records", "asserts-delegation-plan-item"]}
NAMES = [{"given": "Anders", "surname": "Unna", "type": "BirthName"}]
TWO = [{"personId": "I2", "name": "Ole"}, {"personId": "I3", "name": "Brita"}]


def test_parents_pass_when_the_block_names_both():
    research.test_delegation_hands_plan_item_verbatim(
        RTEST, [records_spawn({"subjectId": "I1", "names": NAMES, "parents": TWO})], before("I2", "I3")
    )


def test_parents_pass_on_a_reflowed_block_in_another_order():
    subject = {"parents": list(reversed(TWO)), "names": NAMES, "subjectId": "I1"}
    research.test_delegation_hands_plan_item_verbatim(RTEST, [records_spawn(subject, indent=None)], before("I3", "I2"))


def test_parents_pass_absent_when_the_tree_has_none():
    research.test_delegation_hands_plan_item_verbatim(RTEST, [records_spawn({"subjectId": "I1", "names": NAMES})], before())


@pytest.mark.parametrize(
    "parents, tree_parents, message",
    [
        (None, ("I2", "I3"), r"names \[\], not I1's parents"),
        ([TWO[0]], ("I2", "I3"), r"names \['I2'\], not I1's parents"),
        ([{"personId": "I4", "name": "Per"}, TWO[1]], ("I2", "I3"), r"names \['I3', 'I4'\]"),
        (TWO, ("I2", "I3", "I4"), "who has 3 parents in the tree; leave it out"),
    ],
    ids=["missing", "one-of-two", "wrong-id", "handed-on-three"],
)
def test_parents_reject(parents, tree_parents, message):
    subject = {"subjectId": "I1", "names": NAMES}
    if parents is not None:
        subject["parents"] = parents
    with pytest.raises(AssertionError, match=message):
        research.test_delegation_hands_plan_item_verbatim(RTEST, [records_spawn(subject)], before(*tree_parents))


def test_parents_pass_absent_on_three():
    research.test_delegation_hands_plan_item_verbatim(
        RTEST, [records_spawn({"subjectId": "I1", "names": NAMES})], before("I2", "I3", "I4")
    )


PTEST = {"tags": [*RTEST["tags"], "parents-question"]}
ASKS = "Who were the parents of Anders Unna?"


def test_parents_question_passes_with_no_parents_handed():
    research.test_delegation_hands_plan_item_verbatim(
        PTEST, [records_spawn({"subjectId": "I1", "names": NAMES})], before("I2", "I3", question=ASKS)
    )


def test_parents_question_passes_on_an_empty_list():
    research.test_delegation_hands_plan_item_verbatim(
        PTEST, [records_spawn({"subjectId": "I1", "names": NAMES, "parents": []})], before("I2", "I3", question=ASKS)
    )


def test_parents_question_rejects_the_tree_parents_handed():
    with pytest.raises(AssertionError, match="on a search for his parents; leave it out"):
        research.test_delegation_hands_plan_item_verbatim(
            PTEST, [records_spawn({"subjectId": "I1", "names": NAMES, "parents": TWO})], before("I2", "I3", question=ASKS)
        )


def test_parents_question_rejects_one_parent_handed():
    with pytest.raises(AssertionError, match="on a search for his parents; leave it out"):
        research.test_delegation_hands_plan_item_verbatim(
            PTEST, [records_spawn({"subjectId": "I1", "names": NAMES, "parents": [TWO[0]]})], before("I2", question=ASKS)
        )


@pytest.mark.parametrize(
    "question",
    [
        "Was Anders Unna the son of Ole Unna?",
        "Who was Anders Unna's father?",
        "Was Brita the mother of Anders Unna?",
        "Was Anders Unna a child of Ole and Brita?",
        "What was the parentage of Anders Unna?",
    ],
    ids=["son-of", "father-only", "mother-yes-no", "child-of", "parentage"],
)
def test_parents_question_passes_on_every_wording_that_asks_about_a_parent(question):
    research.test_delegation_hands_plan_item_verbatim(
        PTEST, [records_spawn({"subjectId": "I1", "names": NAMES})], before("I2", "I3", question=question)
    )


def test_a_yes_no_father_question_still_rejects_the_tree_parents_handed():
    with pytest.raises(AssertionError, match="on a search for his parents; leave it out"):
        research.test_delegation_hands_plan_item_verbatim(
            PTEST,
            [records_spawn({"subjectId": "I1", "names": NAMES, "parents": TWO})],
            before("I2", "I3", question="Was Anders Unna the son of Ole Unna?"),
        )


@pytest.mark.parametrize(
    "question",
    ["Whom did Anders Unna marry?", "Who was the godfather of Anders Unna?", "Where did Anders Unna's grandmother live?"],
    ids=["marriage", "godfather", "grandmother"],
)
def test_parents_question_tag_on_a_question_asking_no_parents_is_drift(question):
    with pytest.raises(AssertionError, match="Scenario drift: parents-question is set"):
        research.test_delegation_hands_plan_item_verbatim(
            PTEST,
            [records_spawn({"subjectId": "I1", "names": NAMES})],
            before("I2", "I3", question=question),
        )


def test_untagged_parents_question_still_owes_the_tree_parents():
    with pytest.raises(AssertionError, match=r"names \[\], not I1's parents"):
        research.test_delegation_hands_plan_item_verbatim(
            RTEST, [records_spawn({"subjectId": "I1", "names": NAMES})], before("I2", "I3", question=ASKS)
        )


# --- research: search-images is handed the subject ---------------------------

HTEST = {"tags": ["routing", "routes-to:search-images", "hands-subject"]}


def images_spawn(prompt):
    return {"tool": None, "args": {"subagent_type": "search-images", "prompt": prompt}}


def test_hands_subject_ignores_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        research.test_delegation_hands_subject({"tags": ["routing"]}, [], before())


def test_hands_subject_passes_on_a_block():
    prompt = f"planItemId: pli_001\nimageGroupNumber: 004567123\nsubject:\n{json.dumps({'subjectId': 'I1', 'names': NAMES})}"
    research.test_delegation_hands_subject(HTEST, [images_spawn(prompt)], before())


@pytest.mark.parametrize(
    "prompt, message",
    [
        ("planItemId: pli_001\nimageGroupNumber: 004567123", "no subject JSON block"),
        ("planItemId: pli_001\nsubject:\n{\"subjectId\": \"I9\", \"names\": [1]}", "is not a person in the tree"),
        ("planItemId: pli_001\nsubject:\n{\"subjectId\": \"I1\"}", "carries no names"),
    ],
    ids=["no-block", "not-in-tree", "no-names"],
)
def test_hands_subject_rejects(prompt, message):
    with pytest.raises(AssertionError, match=message):
        research.test_delegation_hands_subject(HTEST, [images_spawn(prompt)], before())


def test_hands_subject_fails_when_search_images_was_never_spawned():
    with pytest.raises(AssertionError, match="No recorded spawn of 'search-images'"):
        research.test_delegation_hands_subject(HTEST, [], before())


# --- search-records: the Cedillo pool (issue #4042) -------------------------

CEDILLO = {"id": "ut_search_records_cdl", "tags": ["cedillo-no-rule-out"]}
CEDILLO_POOL = row(
    name="Nicolasa Cedillo",
    log_entry_ids=["log_001"],
    notes="pool: ark:/61903/1:1:X7FS-6T4L (d. 1943, mother Julia) and X7FM-YRGN (d. 1945, parents Ventura Cedillo, María Jesús Amaya)",
)


def cedillo_after(*rows):
    return state(log=[{"id": "log_001", "tool": "record_search"}], namesakes=list(rows))


def test_cedillo_check_ignores_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        records.test_cedillo_neither_woman_ruled_out(BEFORE, cedillo_after(), {"id": "x", "tags": []})


def test_cedillo_check_passes_on_the_pool_row():
    records.test_cedillo_neither_woman_ruled_out(BEFORE, cedillo_after(CEDILLO_POOL), CEDILLO)


def test_cedillo_check_passes_with_no_row():
    records.test_cedillo_neither_woman_ruled_out(BEFORE, cedillo_after(), CEDILLO)


def test_cedillo_check_passes_beside_an_unrelated_namesake():
    other = row(id="ns_002", name="Nicolasa Cedillo Hernandez", record_ids=["ark:/61903/1:1:X7JJ-K94N"], notes="born 1956")
    records.test_cedillo_neither_woman_ruled_out(BEFORE, cedillo_after(other), CEDILLO)


@pytest.mark.parametrize(
    "rows, message",
    [
        ([row(record_ids=["ark:/61903/1:1:X7FM-YRGN"], notes="other parents")], r"lists \['X7FM-YRGN'\]"),
        ([CEDILLO_POOL, row(id="ns_002", record_ids=["X7FS-6T4L"], notes="spouse")], r"lists \['X7FS-6T4L'\]"),
        ([CEDILLO_POOL, row(id="ns_002", record_ids=["ark:/61903/1:1:X7LS-KMLK"], notes="a different Santiago")], r"lists \['X7LS-KMLK'\]"),
        ([row(record_ids=["X7FS-X3LL"], notes="a daughter, not her")], r"lists \['X7FS-X3LL'\]"),
    ],
)
def test_cedillo_check_rejects(rows, message):
    with pytest.raises(AssertionError, match=message):
        records.test_cedillo_neither_woman_ruled_out(BEFORE, cedillo_after(*rows), CEDILLO)
