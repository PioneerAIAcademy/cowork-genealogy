"""Per-context tool policy: tools only a delegated subagent may call.

Some tools are safe in an isolated subagent and unsafe on the main thread.
`image_read` is the motivating case: it returns a page scan as inline base64,
and if that lands in the router's context the bytes accumulate and overflow the
transport's ~1 MiB per-turn buffer, crashing the whole run. The
record-extraction skill therefore delegates every image read to the
`image-reader` subagent, which absorbs the base64 in a throwaway context and
returns text only (`record-extraction/SKILL.md` §4, `agents/image-reader.md`).

Until now that rule was prose, and prose did not hold — the router was observed
calling `image_read` directly (runlog v1_2026-07-16_20-23-34). It cannot be
enforced by the allowlist: per-agent `tools:` is *subtractive* (an agent narrows
a set it inherits from the session), so the session list is necessarily a
superset of every agent's list and can never express "the agent may, the router
may not". `compute_allowed_tools` must therefore union the delegated agent's
tools into the session list, which hands the router the very tool it must not
call.

The PreToolUse hook can express it, because `PreToolUseHookInput` carries
`agent_id`: present only when the hook fires inside a Task-spawned subagent,
**absent on the main thread** (claude_agent_sdk types.py, `_SubagentContextMixin`).
Probe-verified against the pinned CLI + SDK 0.1.81 — see
`docs/plan/image-read-context-policy.md` §3.1.

One scope limit (plan §4.1):

- **Per-skill, not global.** The discriminator is the skill's own declaration —
  *you may call what you declared; you may not call what was granted only to
  your subagent*. A skill that claims a guarded tool for itself may call it
  directly; a global guard would deny those calls and break the skill. Callers
  pass the pre-union set from `allowed_tools.declared_skill_tools`.

  **No skill declares either guarded tool today**, so the exemption is currently
  unreachable: `search-images` moved to delegating via `@plugin:image-reader`
  (2026-07-17) and `image_read` lives only on `agents/image-reader-opus.md`;
  `extraction_append` has only ever lived on `agents/record-extractor.md`. Both
  facts are pinned by tests in `tests/unit/test_context_policy.py`. The clause
  stays because it is the mechanism a future skill would need, not because
  anything depends on it firing.

e2e enforcement is **partial, and only for `extraction_append`** (#942). Because
no skill declares it, `agent_id` presence alone discriminates a legitimate
record-extractor call from a router substitution, which is all e2e can see — its
sub-skills run in the same session via the `Skill` tool with no `agent_id` to
attribute them. The e2e block is therefore tool-specific
(`is_main_thread_extraction_append` in `e2e/orchestrator.py`) rather than a call
to `subagent_only_violation`, which guards the whole set and takes a
`declared_tools` argument e2e cannot supply. `image_read` meets the same
condition today and is enforceable there too — issue #1273. e2e imports
`bare_tool_name`, `is_subagent_call`, and `subagent_only_denial` from here.

(e2e imports from `harness.*`, never the reverse.)
"""

import importlib.util
from pathlib import Path
from typing import Any

# Tools that are unsafe on the main thread *when the skill did not claim them*.
#
# Membership here is necessary but NOT sufficient for a violation — see
# subagent_only_violation. The declaration in a skill's own `allowed-tools` is
# the discriminator: a skill may call what it declared; it may not call what was
# granted only to its subagent.
#
# - `image_read` — held only by `agents/image-reader-opus.md`. It returns a page
#   scan as inline base64; in the router's context the bytes accumulate and
#   overflow the transport buffer, so every caller must delegate.
# - `extraction_append` — held only by `agents/record-extractor.md`. When that
#   agent fails to spawn, the router must report the failure and stop, not do
#   the extraction and append itself (issue #942).
#
# No skill declares either, so the declared-tools exemption below still runs but
# can never fire — no special-casing needed.
#
# Keep this a plain set, not a policy engine — two entries still do not justify
# machinery. Matched on the bare name, so it is transport-agnostic.
SUBAGENT_ONLY_TOOLS = frozenset({"image_read", "extraction_append"})


def bare_tool_name(tool_name: str) -> str:
    """Strip the `mcp__<server>__` prefix to get the advertised tool name.

    Lifted verbatim from `e2e/orchestrator.py`, which now imports it from here
    — there were already two copies (orchestrator + subagent_capture) before
    this module needed a third. Semantics preserved exactly, including the
    split on *any* `__` rather than only an `mcp__` prefix, so existing callers
    and `tests/unit/test_e2e_tree_block.py` are unaffected.
    """
    return tool_name.rsplit("__", 1)[-1] if "__" in tool_name else tool_name


