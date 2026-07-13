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
