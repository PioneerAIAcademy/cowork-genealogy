"""The premises ut_research_021 and ut_research_022 rest on, asserted.

Both tests are about Cornelius Driscoll and both read
`person-read-driscoll-personid-only.json`. Their rubrics name specific facts:
021's whole point is that a death record is ALREADY attached, so reading beats
searching; 022's is that no candidate sibling carries a parent, so the only
correct reply offers candidates rather than an answer.

Neither fact is asserted by the tests themselves. The judge is told them in
`judge_context`, so if a fixture edit removes one, the judge grades against a
setup that no longer exists and the failure looks like a model error.

This file is new rather than an addition to `test_fixtures.py` on purpose: that
file is modified by BOTH PR #3077 and PR #3115, and a new file cannot conflict
with either.
"""

from __future__ import annotations

import json
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "mcp"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def test_driscoll_still_has_an_attached_death_record() -> None:
    """ut_research_021's premise: the requested record is already attached."""
    sources = _load("person-read-driscoll-attached-sources")["response"]["sources"]
    assert sources, "the fixture carries no sources at all"
    deaths = [s for s in sources if "death" in json.dumps(s).lower()]
    assert deaths, (
        "ut_research_021 asks for a death record BECAUSE one is already attached. "
        "With no death source the ask becomes a genuine search and the test is "
        f"grading the opposite behaviour. Sources present: {[s['id'] for s in sources]}"
    )


def test_no_sibling_candidate_carries_a_parent() -> None:
    """ut_research_022's premise: both candidates are underdetermined.

    The first cut of this fixture copy-pasted a gedcomx block from the Flynn
    census fixture, which carried ParentChild relationships naming Thomas and
    Mary Flynn. That made both 'unattached candidates' full siblings with named
    parents, refuting the judge context in the same breath.
    """
    for hit in _load("record-search-driscoll-sibling-candidates")["response"]["results"]:
        rels = hit.get("gedcomx", {}).get("relationships", [])
        parents = [r for r in rels if r.get("type") == "ParentChild"]
        assert not parents, (
            f"{hit['personName']} carries a parent link, so the ask is answerable and "
            f"'candidates, not verdicts' stops being exercised. Relationships: {rels}"
        )


def test_the_canonical_fixture_is_the_only_driscoll_person_read() -> None:
    """There used to be two, and a copy that drifts is worse than no copy.

    This branch carried `person-read-driscoll-personid-only`, derived from the
    canonical fixture because the canonical predicate demanded
    `sourceDescriptions: true` and would otherwise have missed. PR #3077 dropped
    that key (the tool has ignored it since #2666), which made the copy redundant.
    Guarding the drift was the second-best answer; deleting the copy is the first.
    """
    reads = sorted(f.stem for f in FIXTURES.glob("person-read-driscoll*.json"))
    assert reads == ["person-read-driscoll-attached-sources"], (
        f"a second Driscoll person_read fixture is back: {reads}. Two fixtures for one subject "
        "drift, and two rubrics here rest on facts only one of them would carry."
    )
