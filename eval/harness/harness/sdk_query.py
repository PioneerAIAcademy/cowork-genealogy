"""Open an SDK query whose early close actually stops the Claude CLI.

The SDK's public ``query()`` (claude_agent_sdk/query.py) is a bare
``async for message in client.process_query(...): yield message``. When a
caller stops early, by ``aclose()`` or by dropping the iterator, Python does not
close that inner generator (PEP 533 was deferred). So ``process_query``'s
``finally``, which terminates the CLI subprocess, runs only later, on a
background task that asyncio's async-generator finalizer schedules. When the
event loop stops running first, that task is cancelled and the CLI is orphaned
until the harness process exits. Both harnesses stop runs early (routing
short-circuit, caps, stalls, a stall-resume), and the unit harness blocks its
loop on the synchronous judge right afterwards, so this was the normal case.

``open_query`` returns ``process_query`` itself, so ``aclose()`` reaches the
SDK's own teardown; ``close_query`` is that close, shared by both harnesses.

Delete this module, and call ``query()`` again, once
anthropics/claude-agent-sdk-python#1377 ships and the harness's exact
``claude-agent-sdk`` pin moves to a release carrying it (0.2.165 does not). The
import of the private ``_internal.client`` is acceptable only under that pin.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator

from claude_agent_sdk import ClaudeAgentOptions, Message
from claude_agent_sdk._internal.client import InternalClient


def open_query(*, prompt: str, options: ClaudeAgentOptions) -> AsyncIterator[Message]:
    """Same stream as ``query(prompt=prompt, options=options)``.

    Identical for the harnesses' inputs: ``query()`` adds nothing on top of
    ``process_query`` beyond defaulting ``options``, and neither harness passes
    the ``transport`` argument it would forward (a test pins that body, so an
    SDK upgrade that changes it fails CI). Returned unwrapped on purpose:
    an ``async for … yield`` wrapper here would reintroduce the bug.
    """
    return InternalClient().process_query(prompt=prompt, options=options)


async def close_query(stream: AsyncIterator[Message]) -> None:
    """Close a stream from ``open_query`` and wait for its CLI to exit.

    The SDK's teardown closes stdin, gives the CLI 5s to exit, then sends
    SIGTERM and waits up to 5s more before SIGKILL: about 10s at most, inside
    the 15s bound here. Best-effort: a failed close must not replace the run's
    own outcome, and a test fake without ``aclose`` is not an error.
    """
    with contextlib.suppress(Exception):
        await asyncio.wait_for(stream.aclose(), timeout=15)
