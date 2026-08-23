"""Unit tests for e2e.preflight — per-check status (OK/WARN/FAIL) logic."""

from __future__ import annotations

import inspect
import os
import threading
import time
from pathlib import Path

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
    assert pf.main([]) == 0
    assert "ready" in capsys.readouterr().out.lower()


def test_main_warn_is_nonblocking(monkeypatch, capsys):
    monkeypatch.setattr(
        pf, "CHECKS", [("x", lambda: ("OK", "ok")), ("y", lambda: ("WARN", "aging"))]
    )
    assert pf.main([]) == 0
    assert "warning" in capsys.readouterr().out.lower()


def test_main_returns_one_when_any_fail(monkeypatch, capsys):
    monkeypatch.setattr(
        pf, "CHECKS", [("x", lambda: ("OK", "ok")), ("y", lambda: ("FAIL", "bad"))]
    )
    assert pf.main([]) == 1


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


# --- entry / log_reader threading (issue #1301) ------------------------
#
# `status_getter` stays zero-arg and untouched (the tests above never pass
# `entry`/`log_reader` and keep working unmodified) — these are the new arms
# that exercise the two added, keyword-only parameters.


def test_unavailable_fail_arm_quotes_the_entry_actually_used(monkeypatch, tmp_path):
    _prereqs_ok(monkeypatch, tmp_path)
    status, detail = pf._check_mcp_connection(
        status_getter=lambda: [{"name": "genealogy", "status": "failed", "error": "spawn node ENOENT"}],
        entry="C:/some/stub.js",
    )
    assert status == "FAIL"
    assert "C:/some/stub.js" in detail
    assert str(pf.MCP_BUILD) not in detail


def test_timeout_fail_arm_quotes_the_entry_actually_used(monkeypatch, tmp_path):
    _prereqs_ok(monkeypatch, tmp_path)

    def _hang():
        raise TimeoutError

    status, detail = pf._check_mcp_connection(status_getter=_hang, entry="C:/some/stub.js")
    assert status == "FAIL"
    assert "C:/some/stub.js" in detail
    assert str(pf.MCP_BUILD) not in detail


def test_unavailable_fail_arm_includes_captured_stderr(monkeypatch, tmp_path):
    _prereqs_ok(monkeypatch, tmp_path)
    status, detail = pf._check_mcp_connection(
        status_getter=lambda: [{"name": "genealogy", "status": "failed", "error": "spawn node ENOENT"}],
        log_reader=lambda since: (["STUB-MARKER: refused to start"], "/some/dir"),
    )
    assert status == "FAIL"
    assert "STUB-MARKER: refused to start" in detail


def test_timeout_fail_arm_includes_captured_stderr(monkeypatch, tmp_path):
    _prereqs_ok(monkeypatch, tmp_path)

    def _hang():
        raise TimeoutError

    status, detail = pf._check_mcp_connection(
        status_getter=_hang,
        log_reader=lambda since: (["STUB-MARKER: refused to start"], "/some/dir"),
    )
    assert status == "FAIL"
    assert "STUB-MARKER: refused to start" in detail


def test_unavailable_fail_arm_degrades_to_todays_message_plus_directory(monkeypatch, tmp_path):
    """The explicit degradation case: a log_reader that found nothing must not
    make the FAIL text read as if the server said nothing — it must name where
    it looked, and otherwise read exactly as it did before #1301."""
    _prereqs_ok(monkeypatch, tmp_path)
    baseline_status, baseline_detail = pf._check_mcp_connection(
        status_getter=lambda: [{"name": "genealogy", "status": "failed", "error": "spawn node ENOENT"}]
    )

    status, detail = pf._check_mcp_connection(
        status_getter=lambda: [{"name": "genealogy", "status": "failed", "error": "spawn node ENOENT"}],
        log_reader=lambda since: ([], "/some/dir/mcp-logs-genealogy"),
    )
    assert status == baseline_status == "FAIL"
    # The note is spliced in before the trailing sentence, so the baseline
    # isn't a literal substring — check its two halves survive around it
    # instead of requiring byte-for-byte containment.
    before_note, after_note = baseline_detail.split(".\nAn e2e run would")
    assert before_note in detail
    assert "An e2e run would" + after_note in detail
    assert "/some/dir/mcp-logs-genealogy" in detail


