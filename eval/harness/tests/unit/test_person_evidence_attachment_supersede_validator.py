"""Direct tests for person-evidence's `supersedes-named-attachment-links`
validator (issue #3516 PR D), on the real scenario it grades.

Nothing under `validators/` is collected by `make harness-test`, so the check is
proven here in both directions (CLAUDE.md, "A new lint must be proven to fail").
"""

import copy
import json
import sys
from pathlib import Path

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS / "validators"))

from test_person_evidence import test_supersedes_named_attachment_links as check  # noqa: E402

_SCENARIO = _HARNESS.parents[0] / "fixtures" / "scenarios" / "becker-attachment-links-question"
TAGGED = {"tags": ["supersedes-named-attachment-links"]}
NAMED = ["a_001", "a_002", "a_003", "a_004", "a_005", "a_006"]


def _before() -> dict:
    return {"research_json": json.loads((_SCENARIO / "research.json").read_text(encoding="utf-8"))}


def _link(research: dict, assertion_id: str, score=0.91) -> str:
    pes = research["person_evidence"]
    new_id = f"pe_{len(pes) + 1:03d}"
    pes.append({
        "id": new_id, "assertion_id": assertion_id, "person_id": "I1", "confidence": "confident",
        "match_score": score, "rationale": "score 0.91; name, birth and residence match",
        "created": "2026-10-26", "superseded_by": None,
    })
    return new_id


def _supersede(research: dict, assertion_id: str, by: str) -> None:
    for pe in research["person_evidence"]:
        if pe["assertion_id"] == assertion_id and pe["id"] != by and not pe.get("superseded_by"):
            pe["superseded_by"] = by


def _good_after() -> dict:
    research = copy.deepcopy(_before()["research_json"])
    for aid in NAMED:
        _supersede(research, aid, _link(research, aid))
    return {"research_json": research}


def test_scenario_matches_the_validators_premise():
    research = _before()["research_json"]
    tied = sorted(a["id"] for a in research["assertions"] if a.get("extracted_for_question_ids"))
    assert tied == NAMED


def test_passes_the_expected_run():
    check(_before(), _good_after(), TAGGED)


def test_fires_when_a_named_link_stays_live():
    after = _good_after()
    for pe in after["research_json"]["person_evidence"]:
        if pe["assertion_id"] == "a_003" and pe.get("rationale", "").startswith("Linked because"):
            pe["superseded_by"] = None
    with pytest.raises(AssertionError, match="a_003, named"):
        check(_before(), after, TAGGED)


def test_fires_when_the_superseding_link_has_no_score():
    research = copy.deepcopy(_before()["research_json"])
    for aid in NAMED:
        _supersede(research, aid, _link(research, aid, score=None if aid == "a_005" else 0.91))
    with pytest.raises(AssertionError, match="no match_score"):
        check(_before(), {"research_json": research}, TAGGED)


def test_fires_when_superseded_by_a_link_for_another_pair():
    research = copy.deepcopy(_before()["research_json"])
    other = _link(research, "a_002")
    for aid in NAMED:
        _supersede(research, aid, other if aid == "a_001" else _link(research, aid))
    with pytest.raises(AssertionError, match="another pair"):
        check(_before(), {"research_json": research}, TAGGED)


def test_fires_when_the_unnamed_record_is_relinked():
    after = _good_after()
    _link(after["research_json"], "a_035")
    with pytest.raises(AssertionError, match="a_035 .not named. gained"):
        check(_before(), after, TAGGED)


def test_fires_when_the_unnamed_record_is_superseded():
    after = _good_after()
    _supersede(after["research_json"], "a_039", _link(after["research_json"], "a_039"))
    with pytest.raises(AssertionError, match="a_039, not named"):
        check(_before(), after, TAGGED)


def test_fires_on_a_run_that_wrote_nothing():
    with pytest.raises(AssertionError, match="still live"):
        check(_before(), _before(), TAGGED)


def test_skips_untagged():
    with pytest.raises(pytest.skip.Exception):
        check(_before(), _good_after(), {"tags": []})
