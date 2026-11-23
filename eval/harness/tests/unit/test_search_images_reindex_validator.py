"""Direct tests for the search-images re-index validators (#4141).

Same reason as the sibling `test_search_images_*` modules: nothing under
`validators/` is collected by `make harness-test`, so without these a
validator's pass/fail set would appear only inside a paid per-skill run
(CLAUDE.md, "A new lint must be proven to fail").

The bad replies are the tester's (issue #4133): the index's "Michael Barry"
called a misreading of the OCR's "Michael Berry", and the index's "Mila Fuller"
called missing because the OCR read that line as "Milo Hall".
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix so pytest does not collect them here.
from test_search_images import (  # noqa: E402
    test_reindex_reads_the_index_then_the_page_once as check_calls,
)
from test_search_images import (  # noqa: E402
    test_reindex_reply_pairs_readings_without_a_verdict as check_reply,
)

TEST = {"type": "positive", "tags": ["no-project", "reindex", "direct-arm"]}
IMG = "ark:/61903/3:1:33SQ-GYY1-B2G"

GOOD = """Index list read (27 entries); page read once.
---
| Line | FamilySearch index | New reading | |
|---|---|---|---|
| 1 | Michael Barry | Michael Berry | differ — check this line on the image (3:1:33SQ-GYY1-B2G) |
| 2 | Mila Fuller | Milo Hall | differ — check this line on the image (3:1:33SQ-GYY1-B2G) |
| 3 | Aaph B Totman | Asaph B Totman | differ — check this line on the image (3:1:33SQ-GYY1-B2G) |
Neither reading is marked as an index error: one machine reading can't overrule the index.
"""


def _call(tool, **args):
    return {"tool": f"mcp__genealogy__{tool}", "args": args}


GOOD_CALLS = [_call("image_index", imageId=IMG), _call("image_transcribe", imageId=IMG)]


# --- the reply check: bad replies fail, and say why ------------------------

BAD_REPLIES = {
    "tester's verdict on Barry": GOOD.replace(
        "| 1 | Michael Barry | Michael Berry | differ — check this line on the image (3:1:33SQ-GYY1-B2G) |",
        "| 1 | Michael Barry | Michael Berry | Surname misread — the index was wrong (3:1:33SQ-GYY1-B2G) |",
    ),
    "missing from the index": GOOD.replace(
        "| 2 | Mila Fuller | Milo Hall |",
        "| 2 | Mila Fuller | Milo Hall — missing from the index |",
    ),
    "image is clear": GOOD + "The image is clear, so the new reading stands.\n",
    "misindexed": GOOD + "Line 1 was misindexed by FamilySearch.\n",
    "stated correction": GOOD + "The correct spelling is Berry.\n",
    "separate unmatched rows": GOOD.replace(
        "| 2 | Mila Fuller | Milo Hall | differ — check this line on the image (3:1:33SQ-GYY1-B2G) |",
        "| 2 | Mila Fuller | — | unmatched |\n| 9 | — | Milo Hall | unmatched |",
    ),
    "Barry and Berry on separate lines": GOOD.replace(
        "| 1 | Michael Barry | Michael Berry |",
        "| 1 | Michael Barry | — |\n| 1b | — | Michael Berry |",
    ),
    "no block after ---": GOOD.replace("---\n", ""),
}


@pytest.mark.parametrize("name", sorted(BAD_REPLIES))
def test_bad_reply_fails_with_a_message(name):
    with pytest.raises(AssertionError) as err:
        check_reply([], BAD_REPLIES[name], TEST)
    assert str(err.value).strip(), f"{name}: the validator failed without saying why"


def test_a_table_above_a_second_rule_fails_naming_the_rule():
    """Scratch run 2026-11-19, runs 4-5: the pairs were right but sat above a
    second `---`, so the router relays only the summary below it."""
    reply = GOOD + "---\nI compared the page with its index; fifteen lines differ.\n"
    with pytest.raises(AssertionError, match="above the final `---`"):
        check_reply([], reply, TEST)


def test_negation_is_scoped_to_its_own_clause():
    """'Neither … index error' is negated; a second clause's verdict is not."""
    reply = GOOD + "Not every line differs; the index was wrong on line 1.\n"
    with pytest.raises(AssertionError, match="index was wrong"):
        check_reply([], reply, TEST)


