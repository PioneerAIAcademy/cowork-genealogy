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
    test_reply_never_names_the_subject_by_the_disputed_reading as check_reply_names,
)

T1900 = {
    "skill": "research",
    "tags": ["transcribes-in-place", "index-vs-reading", "index-reading:blank",
             "machine-reading:Anthony", "on-line:23"],
}
T1880 = {
    "skill": "research",
    "tags": ["transcribes-in-place", "index-vs-reading", "index-reading:Armtogne",
             "machine-reading:Armistead", "on-line:43", "as-written:Ann Tone"],
}

BRIEF = {
    "skill": "research",
    "tags": ["brief-no-disputed-reading", "machine-reading:Anthony", "surname:Tyler", "agreed-prefix:A*"],
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
        GOOD_1900 + " This is a confirmed transcription.",
        GOOD_1900 + " Line 23 is now a confirmed Anthony.",
        "Line 23 reads Tyler Anthony.",
        # scratch_2026-11-18_10-11-07, ut_research_iv1 run 1
        GOOD_1900 + " The name as written on the page reads Anthony, not a female given name.",
        GOOD_1900 + " Anthony is the name as written on the image.",
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
        GOOD_1880 + " This is no misprint, it is a variant of Antoine.",
        # scratch_2026-11-17_17-34-55, ut_research_iv2 runs 3 and 4
        GOOD_1880 + " The index reading is a machine-transcription misread of a cursive Armistead.",
        GOOD_1880 + " The two share the letters Arm-, suggesting the indexer misread the same word.",
        GOOD_1880 + " Armistead is the more plausible reading of the two.",
        GOOD_1880 + " The image reads Armistead, not Armtogne.",
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
        # scratch_2026-11-18_07-21-54, ut_research_iv2
        GOOD_1900 + " This is a machine reading of one image, not a confirmed transcription.",
        GOOD_1900 + " It is not an confirmed reading.",
        # "as written" for another record, or for what the page was asked for, is not a verdict
        GOOD_1900 + " The 1923 certificate gives Ann Tone, as written on the certificate.",
        GOOD_1900 + " Only the image can show the name as written.",
        GOOD_1900.replace("Line 23", "Line no. 23"),
        "- Index: Tyler, given name blank\n- Machine reading: Tyler, Anthony\n- Line #23 on the image",
    ],
)
def test_legitimate_variants_pass(reply):
    check_reply(T1900, reply)


@pytest.mark.parametrize(
    "reply",
    [
        GOOD_1880 + " The two records disagree, and neither can simply be called a variant of the other.",
        GOOD_1880 + " Ann Tone is not a rendering of Armistead.",
        # scratch_2026-11-18_08-09-03, ut_research_iv2 runs 0, 1 and 3
        GOOD_1880 + " None of them is confirmed as a variant of the other.",
        GOOD_1880 + " None of the three can be called correct or a variant of another.",
        GOOD_1880 + " I cannot call any of these a variant or rendering of another.",
    ],
)
def test_a_fold_named_only_to_deny_it_passes(reply):
    check_reply(T1880, reply)


@pytest.mark.parametrize(
    "reply",
    [
        GOOD_1880 + " I cannot say the indexer did not misread it, nor that the machine did.",
        GOOD_1880 + " The index was never shown to be a misread; only the image can settle it.",
        GOOD_1880 + " Either reading could be a misread; the index and the machine disagree.",
        GOOD_1880 + " The machine reads Armistead and the index reads Armtogne.",
    ],
)
def test_a_misread_not_laid_on_the_index_passes(reply):
    check_reply(T1880, reply)


@pytest.mark.parametrize(
    "reply",
    [
        GOOD_1880 + " I can't say the index is wrong.",
        GOOD_1880 + " The two readings do not both agree.",
        GOOD_1880 + " I won't say the indexer misread line 43.",
        # v54_2026-11-19_05-55-23, ut_research_iv2 run 0: "confirmed" about the upload, not a reading
        "Good, the project is here and the upload is confirmed. " + GOOD_1880,
        # scratch_2026-11-19_05-45-24, ut_research_iv1 run 4: the reading is credited to the transcription
        GOOD_1880 + " The transcription of the image reads the given name as Armistead.",
        GOOD_1880 + " The machine reading of the image reads Armistead.",
    ],
)
def test_a_verdict_denied_just_before_it_passes(reply):
    check_reply(T1880, reply)