def test_timeout_fail_arm_degrades_to_todays_message_plus_directory(monkeypatch, tmp_path):
    _prereqs_ok(monkeypatch, tmp_path)

    def _hang():
        raise TimeoutError

    baseline_status, baseline_detail = pf._check_mcp_connection(status_getter=_hang)

    status, detail = pf._check_mcp_connection(
        status_getter=_hang,
        log_reader=lambda since: ([], "/some/dir/mcp-logs-genealogy"),
    )
    assert status == baseline_status == "FAIL"
    assert baseline_detail in detail
    assert "/some/dir/mcp-logs-genealogy" in detail


def test_injected_status_getter_leaves_the_real_clock_untouched(monkeypatch, tmp_path):
    """An injected status_getter must never trip the real `time.time()` capture
    that only `_default_getter` writes — confirms the ~10 pre-#1301 tests above
    (none of which pass `log_reader`) stay byte-for-byte unaffected, and that a
    test which *does* pass `log_reader` alongside an injected `status_getter`
    sees the closure cell's untouched initial value, not a real timestamp."""
    _prereqs_ok(monkeypatch, tmp_path)
    seen_since = []

    def _tracking_reader(since):
        seen_since.append(since)
        return [], "/some/dir"

    status, _ = pf._check_mcp_connection(
        status_getter=lambda: [{"name": "genealogy", "status": "failed", "error": "spawn node ENOENT"}],  # "unavailable" arm — reaches log_reader
        log_reader=_tracking_reader,
    )
    assert status == "FAIL"
    assert seen_since == [0.0]  # the closure cell's initial value, untouched


# --- read_mcp_stderr_lines (issue #1301), via preflight's own import -----
#
# e2e.mcp_stderr.read_mcp_stderr_lines is shared with orchestrator.py
# (chesworthrm's review of this PR consolidated the two independent copies);
# these tests exercise it through pf's own imported name rather than a
# second, orchestrator-side copy of the same coverage.
#
# All of these pin sys.platform to "linux" and XDG_CACHE_HOME to tmp_path, so
# the test controls exactly where the function will look — computing that
# same directory (cache_root/cwd_slug/mcp-logs-<server_name>) with the same
# regex the function itself uses, rather than guessing a layout.


def _stderr_log_dir(tmp_path: Path, cwd: Path, server_name: str) -> Path:
    import re as _re

    cwd_slug = _re.sub(r"[^A-Za-z0-9]", "-", str(cwd))
    return tmp_path / "claude-cli-nodejs" / cwd_slug / f"mcp-logs-{server_name}"


def _use_linux_cache_root(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(pf.sys, "platform", "linux")
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))


def test_read_mcp_stderr_lines_reads_the_newest_matching_log(monkeypatch, tmp_path):
    _use_linux_cache_root(monkeypatch, tmp_path)
    cwd = Path("/some/cwd")
    log_dir = _stderr_log_dir(tmp_path, cwd, "genealogy")
    log_dir.mkdir(parents=True)
    old = log_dir / "2020-01-01T00-00-00-000Z.jsonl"
    old.write_text('{"error": "Server stderr: OLD LINE\\n"}\n', encoding="utf-8")
    new = log_dir / "2030-01-01T00-00-00-000Z.jsonl"
    new.write_text('{"error": "Server stderr: NEW LINE\\n"}\n', encoding="utf-8")
    import os as _os
    old_t = old.stat().st_mtime
    _os.utime(new, (old_t + 100, old_t + 100))  # force new to sort newer

    lines, log_dir_str = pf.read_mcp_stderr_lines(cwd=cwd, server_name="genealogy", since=0)
    assert lines == ["NEW LINE"]
    # Substring, not exact-equality: `dir_looked_in` names every candidate
    # tried (literal cwd + its .resolve()'d form), and on a machine where a
    # synthetic POSIX-style path resolves to something else (e.g. Windows,
    # which prepends a drive letter) those are two different strings joined
    # by " or " -- even though the literal one is what actually matched here.
    assert str(log_dir) in log_dir_str


