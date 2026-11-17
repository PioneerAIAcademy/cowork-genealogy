"""Direct tests for `test_research.test_index_and_machine_reading_shown_side_by_side`
and `test_research.test_search_brief_never_carries_the_disputed_reading` (issue #4578).

The failing replies are the shapes the Tyler feedback bundles recorded; the passing
ones are what a correct run writes. `testpaths` excludes `validators/`, which is why
they live here.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import (  # noqa: E402
    test_index_and_machine_reading_shown_side_by_side as check_reply,
    test_search_brief_never_carries_the_disputed_reading as check_brief,
)

BRIEF_TAGS = ["surname:Tyler", "agreed-prefix:An*"]
T1900 = {
    "skill": "research",
    "tags": ["transcribes-in-place", "index-vs-reading", "index-reading:blank",
             "machine-reading:Anthony", "on-line:23", *BRIEF_TAGS],
}
T1880 = {
    "skill": "research",
    "tags": ["transcribes-in-place", "index-vs-reading", "index-reading:Armtogne",
             "machine-reading:Armistead", "on-line:43", "as-written:Ann Tone", *BRIEF_TAGS],
}

GOOD_1900 = (
    "Line 23 of the 1900 page, read again: the machine transcription gives "
    "**Tyler, Anthony**. The FamilySearch index has the surname Tyler and no given name. "
    "The two disagree, and a second pass over the same image is not a second witness. "
    "Look at line 23 on the image yourself: [open page](https://www.familysearch.org/x)."
)
GOOD_1880 = (
    "On line 43 of the 1880 page the index reads *Armtogne* and the machine reading gives "
    "*Armistead*; they differ, so check the image at line 43. The 1923 death certificate "
    "gives the name as Ann Tone Lightfoot, two words, as written."
)


@pytest.mark.parametrize("test,reply", [(T1900, GOOD_1900), (T1880, GOOD_1880)])
def test_a_side_by_side_reply_passes(test, reply):
    check_reply(test, reply)


@pytest.mark.parametrize(
    "reply",
    [
        "The image is clear: line 23 reads Tyler Anthony, though the index left the given name blank.",
        "Line 23: Anthony. The index was wrong to leave the given name blank.",
        "Two independent machine reads both return Anthony, so line 23 is confirmed; the index has no given name.",
        "Confirmed — both AI reads agree on Anthony at line 23. The index gives no given name.",
        "Line 23 reads Tyler Anthony.",
        "The index has no given name, and line 23 is worth checking on the image.",
        "Machine reading Anthony; the index has no given name.",
    ],
)
def test_the_1900_bundle_shapes_fail(reply):
    with pytest.raises(AssertionError):
        check_reply(T1900, reply)


@pytest.mark.parametrize(
    "reply",
    [
        "Line 43 is clear: Tyler Armistead. The index badly misread it as Armtogne.",
        "Line 43: Armistead. Armtogne was a poor attempt. The certificate gives Ann Tone.",
        "Line 43: index Armtogne, machine Armistead. 'Ann Tone' is a two-word phonetic rendering of Antoine.",
        "Line 43: index Armtogne, machine Armistead. The registrar split Antoine into Ann Tone.",
        "Line 43: index Armtogne, machine Armistead. The certificate gives Antone.",
    ],
)
def test_the_1880_bundle_shapes_fail(reply):
    with pytest.raises(AssertionError):
        check_reply(T1880, reply)


@pytest.mark.parametrize(
    "reply",
    [
        GOOD_1900 + " This is not confirmed by any other record.",
        GOOD_1900 + " It cannot be confirmed from this page alone.",
        GOOD_1900.replace("Line 23", "Line no. 23"),
        "- Index: Tyler, given name blank\n- Machine reading: Tyler, Anthony\n- Line #23 on the image",
    ],
)
def test_legitimate_variants_pass(reply):
    check_reply(T1900, reply)


def test_an_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check_reply({"skill": "research", "tags": ["transcribes-in-place"]}, "anything")


def _spawn(callee: str, prompt: str) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": callee, "prompt": prompt}}


@pytest.mark.parametrize(
    "calls",
    [
        [],
        [_spawn("search-records", 'subject: {"names": ["Tyler"]}\ngivenName: An*\n'
                "The 1900 index gives no given name; one machine reading gives Anthony, in doubt.")],
        [_spawn("search-images", "Machine reading 'Anthony' is disputed; the index has Tyler only.")],
        [_spawn("person-evidence", "Anthony Tyler")],
    ],
)
def test_a_brief_holding_the_reading_in_doubt_passes(calls):
    check_brief(T1900, calls)


@pytest.mark.parametrize(
    "calls",
    [
        [_spawn("search-records", 'subject: {"subjectId": "I1", "names": ["Anthony Tyler"]}')],
        [_spawn("search-records", "Search the 1910 census for Tyler, Anthony in Fluvanna.")],
        [_spawn("search-full-text", "givenName: Anthony\nsurname: Tyler")],
        [_spawn("search-records", '{"givenName": "Anthony", "surname": "Tyler"}')],
        [_spawn("search-images", "**first name:** Antone")],
    ],
)
def test_a_brief_naming_the_subject_by_the_reading_fails(calls):
    with pytest.raises(AssertionError):
        check_brief(T1900, calls)