@pytest.mark.parametrize(
    "reply",
    [
        # the denial sits in another clause, or too far back, so the verdict stands
        GOOD_1880 + " I do not doubt it: the index is wrong.",
        GOOD_1880 + " There is no question at all that, having looked twice, the index was wrong.",
        GOOD_1880 + " It isn't hard to see; the image is clear.",
        GOOD_1880 + " Looking again, the image reads Armistead.",
    ],
)
def test_a_denial_away_from_the_verdict_does_not_excuse_it(reply):
    with pytest.raises(AssertionError, match="verdict"):
        check_reply(T1880, reply)


def test_an_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check_reply({"skill": "research", "tags": ["transcribes-in-place"]}, "anything")


def _spawn(callee: str, prompt: str) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": callee, "prompt": prompt}}


@pytest.mark.parametrize(
    "calls",
    [
        [_spawn("search-records", 'subject: {"names": ["Tyler"]}\ngivenName: A*\n'
                "The 1900 index gives no given name; one machine reading gives Anthony, in doubt.")],
        [_spawn("search-images", "Machine reading 'Anthony' is disputed; the index has Tyler only. Search A*.")],
        [_spawn("search-records", 'subject: {"names": [{"given": "A*", "surname": "Tyler"}]}'),
         _spawn("person-evidence", "Anthony Tyler")],
        # scratch_2026-11-18_08-09-03, ut_research_iv3 runs 0, 2 and 4, each with A* added
        [_spawn("search-records", 'subject: {"names": [{"surname": "Tyler"}]}\nThe tree calls her '
                '"Anthony Tyler" but no linked name assertion confirms the given name. Search A*.')],
        [_spawn("search-records", 'The machine transcription of that census page reads "Tyler '
                'Anthony." Try first-name wildcards (e.g. A*).')],
        [_spawn("search-records", 'The tree currently records her as "Anthony Tyler" but no name '
                "assertion carries that given name — it is a proposed reading only. Given name: A*")],
    ],
)
def test_a_brief_holding_the_reading_in_doubt_passes(calls):
    check_brief(BRIEF, calls)


@pytest.mark.parametrize(
    "calls",
    [
        [_spawn("search-records", "given name: Anthony (a machine reading in doubt), search as A*")],
        [_spawn("search-records", 'subject: {"names": ["Tyler"]}\nGiven name: A*\n'
                "Household: father given name: John, mother given name: Sarah.")],
    ],
)
def test_other_given_names_and_a_doubted_field_pass(calls):
    check_brief(BRIEF, calls)


@pytest.mark.parametrize(
    "calls",
    [
        [_spawn("search-images", "Machine reading 'Anthony' is disputed; the index has Tyler only.")],
        # a longer prefix than project_context's searchAs misses Atonne and Armtogne
        [_spawn("search-records", 'subject: {"names": ["Tyler"]}\nGiven name: An* (Anthony is in doubt).')],
        # scratch_2026-11-18_08-09-03, ut_research_iv3 runs 0 and 3: surname only
        [_spawn("search-records", 'subject: {"names": [{"surname": "Tyler"}]}\nSearch with surname '
                "Tyler, born ~1853 Virginia. She may appear under any given name or initial.")],
    ],
)
def test_a_brief_that_drops_the_given_name_fails(calls):
    with pytest.raises(AssertionError, match="name was dropped"):
        check_brief(BRIEF, calls)


@pytest.mark.parametrize("calls", [[], [_spawn("person-evidence", "Anthony Tyler")]])
def test_no_search_briefed_fails_rather_than_passing_unchecked(calls):
    with pytest.raises(AssertionError, match="no brief to check"):
        check_brief(BRIEF, calls)


@pytest.mark.parametrize(
    "calls",
    [
        [_spawn("search-records", 'subject: {"subjectId": "I1", "names": ["Anthony Tyler"]}')],
        [_spawn("search-records", "Search the 1910 census for Tyler, Anthony in Fluvanna.")],
        [_spawn("search-full-text", "givenName: Anthony\nsurname: Tyler")],
        [_spawn("search-records", '{"givenName": "Anthony", "surname": "Tyler"}')],
        [_spawn("search-images", "**first name:** Antone")],
        [_spawn("search-records", 'subject: {"names": [{"given": "Anthony", "surname": "Tyler"}]}')],
        # a doubt word in another sentence does not excuse naming her by the reading
        [_spawn("search-records", "Her name is disputed. Search for Anthony Tyler in 1910. A*")],
        [_spawn("search-records", "Search for Anthony Tyler, the name in the tree. Wildcard A* too.")],
    ],
)
def test_a_brief_naming_the_subject_by_the_reading_fails(calls):
    with pytest.raises(AssertionError, match="reading in doubt"):
        check_brief(BRIEF, calls)