def test_read_mcp_stderr_lines_filters_on_the_server_stderr_prefix(monkeypatch, tmp_path):
    _use_linux_cache_root(monkeypatch, tmp_path)
    cwd = Path("/some/cwd")
    log_dir = _stderr_log_dir(tmp_path, cwd, "genealogy")
    log_dir.mkdir(parents=True)
    (log_dir / "x.jsonl").write_text(
        '{"error": "Server stderr: real line\\n"}\n'
        '{"error": "Connection failed: MCP error -32000"}\n',
        encoding="utf-8",
    )
    lines, _ = pf.read_mcp_stderr_lines(cwd=cwd, server_name="genealogy", since=0)
    assert lines == ["real line"]


def test_read_mcp_stderr_lines_bounds_to_20_lines_with_a_truncation_note(monkeypatch, tmp_path):
    _use_linux_cache_root(monkeypatch, tmp_path)
    cwd = Path("/some/cwd")
    log_dir = _stderr_log_dir(tmp_path, cwd, "genealogy")
    log_dir.mkdir(parents=True)
    rows = "\n".join(f'{{"error": "Server stderr: line {i}\\n"}}' for i in range(25))
    (log_dir / "x.jsonl").write_text(rows, encoding="utf-8")

    lines, _ = pf.read_mcp_stderr_lines(cwd=cwd, server_name="genealogy", since=0)
    assert len(lines) == 21  # 20 kept + 1 truncation note
    assert lines[-1] == "(… 5 earlier lines dropped)"
    assert lines[0] == "line 5"  # oldest of the KEPT lines (0-4 dropped)
    assert lines[-2] == "line 24"  # newest line kept


def test_read_mcp_stderr_lines_truncates_long_lines_to_200_chars(monkeypatch, tmp_path):
    _use_linux_cache_root(monkeypatch, tmp_path)
    cwd = Path("/some/cwd")
    log_dir = _stderr_log_dir(tmp_path, cwd, "genealogy")
    log_dir.mkdir(parents=True)
    long_line = "x" * 500
    (log_dir / "x.jsonl").write_text(
        f'{{"error": "Server stderr: {long_line}\\n"}}\n', encoding="utf-8"
    )
    lines, _ = pf.read_mcp_stderr_lines(cwd=cwd, server_name="genealogy", since=0)
    assert len(lines) == 1
    assert len(lines[0]) == 200


def test_read_mcp_stderr_lines_skips_one_malformed_json_line_among_valid_ones(monkeypatch, tmp_path):
    _use_linux_cache_root(monkeypatch, tmp_path)
    cwd = Path("/some/cwd")
    log_dir = _stderr_log_dir(tmp_path, cwd, "genealogy")
    log_dir.mkdir(parents=True)
    (log_dir / "x.jsonl").write_text(
        '{"error": "Server stderr: good line 1\\n"}\n'
        "not json at all\n"
        '{"error": "Server stderr: good line 2\\n"}\n',
        encoding="utf-8",
    )
    lines, _ = pf.read_mcp_stderr_lines(cwd=cwd, server_name="genealogy", since=0)
    assert lines == ["good line 1", "good line 2"]


def test_read_mcp_stderr_lines_missing_directory_degrades_to_empty_plus_dir_name(monkeypatch, tmp_path):
    _use_linux_cache_root(monkeypatch, tmp_path)
    lines, log_dir = pf.read_mcp_stderr_lines(
        cwd=Path("/nonexistent-cwd"), server_name="genealogy", since=0,
    )
    assert lines == []
    assert log_dir  # names a directory, even though nothing was found there


def test_read_mcp_stderr_lines_unrecognized_platform_degrades_to_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(pf.sys, "platform", "some-unheard-of-os")
    monkeypatch.delenv("XDG_CACHE_HOME", raising=False)
    lines, log_dir = pf.read_mcp_stderr_lines(cwd=tmp_path, server_name="genealogy", since=0)
    assert lines == []
    assert isinstance(log_dir, str)


