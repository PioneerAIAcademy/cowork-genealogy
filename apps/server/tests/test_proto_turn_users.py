"""U3: one Linux user per turn (proto/worker/turn_users.py) and the CLI env allowlist.

Offline: no root, no real users. The live proof -- two concurrent turns, each refused the
other's files by the kernel -- is the compose run recorded in the handoff's U3 entry."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

SERVER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER))

from proto.worker import options, turn_users  # noqa: E402


def _pw(uid, gid=900):
    return SimpleNamespace(pw_uid=uid, pw_gid=gid)


USERS = {"genealogy-turn-0": _pw(901), "genealogy-turn-1": _pw(902)}


def _getpwnam(name):
    return USERS[name]


# ── the start check ──────────────────────────────────────────────────────────────


def test_a_valid_pool_parses_in_order():
    slots = turn_users.parse("genealogy-turn-0, genealogy-turn-1", euid=0, getpwnam=_getpwnam)
    assert [(s.name, s.uid, s.gid) for s in slots] == [("genealogy-turn-0", 901, 900), ("genealogy-turn-1", 902, 900)]
    # The Beanstalk template's form: an environment value may not hold a comma.
    assert turn_users.parse("genealogy-turn-0 genealogy-turn-1", euid=0, getpwnam=_getpwnam) == slots


def test_none_disables_only_when_not_root():
    assert turn_users.parse("none", euid=1000, getpwnam=_getpwnam) is None
    with pytest.raises(turn_users.TurnUsersError, match="as root"):
        turn_users.parse("none", euid=0, getpwnam=_getpwnam)


@pytest.mark.parametrize("raw, euid, users, match", [
    (None, 0, USERS, "unset"),
    ("", 0, USERS, "unset"),
    ("  ", 0, USERS, "unset"),
    ("genealogy-turn-0", 1000, USERS, "needs a root worker"),
    ("nobody-here", 0, USERS, "no such user"),
    ("root-like", 0, {"root-like": _pw(0)}, "uid or gid 0"),
    ("gid-zero", 0, {"gid-zero": _pw(901, 0)}, "uid or gid 0"),
    ("a,b", 0, {"a": _pw(901), "b": _pw(901)}, "share a uid"),
    ("a,b", 0, {"a": _pw(901, 900), "b": _pw(902, 901)}, "one primary group"),
])
def test_a_pool_that_cannot_isolate_turns_refuses(raw, euid, users, match):
    with pytest.raises(turn_users.TurnUsersError, match=match):
        turn_users.parse(raw, euid=euid, getpwnam=users.__getitem__)


def test_process_creds_drop_groups_take_the_pool_gid_and_umask(monkeypatch):
    calls = []
    monkeypatch.setattr(turn_users.os, "setgroups", lambda g: calls.append(("setgroups", g)))
    monkeypatch.setattr(turn_users.os, "setgid", lambda g: calls.append(("setgid", g)))
    monkeypatch.setattr(turn_users.os, "umask", lambda m: calls.append(("umask", m)))
    turn_users.apply_process_creds(900)
    assert calls == [("setgroups", []), ("setgid", 900), ("umask", 0o077)]


def test_probe_runs_each_command_as_the_slot_with_no_extra_groups(tmp_path):
    slot = turn_users.Slot("genealogy-turn-0", 901, 900)
    seen = []

    def run(argv, **kw):
        seen.append((argv[0], kw["user"], kw["group"], kw["extra_groups"], kw["cwd"]))
        return SimpleNamespace(returncode=0)

    assert turn_users.probe(slot, (["/cli", "-v"], ["/py", "-c", "x"]), cwd="/project", tmpdir=str(tmp_path), run=run) is None
    assert seen[:2] == [("/cli", 901, 900, [], "/project"), ("/py", 901, 900, [], "/project")]
    assert seen[2][0] == "/bin/sh", "and a directory made and removed under TMPDIR as that user"

    def failing(argv, **kw):
        return SimpleNamespace(returncode=126 if argv[0] == "/py" else 0)

    assert "exited 126" in turn_users.probe(slot, (["/cli", "-v"], ["/py"]), cwd="/", tmpdir=str(tmp_path), run=failing)


def test_the_seam_check_reads_the_real_sdk_and_refuses_a_moved_one():
    from claude_agent_sdk import ClaudeSDKClient

    assert turn_users.check_seam(ClaudeSDKClient.connect) is None

    async def connect(self):
        from claude_agent_sdk._internal.somewhere_else import materialize_resume_session  # noqa: F401

    assert "no longer imports" in turn_users.check_seam(connect)


# ── the pool and a slot's leftovers ──────────────────────────────────────────────


def test_the_pool_hands_out_each_slot_once_and_refuses_a_third():
    a, b = turn_users.Slot("a", 901, 900), turn_users.Slot("b", 902, 900)
    pool = turn_users.Pool([a, b])
    first, second = pool.acquire(), pool.acquire()
    assert {first, second} == {a, b}
    with pytest.raises(turn_users.NoTurnUser):
        pool.acquire()
    pool.release(first)
    pool.release(first)  # twice is once
    assert pool.acquire() == first
    with pytest.raises(turn_users.NoTurnUser):
        pool.acquire()


def test_uid_pids_reads_real_uids_from_proc(tmp_path):
    for pid, uid in ((10, 901), (11, 902), (12, 901)):
        (tmp_path / str(pid)).mkdir()
        (tmp_path / str(pid) / "status").write_text(f"Name:\tx\nUid:\t{uid}\t0\t0\t0\n", encoding="utf-8")
    (tmp_path / "self").mkdir()
    (tmp_path / "13").mkdir()  # gone mid-scan: no status
    assert sorted(turn_users.uid_pids(901, proc=str(tmp_path))) == [10, 12]


def test_kill_uid_sigkills_what_the_slot_left_and_tolerates_a_race():
    sent = []

    def kill(pid, sig):
        if pid == 2:
            raise ProcessLookupError
        sent.append((pid, sig))

    assert turn_users.kill_uid(901, pids=lambda uid: [1, 2, 3], kill=kill) == [1, 3]
    assert {s for _, s in sent} == {turn_users.signal.SIGKILL}


def test_chown_tree_owns_dirs_0700_files_0600_and_leaves_symlinks(tmp_path, monkeypatch):
    (tmp_path / "d" / "e").mkdir(parents=True)
    (tmp_path / "d" / "mcp.json").write_text("{}", encoding="utf-8")
    (tmp_path / "link").symlink_to("/etc/hostname")
    owned, modes = [], {}
    monkeypatch.setattr(turn_users.os, "chown", lambda p, u, g, follow_symlinks=True: owned.append((p, u, g)))
    monkeypatch.setattr(turn_users.os, "chmod", lambda p, m: modes.__setitem__(os.path.relpath(p, tmp_path), m))
    turn_users.chown_tree(str(tmp_path), turn_users.Slot("s", 901, 900))
    assert modes == {".": 0o700, "d": 0o700, "d/e": 0o700, "d/mcp.json": 0o600}
    assert all(u == 901 and g == 900 for _, u, g in owned)
    assert not any(p.endswith("link") for p, *_ in owned), "a symlink is never followed or owned"


# ── the resume seam ──────────────────────────────────────────────────────────────


def test_a_materialized_resume_is_owned_by_the_options_user_before_it_returns(monkeypatch):
    slot = turn_users.Slot("genealogy-turn-1", 902, 900)
    owned = []
    monkeypatch.setattr(turn_users, "chown_tree", lambda path, s: owned.append((path, s)))

    async def materialize(opts):
        return SimpleNamespace(config_dir="/tmp/claude-resume-x") if opts.resume else None

    module = SimpleNamespace(materialize_resume_session=materialize)
    turn_users.own_materialized_resumes(module, {"genealogy-turn-1": slot}.get)
    wrapped = module.materialize_resume_session
    turn_users.own_materialized_resumes(module, {}.get)
    assert module.materialize_resume_session is wrapped, "wrapped once"

    run = asyncio.run
    assert run(wrapped(SimpleNamespace(user="genealogy-turn-1", resume="s1"))).config_dir == "/tmp/claude-resume-x"
    assert owned == [("/tmp/claude-resume-x", slot)]
    run(wrapped(SimpleNamespace(user=None, resume="s1")))
    run(wrapped(SimpleNamespace(user="genealogy-turn-1", resume=None)))
    assert len(owned) == 1, "no user, or nothing materialized: nothing to own"


# ── the CLI's environment ────────────────────────────────────────────────────────


def _opts(tmp_path, worker_env, **kw):
    return options.build_worker_options(
        project_id="proj-1", cwd="/project", plugin_dir="/opt/genealogy/plugin", agents={},
        store=object(), config_dir=str(tmp_path), pretool_hook=lambda *a: {},
        posttool_hook=lambda *a: {}, worker_env=worker_env, bearer="grant-token", **kw,
    )


WORKER_ENV = {
    "ANTHROPIC_API_KEY": "sk-model", "TMPDIR": "/tmp", "PATH": "/usr/bin", "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8", "CLAUDE_CODE_DEBUG_LOG_LEVEL": "debug", "NODE_EXTRA_CA_CERTS": "/ca.pem",
    "PG_DSN": "postgresql://u:pg-password@db/proto", "FS_TOKEN_ENC_KEY": "grant-key", "QUEUE_URL": "https://q",
    "GENEALOGY_SQS_SECRET_KEY": "sqs-secret", "AWS_SECRET_ACCESS_KEY": "aws-secret", "SOME_NEW_SECRET": "x",
    "WORKER_TURN_USERS": "genealogy-turn-0",
}


def test_the_cli_inherits_no_worker_secret(tmp_path):
    env = _opts(tmp_path, WORKER_ENV).env
    for name in ("PG_DSN", "FS_TOKEN_ENC_KEY", "QUEUE_URL", "GENEALOGY_SQS_SECRET_KEY", "AWS_SECRET_ACCESS_KEY",
                 "SOME_NEW_SECRET", "WORKER_TURN_USERS"):
        assert env.get(name) == "", f"{name} must be blanked: the SDK hands the CLI the worker's environment"
    for name in ("LANG", "LC_ALL", "CLAUDE_CODE_DEBUG_LOG_LEVEL", "NODE_EXTRA_CA_CERTS"):
        assert name not in env, f"{name} is kept as inherited"
    assert env["ANTHROPIC_API_KEY"] == "sk-model", "what the CLI needs is set by options.env, never blanked"
    assert env["PATH"].endswith("/usr/bin")


def test_a_slot_turn_runs_as_its_user_in_its_own_home(tmp_path):
    opts = _opts(tmp_path, WORKER_ENV, turn_user="genealogy-turn-0", turn_home="/tmp/turn-home-x")
    assert opts.user == "genealogy-turn-0"
    assert opts.env["HOME"] == opts.env["TMPDIR"] == opts.env["CLAUDE_CODE_TMPDIR"] == "/tmp/turn-home-x"
    plain = _opts(tmp_path, WORKER_ENV)
    assert plain.user is None and plain.env["TMPDIR"] == "/tmp" and "CLAUDE_CODE_TMPDIR" not in plain.env


def test_start_kills_what_a_previous_worker_left_on_each_slot_before_probing(monkeypatch):
    """Outside a container a crashed worker's CLI children survive it; the new pool would
    hand their uid to the next patron, who shares it with them."""
    from proto.worker import worker

    slots = [turn_users.Slot("genealogy-turn-0", 901, 900), turn_users.Slot("genealogy-turn-1", 902, 900)]
    order: list[str] = []
    monkeypatch.setattr(worker.os, "geteuid", lambda: 0)
    monkeypatch.setattr(worker.turn_users, "parse", lambda raw, euid: slots)
    monkeypatch.setattr(worker.turn_users, "check_seam", lambda connect: None)
    monkeypatch.setattr(worker.turn_users, "apply_process_creds", lambda gid: order.append(f"creds {gid}"))
    monkeypatch.setattr(worker.turn_users, "kill_uid", lambda uid: order.append(f"kill {uid}") or ([77] if uid == 902 else []))
    monkeypatch.setattr(worker.turn_users, "probe", lambda slot, argvs, **kw: order.append(f"probe {slot.uid}"))
    monkeypatch.setattr(worker.turn_users, "own_materialized_resumes", lambda module, slot_for: None)
    monkeypatch.setattr(worker, "TURN_POOL", None)
    monkeypatch.setattr(worker, "TURN_SLOTS", {})
    logged = []
    monkeypatch.setattr(worker, "log", lambda **f: logged.append(f))
    assert worker.setup_turn_users("/usr/bin/python3") == ["genealogy-turn-0", "genealogy-turn-1"]
    assert order == ["creds 900", "kill 901", "kill 902", "probe 901", "probe 902"]
    assert {"ev": "prepare", "step": "turn_users", "killed": {"genealogy-turn-0": [], "genealogy-turn-1": [77]}} in logged
