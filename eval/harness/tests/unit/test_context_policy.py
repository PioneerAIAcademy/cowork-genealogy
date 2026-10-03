"""Unit tests for the per-context tool policy (harness/context_policy.py).

Contract under test, per docs/plan/image-read-context-policy.md: a subagent-only
tool (image_read) is denied on the main thread and allowed inside a delegated
subagent, discriminated by the PRESENCE of `agent_id` in the PreToolUse payload.

The payload shapes here mirror the ones the probe observed against the pinned
CLI + SDK 0.1.81 (plan §3.1): main-thread firings omit `agent_id` entirely
rather than setting it to None.
"""

from pathlib import Path

from harness import context_policy
from harness.context_policy import (
    _DENIAL_REASONS,
    SUBAGENT_ONLY_TOOLS,
    bare_tool_name,
    is_subagent_call,
    protected_file_denial,
    subagent_only_denial,
    subagent_only_violation,
)

# A main-thread firing: no agent_id key at all (not agent_id=None).
MAIN_KEYS = {
    "cwd": "/tmp/x",
    "hook_event_name": "PreToolUse",
    "session_id": "s1",
    "tool_use_id": "t1",
}
# A subagent firing: agent_id + agent_type present.
SUB_KEYS = {**MAIN_KEYS, "agent_id": "a0307acf2508a8c2d", "agent_type": "image-reader"}


def _main(tool_name, **tool_input):
    return {**MAIN_KEYS, "tool_name": tool_name, "tool_input": tool_input}


def _sub(tool_name, **tool_input):
    return {**SUB_KEYS, "tool_name": tool_name, "tool_input": tool_input}


# --- bare_tool_name: semantics preserved from e2e/orchestrator.py ---


def test_bare_tool_name_strips_mcp_prefix():
    assert bare_tool_name("mcp__genealogy__image_read") == "image_read"
    assert bare_tool_name("image_read") == "image_read"
    assert bare_tool_name("Read") == "Read"


# --- is_subagent_call: keys on PRESENCE, not truthiness or agent_type ---


def test_is_subagent_call_true_inside_subagent():
    assert is_subagent_call(_sub("mcp__genealogy__image_read")) is True


def test_is_subagent_call_false_on_main_thread():
    assert is_subagent_call(_main("mcp__genealogy__image_read")) is False


def test_is_subagent_call_keys_on_presence_not_truthiness():
    """An empty-string agent_id is still a subagent firing.

    Presence is the contract; a falsy-but-present value must not read as main.
    """
    payload = {**MAIN_KEYS, "tool_name": "mcp__genealogy__image_read", "agent_id": ""}
    assert is_subagent_call(payload) is True


def test_agent_type_alone_is_not_a_subagent():
    """A session started with --agent carries agent_type WITHOUT agent_id.

    Keying on agent_type would misread that main thread as a subagent and let
    the violation through. See context_policy.is_subagent_call.
    """
    payload = {
        **MAIN_KEYS,
        "tool_name": "mcp__genealogy__image_read",
        "agent_type": "some-agent",
    }
    assert is_subagent_call(payload) is False
    assert subagent_only_violation(payload) == "image_read"


# --- subagent_only_violation ---


def test_violation_on_main_thread():
    assert subagent_only_violation(_main("mcp__genealogy__image_read")) == "image_read"


def test_no_violation_inside_subagent():
    assert subagent_only_violation(_sub("mcp__genealogy__image_read")) is None


def test_no_violation_for_unguarded_tool_on_main():
    assert subagent_only_violation(_main("mcp__genealogy__record_read")) is None
    assert subagent_only_violation(_main("Read")) is None


def test_malformed_tool_name_does_not_raise():
    """A raising PreToolUse hook fails a call the agent was entitled to make.

    `{"tool_name": None}` is the case a `.get("tool_name", "")` default does
    NOT cover — the key is present, so the default never applies and
    `bare_tool_name(None)` would raise TypeError. Mirrors the e2e twin's
    `test_malformed_tool_name_does_not_raise`; must fail closed to "no
    violation", never crash.
    """
    for malformed in ({}, {"tool_name": None}, {"tool_name": ""}):
        assert subagent_only_violation(malformed) is None


# --- the declared-tools exemption (synthetic; no skill exercises it today) ---


