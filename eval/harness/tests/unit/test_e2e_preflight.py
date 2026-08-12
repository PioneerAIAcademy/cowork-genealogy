"""Unit tests for e2e.preflight — per-check status (OK/WARN/FAIL) logic."""

from __future__ import annotations

import inspect
import os
import threading
import time

import pytest

import e2e.preflight as pf


def test_fs_token_fresh_is_ok(monkeypatch, tmp_path):
    token = tmp_path / "tokens.json"
    token.write_text("{}", encoding="utf-8")  # just-written -> age ~0
    monkeypatch.setattr(pf, "FS_TOKENS", token)
    status, _ = pf._check_fs_token()
    assert status == "OK"


def test_fs_token_missing_is_fail(monkeypatch, tmp_path):
    monkeypatch.setattr(pf, "FS_TOKENS", tmp_path / "nope.json")
    status, detail = pf._check_fs_token()
    assert status == "FAIL"
    assert "login" in detail.lower()


def test_fs_token_aging_warns(monkeypatch, tmp_path):
    token = tmp_path / "tokens.json"
    token.write_text("{}", encoding="utf-8")
    # Age it to 23h (past WARN 22h, under FAIL 24h).
    old = time.time() - 23 * 3600
    os.utime(token, (old, old))
    monkeypatch.setattr(pf, "FS_TOKENS", token)
    status, detail = pf._check_fs_token()
    assert status == "WARN"
    assert "expire" in detail.lower()


def test_fs_token_expired_is_fail(monkeypatch, tmp_path):
    token = tmp_path / "tokens.json"
    token.write_text("{}", encoding="utf-8")
    old = time.time() - 25 * 3600  # past 24h
    os.utime(token, (old, old))
    monkeypatch.setattr(pf, "FS_TOKENS", token)
    status, detail = pf._check_fs_token()
    assert status == "FAIL"
    assert "e2e-login" in detail or "login" in detail.lower()


def test_mcp_build_check(monkeypatch, tmp_path):
    monkeypatch.setattr(pf, "MCP_BUILD", tmp_path / "index.js")
    status, detail = pf._check_mcp_build()
    assert status == "FAIL"
    assert "build" in detail.lower()
    (tmp_path / "index.js").write_text("//", encoding="utf-8")
    status, _ = pf._check_mcp_build()
    assert status == "OK"


def test_api_key_from_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    status, detail = pf._check_api_key()
    assert status == "OK"
    assert "environment" in detail.lower()


