"""An early-stopped run must stop the Claude CLI subprocess (issue #3267).

The SDK's `query()` never closes its inner `process_query()` generator, so a
harness that stops between messages left the CLI running
(anthropics/claude-agent-sdk-python#1377). These tests drive the real SDK
against a stand-in CLI — a small Python script that speaks the CLI's
stream-json protocol — and assert on the stand-in's PID, never on "no exception
was raised": every close in both harnesses is best-effort and swallows errors,
so a close that failed and one that worked look the same from outside.

Each PID check runs inside the coroutine, straight after the close or
`_run_agent` returns, with no `await` in between. Under the bug the inner
generator is still closed later, by a background task, and any extra loop turn
would let that task hide the leak.

POSIX only: the stand-in is a shebang script, and on Windows `os.kill(pid, 0)`
terminates the process instead of probing it. The harness CI is ubuntu-only.
"""

from __future__ import annotations

import asyncio
import os
import stat
import sys
from dataclasses import replace
from pathlib import Path

import pytest
from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

from e2e import orchestrator
from e2e.mcp_health import GENEALOGY_SERVER_NAME
from e2e.orchestrator import _run_agent
from harness.sdk_query import open_query
from tests.unit.test_e2e_stall_resume import _fixture

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="POSIX stand-in CLI; os.kill(pid, 0) kills on Windows"
)

# Every mode exits by itself after this many seconds, so a broken close (a
# red-proof run, a later regression) never leaves a process behind: once the
# SDK abandons a close it also stops tracking the PID for its atexit kill.
_STAND_IN_DEADLINE_S = 30

_STAND_IN = """\
#!{python}
import json, os, sys, threading, time

MODE = {mode!r}
DEADLINE = time.monotonic() + {deadline}
with open({pidfile!r}, "a", encoding="utf-8") as f:
    f.write(f"{{os.getpid()}}\\n")

lock = threading.Lock()
started = threading.Event()
eof = threading.Event()


def out(obj):
    try:
        with lock:
            sys.stdout.write(json.dumps(obj) + "\\n")
            sys.stdout.flush()
    except Exception:
        os._exit(0)


def read_stdin():
    for line in sys.stdin:
        msg = json.loads(line)
        if msg.get("type") == "control_request":
            out({{"type": "control_response", "response": {{"subtype": "success",
                 "request_id": msg["request_id"], "response": {{}}}}}})
        elif msg.get("type") == "user":
            started.set()
    eof.set()


def wait_for_eof():
    while not eof.is_set() and time.monotonic() < DEADLINE:
        time.sleep(0.01)
    os._exit(0)


def assistant(text):
    return {{"type": "assistant", "parent_tool_use_id": None, "session_id": "S1",
            "message": {{"role": "assistant", "model": "fake",
                        "usage": {{"input_tokens": 1000, "output_tokens": 1}},
                        "content": [{{"type": "text", "text": text}}]}}}}


threading.Thread(target=read_stdin, daemon=True).start()
while not started.is_set():
    if eof.is_set() or time.monotonic() > DEADLINE:
        os._exit(0)
    time.sleep(0.01)

out({{"type": "system", "subtype": "init", "session_id": "S1",
     "mcp_servers": [{{"name": {server!r}, "status": "connected"}}]}})
if any(a == "--resume" or a.startswith("--resume=") for a in sys.argv):
    out({{"type": "result", "subtype": "success", "duration_ms": 1,
         "duration_api_ms": 1, "is_error": False, "num_turns": 1,
         "session_id": "S1", "total_cost_usd": 0}})
    wait_for_eof()
if MODE == "chatty":
    for i in range(3):
        out(assistant(f"message {{i}}"))
    wait_for_eof()
# no_progress / stubborn: one progress message, then keep-alives that are not
# progress. Kept from the main loop so a closed pipe ends the process.
out(assistant("starting"))
while time.monotonic() < DEADLINE:
    if MODE == "no_progress" and eof.is_set():
        os._exit(0)
    out({{"type": "system", "subtype": "status", "session_id": "S1"}})
    time.sleep(0.05)
os._exit(0)
"""


