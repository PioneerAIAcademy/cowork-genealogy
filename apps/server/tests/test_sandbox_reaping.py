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

from app.sandbox.local import OWNER_ENV_VAR, OWNER_TOKEN, SERVER_MODULE, LocalProvider


def _sandbox(root: Path, name: str, payload: dict | str | None) -> Path:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    if payload is not None:
        text = payload if isinstance(payload, str) else json.dumps(payload)
        (d / "server.json").write_text(text, encoding="utf-8")
    return d


# --- it reaps what it can prove is ours -------------------------------------

def test_a_live_sibling_planes_session_is_not_reaped(tmp_path, monkeypatch):
    """The case the old sibling test could not see, and the bug it let through.

    It faked the sibling under `/some/other/plane/`, a DIFFERENT directory, so the
    secrets-path check separated them trivially. The real configuration SHARES one:
    `make server-dev` and `make server` both use `data_dir/sandboxes`, so both planes
    compute the IDENTICAL `AGENT_SECRETS_PATH` and each reads the other's server as
    its own. Plane B starting up then killpg'd plane A's LIVE session -- exactly what
    the reaper's docstring claims it prevents.

    `_is_our_server` is stubbed True here BECAUSE it would be true: same directory,
    same module, same path. Only the recorded owner separates them.
    """
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_live", {"pid": 4242, "port": 1, "argv": SERVER_MODULE,
                                    "owner": "99999-deadbeef", "owner_pid": os.getpid()})
    monkeypatch.setattr(LocalProvider, "_is_our_server", lambda self, pid, sandbox_id, **kw: True)
    killed: list[int] = []
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: killed.append(pgid))
    monkeypatch.setattr(os, "getpgid", lambda pid: pid)

    assert p.reap_orphans() == [], "a live sibling plane's session was reaped"
    assert killed == []
    assert (tmp_path / "sbx_live" / "server.json").exists(), "its record must survive too"


def test_a_dead_planes_orphan_is_still_reaped(tmp_path, monkeypatch):
    """The other direction, or the fix would just be "never reap anything". A crashed
    plane's orphan is exactly what the reaper exists for, so a recorded owner that is
    NOT running must not protect it."""
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_orphan", {"pid": 4242, "port": 1, "argv": SERVER_MODULE,
                                      "owner": "99999-deadbeef", "owner_pid": 2})
    monkeypatch.setattr(LocalProvider, "_is_our_server", lambda self, pid, sandbox_id, **kw: True)
    monkeypatch.setattr(os, "kill", lambda pid, sig: (_ for _ in ()).throw(ProcessLookupError()))
    killed: list[int] = []
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: killed.append(pgid))
    monkeypatch.setattr(os, "getpgid", lambda pid: pid)

    assert p.reap_orphans() == ["sbx_orphan"]
    assert killed == [4242]


def test_a_recorded_live_server_is_reaped(tmp_path, monkeypatch):
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_orphan", {"pid": 4242, "port": 1, "argv": SERVER_MODULE})
    monkeypatch.setattr(LocalProvider, "_is_our_server", lambda self, pid, sandbox_id, **kw: True)
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
    monkeypatch.setattr(LocalProvider, "_is_our_server", lambda self, pid, sandbox_id, **kw: True)
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
    monkeypatch.setattr(LocalProvider, "_is_our_server", lambda self, pid, sandbox_id, **kw: False)
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
    monkeypatch.setattr(LocalProvider, "_is_our_server", lambda self, pid, sandbox_id, **kw: True)
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
    monkeypatch.setattr(LocalProvider, "_is_our_server", lambda self, pid, sandbox_id, **kw: True)
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

def test_is_our_server_says_no_for_a_pid_that_does_not_exist(tmp_path):
    # A pid that cannot be read is not ours, and must not be guessed at.
    assert LocalProvider(tmp_path)._is_our_server(0, "sbx_1") is False


@pytest.mark.skipif(not Path("/proc").is_dir(), reason="needs /proc")
def test_is_our_server_says_no_for_this_test_process(tmp_path):
    """pytest is alive and is emphatically not a WS server. If this ever returns
    True the check is matching on liveness alone, which is the bug the whole
    safety property rests on."""
    assert LocalProvider(tmp_path)._is_our_server(os.getpid(), "sbx_1") is False


