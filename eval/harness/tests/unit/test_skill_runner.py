"""Smoke tests for harness.skill_runner. The real-API integration is in e2e."""

from harness import skill_runner


def test_constants_present():
    assert "Read" in skill_runner.BASELINE_ALLOWED
    assert "Skill" in skill_runner.BASELINE_ALLOWED
    assert "Bash" in skill_runner.DISALLOWED_BACKSTOP
    assert skill_runner.DEFAULT_MODEL.startswith("claude-")


def test_task_allowed_for_agent_delegation():
    """Task moved out of the backstop (agent-mode): plugin subagents are
    staged into every workspace and a skill delegates only when its
    SKILL.md instructs it — matching the e2e orchestrator's baseline."""
    assert "Task" in skill_runner.BASELINE_ALLOWED
    assert "Task" not in skill_runner.DISALLOWED_BACKSTOP


def test_sdk_version_probe_silent_on_pinned_version():
    """0.1.81 is within the known-good range — probe returns None."""
    from harness.skill_runner import _check_sdk_version
    assert _check_sdk_version() is None


def test_sdk_version_probe_warns_on_future_major(monkeypatch):
    """When the installed SDK is outside the known-good range, return
    a stderr-bound warning string so the operator can verify disallowed_tools."""
    import harness.skill_runner as sr

    def fake_version(_pkg):
        return "0.2.0"

    monkeypatch.setattr(
        "importlib.metadata.version", fake_version, raising=False
    )
    # The function imports inside; patch where it's called from.
    monkeypatch.setattr(sr, "_check_sdk_version", sr._check_sdk_version)
    # Re-run the check with the monkeypatched version.
    warning = sr._check_sdk_version()
    assert warning is not None
    assert "0.2.0" in warning
    assert "disallowed_tools" in warning


def test_classify_exception_abort_reason_matches_max_turns_phrasing():
    """A bare exception carrying the SDK's own max_turns wording is
    classified as the deterministic 'max_turns' reason, not the generic
    (retryable) 'error' bucket — regression test for the misclassification
    that caused ut_proof_conclusion_016 to burn a wasted retry attempt."""
    from harness.skill_runner import _classify_exception_abort_reason

    exc = Exception(
        "Claude Code returned an error result: Reached maximum number of turns (30)"
    )
    assert _classify_exception_abort_reason(exc) == "max_turns"


def test_classify_exception_abort_reason_defaults_to_error():
    from harness.skill_runner import _classify_exception_abort_reason

    exc = Exception("connection reset by peer")
    assert _classify_exception_abort_reason(exc) == "error"


def test_skill_run_result_shape():
    r = skill_runner.SkillRunResult(
        text_response="hi",
        skills_invoked=[],
        tool_calls=[],
        duration_ms=1.0,
        usage={},
    )
    assert r.text_response == "hi"
    assert r.aborted_reason is None
    assert r.error is None
    # WS1: attempted_mcp_calls defaults to an empty list — every caller
    # that constructs SkillRunResult directly (stubs, tests) gets the
    # field for free, and the orchestrator's uncovered-call gate reads it.
    assert r.attempted_mcp_calls == []
    assert r.unread_skill_calls == []


def test_read_skill_tool_input_reads_the_documented_key():
    """"skill" is the claude-agent-sdk 0.1.81 contract."""
    from harness.skill_runner import read_skill_tool_input

    assert read_skill_tool_input({"skill": "timeline"}) == ("timeline", [])


def test_read_skill_tool_input_falls_back_to_name():
    from harness.skill_runner import read_skill_tool_input

    assert read_skill_tool_input({"name": "timeline"}) == ("timeline", [])


def test_read_skill_tool_input_prefers_skill_over_name():
    from harness.skill_runner import read_skill_tool_input

    got, unread = read_skill_tool_input({"name": "wrong", "skill": "timeline"})
    assert (got, unread) == ("timeline", [])


def test_read_skill_tool_input_reports_keys_it_cannot_read():
    """The SDK-drift signal. If the Skill tool moves the name to a key we
    don't read, the name must come back None WITH the keys that were there —
    otherwise skills_invoked silently undercounts and every routing verdict
    reads as "never activated" with nothing anywhere saying why."""
    from harness.skill_runner import read_skill_tool_input

    got, unread = read_skill_tool_input({"skill_name": "timeline", "args": {}})
    assert got is None
    assert unread == ["args", "skill_name"]


def test_read_skill_tool_input_treats_an_empty_name_as_unread():
    """A present-but-empty key is drift too, not an invocation."""
    from harness.skill_runner import read_skill_tool_input

    got, unread = read_skill_tool_input({"skill": ""})
    assert got is None
    assert unread == ["skill"]


# --- wall-clock timeout records the turns actually streamed (#1626 review) ---


def _fake_assistant_message(text):
    """Minimal stand-in for the SDK's AssistantMessage with one TextBlock."""
    from claude_agent_sdk import AssistantMessage, TextBlock
    return AssistantMessage(content=[TextBlock(text=text)], model="stub")


def _run_until_timeout(monkeypatch, tmp_path, *, turns):
    """Drive the REAL run_skill timeout path: stream `turns` assistant
    messages, then hang until the wall clock fires.

    Deliberately not a hand-built SkillRunResult. `usage` is populated only in
    the ResultMessage branch, so a fabricated result can carry field
    combinations this code path can never emit — which is exactly how the
    first version of the zero-progress retry guard passed its tests while
    being blind in production.
    """
    import asyncio
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    async def fake_query(*, prompt, options):
        for i in range(turns):
            yield _fake_assistant_message(f"turn {i}")
        await asyncio.sleep(3600)  # hang until the wall clock fires

    monkeypatch.setattr(sr, "query", fake_query)
    monkeypatch.setattr(
        sr, "create_mock_server", lambda *a, **kw: (None, [], {})
    )

    return asyncio.run(
        sr.run_skill(
            user_message="x",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
            max_wall_clock_seconds=1,
        )
    )


def test_timeout_records_zero_turns_when_the_run_never_started(monkeypatch, tmp_path):
    """The 2026-08-15 stall: the budget elapses without a single assistant
    message. This is what the orchestrator retries."""
    result = _run_until_timeout(monkeypatch, tmp_path, turns=0)
    assert result.aborted_reason == "max_wall_clock_seconds"
    assert result.usage.get("num_turns") == 0


def test_timeout_records_the_turns_a_slow_run_did_produce(monkeypatch, tmp_path):
    """A run that worked and then ran out of clock must report its turns —
    otherwise it is indistinguishable from a startup stall and gets retried,
    burning the full cap once per attempt at 3x the tokens."""
    result = _run_until_timeout(monkeypatch, tmp_path, turns=4)
    assert result.aborted_reason == "max_wall_clock_seconds"
    assert result.usage.get("num_turns") == 4