def _stand_in(tmp_path: Path, mode: str) -> tuple[Path, Path]:
    """Write a stand-in CLI for `mode`; return (cli_path, pidfile).

    `chatty`: three assistant messages, then exits on stdin EOF; never sends a
    `result`. `no_progress`: one assistant message, then non-progress
    keep-alives until stdin EOF. `stubborn`: the same, but ignores stdin EOF
    like a CLI mid-turn, so only the SDK's SIGTERM stops it. Any mode started
    with `--resume` sends init plus a `result` and exits on stdin EOF.
    """
    cli = tmp_path / f"claude-{mode}"
    pidfile = tmp_path / f"pids-{mode}"
    cli.write_text(
        _STAND_IN.format(
            python=sys.executable,
            mode=mode,
            deadline=_STAND_IN_DEADLINE_S,
            pidfile=str(pidfile),
            server=GENEALOGY_SERVER_NAME,
        ),
        encoding="utf-8",
    )
    cli.chmod(cli.stat().st_mode | stat.S_IEXEC)
    return cli, pidfile


def _pids(pidfile: Path) -> list[int]:
    return [int(line) for line in pidfile.read_text(encoding="utf-8").split()]


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


@pytest.fixture(autouse=True)
def _skip_cli_version_check(monkeypatch):
    # The SDK would run `<cli_path> -v`, which a stand-in does not answer.
    monkeypatch.setenv("CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK", "1")


async def _noop_hook(_input, _tool_use_id, _context):
    return {}


def test_closing_open_query_early_stops_the_cli(tmp_path):
    # A registered hook makes the SDK keep stdin open until a `result`, as it
    # does for both harnesses. Without one the SDK closes stdin straight after
    # the prompt, the stand-in exits on its own, and the check would prove
    # nothing.
    cli, pidfile = _stand_in(tmp_path, "chatty")
    options = ClaudeAgentOptions(
        cli_path=str(cli),
        hooks={"Stop": [HookMatcher(matcher=None, hooks=[_noop_hook])]},
    )

    async def main() -> bool:
        stream = open_query(prompt="hi", options=options).__aiter__()
        await stream.__anext__()
        await stream.aclose()
        return _alive(_pids(pidfile)[0])

    assert asyncio.run(main()) is False


def _run_against_stand_in(fx, tmp_path, monkeypatch, cli: Path, pidfile: Path, *, resume_on_stall):
    """Run `_run_agent` with every session spawned from the stand-in.

    Returns `_run_agent`'s result, each stand-in PID's liveness read the moment
    it returned, and, for every session opened after the first, whether the
    previous one's CLI was still alive at that moment.
    """
    opened_while_previous_alive: list[bool] = []

    def recording_open_query(*, prompt, options):
        # A plain `def` returning the helper's own generator: an async wrapper
        # that re-yields here would reintroduce the bug under test.
        if pidfile.exists():
            opened_while_previous_alive.append(_alive(_pids(pidfile)[-1]))
        return open_query(prompt=prompt, options=replace(options, cli_path=str(cli)))

    monkeypatch.setattr(orchestrator, "open_query", recording_open_query)

    async def main():
        result = await _run_agent(
            fixture=fx,
            workspace=tmp_path,
            mcp_server_entry=Path("dummy"),
            resume_on_stall=resume_on_stall,
        )
        return result, {pid: _alive(pid) for pid in _pids(pidfile)}

    result, alive_after = asyncio.run(main())
    return result, alive_after, opened_while_previous_alive


def test_stall_resume_stops_the_first_cli_before_the_resumed_one_starts(
    tmp_path, monkeypatch
):
    # Keep-alives, not silence: a silent stream ends in the inactivity timeout,
    # whose cancel already runs the SDK's teardown, so it could not catch this.
    cli, pidfile = _stand_in(tmp_path, "no_progress")
    fx = _fixture(
        tmp_path, progress_stall_seconds=2.0, inactivity_seconds=10, wall_clock_seconds=60
    )

    (_tc, _t, usage, aborted, *_rest), alive_after, opened_while_previous_alive = (
        _run_against_stand_in(fx, tmp_path, monkeypatch, cli, pidfile, resume_on_stall=True)
    )

    assert aborted is None
    assert usage["resumes"] == 1
    assert opened_while_previous_alive == [False]  # first CLI gone before the second
    assert len(alive_after) == 2 and not any(alive_after.values())


