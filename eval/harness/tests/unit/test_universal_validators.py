"""Direct tests for the universal validators this change rewired.

Those validators are **never collected by `make harness-test`** — `pyproject.toml`
sets `testpaths = ["tests"]`, so `validators/test_universal.py` is outside it and
their real pass/fail set is produced only inside a paid per-skill eval run. That
made the move from two dict literals to a JSON manifest — and the widening of the
no-delete diff set alongside it — changes nothing would exercise until someone
spent $7-25.

So this module calls them directly, the same way `test_universal_context_calls.py`
does. It is about the *wiring*: that a permitted writer passes, a non-owner fails,
an undeclared section is not default-denied, `localities` is reached at all, and
the three sections the diff set used to omit are now covered by the no-delete
rule their own spec row states. Which skill owns which section is frozen next
door, in `test_ownership_manifest.py`.
"""

import json
import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_universal import (  # noqa: E402
    report_no_internal_identifiers_in_response as check_ids,
    test_no_entries_deleted as check_no_deletes,
    test_ownership_table as check_research,
    test_tree_ownership_table as check_tree,
    test_write_then_validate as check_write_then_validate,
)


POSITIVE = {"type": "positive"}


def research(**sections):
    base = {
        "project": {"id": "proj_001", "objective": "x", "updated": "2026-08-16T00:00:00Z"},
        "questions": [],
        "plans": [],
        "log": [],
        "sources": [],
        "assertions": [],
        "person_evidence": [],
        "conflicts": [],
        "hypotheses": [],
        "timelines": [],
        "proof_summaries": [],
        "evaluations": [],
        "localities": [],
    }
    base.update(sections)
    return {"research_json": base}


def tree(**sections):
    base = {"persons": [], "relationships": [], "sources": []}
    base.update(sections)
    return {"tree_gedcomx_json": base}


def entry(_id):
    return [{"id": _id}]


# ── research.json ──────────────────────────────────────────────────────────


def test_owner_writing_its_own_section_passes():
    check_research(
        research(), research(localities=entry("loc_001")), {"name": "locality-guide"}, POSITIVE
    )


def test_non_owner_writing_localities_fails():
    """The one section this promotion newly enforces.

    Before the move, the check iterated `REQUIRED_SECTIONS`, which never
    contained `localities` — so the section had a declared owner from the day it
    shipped and was never once evaluated. This call passed silently.
    """
    with pytest.raises(AssertionError) as e:
        check_research(
            research(),
            research(localities=entry("loc_001")),
            {"name": "research-plan"},
            POSITIVE,
        )
    assert "localities" in str(e.value)
    assert "locality-guide" in str(e.value)


def test_non_owner_writing_an_already_enforced_section_still_fails():
    with pytest.raises(AssertionError) as e:
        check_research(
            research(), research(conflicts=entry("c_001")), {"name": "timeline"}, POSITIVE
        )
    assert "conflicts" in str(e.value)


def test_proof_conclusion_may_write_questions():
    """The one writer set this promotion widened."""
    check_research(
        research(), research(questions=entry("q_001")), {"name": "proof-conclusion"}, POSITIVE
    )


def test_a_section_with_no_enforceable_row_is_not_default_denied():
    """`evaluations` is agent-owned, so this tier cannot express its row.

    Default-deny here would fail the mandatory proof critique on every run that
    has one — 114 of 154 committed runs. Not-checked and denied are different
    answers, and only one of them is right for a row this plane cannot see.
    """
    check_research(
        research(), research(evaluations=entry("ev_001")), {"name": "proof-conclusion"}, POSITIVE
    )


def test_project_updated_ping_alone_is_not_a_violation():
    before = research()
    after = research(
        project={**before["research_json"]["project"], "updated": "2026-08-17T00:00:00Z"}
    )
    check_research(before, after, {"name": "timeline"}, POSITIVE)


def test_substantive_project_change_by_a_non_owner_fails():
    before = research()
    after = research(project={**before["research_json"]["project"], "status": "completed"})
    with pytest.raises(AssertionError) as e:
        check_research(before, after, {"name": "timeline"}, POSITIVE)
    assert "project" in str(e.value)


