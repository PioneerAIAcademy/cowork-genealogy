"""Orphaned WS servers are found and killed, and strangers are not.

[R8] "Local sandboxes are never reaped." Nine `app.sandbox_server` processes were
once found running on a dev box, one of them 17 days old, and "is my sandbox
running?" could only be answered with a process table. That cost real debugging
time during phase 1.

WHY THEY SURVIVE. `LocalProvider._servers` is in-memory, and `ensure_server`
launches with `start_new_session=True` -- the child is in its own process group
precisely so `killpg` can take the agent grandchild down with it. The same flag
means a control plane that dies without reaching `aclose()` (a crash, a `kill
-9`, a reload) orphans every one of them, and the next run has no record they
exist.

THE RISK THE FIX HAS TO AVOID is worse than the leak: pids are reused, so a
record written weeks ago can name a stranger's process. Killing that is
unacceptable where leaking one is merely untidy, which is why ownership must be
PROVEN and an unverifiable pid is left alone.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.sandbox.local import SERVER_MODULE, LocalProvider


def _sandbox(root: Path, name: str, payload: dict | str | None) -> Path:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    if payload is not None:
        text = payload if isinstance(payload, str) else json.dumps(payload)
        (d / "server.json").write_text(text, encoding="utf-8")
    return d


# --- it reaps what it can prove is ours -------------------------------------

def test_a_recorded_live_server_is_reaped(tmp_path, monkeypatch):
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_orphan", {"pid": 4242, "port": 1, "argv": SERVER_MODULE})
    monkeypatch.setattr(LocalProvider, "_is_our_server", staticmethod(lambda pid: True))
    killed: list[int] = []
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: killed.append(pgid))
    monkeypatch.setattr(os, "getpgid", lambda pid: pid)

    assert p.reap_orphans() == ["sbx_orphan"]
    assert killed == [4242]
    assert not (tmp_path / "sbx_orphan" / "server.json").exists(), "the record must go with it"


def test_several_orphans_are_all_reaped(tmp_path, monkeypatch):
    p = LocalProvider(tmp_path)
    for i in range(3):
        _sandbox(tmp_path, f"sbx_{i}", {"pid": 100 + i, "port": i, "argv": SERVER_MODULE})
    monkeypatch.setattr(LocalProvider, "_is_our_server", staticmethod(lambda pid: True))
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: None)
    monkeypatch.setattr(os, "getpgid", lambda pid: pid)

    assert p.reap_orphans() == ["sbx_0", "sbx_1", "sbx_2"]


# --- and nothing else -------------------------------------------------------

def test_a_pid_we_cannot_prove_is_ours_is_never_killed(tmp_path, monkeypatch):
    """The whole safety property. A reused pid naming a stranger's process must
    be left alone -- leaking a server is untidy, killing someone else's work is
    not recoverable."""
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_stranger", {"pid": 4242, "port": 1, "argv": SERVER_MODULE})
    monkeypatch.setattr(LocalProvider, "_is_our_server", staticmethod(lambda pid: False))
    killed: list[int] = []
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: killed.append(pgid))
    monkeypatch.setattr(os, "getpgid", lambda pid: pid)

    assert p.reap_orphans() == []
    assert killed == [], "an unverifiable pid must not be signalled at all"


def test_a_server_this_process_owns_is_left_alone(tmp_path, monkeypatch):
    """`_servers` holds the live ones. Reaping those would kill the session the
    caller is about to use."""
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_live", {"pid": 4242, "port": 1, "argv": SERVER_MODULE})
    p._servers["sbx_live"] = (object(), 1)  # type: ignore[assignment]
    monkeypatch.setattr(LocalProvider, "_is_our_server", staticmethod(lambda pid: True))
    killed: list[int] = []
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: killed.append(pgid))

    assert p.reap_orphans() == []
    assert killed == []
    assert (tmp_path / "sbx_live" / "server.json").exists()


def test_a_sandbox_with_no_record_is_skipped(tmp_path):
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_norecord", None)
    assert p.reap_orphans() == []


# --- malformed input, which must not raise ---------------------------------

@pytest.mark.parametrize(
    "payload",
    ["not json at all", "{}", '{"pid": null}', '{"pid": "abc"}', '{"pid": -1}', '{"pid": 0}'],
    ids=["garbage", "empty", "null", "nonnumeric", "negative", "zero"],
)
def test_a_malformed_record_is_dropped_not_raised(tmp_path, payload, monkeypatch):
    """A reaper that raises at control-plane construction takes the whole server
    down over a stale file. Every one of these shapes has to resolve to "forget
    it and move on"."""
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_bad", payload)
    killed: list[int] = []
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: killed.append(pgid))

    assert p.reap_orphans() == []
    assert killed == []
    assert not (tmp_path / "sbx_bad" / "server.json").exists(), "a stale record must be dropped"


def test_a_kill_that_fails_does_not_stop_the_sweep(tmp_path, monkeypatch):
    """One unkillable orphan must not leave the rest running."""
    p = LocalProvider(tmp_path)
    for i in range(3):
        _sandbox(tmp_path, f"sbx_{i}", {"pid": 100 + i, "port": i, "argv": SERVER_MODULE})
    monkeypatch.setattr(LocalProvider, "_is_our_server", staticmethod(lambda pid: True))
    monkeypatch.setattr(os, "getpgid", lambda pid: pid)

    def flaky(pgid, sig):
        if pgid == 101:
            raise PermissionError("not yours")

    monkeypatch.setattr(os, "killpg", flaky)
    assert p.reap_orphans() == ["sbx_0", "sbx_1", "sbx_2"]


def test_an_empty_or_missing_dir_is_fine(tmp_path):
    p = LocalProvider(tmp_path / "does-not-exist-yet")
    assert p.reap_orphans() == []


# --- the ownership check itself ---------------------------------------------

def test_is_our_server_says_no_for_a_pid_that_does_not_exist():
    # A pid that cannot be read is not ours, and must not be guessed at.
    assert LocalProvider._is_our_server(0) is False


@pytest.mark.skipif(not Path("/proc").is_dir(), reason="needs /proc")
def test_is_our_server_says_no_for_this_test_process():
    """pytest is alive and is emphatically not a WS server. If this ever returns
    True the check is matching on liveness alone, which is the bug the whole
    safety property rests on."""
    assert LocalProvider._is_our_server(os.getpid()) is False