def test_api_key_from_env_file(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_text("ANTHROPIC_API_KEY=sk-from-file\n", encoding="utf-8")
    monkeypatch.setattr(pf, "ENV_FILE", env)
    status, detail = pf._check_api_key()
    assert status == "OK"
    assert ".env" in detail


def test_api_key_missing(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(pf, "ENV_FILE", tmp_path / "absent.env")
    status, detail = pf._check_api_key()
    assert status == "FAIL"
    assert "ANTHROPIC_API_KEY" in detail


def test_harness_deps_present():
    status, _ = pf._check_harness_deps()
    assert status == "OK"


def test_main_returns_zero_when_all_ok(monkeypatch, capsys):
    monkeypatch.setattr(pf, "CHECKS", [("x", lambda: ("OK", "ok"))])
    assert pf.main() == 0
    assert "ready" in capsys.readouterr().out.lower()


def test_main_warn_is_nonblocking(monkeypatch, capsys):
    monkeypatch.setattr(
        pf, "CHECKS", [("x", lambda: ("OK", "ok")), ("y", lambda: ("WARN", "aging"))]
    )
    assert pf.main() == 0
    assert "warning" in capsys.readouterr().out.lower()


def test_main_returns_one_when_any_fail(monkeypatch, capsys):
    monkeypatch.setattr(
        pf, "CHECKS", [("x", lambda: ("OK", "ok")), ("y", lambda: ("FAIL", "bad"))]
    )
    assert pf.main() == 1


# --- check 5: the live MCP connection (#941) -------------------------
#
# Every arm below injects `status_getter`, so none of them spawns a CLI. The
# real spawn is exercised by hand (task-lifecycle step 5) — these cover the
# branch logic, which is where the misattribution risks live.


def _prereqs_ok(monkeypatch, tmp_path):
    """Make checks 2 and 3 pass so check 5 is actually attempted."""
    build = tmp_path / "index.js"
    build.write_text("//", encoding="utf-8")
    monkeypatch.setattr(pf, "MCP_BUILD", build)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")


def test_mcp_check_skips_when_build_missing(monkeypatch, tmp_path):
    """No build → nothing could have connected. SKIP, and name the real cause.

    Safe only because check 2 already FAILed, so the exit code is already 1.
    """
    monkeypatch.setattr(pf, "MCP_BUILD", tmp_path / "absent.js")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    status, detail = pf._check_mcp_connection(status_getter=_never_called)
    assert status == "SKIP"
    assert "Built MCP server" in detail


def test_mcp_check_skips_when_api_key_missing(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(pf, "ENV_FILE", tmp_path / "absent.env")
    build = tmp_path / "index.js"
    build.write_text("//", encoding="utf-8")
    monkeypatch.setattr(pf, "MCP_BUILD", build)
    status, detail = pf._check_mcp_connection(status_getter=_never_called)
    assert status == "SKIP"
    assert "Anthropic API key" in detail


def _never_called():
    raise AssertionError("the live check must not be attempted without prerequisites")


def test_mcp_check_ok_when_connected(monkeypatch, tmp_path):
    _prereqs_ok(monkeypatch, tmp_path)
    status, detail = pf._check_mcp_connection(
        status_getter=lambda: [
            {"name": "genealogy", "status": "connected", "tools": [{}, {}, {}]}
        ]
    )
    assert status == "OK"
    assert "3 tools" in detail


def test_mcp_check_fails_and_quotes_the_servers_own_error(monkeypatch, tmp_path):
    """Acceptance criterion 1: FAIL *quoting the server's own error text*."""
    _prereqs_ok(monkeypatch, tmp_path)
    status, detail = pf._check_mcp_connection(
        status_getter=lambda: [
            {"name": "genealogy", "status": "failed", "error": "spawn node ENOENT"}
        ]
    )
    assert status == "FAIL"
    assert "spawn node ENOENT" in detail


def test_mcp_check_fails_when_the_server_is_absent_entirely(monkeypatch, tmp_path):
    # A REAL server list that simply does not name genealogy — the observed
    # failure shape. (The list carrying someone else's connector is realistic:
    # the operator's own claude.ai servers show up here.)
    _prereqs_ok(monkeypatch, tmp_path)
    status, detail = pf._check_mcp_connection(
        status_getter=lambda: [{"name": "claude.ai Slack", "status": "needs-auth"}]
    )
    assert status == "FAIL"
    assert "never registered" in detail


def test_mcp_check_does_not_fail_on_an_unreadable_server_list(monkeypatch, tmp_path):
    """An empty / unparseable list is not evidence the server is absent.

    It means the CLI has not populated the list yet, so calling it a FAIL sends
    the operator to rebuild a healthy server. Preflight still cannot go green on
    a genuinely missing server: in the live path `_ask` polls an absent entry
    like `pending` and exhausts the ceiling, which FAILs via the timeout arm.
    """
    _prereqs_ok(monkeypatch, tmp_path)
    for payload in ([], ["nonsense", None, 7]):
        status, _ = pf._check_mcp_connection(status_getter=lambda p=payload: p)
        assert status == "WARN"


def test_mcp_check_fails_on_timeout(monkeypatch, tmp_path):
    """A server stuck 'pending' is what killed run-2026-07-29_02-31-20 60s into
    init. _live_mcp_status polls until the status settles; exhausting the budget
    means it never did."""
    _prereqs_ok(monkeypatch, tmp_path)

    def _hang():
        raise TimeoutError

    status, detail = pf._check_mcp_connection(status_getter=_hang)
    assert status == "FAIL"
    # Covers both ways the budget can be exhausted: a status stuck 'pending',
    # and an entry the CLI never lists at all (both are polled, not settled).
    assert "never reported a settled status" in detail


def test_mcp_check_warns_rather_than_blaming_mcp_when_unprovable(monkeypatch, tmp_path):
    """An auth/dependency problem is NOT an MCP failure — and must not read as
    green either, or preflight breaks the promise #941 says it must keep."""
    _prereqs_ok(monkeypatch, tmp_path)

    def _no_credential():
        raise pf._Unprovable("no usable Anthropic credential: none found")

    status, detail = pf._check_mcp_connection(status_getter=_no_credential)
    assert status == "WARN"
    assert "UNPROVEN" in detail
    assert "not an MCP failure" in detail


def test_mcp_check_warns_on_pending_instead_of_failing(monkeypatch, tmp_path):
    """`pending` is a real transient state; aborting on it would false-fail a
    healthy server mid-handshake."""
    _prereqs_ok(monkeypatch, tmp_path)
    status, detail = pf._check_mcp_connection(
        status_getter=lambda: [{"name": "genealogy", "status": "pending"}]
    )
    assert status == "WARN"
    assert "still connecting" in detail


def test_mcp_check_reports_an_unexpected_error_without_crashing(monkeypatch, tmp_path):
    _prereqs_ok(monkeypatch, tmp_path)

    def _boom():
        raise RuntimeError("transport closed")

    status, detail = pf._check_mcp_connection(status_getter=_boom)
    assert status == "FAIL"
    assert "transport closed" in detail


# --- the hard wall around the live check (#941) -----------------------
#
# Measured 2026-08-05 against a stdio server that accepts the connection and
# never speaks: with the budget wrapped around the coroutine alone, the check
# returned the right FAIL but took 132.7s against a 90s ceiling. The +42.7s was
# `asyncio.run`'s own loop shutdown, which no in-loop timeout can bound — so the
# wall has to sit outside the loop, and these prove it does.
#
# `_run_bounded` is tested directly rather than through `_live_mcp_status`,
# because that resolves an Anthropic credential before it ever reaches the wall:
# a test that called it would pass or fail on whether the machine happens to
# have one. The first version of this test did exactly that — green here, red in
# CI, which is the shape of bug #941 itself.


def test_the_wall_gives_up_on_work_that_never_returns():
    entered = threading.Event()

    def _hang():
        entered.set()
        time.sleep(5)  # long enough to outlive the wall, short enough to reap

    start = time.monotonic()
    with pytest.raises(TimeoutError):
        pf._run_bounded(_hang, 0.2)
    assert entered.wait(2), "the work must actually have been started"
    assert time.monotonic() - start < 5, "the wall, not the work, ended this"


def test_the_wall_passes_a_result_back():
    assert pf._run_bounded(lambda: {"mcpServers": []}, 5) == {"mcpServers": []}


def test_the_wall_reraises_on_the_callers_thread():
    """`_check_mcp_connection` discriminates on exception TYPE, so the wall must
    not flatten `_Unprovable` (WARN) into a generic failure (FAIL)."""

    def _unprovable():
        raise pf._Unprovable("no usable Anthropic credential: none found")

    with pytest.raises(pf._Unprovable):
        pf._run_bounded(_unprovable, 5)


def test_the_walls_worker_is_a_daemon():
    """A hung CLI child must not keep the preflight process alive."""
    seen = pf._run_bounded(lambda: threading.current_thread().daemon, 5)
    assert seen is True


def test_the_live_check_uses_the_wall_with_teardown_grace_included():
    """Bind the call site: the tests above prove the wall works, this proves the
    live check uses it — and that the inner coroutine budget survived too."""
    src = inspect.getsource(pf._live_mcp_status)
    assert "_run_bounded(" in src
    assert "_MCP_CHECK_TIMEOUT_S + _MCP_TEARDOWN_GRACE_S" in src, (
        "the wall must allow for teardown on top of the ceiling"
    )
    assert "asyncio.wait_for(_ask(), timeout=_MCP_CHECK_TIMEOUT_S)" in src, (
        "the inner budget is what turns a stuck 'pending' into an actionable FAIL"
    )


def test_mcp_connection_check_is_last_in_checks():
    """It spawns a process and depends on the three before it."""
    assert pf.CHECKS[-1][1] is pf._check_mcp_connection


def test_main_passes_skip_through_without_failing_or_warning(monkeypatch, capsys):
    """SKIP is display-only. It can only arise when another check FAILed, so
    main() must not treat it as a status of its own."""
    monkeypatch.setattr(
        pf,
        "CHECKS",
        [("x", lambda: ("FAIL", "bad")), ("y", lambda: ("SKIP", "not attempted"))],
    )
    assert pf.main() == 1
    out = capsys.readouterr().out
    assert "[SKIP]" in out
    assert "warning" not in out.lower()