def test_negative_tests_are_skipped():
    with pytest.raises(pytest.skip.Exception):
        check_research(
            research(),
            research(conflicts=entry("c_001")),
            {"name": "timeline"},
            {"type": "negative"},
        )


def test_ownership_is_skipped_on_a_stubbed_run():
    """The stub_skills skip must actually fire (issue #2156, lead-affirmed
    2026-09-14). On a stubbed positive run the owning callee is denied, so every
    section write lands on the caller; grading the caller for it measures the
    stub, not the skill. This uses a **non-owner** write so that if the skip
    block is ever removed the test fails loudly — the check would raise
    AssertionError instead of skipping — rather than passing vacuously, which is
    the coverage gap the lead flagged.
    """
    with pytest.raises(pytest.skip.Exception):
        check_research(
            research(),
            research(conflicts=entry("c_001")),
            {"name": "research"},
            {"type": "positive", "execution": {"stub_skills": ["question-selection"]}},
        )


def test_write_then_validate_is_skipped_on_a_stubbed_run():
    """Companion coverage for the other new stub skip (issue #2156). Same
    property: a stubbed positive run's research.json write is the stub/caller's,
    so demanding a `validate_research_schema` pass measures the stub. The skill
    declares the tool and none was called and research.json changed, so without
    the skip this raises — proving the skip block is load-bearing rather than
    inert (the gap the lead flagged for both new arms).
    """
    with pytest.raises(pytest.skip.Exception):
        check_write_then_validate(
            research(),
            research(conflicts=entry("c_001")),
            [],  # no tool calls -> no validate_research_schema call
            {"name": "research", "allowed-tools": ["validate_research_schema"]},
            {"type": "positive", "execution": {"stub_skills": ["question-selection"]}},
        )


# ── tree.gedcomx.json ──────────────────────────────────────────────────────


def test_tree_owner_writing_persons_passes():
    check_tree(tree(), tree(persons=entry("I1")), {"name": "person-evidence"}, POSITIVE)


def test_record_extraction_may_write_tree_sources_but_not_tree_persons():
    """Unchanged by #2472, deliberately.

    The assertion-backlink rewrite gives `extraction_append` a way to touch
    `persons`, but record-extraction is NOT added to that row's `callers`: a
    skill-granular grant would also authorize adding an unsourced person and
    setting `primary`, both of which this test refuses and both of which the
    row's own `failure` line is about ("This file is the upload target"). The
    rewrite is authorized by TOOL identity instead, and only for its own delta -
    see the two cases below.
    """
    check_tree(tree(), tree(sources=entry("S1")), {"name": "record-extraction"}, POSITIVE)
    with pytest.raises(AssertionError) as e:
        check_tree(tree(), tree(persons=entry("I1")), {"name": "record-extraction"}, POSITIVE)
    assert "persons" in str(e.value)


def _person_with_fact(**fact_over):
    fact = {"id": "F1", "type": "Immigration", "place": "Wellburn, Ontario, Canada",
            "assertion_id": "a_011", "sources": [{"ref": "S1"}]}
    fact.update(fact_over)
    return [{"id": "I1", "names": [{"id": "N1", "given": "Anna", "surname": "W"}], "facts": [fact]}]


#: A real correction: the tool, the op, and the assertion id it named.
_EXTRACTION_CALL = [{
    "tool": "mcp__genealogy__extraction_append",
    "args": {"section": "assertions", "op": "update", "entryId": "a_011",
             "fields": {"place": "Odessa, Saskatchewan, Canada"}},
}]

#: research.json as it stands AFTER that correction. The authorization checks
#: the fact's new value against it, so an arbitrary edit cannot ride the path.
def _research_after(place="Odessa, Saskatchewan, Canada"):
    return {"assertions": [{"id": "a_011", "place": place}]}


def _tree_state(persons, research=None):
    state = tree(persons=persons)
    state["research_json"] = research if research is not None else _research_after()
    return state


