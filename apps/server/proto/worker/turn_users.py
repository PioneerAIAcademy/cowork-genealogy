"""One Linux user per turn (U3): the kernel, not a tool/path list, keeps one patron's turn
out of another's files and out of the worker's own ``/proc/<pid>``.

``WORKER_TURN_USERS`` names a small pool of unprivileged users, one per sqsd
``HttpConnections`` slot. The worker runs as root; each attempt takes a free slot, owns its
directories as that user, and the SDK launches the CLI as it (``ClaudeAgentOptions.user``).

The SDK passes only ``user`` to the process launch -- no group, supplementary groups or
umask -- so a root worker's child would keep gid 0 and root's groups. ``apply_process_creds``
therefore drops the worker's own supplementary groups, sets its gid to the pool's and its
umask to 077 once at start; every CLI and hook process inherits all three.

On a resumed turn the SDK materializes the session into its own ``mkdtemp`` (0700, made by
the worker) and spawns at once; ``own_materialized_resumes`` wraps that one function so the
directory belongs to ``options.user`` before the spawn. ``check_seam`` refuses to start if an
SDK upgrade moves it. Stdlib only."""

from __future__ import annotations

import inspect
import os
import pwd
import re
import signal
import subprocess
import threading
from dataclasses import dataclass
from typing import Any, Callable, Iterable

ENV_VAR = "WORKER_TURN_USERS"
DISABLED = "none"


class TurnUsersError(RuntimeError):
    """The pool's configuration cannot isolate turns; the worker refuses to start."""


class NoTurnUser(RuntimeError):
    """Every slot is in use: the attempt answers 500 and sqsd retries it."""


@dataclass(frozen=True)
class Slot:
    name: str
    uid: int
    gid: int


def parse(raw: str | None, *, euid: int, getpwnam: Callable[[str], Any] = pwd.getpwnam) -> list[Slot] | None:
    """The pool, or None when disabled. Raises ``TurnUsersError`` for a configuration that
    would run a CLI as root or let two turns share a uid."""
    value = (raw or "").strip()
    if not value:
        raise TurnUsersError(f"{ENV_VAR} is unset: name one unprivileged user per sqsd connection, or {DISABLED!r}")
    if value == DISABLED:
        if euid == 0:
            raise TurnUsersError(f"{ENV_VAR}={DISABLED} as root: every CLI would run as root, which it refuses")
        return None
    if euid != 0:
        raise TurnUsersError(f"{ENV_VAR} needs a root worker to launch each CLI as its user (euid {euid})")
    names = [n for n in re.split(r"[,\s]+", value) if n]
    slots: list[Slot] = []
    for name in names:
        try:
            pw = getpwnam(name)
        except KeyError:
            raise TurnUsersError(f"{ENV_VAR}: no such user {name!r}") from None
        if pw.pw_uid == 0 or pw.pw_gid == 0:
            raise TurnUsersError(f"{ENV_VAR}: {name!r} is uid or gid 0")
        slots.append(Slot(name, pw.pw_uid, pw.pw_gid))
    if len({s.uid for s in slots}) != len(slots):
        raise TurnUsersError(f"{ENV_VAR}: two names share a uid; each slot needs its own")
    if len({s.gid for s in slots}) != 1:
        raise TurnUsersError(f"{ENV_VAR}: the users must share one primary group (the worker takes it)")
    return slots


def apply_process_creds(gid: int) -> None:
    """Once, before serving: no supplementary groups, the pool's gid, umask 077. Inherited by
    every CLI child, so nothing it creates is readable by another slot."""
    os.setgroups([])
    os.setgid(gid)
    os.umask(0o077)