def test_declaring_the_tool_exempts_the_skill():
    """A skill that declares a guarded tool may call it directly (synthetic set).

    Regression guard for the declared-tools exemption: an unscoped policy would
    deny every such call and break the skill outright. The declaration is what
    separates a legitimate direct call from a boundary violation. No shipping
    skill exercises this today — `search-images` moved to delegating via
    `@plugin:image-reader` on 2026-07-17, so the exemption is currently
    unreachable — hence the declared set here is synthetic.
    """
    assert (
        subagent_only_violation(
            _main("mcp__genealogy__image_read"), {"volume_search", "image_search", "image_read"}
        )
        is None
    )


def test_undeclared_tool_is_still_a_violation():
    """record-extraction declares record_read/volume_search/research_log_append.

    It holds image_read only through the @plugin:image-reader union, so its
    router must delegate.
    """
    assert (
        subagent_only_violation(
            _main("mcp__genealogy__image_read"),
            {"record_read", "volume_search", "research_log_append"},
        )
        == "image_read"
    )


def test_unknown_declaration_applies_the_guard():
    """None means 'declared nothing' — fail closed, not open."""
    assert subagent_only_violation(_main("mcp__genealogy__image_read"), None) == "image_read"
    assert subagent_only_violation(_main("mcp__genealogy__image_read"), set()) == "image_read"


def test_declaration_does_not_matter_inside_a_subagent():
    """A subagent call is fine either way — the guard is about the main thread."""
    assert subagent_only_violation(_sub("mcp__genealogy__image_read"), set()) is None


def test_delegation_itself_is_not_a_violation():
    """The Agent/Task call is a main-thread call, but it is not the guarded tool.

    The probe (plan §3.1) confirmed the delegation surfaces as `Agent` with no
    agent_id; denying it would break the very path we want the router to take.
    """
    assert subagent_only_violation(_main("Agent", subagent_type="image-reader")) is None
    assert subagent_only_violation(_main("Task", subagent_type="image-reader")) is None


def test_violation_matches_bare_name_without_prefix():
    assert subagent_only_violation(_main("image_read")) == "image_read"


def test_missing_tool_name_is_not_a_violation():
    assert subagent_only_violation({**MAIN_KEYS}) is None


# --- subagent_only_denial: shape the SDK requires ---


def test_denial_shape_is_a_deny_without_stop_reason():
    payload = subagent_only_denial("image_read")
    hook_out = payload["hookSpecificOutput"]
    assert hook_out["hookEventName"] == "PreToolUse"
    assert hook_out["permissionDecision"] == "deny"
    # No stopReason / continue_: a denied call is recoverable — the run must
    # continue so the router can pivot to delegating.
    assert "stopReason" not in payload
    assert "continue_" not in payload


def test_denial_reason_names_the_fix():
    reason = subagent_only_denial("image_read")["hookSpecificOutput"][
        "permissionDecisionReason"
    ]
    # The reason text is the model's only feedback, so it must point at the
    # subagent rather than merely refusing.
    assert "image-reader" in reason
    assert "image_read" in reason


# --- extraction_append: NO LONGER GUARDED (issue #2937) ---------------------
#
# It was the set's second member, guarding the #942 case: a main-thread call
# meant the router had substituted for a failed `record-extractor` spawn. Issue
# #2937 routes extraction of a FamilySearch-indexed record through code called
# from the main thread, and `record-extraction` now declares the tool in its own
# `allowed-tools`, so a deny would refuse the shipped route on every eval run.
#
# These tests pin the REVERSAL, because the reversal is what a later "tidy-up"
# would undo: re-adding the tool to the set is a one-word edit that would break
# every record-extraction eval run with a denial rather than a test failure.
# What that retires is recorded in context_policy's set comment and on the
# `nothing-checks` register.


def test_extraction_append_is_not_guarded():
    assert "extraction_append" not in SUBAGENT_ONLY_TOOLS


def test_extraction_append_on_main_thread_is_allowed():
    """The shipped route after #2937: the skill calls it directly."""
    assert subagent_only_violation(_main("mcp__genealogy__extraction_append")) is None


def test_extraction_append_still_allowed_inside_the_subagent():
    """The unindexed path still delegates to record-extractor until issue #2939."""
    assert subagent_only_violation(_sub("mcp__genealogy__extraction_append")) is None