def test_read_mcp_stderr_lines_never_raises_on_an_unreadable_file(monkeypatch, tmp_path):
    _use_linux_cache_root(monkeypatch, tmp_path)
    cwd = Path("/some/cwd")
    log_dir = _stderr_log_dir(tmp_path, cwd, "genealogy")
    log_dir.mkdir(parents=True)
    (log_dir / "x.jsonl").write_bytes(b"\xff\xfe\x00\x01")  # not valid utf-8

    lines, log_dir_str = pf.read_mcp_stderr_lines(cwd=cwd, server_name="genealogy", since=0)
    assert lines == []  # must not raise
    assert str(log_dir) in log_dir_str  # substring, not exact-equality; see note above


def test_read_mcp_stderr_lines_since_filter_skips_files_older_than_the_check(monkeypatch, tmp_path):
    """A log left over from a PREVIOUS session must not be mistaken for this
    one's — `since` is the check's own start time, and an old file predates it."""
    _use_linux_cache_root(monkeypatch, tmp_path)
    cwd = Path("/some/cwd")
    log_dir = _stderr_log_dir(tmp_path, cwd, "genealogy")
    log_dir.mkdir(parents=True)
    stale = log_dir / "old.jsonl"
    stale.write_text('{"error": "Server stderr: STALE\\n"}\n', encoding="utf-8")

    lines, _ = pf.read_mcp_stderr_lines(
        cwd=cwd, server_name="genealogy", since=time.time() + 3600,
    )
    assert lines == []


def test_read_mcp_stderr_lines_finds_the_log_when_the_cli_resolved_a_different_cwd(
    monkeypatch, tmp_path,
):
    """macOS: Node's process.cwd() reports the RESOLVED path (/private/var/...)
    while Python's tempfile hands this function the literal, unresolved one
    (/var/...) -- the two disagree only because /var is itself a symlink.
    Caught live by chesworthrm's review: the CLI writes its log under the
    resolved slug, so a reader that only tries the literal one never finds it,
    and the abort silently falls back to today's message with no hint a
    capture was even attempted.

    Simulated via a `Path.resolve` monkeypatch rather than a real symlink, so
    this is deterministic on every platform (including CI, which runs Linux,
    where the literal and resolved forms are the same and this divergence
    can't be reproduced with a real filesystem symlink in the same way).
    """
    _use_linux_cache_root(monkeypatch, tmp_path)
    literal_cwd = Path("/var/folders/xx/T/e2e-some-fixture-abc123")
    resolved_cwd = Path("/private/var/folders/xx/T/e2e-some-fixture-abc123")

    real_resolve = Path.resolve

    def fake_resolve(self, *args, **kwargs):
        if str(self) == str(literal_cwd):
            return resolved_cwd
        return real_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", fake_resolve)

    # The log exists ONLY under the slug the CLI actually resolved to --
    # exactly what a real macOS run produces (chesworthrm's review reproduced
    # this live: "handed log dir exists? 0 / resolved log dir exists? 1").
    log_dir = _stderr_log_dir(tmp_path, resolved_cwd, "genealogy")
    log_dir.mkdir(parents=True)
    (log_dir / "x.jsonl").write_text(
        '{"error": "Server stderr: STUB-MARKER: refused to start\\n"}\n',
        encoding="utf-8",
    )

    lines, dir_looked_in = pf.read_mcp_stderr_lines(
        cwd=literal_cwd, server_name="genealogy", since=0,
    )
    assert lines == ["STUB-MARKER: refused to start"]
    # Both candidates are named in the failure-path string, not just whichever
    # one happened to match -- rule 2 (an empty capture must name where it
    # looked) needs this to be true on the miss path too, not just the hit path.
    assert str(_stderr_log_dir(tmp_path, literal_cwd, "genealogy")) in dir_looked_in
    assert str(log_dir) in dir_looked_in


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