def probe(slot: Slot, argvs: Iterable[list[str]], *, cwd: str, tmpdir: str, run=subprocess.run) -> str | None:
    """Why ``slot`` cannot run a turn, or None: each command as that user from ``cwd``, and a
    directory made and removed under ``tmpdir``. The worker's own checks run as root, which
    reaches everything."""
    for argv in argvs:
        try:
            done = run(argv, cwd=cwd, user=slot.uid, group=slot.gid, extra_groups=[], capture_output=True,
                       timeout=60, check=False)
        except (OSError, subprocess.SubprocessError) as exc:
            return f"{slot.name}: {argv[0]}: {type(exc).__name__}: {exc}"
        if done.returncode != 0:
            return f"{slot.name}: {argv[0]} exited {done.returncode}"
    probe_dir = os.path.join(tmpdir, f".turn-user-probe-{slot.uid}")
    done = run(["/bin/sh", "-c", 'mkdir "$1" && rmdir "$1"', "probe", probe_dir], cwd=cwd, user=slot.uid,
               group=slot.gid, extra_groups=[], capture_output=True, timeout=30, check=False)
    if done.returncode != 0:
        return f"{slot.name}: cannot make a directory under {tmpdir}"
    return None


def chown_tree(path: str, slot: Slot) -> None:
    """``path`` and everything under it to ``slot`` (dirs 0700, files 0600), symlinks untouched."""
    def own(p: str, mode: int) -> None:
        os.chown(p, slot.uid, slot.gid, follow_symlinks=False)
        os.chmod(p, mode)

    own(path, 0o700)
    for root, dirs, files in os.walk(path):
        for d in dirs:
            p = os.path.join(root, d)
            if not os.path.islink(p):
                own(p, 0o700)
        for f in files:
            p = os.path.join(root, f)
            if not os.path.islink(p):
                own(p, 0o600)


def uid_pids(uid: int, proc: str = "/proc") -> list[int]:
    """Every live process whose real uid is ``uid``."""
    pids = []
    for entry in os.listdir(proc):
        if not entry.isdigit():
            continue
        try:
            with open(os.path.join(proc, entry, "status"), encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("Uid:"):
                        if int(line.split()[1]) == uid:
                            pids.append(int(entry))
                        break
        except (OSError, ValueError):
            continue
    return pids


def kill_uid(uid: int, *, pids: Callable[[int], list[int]] = uid_pids, kill=os.kill) -> list[int]:
    """SIGKILL what the slot left behind (a hook or a search child can outlive the CLI), so
    the next patron on the slot inherits no process. Returns the pids signalled."""
    killed = []
    for pid in pids(uid):
        try:
            kill(pid, signal.SIGKILL)
            killed.append(pid)
        except ProcessLookupError:
            pass
    return killed


class Pool:
    """The free slots. ``acquire`` never blocks: no free slot is a 500 sqsd retries."""

    def __init__(self, slots: list[Slot]) -> None:
        self._free = list(slots)
        self._lock = threading.Lock()

    def acquire(self) -> Slot:
        with self._lock:
            if not self._free:
                raise NoTurnUser(f"every {ENV_VAR} slot is in use")
            return self._free.pop(0)

    def release(self, slot: Slot) -> None:
        with self._lock:
            if slot not in self._free:
                self._free.append(slot)


SEAM_MODULE = "claude_agent_sdk._internal.session_resume"
SEAM_NAME = "materialize_resume_session"


def check_seam(connect: Callable[..., Any]) -> str | None:
    """Why the resume-ownership wrapper would not bind, or None: ``ClaudeSDKClient.connect``
    must still import the function by name from its module at call time."""
    try:
        source = inspect.getsource(connect)
    except (OSError, TypeError) as exc:
        return f"cannot read ClaudeSDKClient.connect ({type(exc).__name__})"
    if f"from ._internal.session_resume import {SEAM_NAME}" not in source:
        return f"ClaudeSDKClient.connect no longer imports {SEAM_NAME} from session_resume"
    return None


def own_materialized_resumes(module: Any, slot_for: Callable[[str], Slot | None]) -> None:
    """Wrap ``module.materialize_resume_session`` once: the directory it makes is chowned to
    ``options.user``'s slot before the SDK spawns the CLI into it."""
    original = getattr(module, SEAM_NAME)
    if getattr(original, "_owns_resumes", False):
        return

    async def wrapped(options: Any, *args: Any, **kwargs: Any):
        materialized = await original(options, *args, **kwargs)
        slot = slot_for(getattr(options, "user", None) or "")
        config_dir = getattr(materialized, "config_dir", None) if materialized is not None else None
        if slot is not None and config_dir:
            chown_tree(str(config_dir), slot)
        return materialized

    wrapped._owns_resumes = True  # type: ignore[attr-defined]
    setattr(module, SEAM_NAME, wrapped)