# --- the other direction: correct variants pass ---------------------------

GOOD_REPLIES = {
    "side-by-side table": GOOD,
    "surname first": GOOD.replace("| Mila Fuller | Milo Hall |", "| Fuller, Mila | Hall, Milo |"),
    "prose pairs": "Read.\n---\nLine 2: FamilySearch has Mila Fuller; the new reading is Milo Hall. They differ, so look at line 2 on the image.\nLine 1: index Michael Barry, new reading Michael Berry; they differ.\n",
    "negated verdict": GOOD + "This is not a correction, and the index is not wrong on its say-so.\n",
}


@pytest.mark.parametrize("name", sorted(GOOD_REPLIES))
def test_correct_reply_passes(name):
    check_reply([], GOOD_REPLIES[name], TEST)


def test_untagged_test_is_skipped():
    with pytest.raises(pytest.skip.Exception):
        check_reply([], BAD_REPLIES["image is clear"], {"type": "positive", "tags": []})


# --- the call check -------------------------------------------------------

def test_calls_in_order_pass():
    check_calls(GOOD_CALLS, TEST)


BAD_CALLS = {
    "no image_index": [GOOD_CALLS[1]],
    "transcribe first": [GOOD_CALLS[1], GOOD_CALLS[0]],
    "second OCR pass": GOOD_CALLS + [GOOD_CALLS[1]],
    "projectPath on a no-project read": [GOOD_CALLS[0], _call("image_transcribe", imageId=IMG, projectPath="/tmp/p")],
    "logged with no project": GOOD_CALLS + [_call("research_log_append", projectPath="/tmp/p")],
    "never read the page": [GOOD_CALLS[0]],
}


@pytest.mark.parametrize("name", sorted(BAD_CALLS))
def test_bad_calls_fail_with_a_message(name):
    with pytest.raises(AssertionError) as err:
        check_calls(BAD_CALLS[name], TEST)
    assert str(err.value).strip()


def test_the_agents_own_return_is_graded_over_the_relay():
    """On the direct arm text_response is the dispatcher's relay; the agent's
    own return decides."""
    returns = [{"subagent_type": "search-images", "text": BAD_REPLIES["image is clear"]}]
    with pytest.raises(AssertionError):
        check_reply(returns, GOOD, TEST)


# --- code-review round (2026-11-18): the guard's reach ----------------------

AFFIRMED_VERDICTS = {
    "without doubt": GOOD + "Without doubt the index was wrong on line 1.\n",
    "no question": GOOD + "There is no question the index was wrong on line 1.\n",
    "negation joined by and": GOOD + "It is not Barry and the index was wrong.\n",
    "negation far back in the clause": GOOD
    + "No careful reader of this old hand could miss that the index was wrong on line 1\n",
}


@pytest.mark.parametrize("name", sorted(AFFIRMED_VERDICTS))
def test_a_verdict_a_distant_or_idiomatic_negation_does_not_hide(name):
    with pytest.raises(AssertionError):
        check_reply([], AFFIRMED_VERDICTS[name], TEST)


def test_a_conditional_pointer_to_the_image_passes():
    check_reply([], GOOD + "Line 15: if the image is clear at this line, decide from it.\n", TEST)


def test_a_silent_agent_on_the_direct_arm_fails_even_when_the_relay_is_right():
    """subject_reply_text: on a direct test the agent's empty return grades as
    nothing; the dispatcher's correct-looking relay does not stand in for it."""
    direct = {**TEST, "delegation": "No project exists in this folder."}
    with pytest.raises(AssertionError, match="no block after"):
        check_reply([{"subagent_type": "search-images", "text": ""}], GOOD, direct)
