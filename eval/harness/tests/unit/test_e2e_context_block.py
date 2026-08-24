"""Unit tests for the e2e main-thread `extraction_append` block (#942).

`extraction_append` is the record-extractor subagent's private writer — no
skill declares it. On the main thread it is the router substituting for a failed
spawn and doing the extraction itself (observed in production). The e2e
orchestrator denies it there, mirroring the tree-read block, while leaving the
subagent's own call (which carries `agent_id`) untouched.

This is the one member of `context_policy.SUBAGENT_ONLY_TOOLS` e2e enforces
today. `image_read`, the other member, is equally enforceable here — no skill
has declared it since `search-images` moved to `@plugin:image-reader`
(2026-07-17) — and is simply outside #942's scope, tracked as issue #1273. See
`e2e-test-spec.md` §6.1.1.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from claude_agent_sdk import ResultMessage, SystemMessage

from e2e import orchestrator
from e2e.orchestrator import (
    _run_agent,
    is_main_thread_extraction_append,
    main_thread_owned_section,
    load_fixture,
)


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
    """Baseline tools (Read, Skill, Task, …) are not candidates. The bare,
    unqualified `extraction_append` is here on purpose: the `mcp__` prefix guard
    means a name without a server prefix is never matched — only the genuine
    `mcp__…__extraction_append` call the router would actually emit is blocked."""
    for name in ("Read", "Skill", "Task", "extraction_append"):
        assert is_main_thread_extraction_append(_main(name)) is False


@pytest.mark.parametrize("malformed", [{}, {"tool_name": None}, {"tool_name": ""}])
def test_malformed_tool_name_does_not_raise(malformed):
    """A malformed input must fail closed to 'not blocked', never crash the hook.

    `{"tool_name": None}` is the case a `.get("tool_name", "")` default does NOT
    cover — the key is present, so the default never applies and `.startswith`
    would raise on None. A raising PreToolUse hook fails a call the agent was
    entitled to make.
    """
    assert is_main_thread_extraction_append(malformed) is False


# --- integration: the recording path through the real hook closure ----------
#
# The predicate tests above prove the DECISION. This drives `_run_agent`'s
# actual `pretool_hook` closure via a mocked SDK `query` (the pattern
# test_e2e_stall_resume.py uses) and asserts the denial is DENIED and RECORDED
# into the `blocked_context_calls` list threaded out of `_run_agent`. Without
# this, dropping the recording (or threading the wrong variable out of the
# tuple) would silently leave the list empty and no test would catch it — the
# gap the review flagged. It does not reach the `E2eResult(...)` constructor
# (that is `run_e2e_test`, covered only by a live e2e suite run), so the final
# `blocked_context_calls=` kwarg remains covered-by-inspection, exactly as
# `blocked_tree_reads` is.


def _fixture(tmp_path: Path):
    """A minimal valid fixture on disk, loaded via the real `load_fixture`."""
    fixture_dir = tmp_path / "fx"
    fixture_dir.mkdir()
    (fixture_dir / "fixture.json").write_text(
        json.dumps(
            {
                "id": "fx",
                "name": "fx",
                "source_pid": "ABCD-123",
                "captured": "2026-05-26",
                "researcher_question": "Who were John's parents?",
                "tags": {"question_type": "parents", "era": "1850s", "geography": "US-VA"},
                "model": {"agent": "claude-sonnet-4-6", "judge": "claude-haiku-4-5-20251001"},
                "caps": {},
            }
        ),
        encoding="utf-8",
    )
    (fixture_dir / "starting-research.json").write_text(
        json.dumps({"project": {"objective": "x"}}), encoding="utf-8"
    )
    (fixture_dir / "starting-tree.gedcomx.json").write_text(
        json.dumps({"persons": []}), encoding="utf-8"
    )
    (fixture_dir / "expected-findings.json").write_text(
        json.dumps({"findings": []}), encoding="utf-8"
    )
    return load_fixture(fixture_dir)


class _HookDrivingAgent:
    """An async message stream that first drives the registered PreToolUse hook
    with scripted inputs (recording each return payload into `sink`), then
    yields its messages so `_run_agent` completes normally."""

    def __init__(self, hook, hook_inputs, messages, sink):
        self._hook = hook
        self._hook_inputs = hook_inputs
        self._messages = messages
        self._sink = sink
        self._started = False
        self._i = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._started:
            self._started = True
            for label, inp in self._hook_inputs:
                self._sink[label] = await self._hook(inp, "tool-use-id", None)
        if self._i >= len(self._messages):
            raise StopAsyncIteration
        msg = self._messages[self._i]
        self._i += 1
        return msg

    async def aclose(self):
        return None


def test_main_thread_extraction_append_is_denied_and_recorded(tmp_path, monkeypatch):
    # This test drives the real _run_agent but does no real API call (query is
    # mocked below). _run_agent still evaluates env_for_sdk(resolve_auth()) when
    # building the query() args, which on keyless CI (eval-harness-tests.yml runs
    # `-m 'not e2e'` with no key and no ~/.claude) raises AuthError before the
    # mock runs. Auth is not what this test exercises, so stub resolve_auth to a
    # canned AuthConfig — the same idiom test_cli.py uses for its 10 resolve_auth
    # stubs — and let the real env_for_sdk run on it. Order-independent; no key.
    from harness.auth import AuthConfig

    monkeypatch.setattr(
        orchestrator,
        "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    sink: dict = {}

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        inputs = [
            (
                "main",
                {
                    "tool_name": "mcp__genealogy__extraction_append",
                    "tool_input": {"assertions": [], "sources": []},
                },
            ),
            (
                "sub",
                {
                    "tool_name": "mcp__genealogy__extraction_append",
                    "tool_input": {"assertions": []},
                    "agent_id": "agent-record-extractor",
                },
            ),
        ]
        return _HookDrivingAgent(
            hook,
            inputs,
            [SystemMessage(subtype="init", data={"session_id": "S1"}), _result()],
            sink,
        )

    monkeypatch.setattr(orchestrator, "query", fake_query)
    result = asyncio.run(
        _run_agent(fixture=_fixture(tmp_path), workspace=tmp_path, mcp_server_entry=Path("dummy"))
    )
    aborted_reason = result[3]
    blocked_context_calls = result[6]

    assert aborted_reason is None  # completed cleanly, not aborted

    # The main-thread call was DENIED...
    assert (
        sink["main"]["hookSpecificOutput"]["permissionDecision"] == "deny"
    )
    # ...and RECORDED, threaded out of _run_agent at the right tuple position.
    assert len(blocked_context_calls) == 1
    assert blocked_context_calls[0]["tool"] == "extraction_append"
    assert blocked_context_calls[0]["blocked_by"] == "context"
    assert blocked_context_calls[0]["args"] == {"assertions": [], "sources": []}

    # The subagent's own call (carries agent_id) was NOT denied and NOT recorded
    # — the legitimate record-extractor path stays open.
    assert sink["sub"] == {}


def _result(session="S1"):
    return ResultMessage(
        subtype="result",
        duration_ms=1,
        duration_api_ms=1,
        is_error=False,
        num_turns=1,
        session_id=session,
    )


# ── agent-owned sections: research_append + proof_summaries ──
#
# Keyed on tool AND section, unlike the extraction_append block above: that one
# can key on the tool alone because no skill declares it, whereas research_append
# is the general writer and only its owned sections are routed. Keyed on
# agent_type as well as agent_id, because agent_id alone would permit the
# general-purpose stand-in the model falls back to when a delegation misses.


def _owned(
    section=None,
    ops=None,
    agent_id=None,
    agent_type=None,
    tool="research_append",
    op=None,
    fields=None,
    entry=None,
):
    """A PreToolUse payload.

    `fields` / `entry` / `op` exist for the field-scoped declaration rule, which
    reads the op's own payload rather than the section alone — a section-only
    vector cannot distinguish `declared: true` from `declared: false`, and that
    distinction is the whole rule.
    """
    payload = {"tool_name": f"mcp__genealogy__{tool}", "tool_input": {}}
    if ops is not None:
        payload["tool_input"]["ops"] = ops
    elif section is not None:
        payload["tool_input"]["section"] = section
        if op is not None:
            payload["tool_input"]["op"] = op
        if fields is not None:
            payload["tool_input"]["fields"] = fields
        if entry is not None:
            payload["tool_input"]["entry"] = entry
    if agent_id is not None:
        payload["agent_id"] = agent_id
    if agent_type is not None:
        payload["agent_type"] = agent_type
    return payload


@pytest.mark.parametrize(
    "payload,label",
    [
        (_owned(section="proof_summaries"), "main thread"),
        (
            _owned(ops=[{"section": "questions"}, {"section": "proof_summaries"}]),
            "batched with another section",
        ),
        (
            _owned(section="proof_summaries", agent_id="a1", agent_type="general-purpose"),
            "a general-purpose stand-in, which agent_id alone would permit",
        ),
        (
            _owned(section="proof_summaries", agent_type="genealogy-research:proof-conclusion"),
            "agent_type without agent_id -- the --agent main thread",
        ),
    ],
)
def test_owned_section_write_is_blocked(payload, label):
    # The predicate returns the SHIPPED hook's (section, rule, caller) triple
    # since 2026-08-23, when the harness stopped carrying its own copy of the
    # rule. A bare section name is no longer the shape.
    denied = main_thread_owned_section(payload)
    assert denied is not None, label
    assert denied[0] == "proof_summaries", label
    assert denied[1] == "routed", label


@pytest.mark.parametrize(
    "payload,label",
    [
        (
            _owned(
                section="proof_summaries",
                agent_id="a1",
                agent_type="genealogy-research:proof-conclusion",
            ),
            "the owner, namespaced as production reports it",
        ),
        (
            _owned(section="proof_summaries", agent_id="a1", agent_type="proof-conclusion"),
            "the owner, bare",
        ),
        (_owned(section="assertions"), "an unowned section on the main thread"),
        (_owned(ops=[{"section": "questions"}]), "a batch with no owned section"),
        (_owned(section="proof_summaries", tool="research_query"), "a different tool"),
        ({"tool_name": "Write", "tool_input": {"section": "proof_summaries"}}, "not an MCP tool"),
    ],
)
def test_owned_section_write_is_allowed(payload, label):
    assert main_thread_owned_section(payload) is None, label


# ── the deny TEXT, not just the decision ──


def test_owned_section_deny_uses_the_shipped_hooks_own_words():
    """The harness must deny with the text the agent meets in Cowork.

    This arm previously shared a branch with the extraction_append block and so
    reused its denial, which told the agent `research_append may not be called
    from the main session — it is reserved for a delegated subagent`. That is
    true of extraction_append and flatly false of research_append: it is the
    general writer, used from the main thread constantly for plans, questions,
    conflicts and the log. An agent that believed it would stop writing all of
    them — in the plane that measures whether this guardrail works.
    """
    from harness.context_policy import owned_section_denial

    reason = owned_section_denial(("proof_summaries", "routed", ""))["hookSpecificOutput"][
        "permissionDecisionReason"
    ]
    assert "proof_summaries" in reason
    assert "proof-conclusion" in reason
    # The load-bearing half: the rest of the tool is still available.
    assert "unaffected" in reason
    # The sentence that made the old text dangerous must not reappear.
    assert "may not be called from the main session" not in reason


def test_owned_sections_is_the_shipped_hooks_map_not_a_copy():
    """One definition, reached through the plugin hook module.

    Three places state this fact — the hook, the harness, and the ownership
    manifest's hook-plane rows. The harness reads the hook's rather than
    restating it, so only the manifest is left to keep in step, and the
    packaging test does that.
    """
    from harness import context_policy

    assert context_policy.OWNED_SECTIONS is context_policy._guard.OWNED_SECTIONS


# ── the declaration arm: field-scoped routing (issue #1335, Phase 4) ──
#
# `exhaustive_declaration` is a REQUIRED property of every question, so
# question-selection writes it on every creation from the main thread. Routing
# the SECTION, or the field's mere presence, denies all 197 of those in the
# corpus. The rule keys on the CLAIM — `declared: true` — and these vectors are
# what pin that apart.

_DECLARE = {"declared": True, "log_entry_ids": ["log_001"]}
_EXH_OWNER = "genealogy-research:research-exhaustiveness"


@pytest.mark.parametrize(
    "payload,label",
    [
        (
            _owned(section="questions", fields={"exhaustive_declaration": _DECLARE}),
            "main thread",
        ),
        (
            _owned(
                ops=[
                    {"section": "plan_items", "op": "update"},
                    {
                        "section": "questions",
                        "op": "update",
                        "fields": {"exhaustive_declaration": _DECLARE},
                    },
                ]
            ),
            "batched behind another section",
        ),
        (
            _owned(
                section="questions",
                fields={"exhaustive_declaration": _DECLARE},
                agent_id="a1",
                agent_type="general-purpose",
            ),
            "a general-purpose stand-in",
        ),
        (
            _owned(
                section="questions",
                fields={"exhaustive_declaration": _DECLARE},
                agent_id="a1",
                agent_type="genealogy-research:proof-conclusion",
            ),
            "another owning agent -- proof-conclusion may write questions, not the claim",
        ),
    ],
)
def test_exhaustive_declaration_claim_is_blocked(payload, label):
    denied = main_thread_owned_section(payload)
    assert denied is not None, label
    assert denied[0] == "questions.exhaustive_declaration", label
    assert denied[1] == "declaration", label


@pytest.mark.parametrize(
    "payload,label",
    [
        (
            _owned(
                section="questions",
                fields={"exhaustive_declaration": _DECLARE},
                agent_id="a1",
                agent_type=_EXH_OWNER,
            ),
            "the owner, namespaced as production reports it",
        ),
        (
            _owned(
                section="questions",
                fields={"exhaustive_declaration": _DECLARE},
                agent_id="a1",
                agent_type="research-exhaustiveness",
            ),
            "the owner, bare",
        ),
        # The vector a section-scoped route breaks, and a presence-keyed field
        # route breaks too: question-selection creating a question. The schema
        # makes the field required, so EVERY creation carries it.
        (
            _owned(
                section="questions",
                op="append",
                entry={
                    "question": "Who were the parents?",
                    "exhaustive_declaration": {"declared": False, "log_entry_ids": []},
                },
            ),
            "question-selection creating a question (declared: false)",
        ),
        # The owning skill's own honest early-termination path. It claims
        # nothing, so it is not routed.
        (
            _owned(
                section="questions",
                fields={"exhaustive_declaration": {"declared": False, "log_entry_ids": ["log_001"]}},
            ),
            "an honest early termination (declared: false)",
        ),
    ],
)
def test_exhaustive_declaration_claim_is_allowed(payload, label):
    assert main_thread_owned_section(payload) is None, label


def test_declaration_deny_uses_the_shipped_hooks_own_words():
    from harness.context_policy import owned_section_denial

    reason = owned_section_denial(
        ("questions.exhaustive_declaration", "declaration", "")
    )["hookSpecificOutput"]["permissionDecisionReason"]
    assert "@plugin:research-exhaustiveness" in reason
    # It must say what is NOT routed, or a reader concludes the whole section is.
    assert "declared: false" in reason


# ── the out-of-lane arm, which the harness gained on 2026-08-23 ──


def test_out_of_lane_write_by_a_dedicated_agent_is_blocked():
    """The arm the harness did NOT have while it carried its own predicate.

    `main_thread_owned_section` used to walk `ops` itself and could only produce
    the `routed` rule, so a dedicated agent writing outside its own section set
    was denied in Cowork and allowed here. Delegating to the shipped
    `owner_denied` brings it across — a widening, and no pre-existing vector
    could have caught it.

    This is also the specific deny that stops the exhaustiveness agent clearing
    its own blocker: refused for an in-flight plan item, it cannot flip that
    item, because `plan_items` is outside its lane (issue #1821).
    """
    denied = main_thread_owned_section(
        _owned(
            section="plan_items",
            fields={"status": "completed"},
            agent_id="a1",
            agent_type=_EXH_OWNER,
        )
    )
    assert denied is not None
    assert denied[0] == "plan_items"
    assert denied[1] == "out_of_lane"

    from harness.context_policy import owned_section_denial

    reason = owned_section_denial(denied)["hookSpecificOutput"]["permissionDecisionReason"]
    assert "`questions`" in reason


def test_out_of_lane_write_by_proof_conclusion_is_blocked():
    """The widening this PR causes for an agent that already existed.

    Importing the shipped `owner_denied` brings the hook's out-of-lane arm into
    e2e for the first time, and `proof-conclusion` — which has shipped since
    Phase 3 — is the agent it newly binds: it may write
    {proof_summaries, questions, project} and nothing else. The sibling test
    above covers the same arm for the agent this PR adds, which cannot regress
    anything because it did not exist before. This one can.
    """
    denied = main_thread_owned_section(
        _owned(
            section="conflicts",
            fields={"status": "resolved"},
            agent_id="a1",
            agent_type="genealogy-research:proof-conclusion",
        )
    )
    assert denied is not None
    assert denied[0] == "conflicts"
    assert denied[1] == "out_of_lane"