def is_subagent_call(input_data: dict[str, Any]) -> bool:
    """Whether this PreToolUse firing came from inside a delegated subagent.

    Keys on the **presence** of `agent_id`, not on `agent_type` and not on a
    truthiness check. Two reasons, both load-bearing:

    - On the main thread the SDK omits `agent_id` from the payload entirely
      rather than setting it to None, so `in` is the honest test.
    - `agent_type` is *also* present on the main thread of a session started
      with `--agent` (without `agent_id`), so an `agent_type`-keyed predicate
      would misread such a session as a subagent.
    """
    return "agent_id" in input_data


def subagent_only_violation(
    input_data: dict[str, Any],
    declared_tools: set[str] | None = None,
) -> str | None:
    """Return the bare tool name if this call breaks the policy, else None.

    A violation requires all three:

    1. The tool is guarded (`SUBAGENT_ONLY_TOOLS`).
    2. The call is on the main thread (no `agent_id`). The delegation itself —
       the `Agent`/`Task` call — is a main-thread call but is not the guarded
       tool, so it is never a violation; denying it would break the very path
       we want the router to take.
    3. The skill did **not** declare the tool in its own `allowed-tools`
       (`declared_tools`, from `allowed_tools.declared_skill_tools`). A skill
       that claimed the tool for itself may call it directly; a skill that
       holds it only through the agent-union may not. No skill declares either
       guarded tool today — `search-images` moved to delegating via
       `@plugin:image-reader` on 2026-07-17 — so this exemption is currently
       unreachable, and `agent_id` presence alone decides (see
       `e2e/orchestrator.py` and e2e-test-spec §6.1.1).

    `declared_tools=None` means "unknown", and is treated as **declaring
    nothing** — i.e. the guard applies. Callers that cannot attribute a call to
    one skill should not use this function at all rather than pass None; see
    the e2e note in the module docstring.
    """
    # `or ""` rather than a get() default: a present-but-None `tool_name` would
    # make `bare_tool_name(None)` raise TypeError, and a raising PreToolUse hook
    # fails a call the agent was entitled to make (CLAUDE.md, "Plugin hooks").
    # Mirrors the fail-closed guard in e2e's `is_main_thread_extraction_append`.
    bare = bare_tool_name(input_data.get("tool_name") or "")
    if bare not in SUBAGENT_ONLY_TOOLS:
        return None
    if is_subagent_call(input_data):
        return None
    if bare in (declared_tools or set()):
        return None
    return bare


# Per-tool denial reasons. The reason text is the model's ONLY feedback on a
# deny, so each guarded tool must name its own fix — a generic "not allowed here"
# just relocates the substitution. The two fixes are genuinely different:
# `image_read` has somewhere legitimate to go (delegate the read), whereas an
# `extraction_append` deny means the delegation itself already failed, so the
# only correct move is to surface that and stop — NOT to retry another way,
# which would leave the goal in place and push the substitution elsewhere
# (issue #942).
_DENIAL_REASONS = {
    "image_read": (
        "image_read may not be called from the main session — it returns "
        "inline base64 that overflows the transport buffer and crashes the "
        "run. Delegate to the image-reader subagent (@plugin:image-reader), "
        "which returns a text transcription."
    ),
    "extraction_append": (
        "extraction_append may not be called from the main session — writing "
        "extracted assertions and sources is the record-extractor subagent's "
        "job (@plugin:record-extractor), never the router's. If that subagent "
        "failed to spawn, report the spawn failure to the user and stop. Do "
        "not extract the record and append it yourself, and do not retry "
        "another way — the extraction must run in the subagent's isolated "
        "context or not at all."
    ),
}

# A fallback that still refuses, for a guarded tool added to SUBAGENT_ONLY_TOOLS
# without a bespoke reason. Never expected to fire (a test pins parity), but a
# deny with a vague reason beats a KeyError that crashes the hook.
_DENIAL_REASON_FALLBACK = (
    "{bare} may not be called from the main session — it is reserved for a "
    "delegated subagent. Delegate the work rather than doing it here."
)


def subagent_only_denial(bare: str) -> dict[str, Any]:
    """A PreToolUse deny payload for a subagent-only tool called on main.

    Deliberately returns no `stopReason`: a denied call is a recoverable
    mistake, not a fatal one. The run continues so the router can pivot —
    matching how the e2e tree-read block behaves. The reason text is the
    model's only feedback here, so it names the fix per tool (`_DENIAL_REASONS`).
    """
    reason = _DENIAL_REASONS.get(bare, _DENIAL_REASON_FALLBACK.format(bare=bare))
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }


