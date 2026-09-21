"""The hand-back literal has one canonical regex — the web's `HAND_BACK_RE` in
apps/web/src/components/chatEvents.ts — and the runner carries a copy so it can
answer the literal itself (issue #2653). Issue #2292 already requires the prose,
the e2e classifier and the plugin hook to agree on one string; this pins the
fourth copy to the first, so editing either alone fails here.
"""
import re
from pathlib import Path

from app.agent.hand_back import HAND_BACK_PATTERN, HAND_BACK_RE, ends_with_hand_back

_CHAT_EVENTS = (
    Path(__file__).resolve().parents[2] / "web" / "src" / "components" / "chatEvents.ts"
)


def _web_pattern() -> str:
    source = _CHAT_EVENTS.read_text(encoding="utf-8")
    m = re.search(r"^export const HAND_BACK_RE = /(.*)/[a-z]*$", source, re.M)
    assert m, f"HAND_BACK_RE literal not found in {_CHAT_EVENTS}"
    return m.group(1)


def test_the_runner_pattern_is_the_webs_byte_for_byte():
    assert HAND_BACK_PATTERN == _web_pattern()


def test_the_web_regex_carries_no_flags_the_python_copy_lacks():
    source = _CHAT_EVENTS.read_text(encoding="utf-8")
    m = re.search(r"^export const HAND_BACK_RE = /.*/([a-z]*)$", source, re.M)
    assert m and m.group(1) == "", "a JS flag (m, s, i) would change what `$` and `.` match"
    assert HAND_BACK_RE.flags & (re.M | re.S | re.I) == 0


def test_both_copies_agree_on_the_ruled_examples():
    for text, expected in (
        ("Next: choose the first research question. Continue?", True),
        ("Found her.\n\nNext: run the first search. Continue?\n", True),
        ("Next: run the first search. Continue? Also note x.", False),
        ("Research complete.", False),
        ("Shall I continue?", False),
    ):
        assert ends_with_hand_back(text) is expected, text
