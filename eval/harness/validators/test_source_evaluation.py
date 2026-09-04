"""Skill-specific validators for the source-evaluation skill.

source-evaluation is a read-only audit skill: it enumerates the sources
already attached to a person, reads each one, classifies what disagrees
with the profile, and reports. It writes nothing.

The rubric (rubric.md) keeps the prose-judgment dimensions — whether a
classification's cue is convincing, whether the report reads as triaged.
What lives here is the one rule that is a literal property of the text
and must not be left to a judge's mood: on a test that declares an index
discrepancy, the remedy must be a re-read and must not be a detach. That
is doctrine point 1 of issue #1606, and it is the thing the live agent
got wrong in feedback case #1536.

The check is gated on the `index-discrepancy` tag rather than inferred
from the transcript. `validator_runner.py`'s `text_response` contract is
explicit that a validator may assert a literal, falsifiable property of
the text but must not re-grade prose quality; deciding for itself which
finding is an index error would be exactly that. The tests declare the
situation; the validator asserts the rule.

Tool-usage enforcement is the universal `test_tool_allowlist`'s job — it
validates calls against the skill's own `allowed-tools` frontmatter, which
is where the absence of `image_read` and `image_transcribe` is enforced.

See test_universal.py module docstring for the full validator
function-signature contract.
"""

from __future__ import annotations

import re

import pytest

# Phrases that recommend severing the source from the person. Matched
# case-insensitively as whole words so "detached" and "detaching" count
# while an unrelated substring does not.
_DETACH_TERMS = ("detach", "detaching", "detached", "unlink", "unlinking", "unlinked")

# Phrases that recommend going back to the original image. "re-read",
# "reread" and "read the original" are all live in the skill body and in
# a genealogist's own vocabulary.
# The rule is "send the researcher back to what the index was made from", not
# the literal word "re-read". The corpus's index error sits on the Minnesota
# Death Index — "database, FamilySearch", index-only, no scan — so a correct
# report must NOT say "re-read the image" there, and SKILL.md now says so
# (review of PR #2165, finding 4b). A pattern that only matched re-read
# phrasings would have failed the very behaviour that change introduced.
_GO_TO_SOURCE_PATTERN = re.compile(
    r"re-?read"
    r"|read the original"
    r"|check the original"
    r"|against the original (image|record|page)"
    r"|go(ing)? back to"
    r"|derive[sd]? from"
    r"|was made from"
    r"|correction path"
    r"|correct the index",
    re.IGNORECASE,
)


def _requires_index_discrepancy(test) -> None:
    """Skip unless this test declares an index discrepancy in its tags."""
    if "index-discrepancy" not in (test.get("tags") or []):
        pytest.skip("test does not declare an index discrepancy")
    if test.get("type") != "positive":
        pytest.skip("negative tests route away and produce no audit")


def test_index_discrepancy_recommends_reread(text_response, test):
    """Doctrine point 1: re-read the record, do not detach the source.

    On a fact conflict that looks like a transcription or indexing error,
    the first-line remedy is re-reading the original image and correcting
    the index. Feedback case #1536: the agent effectively advised
    detaching, and the tester instead re-read the image, corrected the
    index, and kept the source attached.
    """
    _requires_index_discrepancy(test)
    assert _GO_TO_SOURCE_PATTERN.search(text_response), (
        "source-evaluation reported on an index discrepancy without "
        "recommending a re-read of the original record. Doctrine point 1 "
        "of issue #1606: for a fact conflict that looks like a "
        "transcription or indexing error, the first-line remedy is to "
        "re-read the original image and correct the index."
    )


def test_index_discrepancy_does_not_recommend_detaching(text_response, test):
    """The other half of doctrine point 1, and the one that actually failed.

    Detaching is reserved for a source genuinely about a different person.
    Recommending it for a mis-transcribed field discards good evidence and
    leaves the bad field in the index for the next researcher.

    Scoped to the ONE source the test declares as the index error, via
    `index_error_source`. An earlier version asked only whether the reply
    mentioned a misattribution anywhere before allowing the word "detach"
    anywhere — and since this corpus always contains a genuinely
    misattributed source (HOLE-003), a correct report always granted that
    licence, so the assertion could never fail. Review of PR #2165 proved it
    with a reply that hedged "re-read the original and correct the index, or
    detach the source if you prefer" on the index error and still passed,
    which rubric.md grades `partial`. The fix keeps the module's contract —
    the test declares the situation, the validator asserts the rule.
    """
    _requires_index_discrepancy(test)
    protected = test.get("index_error_source")
    if not protected:
        pytest.skip("test declares no index_error_source to protect")
    hits = [
        block
        for block in re.split(r"\n\s*\n", text_response)
        if protected.lower() in block.lower()
        and any(term in block.lower() for term in _DETACH_TERMS)
    ]
    assert not hits, (
        f"source-evaluation recommended detaching or unlinking in the same "
        f"passage as {protected!r}, which this test declares to be an "
        f"indexing error. Doctrine point 1 of issue #1606 reserves detaching "
        f"for genuinely misattributed sources; an index error is fixed by "
        f"going back to what the index was made from and correcting it. "
        f"Offending passage: {hits[0][:300] if hits else ''!r}"
    )


def test_research_json_unmodified(before_state, after_state, test):
    """source-evaluation is read-only — it reports, it does not write.

    Skipped on negative tests: the run is expected to route away to
    another skill, which may legitimately write as part of its own
    contract. Mirrors the same guard in test_check_warnings.py and
    test_project_status.py.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert before == after, (
        "source-evaluation modified research.json — this skill is read-only. "
        "Findings are reported as narrative; recording a conflict is the "
        "researcher's next step through conflict-resolution, not this "
        "skill's write."
    )


def test_tree_gedcomx_unmodified(before_state, after_state, test):
    """source-evaluation must not modify the tree either.

    Skipped on negative tests (see test_research_json_unmodified).
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    after = after_state.get("tree_gedcomx_json") or after_state.get("tree_gedcomx")
    if before is None or after is None:
        pytest.skip("Missing tree.gedcomx.json for diff")
    assert before == after, (
        "source-evaluation modified tree.gedcomx.json — this skill is "
        "read-only. Correcting an index happens on FamilySearch, by the "
        "researcher; detaching a source is a tree-edit decision the "
        "researcher makes after reading the report."
    )