# ---------------------------------------------------------------------------
# Protected-file lockdown, imported (NOT copied) from the shipped plugin hook.
#
# The raw-write lockdown — deny Write/Edit/NotebookEdit on research.json and
# tree.gedcomx.json — ships in three copies (plugin hook, hosted SDK hook, e2e
# harness). The unit harness was the one tier missing it (issue #1493). Rather
# than add a fourth textual copy that could drift, we bind the *live* predicate
# object from the plugin hook. It is the only one of the three that is
# stdlib-only (`json`/`sys`), so importing it here pulls in no `claude_agent_sdk`
# — unlike `real_agent`/`orchestrator`, whose predicates the parity test must
# `ast`-extract because importing them would run a foreign venv's imports.
#
# An imported predicate cannot diverge from what the plugin ships, which is
# strictly stronger than a vector-checked copy; that is why #1493 mandates
# "import, do not copy" and why IMPLEMENTATIONS in test_write_lockdown_parity.py
# stays at three. Do NOT rebind `_guard.PROTECTED_PROJECT_FILES` to a
# module-level name here: `test_no_unregistered_copy_of_the_lockdown_exists`
# greps for `PROTECTED_PROJECT_FILES[[:space:]]*[:=]` and would flag this module
# as a fourth copy. Reach it as `_guard.PROTECTED_PROJECT_FILES` only.
# ---------------------------------------------------------------------------

_GUARD_HOOK_PATH = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "engine"
    / "plugin"
    / "hooks"
    / "guard_project_files.py"
)


def _load_guard():
    """Import the shipped plugin hook module by file path.

    Fail-closed on purpose: if the plugin hook cannot be loaded, raise here
    rather than degrade to allowing every write — a silent None would recreate
    exactly the "nothing checks" gap #1493 closes. The plugin file is always
    present in a checkout, so this only fires on a genuinely broken tree.
    """
    spec = importlib.util.spec_from_file_location(
        "_genealogy_guard_project_files", _GUARD_HOOK_PATH
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load guard hook at {_GUARD_HOOK_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_guard = _load_guard()


def protected_file_denial(tool_name: str, tool_input: Any) -> dict[str, Any] | None:
    """A PreToolUse deny payload for a raw write to a protected project file.

    Returns None when the call is not a protected-file write (the hook should
    then fall through to the normal permission flow). Reuses the plugin hook's
    own `protected_target` predicate and `REASON` text, so the unit harness
    denies exactly what ships in Cowork, with identical feedback. No
    `stopReason` — a denied write is recoverable, matching `subagent_only_denial`
    and the e2e tree-read block.
    """
    name = _guard.protected_target(
        tool_name, tool_input if isinstance(tool_input, dict) else {}
    )
    if name is None:
        return None
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": _guard.REASON.format(
                tool=tool_name or "This tool", name=name
            ),
        },
    }


def protected_write_denial(
    tool_name: str, tool_input: Any, workspace: Path
) -> dict[str, Any] | None:
    """Deny payload for a raw write to an **already-existing** protected file.

    This is the unit harness's existence-gated wrapper around
    `protected_file_denial`. It returns a deny **only** when the write should
    actually be blocked — the target basename is protected **and** the file
    already exists on disk. Two cases return None (the hook then falls through
    and allows the call):

    - the write is not to a protected basename at all; or
    - the protected file **does not exist yet** — a bootstrap creation.

    The bootstrap-create exemption exists because `init-project` seeds
    `research.json`/`tree.gedcomx.json` by raw `Write` (no writer tool can
    create an absent file — `research_append`/`tree_edit` throw "not found" —
    and it is granted none). A create has nothing to validate against and no
    `.bak` to lose. This mirrors the coarse validator
    `test_project_file_changes_route_through_writer_tools`, which skips when
    there is no `before_state` to diff. The lockdown targets raw EDITS to files
    that already exist; the missing bootstrap seed tool is issue #1080.

    Fail-open on a path that cannot be stat'd: `Path.exists()` raises (rather
    than returning False) on e.g. ENAMETOOLONG for a model-composed overlong
    path, and a PreToolUse hook must never raise (CLAUDE.md, "Plugin hooks") —
    an exception here fails a tool call the skill was entitled to make. An
    unstattable path cannot hold a real file to hand-edit and the write itself
    would fail anyway, so it is treated as a create and allowed.

    `workspace` resolves a relative `file_path` the model may pass; an absolute
    path is used as-is.
    """
    denial = protected_file_denial(tool_name, tool_input)
    if denial is None:
        return None
    file_path = str((tool_input or {}).get("file_path") or "")
    target = Path(file_path) if Path(file_path).is_absolute() else workspace / file_path
    try:
        already_exists = target.exists()
    except (OSError, ValueError):
        already_exists = False
    return denial if already_exists else None