# --- two control planes sharing a sandboxes_dir (should-fix 15 of #3262) -----------
#
# The review that found this said it was read from the code and not run. These run it.
#
# `make server-dev` (:8000) and `make server` (:1837) are the shipped way to have two
# control planes at once, and they share `data_dir`. Every WS server on the machine is
# spawned as `python -m <SERVER_MODULE>` with NO arguments, so a module-name check
# cannot tell one plane's server from another's: plane A sees plane B's `server.json`,
# does not find it in its own `_servers`, confirms the pid is alive and names the
# module -- and killpg's a live session belonging to someone else.


def _fake_proc(monkeypatch, *, cmdline: bytes, environ: bytes):
    """Control BOTH /proc reads independently.

    Needed because a real pid cannot exercise the second check: any process whose
    cmdline does NOT name the module is rejected by the first one, so a test using
    `os.getpid()` passes whether or not the environ check exists — which is exactly
    how the first version of these tests was vacuous, and the planted-bug run caught it.
    """
    real = Path.read_bytes

    def fake(self):
        s = str(self)
        if s.endswith("/cmdline"):
            return cmdline
        if s.endswith("/environ"):
            return environ
        return real(self)

    monkeypatch.setattr(Path, "read_bytes", fake)






def test_our_own_server_is_recognised_by_its_secrets_path(tmp_path, monkeypatch):
    """The other direction, or the fix would just be "never reap anything"."""
    provider = LocalProvider(tmp_path)
    want = f"AGENT_SECRETS_PATH={provider._abs_secrets('sbx_1')}".encode()
    mine = f"{OWNER_ENV_VAR}={OWNER_TOKEN}".encode()
    _fake_proc(
        monkeypatch,
        cmdline=f"python\0-m\0{SERVER_MODULE}\0".encode(),
        environ=want + b"\0" + mine + b"\0PATH=/usr/bin\0",
    )
    assert provider._is_our_server(1234, "sbx_1") is True


def test_a_sandbox_id_that_is_a_prefix_of_ours_is_not_ours(tmp_path, monkeypatch):
    """Exact environ entry, not a substring of the blob: `sbx_1` must not match a
    process serving `sbx_12`."""
    provider = LocalProvider(tmp_path)
    _fake_proc(
        monkeypatch,
        cmdline=f"python\0-m\0{SERVER_MODULE}\0".encode(),
        environ=f"AGENT_SECRETS_PATH={provider._abs_secrets('sbx_12')}\0".encode(),
    )
    assert provider._is_our_server(1234, "sbx_1") is False


def test_our_path_inside_another_variable_is_not_a_match(tmp_path, monkeypatch):
    """Exact environ ENTRY, not a substring of the blob.

    A prefix test cannot show this -- `/sbx_1/` is genuinely not a substring of
    `/sbx_12/` -- so the distinguishing case is our whole expected entry appearing
    INSIDE another variable's value, which a serialised-env wrapper produces. A
    substring check says ours; it is not.
    """
    provider = LocalProvider(tmp_path)
    want = f"AGENT_SECRETS_PATH={provider._abs_secrets('sbx_1')}"
    _fake_proc(
        monkeypatch,
        cmdline=f"python\0-m\0{SERVER_MODULE}\0".encode(),
        environ=f"SAVED_ENV={want}\0PATH=/usr/bin\0".encode(),
    )
    assert provider._is_our_server(1234, "sbx_1") is False


def test_an_unreadable_environ_is_not_ours(tmp_path, monkeypatch):
    """Same doctrine as an unreadable cmdline: an unverifiable kill is not worth it."""
    provider = LocalProvider(tmp_path)
    real = Path.read_bytes

    def fake(self):
        s = str(self)
        if s.endswith("/cmdline"):
            return f"python\0-m\0{SERVER_MODULE}\0".encode()
        if s.endswith("/environ"):
            raise OSError("permission denied")
        return real(self)

    monkeypatch.setattr(Path, "read_bytes", fake)
    assert provider._is_our_server(1234, "sbx_1") is False