def test_the_fact_rewrite_is_authorized_by_tool_identity():
    """A backlinked fact's mirrored attributes may change under extraction_append."""
    check_tree(
        _tree_state(_person_with_fact()),
        _tree_state(_person_with_fact(place="Odessa, Saskatchewan, Canada")),
        {"name": "record-extraction"},
        POSITIVE,
        tool_calls=_EXTRACTION_CALL,
    )


def test_a_legacy_heal_riding_along_with_the_rewrite_is_still_authorized():
    """research_append runs sanitizeTree on every call and persists the healed
    document whenever it writes the tree, so a coerced legacy `quality` or a
    pruned unknown key arrives with a perfectly legitimate rewrite. Refusing that
    reds a run for something the TOOL did and the skill could not avoid."""
    before = _person_with_fact()
    before[0]["facts"][0]["sources"] = [{"ref": "S1", "quality": "3"}]
    before[0]["facts"][0]["legacy_key"] = "pruned on read"
    after = _person_with_fact(place="Odessa, Saskatchewan, Canada")
    after[0]["facts"][0]["sources"] = [{"ref": "S1", "quality": 3}]
    check_tree(
        _tree_state(before),
        _tree_state(after),
        {"name": "record-extraction"},
        POSITIVE,
        tool_calls=_EXTRACTION_CALL,
    )


def test_the_new_value_must_match_the_corrected_assertion():
    """An arbitrary edit to a backlinked fact is not the rewrite."""
    with pytest.raises(AssertionError) as e:
        check_tree(
            _tree_state(_person_with_fact()),
            _tree_state(_person_with_fact(place="anything at all")),
            {"name": "record-extraction"},
            POSITIVE,
            tool_calls=_EXTRACTION_CALL,
        )
    assert "persons" in str(e.value)


def test_the_corrected_assertion_must_be_one_the_run_named():
    """A backlink to an assertion no op touched cannot have been rewritten."""
    other = [{"tool": "mcp__genealogy__extraction_append",
              "args": {"section": "assertions", "op": "update", "entryId": "a_999",
                       "fields": {"place": "x"}}}]
    with pytest.raises(AssertionError) as e:
        check_tree(
            _tree_state(_person_with_fact()),
            _tree_state(_person_with_fact(place="Odessa, Saskatchewan, Canada")),
            {"name": "record-extraction"},
            POSITIVE,
            tool_calls=other,
        )
    assert "persons" in str(e.value)


@pytest.mark.parametrize("label,after_persons", [
    # Anything the rewrite cannot produce must still fail, even with the call present.
    ("adds a person", _person_with_fact(place="Odessa, Saskatchewan, Canada")
     + [{"id": "I2", "names": [], "facts": []}]),
    ("adds a fact", [{**_person_with_fact()[0],
                      "facts": _person_with_fact()[0]["facts"] + [{"id": "F2", "type": "Birth"}]}]),
    ("sets primary", _person_with_fact(place="Odessa, Saskatchewan, Canada", primary=True)),
    ("adds a source ref", _person_with_fact(sources=[{"ref": "S1"}, {"ref": "S2"}])),
    ("changes a name", [{**_person_with_fact()[0],
                         "names": [{"id": "N1", "given": "Anne", "surname": "W"}]}]),
    ("changes an unbacklinked fact", [{**_person_with_fact()[0],
                                       "facts": [{"id": "F1", "type": "Immigration",
                                                  "place": "Odessa, Saskatchewan, Canada",
                                                  "sources": [{"ref": "S1"}]}]}]),
    ("retypes the fact", _person_with_fact(type="Residence")),
])
def test_the_tool_identity_path_authorizes_nothing_else(label, after_persons):
    with pytest.raises(AssertionError) as e:
        check_tree(
            _tree_state(_person_with_fact()),
            _tree_state(after_persons),
            {"name": "record-extraction"},
            POSITIVE,
            tool_calls=_EXTRACTION_CALL,
        )
    assert "persons" in str(e.value), label


