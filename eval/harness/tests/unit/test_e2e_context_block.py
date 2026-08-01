"""Unit tests for the e2e main-thread `extraction_append` block (#942).

`extraction_append` is the record-extractor subagent's private writer — no
skill declares it. On the main thread it is the router substituting for a failed
spawn and doing the extraction itself (observed in production). The e2e
orchestrator denies it there, mirroring the tree-read block, while leaving the
subagent's own call (which carries `agent_id`) untouched.

This is the one member of `context_policy.SUBAGENT_ONLY_TOOLS` e2e can enforce:
`image_read` stays unit-only (a legitimate in-session `search-images` browse is
indistinguishable from a violation), but that caveat does not transfer here —
no skill declares `extraction_append`, so `agent_id` presence alone
discriminates. See `e2e-test-spec.md` §6.1.1.
"""

from __future__ import annotations

from e2e.orchestrator import is_main_thread_extraction_append


def _main(tool_name: str) -> dict:
    """A PreToolUse firing on the main thread: no `agent_id` key at all."""
    return {"tool_name": tool_name, "tool_input": {}}


def _sub(tool_name: str) -> dict:
    """A firing from inside a Task-spawned subagent: `agent_id` present."""
    return {"tool_name": tool_name, "tool_input": {}, "agent_id": "agent-abc123"}


def test_main_thread_extraction_append_is_blocked():
    assert (
        is_main_thread_extraction_append(_main("mcp__genealogy__extraction_append"))
        is True
    )


def test_subagent_extraction_append_is_not_blocked():
    """The record-extractor's own call carries `agent_id` — the legitimate path."""
    assert (
        is_main_thread_extraction_append(_sub("mcp__genealogy__extraction_append"))
        is False
    )


def test_remote_devices_spelling_is_also_blocked_on_main():
    """Discriminate on the bare name, so the bridge spelling is caught too."""
    assert (
        is_main_thread_extraction_append(
            _main("mcp__remote-devices__Genealogy_Research__extraction_append")
        )
        is True
    )


def test_other_mcp_tools_on_main_are_not_blocked():
    """Only extraction_append is guarded here — image_read stays unit-only, and
    ordinary research tools must pass through untouched."""
    for name in (
        "mcp__genealogy__image_read",
        "mcp__genealogy__record_read",
        "mcp__genealogy__research_append",
        "mcp__genealogy__record_search",
    ):
        assert is_main_thread_extraction_append(_main(name)) is False


def test_non_mcp_tools_are_never_blocked():
    """Baseline tools (Read, Skill, Task, …) are not candidates."""
    for name in ("Read", "Skill", "Task", "extraction_append"):
        assert is_main_thread_extraction_append(_main(name)) is False


def test_missing_tool_name_does_not_raise():
    """A malformed input must fail closed to 'not blocked', never crash the hook."""
    assert is_main_thread_extraction_append({}) is False