def test_reap_leaves_a_sibling_planes_sandbox_alone(tmp_path, monkeypatch):
    """End to end through `reap_orphans`: an untracked sandbox dir whose server is NOT
    ours must be forgotten, never killed. Before the fix the module-name check said yes
    and this killpg'd a live sibling."""
    killed: list[int] = []
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: killed.append(pgid))
    monkeypatch.setattr(os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(LocalProvider, "_is_our_server", lambda self, pid, sandbox_id, **kw: False)

    provider = LocalProvider(tmp_path)
    sibling = tmp_path / "sbx_other_plane"
    sibling.mkdir(parents=True)
    (sibling / "server.json").write_text(json.dumps({"pid": 4242, "port": 9999}), encoding="utf-8")

    reaped = provider.reap_orphans()
    assert killed == [], "a sibling control plane's live server was killed"
    assert "sbx_other_plane" not in reaped


# --- the two cases that must NOT be stubbed ------------------------------------
#
# The tests above stub `_is_our_server`, which is right for exercising
# `reap_orphans`' own logic but means they cannot see what that method decides.
# These two drive the real one. The first is why the owner token is NOT consulted
# for a record that has an owner; the second is why it IS consulted for one that
# does not.

def _real_proc(monkeypatch, provider, sandbox_id: str, token: bytes | None):
    """A real-looking /proc for a server: our secrets path, and `token` if given."""
    ours = f"AGENT_SECRETS_PATH={provider._abs_secrets(sandbox_id)}".encode()
    environ = ours + b"\0" + (token + b"\0" if token else b"")
    _fake_proc(monkeypatch, cmdline=f"python\0-m\0{SERVER_MODULE}\0".encode(), environ=environ)


def test_a_crashed_planes_orphan_is_reaped_though_its_token_is_foreign(tmp_path, monkeypatch):
    """Nothing stubbed. The orphan carries the DEAD plane's token, as a real one would.

    This is why `_is_our_server` must NOT require our token when the record names an
    owner: a crashed plane's orphan and a live sibling's session BOTH carry a foreign
    token, so the token cannot separate them -- only the owner's liveness can.
    Requiring it here would refuse to reap every orphan a crashed plane left behind,
    which is the reaper's whole purpose.
    """
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_orphan", {"pid": 4242, "port": 1, "argv": SERVER_MODULE,
                                      "owner": "99999-deadbeef", "owner_pid": 2})
    _real_proc(monkeypatch, p, "sbx_orphan", f"{OWNER_ENV_VAR}=99999-deadbeef".encode())
    monkeypatch.setattr(os, "kill", lambda pid, sig: (_ for _ in ()).throw(ProcessLookupError()))
    killed: list[int] = []
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: killed.append(pgid))
    monkeypatch.setattr(os, "getpgid", lambda pid: pid)

    assert p.reap_orphans() == ["sbx_orphan"], "a crashed plane's orphan was not reaped"
    assert killed == [4242]


def test_a_live_sibling_with_a_pre_owner_record_is_left_alone(tmp_path, monkeypatch):
    """Nothing stubbed. A `server.json` written before owners were recorded.

    `_is_live_siblings` cannot help -- there is no owner pid to ask about -- so
    without the environ check this fell through to a cmdline and secrets-path match
    and killed a live sibling's session, which is the exact kill the reaper claims to
    prevent. The foreign token is the only evidence available, and an unprovable kill
    is not worth it.
    """
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_live", {"pid": 4242, "port": 1, "argv": SERVER_MODULE})
    _real_proc(monkeypatch, p, "sbx_live", f"{OWNER_ENV_VAR}=99999-deadbeef".encode())
    killed: list[int] = []
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: killed.append(pgid))
    monkeypatch.setattr(os, "getpgid", lambda pid: pid)

    assert p.reap_orphans() == [], "a live sibling with a pre-owner record was reaped"
    assert killed == []
    assert (tmp_path / "sbx_live" / "server.json").exists()


def test_a_pre_owner_record_with_our_own_token_still_reaps(tmp_path, monkeypatch):
    """The other direction, or the check above would just be "never reap a legacy
    record". Our own token means we spawned it and lost track of it."""
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_mine", {"pid": 4242, "port": 1, "argv": SERVER_MODULE})
    _real_proc(monkeypatch, p, "sbx_mine", f"{OWNER_ENV_VAR}={OWNER_TOKEN}".encode())
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: None)
    monkeypatch.setattr(os, "getpgid", lambda pid: pid)

    assert p.reap_orphans() == ["sbx_mine"]


def test_a_pre_token_spawn_reaps_exactly_as_it_used_to(tmp_path, monkeypatch):
    """No owner in the record AND no token in the environ: a server from before any
    of this existed. It must reap as it always did, or the fix would strand every
    orphan already on disk."""
    p = LocalProvider(tmp_path)
    _sandbox(tmp_path, "sbx_old", {"pid": 4242, "port": 1, "argv": SERVER_MODULE})
    _real_proc(monkeypatch, p, "sbx_old", None)
    monkeypatch.setattr(os, "killpg", lambda pgid, sig: None)
    monkeypatch.setattr(os, "getpgid", lambda pid: pid)

    assert p.reap_orphans() == ["sbx_old"]