def test_extraction_append_has_no_stale_denial_reason():
    """The reason text went with the set membership.

    Left behind it would be dead prose telling a router to re-delegate a call
    that nothing denies any more.
    """
    assert "extraction_append" not in _DENIAL_REASONS


def test_extraction_append_allowed_with_the_real_declared_set():
    """Grounded in the real frontmatter, not a hand-written set."""
    from harness.allowed_tools import declared_skill_tools

    declared = declared_skill_tools("record-extraction", _skills_dir())
    assert (
        subagent_only_violation(
            _main("mcp__genealogy__extraction_append"), declared
        )
        is None
    )


def test_delegation_itself_is_not_a_violation():
    """The Task call that spawns record-extractor is main-thread but not guarded."""
    assert (
        subagent_only_violation(_main("Task", subagent_type="record-extractor"))
        is None
    )


# --- the policy set itself ---


def test_image_read_is_the_guarded_tool():
    assert "image_read" in SUBAGENT_ONLY_TOOLS
    # Guard against over-reach: record_read etc. must stay callable on main.
    assert "record_read" not in SUBAGENT_ONLY_TOOLS


def test_the_guarded_set_is_exactly_image_read():
    # Pinned as an EQUALITY, not a membership: after #2937 removed
    # `extraction_append` the set has one member, and an equality is what catches
    # a tool being quietly added back.
    assert set(SUBAGENT_ONLY_TOOLS) == {"image_read"}
    # research_append is the broad writer the record-extractor is denied; it must
    # NOT get swept into the subagent-only guard, which is about a different axis.
    assert "research_append" not in SUBAGENT_ONLY_TOOLS


def test_every_guarded_tool_has_a_bespoke_denial_reason():
    """Parity guard: the fallback in subagent_only_denial must stay unreachable.

    A tool added to SUBAGENT_ONLY_TOOLS without its own reason would silently
    fall back to a vague refusal — this fails loudly instead.
    """
    for tool in SUBAGENT_ONLY_TOOLS:
        assert tool in _DENIAL_REASONS, f"{tool} has no bespoke denial reason"
        # The reason should reference the tool it denies.
        assert tool in _DENIAL_REASONS[tool]


# --- grounding against the REAL skill files -------------------------------
#
# The two tests above encode the intent; these pin it to what the repo
# actually declares, so a future edit to either SKILL.md fails loudly here
# instead of silently breaking browsing or silently un-guarding the router.


def _skills_dir():
    # .../eval/harness/tests/unit/this.py -> parents[4] is the repo root.
    from pathlib import Path

    return Path(__file__).resolve().parents[4] / "packages/engine/plugin/skills"


def test_real_search_images_does_not_declare_image_read():
    from harness.allowed_tools import declared_skill_tools

    declared = declared_skill_tools("search-images", _skills_dir())
    assert "image_read" not in declared, (
        "search-images must NOT declare image_read — it browses volumes page-by-page "
        "by delegating each page to @plugin:image-reader, so the base64 never enters "
        "the skill's context. Declaring it here would exempt the browse loop from the "
        "guard and reopen the accumulation crash."
    )
    assert (
        subagent_only_violation(_main("mcp__genealogy__image_read"), declared)
        == "image_read"
    )


def test_real_record_extraction_does_not_declare_image_read():
    from harness.allowed_tools import declared_skill_tools

    declared = declared_skill_tools("record-extraction", _skills_dir())
    assert "image_read" not in declared, (
        "record-extraction must NOT declare image_read — it delegates to "
        "@plugin:image-reader so the base64 never enters the router's context. "
        "Declaring it here would exempt the router from the guard."
    )
    assert (
        subagent_only_violation(_main("mcp__genealogy__image_read"), declared)
        == "image_read"
    )


