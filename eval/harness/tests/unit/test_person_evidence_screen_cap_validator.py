"""Direct tests for the screen-misattributed-cap validator: a new link for a
named assertion whose record source_screen calls misattributed is speculative."""

import copy
import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_person_evidence import test_screen_misattributed_caps_link as check  # noqa: E402

_SCENARIO = Path(__file__).resolve().parents[3] / "fixtures" / "scenarios" / "becker-attachment-links-question"
TAGGED = {"type": "positive", "tags": ["screen-misattributed-cap"]}


def _before():
    research = json.loads((_SCENARIO / "research.json").read_text(encoding="utf-8"))
    return {"research_json": research}


def _after_with(confidence, assertion_id="a_001"):
    after = copy.deepcopy(_before())
    after["research_json"]["person_evidence"].append(
        {"id": "pe_900", "assertion_id": assertion_id, "person_id": "I1", "confidence": confidence, "match_score": 0.91}
    )
    return after


def test_a_speculative_link_passes():
    check(_before(), _after_with("speculative"), TAGGED)


@pytest.mark.parametrize("confidence", ["probable", "confident", "possible"])
def test_a_higher_tier_on_a_named_assertion_fails(confidence):
    with pytest.raises(AssertionError, match="speculative at most"):
        check(_before(), _after_with(confidence), TAGGED)


def test_an_unnamed_assertion_is_not_capped():
    check(_before(), _after_with("probable", assertion_id="a_035"), TAGGED)


def test_an_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check(_before(), _after_with("probable"), {"type": "positive", "tags": []})