def test_the_tool_identity_path_needs_the_call():
    """Without an extraction_append/research_append call, the same delta fails."""
    with pytest.raises(AssertionError) as e:
        check_tree(
            _tree_state(_person_with_fact()),
            _tree_state(_person_with_fact(place="Odessa, Saskatchewan, Canada")),
            {"name": "record-extraction"},
            POSITIVE,
            tool_calls=[{"tool": "mcp__genealogy__person_read", "args": {}}],
        )
    assert "persons" in str(e.value)


def test_person_evidence_may_not_write_tree_sources():
    """It attaches a source ref to a node; it does not mint a source description."""
    with pytest.raises(AssertionError) as e:
        check_tree(tree(), tree(sources=entry("S1")), {"name": "person-evidence"}, POSITIVE)
    assert "sources" in str(e.value)


# ── the no-delete diff set ─────────────────────────────────────────────────


@pytest.mark.parametrize("section,_id", [
    ("localities", "loc_001"),
    ("evaluations", "ev_001"),
    ("known_holdings", "kh_001"),
])
def test_deleting_from_a_newly_covered_section_fails(section, _id):
    """The three sections the old diff set omitted.

    Each one's spec row states the no-delete rule — `localities` refreshes in
    place, `evaluations` retires via `superseded_by`, `known_holdings` never
    deletes — and until now nothing checked any of them.
    """
    with pytest.raises(AssertionError) as e:
        check_no_deletes(research(**{section: entry(_id)}), research())
    assert section in str(e.value)
    assert _id in str(e.value)


def test_deleting_from_an_already_covered_section_still_fails():
    with pytest.raises(AssertionError) as e:
        check_no_deletes(research(sources=entry("src_001")), research())
    assert "sources" in str(e.value)


def test_appending_is_not_a_deletion():
    check_no_deletes(research(), research(localities=entry("loc_001")))

def test_a_stringified_ops_payload_is_still_authorized():
    """`research_append` coerces a JSON-string `ops`, so the write lands and the
    run log records the string. Without parsing it here the authorization
    false-fails a legitimate write, which is the worse direction."""
    call = [{
        "tool": "mcp__genealogy__extraction_append",
        "args": {"ops": json.dumps([{
            "section": "assertions", "op": "update", "entryId": "a_011",
            "fields": {"place": "Odessa, Saskatchewan, Canada"},
        }])},
    }]
    check_tree(
        _tree_state(_person_with_fact()),
        _tree_state(_person_with_fact(place="Odessa, Saskatchewan, Canada")),
        {"name": "record-extraction"},
        POSITIVE,
        tool_calls=call,
    )


def test_an_op_touching_no_mirrored_field_authorizes_nothing():
    """An assertions update that set only `informant` cannot have caused a
    rewrite, so it must not license one."""
    call = [{
        "tool": "mcp__genealogy__extraction_append",
        "args": {"section": "assertions", "op": "update", "entryId": "a_011",
                 "fields": {"informant": "official"}},
    }]
    with pytest.raises(AssertionError) as e:
        check_tree(
            _tree_state(_person_with_fact()),
            _tree_state(_person_with_fact(place="Odessa, Saskatchewan, Canada")),
            {"name": "record-extraction"},
            POSITIVE,
            tool_calls=call,
        )
    assert "persons" in str(e.value)


def test_deleting_an_attribute_the_assertion_still_asserts_is_refused():
    """Absence is how the rewrite expresses a withdrawal, so it is legitimate
    only when the assertion withdrew it."""
    after = _person_with_fact()
    del after[0]["facts"][0]["place"]
    with pytest.raises(AssertionError) as e:
        check_tree(
            _tree_state(_person_with_fact()),
            _tree_state(after),
            {"name": "record-extraction"},
            POSITIVE,
            tool_calls=_EXTRACTION_CALL,
        )
    assert "persons" in str(e.value)


def test_deleting_an_attribute_the_assertion_withdrew_is_authorized():
    after = _person_with_fact()
    del after[0]["facts"][0]["place"]
    check_tree(
        _tree_state(_person_with_fact()),
        _tree_state(after, {"assertions": [{"id": "a_011", "place": None}]}),
        {"name": "record-extraction"},
        POSITIVE,
        tool_calls=_EXTRACTION_CALL,
    )