def test_record_extraction_declares_extraction_append():
    """The inverse of the pin this test used to carry (issue #2937).

    It previously asserted that NO skill declares `extraction_append`. That was
    the premise of the #942 guard; the guard is gone, and the declaration is now
    required rather than forbidden — without it the skill cannot call the tool
    it routes indexed records through, because `allowed-tools` is a GRANT.
    Pinned to the real frontmatter so dropping the line fails here rather than
    at eval time.

    Only `record-extraction` may declare it: a second skill declaring it would
    be a new main-thread writer nobody reviewed.
    """
    from harness.allowed_tools import declared_skill_tools

    declared = declared_skill_tools("record-extraction", _skills_dir())
    assert "extraction_append" in declared, (
        "record-extraction must declare extraction_append in its allowed-tools — "
        "issue #2937 routes every sidecar-backed record through a direct call, "
        "and `allowed-tools` is a GRANT, so omitting it leaves the skill unable "
        "to make the call its body prescribes."
    )

    for skill_dir in sorted(_skills_dir().iterdir()):
        if not (skill_dir / "SKILL.md").exists():
            continue
        if skill_dir.name == "record-extraction":
            continue
        other = declared_skill_tools(skill_dir.name, _skills_dir())
        assert "extraction_append" not in other, (
            f"{skill_dir.name} declares extraction_append in its allowed-tools — "
            "only record-extraction may. Every other caller reaches the writer "
            "through @plugin:record-extractor."
        )


def test_record_extractor_agent_declares_extraction_append():
    """The other half of the invariant: the tool must live on the record-extractor
    agent's `tools:` frontmatter, under BOTH server spellings (CLAUDE.md
    "Dual-spelled tool names"), or the guard would deny a call nobody can
    legitimately make.

    Checks the qualified `mcp__…` spellings inside the YAML frontmatter — NOT the
    bare `extraction_append`, which appears throughout the prose body (Step 4).
    A bare-substring check would still pass if someone deleted the tools: entries
    (leaving the subagent unable to call it) or dropped one of the two required
    spellings, so it must key on what actually grants the tool.
    """
    from pathlib import Path

    agent = (
        Path(__file__).resolve().parents[4]
        / "packages/engine/plugin/agents/record-extractor.md"
    )
    text = agent.read_text(encoding="utf-8")
    # Isolate the YAML frontmatter (between the first two `---` fences). maxsplit=2
    # keeps any `---` thematic break in the body out of parts[1].
    parts = text.split("---", 2)
    assert len(parts) >= 3, "record-extractor.md must open with YAML frontmatter"
    frontmatter = parts[1]
    for spelling in (
        "mcp__genealogy__extraction_append",
        "mcp__remote-devices__Genealogy_Research__extraction_append",
    ):
        assert spelling in frontmatter, (
            f"record-extractor.md frontmatter must declare {spelling} — the tool "
            "is held only by this agent, and CLAUDE.md requires both server "
            "spellings; a prose mention of the bare name does not grant it."
        )


# ---------------------------------------------------------------------------
# The protected-file lockdown is IMPORTED from the shipped plugin hook, not
# copied (issue #1493). These pin that binding: the harness denies exactly what
# Cowork ships, and it is the shipped file it bound — not a stale local copy.
# An `is`-identity assertion against a separately-imported guard module cannot
# work (importlib produces a distinct module object), so we assert the bound
# module's __file__ and its observable behaviour instead.
# ---------------------------------------------------------------------------


def test_guard_is_bound_to_the_shipped_plugin_hook():
    # parents[4] is the repo root from eval/harness/tests/unit/.
    expected = (
        Path(__file__).resolve().parents[4]
        / "packages/engine/plugin/hooks/guard_project_files.py"
    )
    assert Path(context_policy._guard.__file__).resolve() == expected.resolve(), (
        "context_policy bound a guard module other than the shipped plugin hook "
        f"— expected {expected}, got {context_policy._guard.__file__}"
    )


def test_protected_file_denial_denies_a_raw_write_to_a_protected_file():
    denial = protected_file_denial("Write", {"file_path": "/ws/research.json"})
    assert denial is not None
    out = denial["hookSpecificOutput"]
    assert out["permissionDecision"] == "deny"
    assert "research.json" in out["permissionDecisionReason"]
    # No stopReason: a denied write is recoverable, like subagent_only_denial.
    assert "stopReason" not in denial


def test_protected_file_denial_ignores_an_unprotected_write():
    assert protected_file_denial("Write", {"file_path": "/ws/notes.md"}) is None


def test_protected_file_denial_ignores_non_write_tools():
    assert protected_file_denial("Read", {"file_path": "/ws/research.json"}) is None


def test_protected_file_denial_survives_degenerate_input():
    # Never raise in front of a tool call — a raising hook fails a call the user
    # was entitled to make.
    assert protected_file_denial("Write", None) is None
    assert protected_file_denial("", {"file_path": "/ws/research.json"}) is None