def test_no_progress_abort_stops_the_cli_before_run_agent_returns(tmp_path, monkeypatch):
    # `stubborn` ignores stdin EOF, so only the SDK's SIGTERM (after its 5s
    # grace) stops it: the PID is dead at return only if the close was awaited.
    cli, pidfile = _stand_in(tmp_path, "stubborn")
    fx = _fixture(
        tmp_path, progress_stall_seconds=1.0, inactivity_seconds=10, wall_clock_seconds=60
    )

    (_tc, _t, _usage, aborted, *_rest), alive_after, _opened = _run_against_stand_in(
        fx, tmp_path, monkeypatch, cli, pidfile, resume_on_stall=False
    )

    assert aborted == "no_progress_stall"
    assert len(alive_after) == 1 and not any(alive_after.values())


def test_wall_clock_cap_landing_in_the_resume_close_still_stops_the_cli(
    tmp_path, monkeypatch
):
    # The resume close runs inside `_consume`, under the wall-clock cap. With
    # `stubborn` that close takes the SDK's 5s grace, so a 3s cap lands in the
    # middle of it. A cancel that cuts the close short leaves the CLI running
    # and drops it from the SDK's own atexit kill; the close must still finish.
    cli, pidfile = _stand_in(tmp_path, "stubborn")
    fx = _fixture(
        tmp_path, progress_stall_seconds=1.0, inactivity_seconds=10, wall_clock_seconds=3.0
    )

    (_tc, _t, usage, aborted, *_rest), alive_after, _opened = _run_against_stand_in(
        fx, tmp_path, monkeypatch, cli, pidfile, resume_on_stall=True
    )

    assert aborted == "max_wall_clock_seconds"
    assert usage["resumes"] == 1
    assert len(alive_after) == 1 and not any(alive_after.values())


def test_input_token_cap_abort_stops_the_cli_before_run_skill_returns(
    tmp_path, monkeypatch
):
    # The unit harness's own path: `run_skill` stops between messages on
    # `_LimitExceeded` (the stand-in reports 1000 input tokens against a cap of
    # 100), and `stubborn` ignores stdin EOF, so the PID is dead at return only
    # if `run_skill` waited for the SDK's teardown.
    from harness import skill_runner as sr
    from harness.auth import AuthConfig

    cli, pidfile = _stand_in(tmp_path, "stubborn")

    def stand_in_open_query(*, prompt, options):
        return open_query(prompt=prompt, options=replace(options, cli_path=str(cli)))

    monkeypatch.setattr(sr, "open_query", stand_in_open_query)

    async def main():
        result = await sr.run_skill(
            user_message="go",
            workspace=tmp_path,
            fixture_names=[],
            fixtures_dir=tmp_path,
            auth=AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
            max_input_tokens_per_turn=100,
        )
        return result, {pid: _alive(pid) for pid in _pids(pidfile)}

    result, alive_after = asyncio.run(main())

    assert result.aborted_reason == "max_input_tokens_per_turn"
    assert len(alive_after) == 1 and not any(alive_after.values())


def test_query_is_still_a_plain_pass_through_to_process_query():
    # `open_query` calls `process_query` directly, which matches `query()` only
    # while `query()` adds nothing around it. If an SDK upgrade changes that
    # body, re-check `harness/sdk_query.py` against the new one (or delete it,
    # if anthropics/claude-agent-sdk-python#1377 shipped) and update this.
    import ast
    import inspect

    from claude_agent_sdk import query

    fn = ast.parse(inspect.getsource(query)).body[0]
    expected = ast.parse(
        "async def query(*, prompt, options=None, transport=None):\n"
        "    if options is None:\n"
        "        options = ClaudeAgentOptions()\n"
        "    client = InternalClient()\n"
        "    async for message in client.process_query(\n"
        "        prompt=prompt, options=options, transport=transport\n"
        "    ):\n"
        "        yield message\n"
    ).body[0]
    without_docstring = fn.body[1:]
    assert [ast.dump(node) for node in without_docstring] == [
        ast.dump(node) for node in expected.body
    ]
