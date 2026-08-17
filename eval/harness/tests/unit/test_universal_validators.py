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

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_universal import (  # noqa: E402
    test_no_entries_deleted as check_no_deletes,
    test_ownership_table as check_research,
    test_tree_ownership_table as check_tree,
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


# ── tree.gedcomx.json ──────────────────────────────────────────────────────


def test_tree_owner_writing_persons_passes():
    check_tree(tree(), tree(persons=entry("I1")), {"name": "person-evidence"}, POSITIVE)


def test_record_extraction_may_write_tree_sources_but_not_tree_persons():
    check_tree(tree(), tree(sources=entry("S1")), {"name": "record-extraction"}, POSITIVE)
    with pytest.raises(AssertionError) as e:
        check_tree(tree(), tree(persons=entry("I1")), {"name": "record-extraction"}, POSITIVE)
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
