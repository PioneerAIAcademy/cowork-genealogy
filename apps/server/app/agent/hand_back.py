"""The hand-back literal, as the runner reads it.

Every hand-back the prompts produce ends with one fixed line — `Next: <step>.
Continue?` (terminal case `Research complete.`) — by lead ruling 2026-09-07
(issues #1104, #2292, #2328). The web's Continue button, the e2e classifier and
the plugin Stop hook all match that line and nothing else; this module is the
runner's copy, used to decide whether to answer it itself (issue #2653).

The canonical regex is `HAND_BACK_RE` in `apps/web/src/components/chatEvents.ts`.
`tests/test_hand_back_parity.py` asserts this pattern's source is byte-identical
to it, so the fourth copy cannot drift from the others silently.
"""
from __future__ import annotations

import re

# Keep the body identical to chatEvents.ts's literal between the slashes.
HAND_BACK_PATTERN = r"(?:^|\n)\s*Next: .+\. Continue\?\s*$"
HAND_BACK_RE = re.compile(HAND_BACK_PATTERN)

RESEARCH_COMPLETE = "Research complete."

# What the runner sends as the researcher's answer — the same text the web's
# Continue button sends (ChatPane.tsx) and the e2e harness answers with.
AUTO_CONTINUE_TEXT = "Yes."


def ends_with_hand_back(text: str | None) -> bool:
    """True when the assistant's final text closes with the ruled literal."""
    return bool(text) and HAND_BACK_RE.search(text) is not None
