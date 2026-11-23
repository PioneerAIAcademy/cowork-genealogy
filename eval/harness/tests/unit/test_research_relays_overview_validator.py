"""Direct tests for `test_research.test_reply_relays_the_overview` (#4381).

From historical-context the router relays everything above its `### Search implications`
heading: the narrative and its Sources consulted list, not the block naming agents
for the main thread (Richard on #4381, 2026-11-17).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_research import test_reply_relays_the_overview as check  # noqa: E402

TEST = {"skill": "research", "tags": ["routing", "relays-overview"]}
NARRATIVE = (
    "Irish emigration to the anthracite region of Pennsylvania rose sharply in the late 1840s.\n\n"
    "**Sources consulted**\n- [Pennsylvania Emigration and Immigration](https://www.familysearch.org/en/wiki/x)"
)
OFFER = "I can check the dates his explanation rests on.\n\nContinue with `setting up the project`?"
IMPLICATIONS = "### Search implications\n- hypothesis-tracking: none\n- research-plan: none"
SUMMARY = "I looked into why Patrick may have come to Pennsylvania.\n\nNext, we can set up the research."


@pytest.mark.parametrize("reply", [
    f"{NARRATIVE}\n\n{OFFER}",
    f"{NARRATIVE}\n\n{OFFER} https://example.test/p/1",
    f"Your project is set up.\n\n{NARRATIVE.replace('**Sources consulted**', 'Sources consulted:')}\n\n{OFFER}",
], ids=["narrative-and-offer", "url-on-the-offer-line", "colon-heading"])
def test_passes_the_overview(reply):
    check(TEST, reply)


@pytest.mark.parametrize("reply, match", [
    (f"{NARRATIVE}\n\n{IMPLICATIONS}\n\n{OFFER}", "Search implications"),
    (f"{SUMMARY}\n\n{OFFER}", "Sources consulted"),
    ("No tool result gave the reason, so the sources consulted did not give one.\n\n" + OFFER,
     "Sources consulted"),
    ("", "Sources consulted"),
    (None, "Sources consulted"),
], ids=["implications-relayed", "summary-only", "summary-naming-sources-consulted", "empty", "none"])
def test_fails_without_the_overview_or_with_the_implications(reply, match):
    with pytest.raises(AssertionError, match=match):
        check(TEST, reply)


def test_skips_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check({"skill": "research", "tags": ["routing"]}, "")
