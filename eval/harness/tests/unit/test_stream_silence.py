"""The silence watchdog counts streamed tokens as activity.

Without `include_partial_messages`, the next SDK message after a tool result is
the whole assistant turn, so a long final report trips `sdk_stream_silence`
though the model is writing the whole time. With it, each token delta arrives
as a StreamEvent and resets the window; a stream that truly goes quiet still
aborts.
"""

import asyncio

from claude_agent_sdk import AssistantMessage, ResultMessage, StreamEvent, TextBlock

from harness import skill_runner as sr
from harness.auth import AuthConfig


class _TimedStream:
    """Yields (delay_seconds, message) pairs, sleeping before each."""

    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._items:
            raise StopAsyncIteration
        delay, message = self._items.pop(0)
        await asyncio.sleep(delay)
        return message

    async def aclose(self):
        return None


def _delta(text: str) -> StreamEvent:
    return StreamEvent(
        uuid="u", session_id="S1",
        event={"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}},
    )


_REPORT = AssistantMessage(content=[TextBlock(text="the report")], model="claude-sonnet-4-6")
_RESULT = ResultMessage(subtype="result", duration_ms=1, duration_api_ms=1, is_error=False, num_turns=1, session_id="S1")


def _run(tmp_path, monkeypatch, items, silence=0.3, seen=None):
    def fake_open_query(**kw):
        if seen is not None:
            seen.append(kw["options"])
        return _TimedStream(items)

    monkeypatch.setattr(sr, "open_query", fake_open_query)
    return asyncio.run(
        sr.run_skill(
            user_message="go",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
            sdk_message_silence_seconds=silence,
        )
    )


def test_the_options_ask_the_sdk_for_partial_messages(tmp_path, monkeypatch):
    seen = []
    _run(tmp_path, monkeypatch, [(0, _REPORT), (0, _RESULT)], seen=seen)
    assert seen and seen[0].include_partial_messages is True


def test_streamed_deltas_keep_a_long_turn_alive(tmp_path, monkeypatch):
    # Six deltas 0.1s apart: 0.6s of generation against a 0.3s window.
    items = [(0.1, _delta("x")) for _ in range(6)] + [(0.1, _REPORT), (0, _RESULT)]
    result = _run(tmp_path, monkeypatch, items)
    assert result.aborted_reason is None
    assert result.text_response == "the report"


def test_a_stream_that_goes_quiet_still_aborts(tmp_path, monkeypatch):
    items = [(0.1, _delta("x")), (0.6, _REPORT), (0, _RESULT)]
    result = _run(tmp_path, monkeypatch, items)
    assert result.aborted_reason == "sdk_stream_silence"
