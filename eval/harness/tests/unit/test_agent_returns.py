"""Tests for the direct arm's agent-return capture.

`text_response` is the MAIN THREAD's text. On the direct arm the main thread is
a dispatcher relaying someone else's work, so every reply-shape check reading
`text_response` there grades the dispatcher's paraphrase rather than the agent.

Measured on `eval/runlogs/unit/search-wikipedia/v1_2026-09-28_09-49-04`: six of
ten tests failed on reply shape while **every** deterministic validator passed
10/10, and two replies opened "The subagent has completed the task" / "The
subagent has looked up ...", wording no agent body produces about itself. A live
capture of `ut_search_wikipedia_002` on 2026-09-28 settled it — the two texts
from one run:

    agent:       Saved the Wikipedia summary to `albert-einstein.md`.
    main thread: The subagent has completed the task. It looked up **Albert
                 Einstein** on Wikipedia and saved the article summary to a file
                 named **`albert-einstein.md`** in the working folder.

The agent was right and the suite was failing the dispatcher.

`strip_agent_return_trailer` is the half that has to be proven in both
directions: it must remove what the runtime appends, and must not touch an
agent's own prose. The fixtures below are the verbatim live capture, not strings
written to match the regex.
"""

from harness.skill_runner import _tool_result_text, strip_agent_return_trailer


# The live capture, byte for byte.
LIVE_RETURN = (
    "Saved the Wikipedia summary to `albert-einstein.md`.\n"
    "agentId: a18a42245a899b05a (use SendMessage with to: 'a18a42245a899b05a' "
    "to continue this agent)\n"
    "<usage>total_tokens: 3509\ntool_uses: 2\nduration_ms: 5083</usage>"
)

CLEAN = "Saved the Wikipedia summary to `albert-einstein.md`."


def test_strips_the_runtime_trailer_from_a_live_capture():
    assert strip_agent_return_trailer(LIVE_RETURN) == CLEAN


def test_leaves_an_untrailered_return_untouched():
    """The other direction. A strip that also ate ordinary prose would quietly
    empty every return it was supposed to preserve."""
    plain = "Saved the Wikipedia summary to `kirchenbuch.md`."
    assert strip_agent_return_trailer(plain) == plain


def test_preserves_a_multi_paragraph_return():
    """Agents that DO carry a summary_for_user contract return several
    paragraphs; the strip must not collapse them."""
    body = (
        "Refined the citation on src_007.\n\n"
        "---\n\n"
        "The birth certificate now carries a full source note.\n\n"
        "Nothing further is needed on it."
    )
    assert strip_agent_return_trailer(body + "\n<usage>total_tokens: 12</usage>") == body


def test_strips_a_usage_block_spanning_lines_without_an_agentid():
    """The two trailers are independent — the runtime has emitted the usage
    block on its own, so neither pattern may depend on the other being present."""
    assert strip_agent_return_trailer(
        CLEAN + "\n<usage>total_tokens: 1\ntool_uses: 0</usage>"
    ) == CLEAN


def test_does_not_strip_prose_that_merely_mentions_usage_or_an_agent_id():
    """A false positive here silently deletes the agent's own words. `agentId:`
    is matched only at the start of a line, and `<usage>` only as a tag."""
    prose = "The agentId is not something this agent reports, and usage is fine."
    assert strip_agent_return_trailer(prose) == prose


# --- _tool_result_text: both content shapes the SDK returns ----------------


def test_reads_a_plain_string_content():
    assert _tool_result_text("hello") == "hello"


def test_reads_a_list_of_content_dicts():
    assert _tool_result_text([{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]) == "a\nb"


def test_ignores_a_non_text_part_rather_than_repring_it():
    """An image block contributes nothing. Without this a return carrying one
    would grade against a Python repr."""
    assert _tool_result_text(
        [{"type": "image", "source": {}}, {"type": "text", "text": "only this"}]
    ) == "only this"


def test_none_content_is_empty_not_a_crash():
    assert _tool_result_text(None) == ""
