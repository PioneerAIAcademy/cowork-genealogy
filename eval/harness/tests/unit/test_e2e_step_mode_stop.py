"""Step mode's orchestrator fixes (review of aa48f22e, asks 2-3), and the guard that
no Stop veto comes back (step mode phase 2).

Structural, because these closures are built inside `_run_agent` and cannot be
called without the SDK. Each test names the behaviour it stands for, and each was
checked to fail with its fix reverted.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

REPO_ROOT = next(
    q for q in Path(__file__).resolve().parents if (q / "eval/harness/e2e").is_dir()
)
SRC = (REPO_ROOT / "eval/harness/e2e/orchestrator.py").read_text(encoding="utf-8")
TREE = ast.parse(SRC)


#: The e2e Stop veto's names, deleted in step mode phase 2 (PR B). A step turn ends
#: at its boundary on purpose and the host's reply continues the run, so nothing in
#: the harness may veto a stop again (docs/specs/research-step-mode-spec.md, section F).
_VETO_NAMES = {
    "should_continue_run", "terminal_reason", "hand_back_key",
    "COUNTED_TERMINAL_REASONS", "max_continue_nudges", "stop_hook",
}
#: Matched as an attribute too (`stop_checker.should_continue_run`), except
#: `terminal_reason`, which is also a field the SDK's ResultMessage carries.
_VETO_ATTRS = _VETO_NAMES - {"terminal_reason"}
HARNESS = REPO_ROOT / "eval/harness"


def _is_stop(node: ast.AST | None) -> bool:
    return isinstance(node, ast.Constant) and node.value == "Stop"


def _binds_a_stop_key(node: ast.AST) -> bool:
    """A `Stop` hook bound under any spelling. The event's name is matched wherever it
    appears as a string, not only as a dict key: `hooks.setdefault("Stop", ...)`,
    `dict([("Stop", ...)])` and `EV = "Stop"` all bind one. No harness module needs
    the literal for anything else, so any occurrence is an offence. `dict(Stop=...)`
    is the one spelling with no string in it."""
    if _is_stop(node):
        return True
    if isinstance(node, ast.Call):
        return any(k.arg == "Stop" for k in node.keywords)
    return False


def _returns_a_block_decision(node: ast.AST) -> bool:
    """`{"decision": "block", ...}`: what a vetoing hook returns, whatever it is named."""
    return isinstance(node, ast.Dict) and any(
        isinstance(k, ast.Constant) and k.value == "decision"
        and isinstance(v, ast.Constant) and v.value == "block"
        for k, v in zip(node.keys, node.values)
    )


def _veto_names_in(tree: ast.AST) -> set[str]:
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in _VETO_NAMES:
            found.add(node.name)
        elif isinstance(node, ast.Assign):
            found |= {
                n.id for t in node.targets for n in ast.walk(t)
                if isinstance(n, ast.Name) and n.id in _VETO_NAMES
            }
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and node.target.id in _VETO_NAMES:
                found.add(node.target.id)
        elif isinstance(node, ast.ImportFrom):
            found |= {a.name for a in node.names if a.name in _VETO_NAMES}
        elif isinstance(node, ast.Attribute) and node.attr in _VETO_ATTRS:
            found.add(node.attr)
        elif _returns_a_block_decision(node):
            found.add("decision: block")
        if _binds_a_stop_key(node):
            found.add("Stop")
    return found


def _harness_modules() -> list[Path]:
    """Every harness module except the tests, which may bind a no-op `Stop` hook to
    stand in for a CLI (`test_sdk_query_close.py`), and the virtualenv."""
    return sorted(
        p for p in HARNESS.rglob("*.py")
        if not {"tests", ".venv", "__pycache__"} & set(p.relative_to(HARNESS).parts)
    )


def test_no_harness_module_binds_a_stop_hook_or_keeps_the_veto():
    modules = _harness_modules()
    assert HARNESS / "e2e" / "orchestrator.py" in modules
    assert HARNESS / "run_tests.py" in modules
    offenders = {}
    for path in modules:
        names = _veto_names_in(ast.parse(path.read_text(encoding="utf-8")))
        if names:
            offenders[str(path.relative_to(HARNESS))] = names
    assert offenders == {}


def test_the_guard_sees_each_shape_of_a_planted_veto():
    for planted in (
        "def should_continue_run(**kw):\n    return True\n",
        "async def stop_hook(a, b, c):\n    return {}\n",
        "COUNTED_TERMINAL_REASONS = frozenset()\n",
        "max_continue_nudges: int = 40\n",
        "from e2e.stop_checker import hand_back_key\n",
        "hooks['Stop'] = [matcher]\n",
        "hooks = {'PreToolUse': [m], 'Stop': [matcher]}\n",
        "options = ClaudeAgentOptions(hooks=dict(Stop=[matcher]))\n",
        # Open-break on PR B: five shapes the first version missed.
        "EV = 'Stop'\nhooks = {EV: [m]}\n",
        "hooks.setdefault('Stop', []).append(m)\n",
        "hooks = dict([('Stop', [m])])\n",
        "async def on_stop(a, b, c):\n    return {'decision': 'block', 'reason': 'go on'}\n",
        "if stop_checker.should_continue_run(**kw):\n    pass\n",
    ):
        assert _veto_names_in(ast.parse(planted)), planted
    for legitimate in (
        "if event == 'StopFailure':\n    pass\n",
        "return {'permissionDecision': 'deny', 'decision_reason': 'block'}\n",
        "stop = True\n",
        "stop_reason = derive_stop_reason(sdk_aborted_reason=None, research=None)\n",
        "hooks = {'PreToolUse': [m]}\n",
        "x = message.terminal_reason\n",
    ):
        assert not _veto_names_in(ast.parse(legitimate)), legitimate


def test_the_turn_step_is_read_from_the_gate_not_re_derived():
    """Ask 2. `step_candidate` reports the router skill; the gate does not. So
    re-deriving stamped `research` as the step of any turn that opened with a
    router call — 13 of the 222 committed e2e runs — and `next_auto_reply` then
    keyed on `(research, offer)` pairs, ended runs on false repeats, and never
    saw `research-plan` or `proof-conclusion`. The gate is the one thing that
    knows which step a turn opened with."""
    assert "_step_turns[-1].step = _gate.first_step" in SRC, (
        "the turn's step is not read from the gate; re-deriving it with "
        "step_candidate stamps the router as the step."
    )
    assert "_step_turns[-1].step = _boundary.bare_name(_candidate)" not in SRC, (
        "the re-derived stamping is still present — it will overwrite or "
        "contend with the gate's own first_step."
    )


def _disconnect_guard() -> ast.If:
    """The `if` whose body disconnects the step client.

    Found structurally rather than by a substring, because a substring is still
    present when the statement has been disabled -- `if False:` around it keeps
    `live["client"].disconnect()` in the source and reads as covered. A
    break-test proved exactly that: the grep form passed on dead code.
    """
    for node in ast.walk(TREE):
        if not isinstance(node, ast.If):
            continue
        body = ast.dump(ast.Module(body=node.body, type_ignores=[]))
        if "disconnect" in body and "client" in body:
            return node
    raise AssertionError(
        "no `if` statement disconnects the step client; the persistent session "
        "is left running through the judge phase."
    )


def test_the_step_client_is_disconnected_in_teardown():
    """Ask 3. Closing the `stream_turns` generator does not close the session it
    streamed from, so a step run's CLI and its MCP server sat idle through the
    whole judge phase until the SDK's atexit reaper got to them."""
    guard = _disconnect_guard()
    assert not isinstance(guard.test, ast.Constant), (
        f"the disconnect is guarded by the constant {guard.test.value!r}, so it "
        "never runs. The source still contains the call, which is why this is "
        "checked structurally."
    )
    assert "client" in ast.dump(guard.test), (
        "the disconnect's guard does not test the client, so it is not the "
        "'do we have a session to close' check it is meant to be."
    )


@pytest.mark.parametrize("guard", ["contextlib.suppress", "asyncio.shield", "timeout=15"])
def test_the_disconnect_cannot_fail_a_run_that_already_finished(guard):
    """Teardown runs after the result exists. A disconnect that raised, or hung,
    would replace a finished run's outcome with a teardown error."""
    at = SRC.index('live["client"].disconnect()')
    window = SRC[max(0, at - 400):at + 200]
    assert guard in window, f"the disconnect is not guarded by {guard}"


def test_contextlib_is_imported():
    """The suppress above is a NameError without it, and the failure would land
    in teardown — after the run finished — which is exactly where it is hardest
    to read."""
    assert any(
        isinstance(n, ast.Import) and any(a.name == "contextlib" for a in n.names)
        for n in ast.walk(TREE)
    )