def test_a_name_prefix_change_is_not_authorized():
    """`_person_identity` compared four keys, so prefix, suffix and a name's own
    source refs could change and ride through."""
    after = _person_with_fact(place="Odessa, Saskatchewan, Canada")
    after[0]["names"] = [{"id": "N1", "given": "Anna", "surname": "W", "prefix": "Dr."}]
    with pytest.raises(AssertionError) as e:
        check_tree(
            _tree_state(_person_with_fact()),
            _tree_state(after),
            {"name": "record-extraction"},
            POSITIVE,
            tool_calls=_EXTRACTION_CALL,
        )
    assert "persons" in str(e.value)


def test_a_stubbed_run_skips_tree_ownership():
    """Mirrors the research-side skip (#2156 ruling). `research` carries 10
    stubbed positive tests, owns no tree section, and stubs `person-evidence`
    and `proof-conclusion` which own `persons` -- so without this the caller's
    write is attributed to `research` and the check measures the stub."""
    with pytest.raises(BaseException) as exc:
        check_tree(
            tree(),
            tree(persons=entry("I1")),
            {"name": "research"},
            {"type": "positive", "execution": {"stub_skills": ["person-evidence"]}},
        )
    assert exc.typename == "Skipped"


def test_an_UNSTUBBED_run_still_checks_tree_ownership():
    """The other direction, written so a SKIP counts as a FAILURE.

    `pytest.raises(AssertionError)` cannot express this. A `pytest.skip` inside
    the validator raises `Skipped`, which is a BaseException pytest reports as a
    skipped test, not a failed one -- so widening the skip to every run left the
    `raises` form green while silently standing the whole check down. Measured:
    that break turned 21 tests into skips and the suite still reported 0 failed.
    """
    outcome = "the check did not run at all (passed)"
    try:
        check_tree(tree(), tree(persons=entry("I1")), {"name": "research"}, POSITIVE)
    except AssertionError as exc:
        assert "persons" in str(exc)
        outcome = "refused"
    except BaseException as exc:  # noqa: BLE001 -- Skipped is a BaseException
        outcome = f"{type(exc).__name__}: {exc}"
    assert outcome == "refused", f"ownership was not enforced on an unstubbed run: {outcome}"


# --- lay mode: no internal identifiers in the reply (tier 2, advisory) ------

def _report_fails(text):
    try:
        check_ids(text, POSITIVE)
    except AssertionError as exc:
        return str(exc)
    return None


def test_identifier_report_names_each_schema_id_it_finds():
    msg = _report_fails("q_001 written. I logged the search as log_003 and added a_283.")
    assert msg is not None
    for ident in ("q_001", "log_003", "a_283"):
        assert ident in msg


def test_identifier_report_fires_on_bracketed_section_names():
    """The schema's section names written as arrays — `conflicts[]`,
    `hypotheses[]` — are how issue #2493's own quoted reply spoke to the tester."""
    msg = _report_fails("I added a conflicts[] entry and a hypotheses[] entry for Etta.")
    assert msg is not None and "conflicts[]" in msg and "hypotheses[]" in msg


def test_identifier_report_fires_on_project_file_and_tool_names():
    msg = _report_fails("I updated research.json through research_append.")
    assert msg is not None and "research.json" in msg and "research_append" in msg


def test_identifier_report_passes_a_lay_reply():
    """The other direction: a reply in the house style, with a year, a place and
    an ordinary numbered list, must not trip on numbers or underscores."""
    assert _report_fails(
        "I found the 1850 census for the household in Warren County. Mary is "
        "listed as 12, born in Ohio, which fits. Next: search for her marriage."
    ) is None


def test_identifier_report_skips_a_negative_test():
    with pytest.raises(pytest.skip.Exception):
        check_ids("q_001 written", {"type": "negative"})


def test_identifier_report_skips_an_empty_reply():
    with pytest.raises(pytest.skip.Exception):
        check_ids("", POSITIVE)
