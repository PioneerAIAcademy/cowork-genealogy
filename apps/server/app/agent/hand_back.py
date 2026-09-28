"""The hand-back literal, as the runner reads it.

Every hand-back the prompts produce ends with one fixed line — `Next: <step>.
Continue?` (terminal case `Research complete.`) — by lead ruling 2026-09-07
(issues #1104, #2292, #2328). This module is the runner's copy, used to decide
whether to answer it itself (issue #2653). No plugin body emits the literal any
more, so on the alpha the chain does not start; the module goes with the alpha.
`tests/test_runner_auto_continue.py` pins the pattern.
"""
from __future__ import annotations

import re

HAND_BACK_PATTERN = r"(?:^|\n)\s*Next: .+\. Continue\?\s*$"
HAND_BACK_RE = re.compile(HAND_BACK_PATTERN)

RESEARCH_COMPLETE = "Research complete."

# What the runner sends as the researcher's answer — the same text the e2e
# harness answers with.
AUTO_CONTINUE_TEXT = "Yes."


def ends_with_hand_back(text: str | None) -> bool:
    """True when the assistant's final text closes with the ruled literal."""
    return bool(text) and HAND_BACK_RE.search(text) is not None