def test_the_brief_check_skips_the_transcription_tests():
    with pytest.raises(pytest.skip.Exception):
        check_brief(T1900, [])


# PR #4711 review, item 5: "no doubt" affirms the verdict after it; it is no denial.
@pytest.mark.parametrize(
    "reply",
    [
        GOOD_1900 + " There is no doubt the image is clear.",
        GOOD_1900 + " I have no doubt the index misread it.",
        GOOD_1900 + " Without question the index is wrong.",
    ],
)
def test_an_affirming_no_doubt_does_not_deny_the_verdict(reply):
    with pytest.raises(AssertionError, match="verdict"):
        check_reply(T1900, reply)


@pytest.mark.parametrize(
    "reply",
    [
        GOOD_1900 + " No doubt you will want to check line 23 yourself.",
        GOOD_1900 + " I can't say the index got it wrong.",
    ],
)
def test_no_doubt_about_something_else_still_passes(reply):
    check_reply(T1900, reply)


# PR #4711 review, item 6: verdict shapes the decided list did not name.
@pytest.mark.parametrize(
    "reply",
    [
        GOOD_1900 + " The indexer got it wrong.",
        GOOD_1900 + " The index was mistaken.",
        GOOD_1900 + " The enumerator wrote 'Tyler Anthony'.",  # the #4519 bundle's own phrase
        GOOD_1900 + " Her correct given name is Anthony.",
        GOOD_1900 + " Both passes match on Anthony.",
    ],
)
def test_more_verdict_shapes_fail(reply):
    with pytest.raises(AssertionError, match="verdict"):
        check_reply(T1900, reply)


@pytest.mark.parametrize(
    "reply",
    [
        GOOD_1900 + " What the enumerator wrote is for you to check on the image.",
        GOOD_1900 + " The two passes do not both match the index.",
        GOOD_1900 + " I can't tell whether the index is incorrect.",
        GOOD_1900 + " Neither reading can say what her correct name is.",
        GOOD_1900 + " The index is not mistaken just because a machine read it differently.",
    ],
)
def test_their_legitimate_neighbours_pass(reply):
    check_reply(T1900, reply)


# PR #4711 review, item 4: the reply and the search task's label, not only the prompt.
def _labelled(callee: str, description: str) -> dict:
    return {"tool": "Agent", "args": {"subagent_type": callee, "prompt": "Given name: A*", "description": description}}


@pytest.mark.parametrize(
    "reply,calls",
    [
        # v54_2026-11-19_15-46-00, ut_research_iv3
        ("Searching for Anthony Tyler (born April 1853, Virginia) in the 1910 census now.",
         [_labelled("search-records", "Search 1910 census for Tyler")]),
        ("Searching the 1910 census for her now.",
         [_labelled("search-records", "Search 1910 census for Anthony Tyler")]),
        ("Searching the 1910 census for **Tyler, Anthony** now.", []),
    ],
)
def test_naming_her_by_the_reading_to_the_researcher_fails(reply, calls):
    with pytest.raises(AssertionError, match="reading in doubt"):
        check_reply_names(BRIEF, reply, calls)


@pytest.mark.parametrize(
    "reply,calls",
    [
        ("Searching the 1910 census for Tyler, born about 1853 in Virginia, with the given name as A*.",
         [_labelled("search-records", "Search 1910 census for Tyler (A*)")]),
        ("The tree calls her Anthony Tyler, but that is one machine reading, in doubt; searching as A*.",
         [_labelled("search-records", "Search 1910 census for Tyler")]),
        ("Searching now.", [_labelled("person-evidence", "Link Anthony Tyler")]),
    ],
)
def test_holding_the_reading_in_doubt_to_the_researcher_passes(reply, calls):
    check_reply_names(BRIEF, reply, calls)


def test_the_reply_name_check_skips_the_transcription_tests():
    with pytest.raises(pytest.skip.Exception):
        check_reply_names(T1900, "Anthony Tyler", [])
