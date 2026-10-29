"""Step mode's three orchestrator fixes (review of aa48f22e, blocker 1 + asks 2-3).

Structural, like `test_e2e_single_ask.py`'s stop-hook test and for the same
reason: these closures are built inside `_run_agent` and cannot be called
without the SDK. Each test names the behaviour it stands for, and each was
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


def _stop_hook() -> ast.AsyncFunctionDef:
    return next(
        n for n in ast.walk(TREE)
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "stop_hook"
    )


def test_a_step_run_is_not_vetoed_for_ending_at_its_boundary():
    """The blocker. A step turn ends on its Continue line by design, with the
    project incomplete. The Stop veto read that as an early yield and told the
    model to "keep going until project.status is" — so the model reached for the
    next step, hit the boundary deny, was vetoed again, and ran to the halt.

    `next_auto_reply`'s cap replaces `max_continue_nudges` here (section F).
    """
    body = _stop_hook().body
    guards = [
        stmt for stmt in body
        if isinstance(stmt, ast.If)
        and isinstance(stmt.test, ast.Compare)
        and isinstance(stmt.test.left, ast.Name)
        and stmt.test.left.id == "_boundary"
        and isinstance(stmt.body[0], ast.Return)
        and isinstance(stmt.body[0].value, ast.Dict)
        and stmt.body[0].value.keys == []
    ]
    assert guards, (
        "stop_hook has no `if _boundary is not None: return {}` statement, so a "
        "--step-mode run keeps the Stop veto armed and every boundary is vetoed."
    )


def test_the_step_guard_is_its_own_statement_not_folded_into_single_ask():
    """`test_e2e_single_ask.py::test_stop_hook_returns_allow_first_in_single_ask_mode`
    pins the first statement's exact shape, so folding the two conditions into
    one `if` turns that test red. Pinned here too, so the reason is written down
    where the second guard lives rather than only in the other file."""
    first = _stop_hook().body[0]
    assert isinstance(first, ast.If)
    assert isinstance(first.test, ast.Name) and first.test.id == "single_ask", (
        "the single_ask guard must stay the FIRST statement and stay a bare "
        "`if single_ask:` — the step guard goes after it, not inside it."
    )


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