def test_mcp_connection_check_follows_the_static_checks():
    """It spawns a process and depends on the three before it, so it must come
    after them — and before the WARN-only network probe appended last."""
    names = [c[1] for c in pf.CHECKS]
    assert pf._check_mcp_connection in names
    assert names.index(pf._check_mcp_connection) > names.index(pf._check_harness_deps)


# --- check 6: wiki + population service reachability (#1552) ----------
#
# WARN-only and prober-injected, so no arm hits the network. The point pinned
# here is that it NEVER FAILs — a run without these services is degraded, not
# aborted, so a FAIL would block a run the operator was entitled to make.


def test_wiki_pop_ok_when_both_reachable():
    status, detail = pf._check_wiki_pop_services(prober=lambda url: (True, "HTTP 200"))
    assert status == "OK"
    assert "reachable" in detail


def test_wiki_pop_warns_when_a_service_is_unreachable():
    status, detail = pf._check_wiki_pop_services(
        prober=lambda url: (False, "URLError")
    )
    assert status == "WARN"
    # The issue's exact operator-facing sentence must survive verbatim.
    assert "will fail for the whole run" in detail
    assert "report it before spending an hour" in detail


def test_wiki_pop_never_fails_whatever_the_probe_says():
    for outcome in [(True, "HTTP 200"), (False, "timeout"), (True, "HTTP 404")]:
        status, _ = pf._check_wiki_pop_services(prober=lambda url, o=outcome: o)
        assert status in ("OK", "WARN")
        assert status != "FAIL"


def test_wiki_pop_warns_when_a_base_url_cannot_be_resolved(monkeypatch, tmp_path):
    monkeypatch.setattr(pf, "FS_CONFIG", tmp_path / "absent.json")
    monkeypatch.setattr(pf, "_WIKI_CONFIG_TS", tmp_path / "absent-config.ts")
    monkeypatch.setattr(pf, "_POP_CONFIG_TS", tmp_path / "absent-pop.ts")
    status, detail = pf._check_wiki_pop_services(prober=_probe_never_called)
    assert status == "WARN"
    assert "Could not resolve" in detail


def _probe_never_called(url):
    raise AssertionError("must not probe when the base URL is unresolved")


def test_resolve_base_prefers_the_per_user_override(monkeypatch, tmp_path):
    cfg = tmp_path / "config.json"
    cfg.write_text('{"wikiApiUrl": "http://localhost:8000/"}', encoding="utf-8")
    monkeypatch.setattr(pf, "FS_CONFIG", cfg)
    got = pf._resolve_service_base("wikiApiUrl", tmp_path / "unused.ts", "DEFAULT_WIKI_API_URL")
    assert got == "http://localhost:8000"  # trailing slash stripped


def test_resolve_base_falls_back_to_the_ts_default(monkeypatch, tmp_path):
    """With no override, the compiled-in TS default is the source of truth, so a
    rotation of that constant is followed without editing this test: it asserts the
    resolver returns whatever the TS currently declares, not a fixed URL."""
    import re

    monkeypatch.setattr(pf, "FS_CONFIG", tmp_path / "absent.json")
    got = pf._resolve_service_base(
        "wikiApiUrl", pf._WIKI_CONFIG_TS, "DEFAULT_WIKI_API_URL"
    )
    declared = (
        re.search(
            r'DEFAULT_WIKI_API_URL\s*=\s*"([^"]+)"',
            pf._WIKI_CONFIG_TS.read_text(encoding="utf-8"),
        )
        .group(1)
        .rstrip("/")
    )
    assert got == declared and got.startswith("https://")


def test_main_passes_skip_through_without_failing_or_warning(monkeypatch, capsys):
    """SKIP is display-only. It can only arise when another check FAILed, so
    main() must not treat it as a status of its own."""
    monkeypatch.setattr(
        pf,
        "CHECKS",
        [("x", lambda: ("FAIL", "bad")), ("y", lambda: ("SKIP", "not attempted"))],
    )
    assert pf.main([]) == 1
    out = capsys.readouterr().out
    assert "[SKIP]" in out
    assert "warning" not in out.lower()
