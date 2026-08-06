"""Unit tests for `e2e.run_e2e`'s judge-key preflight (#1023).

The unit CLI's preflight has eight tests in `test_cli.py`; this call site had
none — and it is the expensive half. A bad key here means a $7+ agent run
completes and is then discarded because the judge cannot grade it, which is the
exact waste the preflight exists to prevent.

(Not to be confused with `test_e2e_preflight.py`, which covers the unrelated
`e2e.preflight` module — the FS-token / build-freshness checks.)

`verify_judge_key` itself is covered through the unit path, so these cover the
*call site*: that it fires before anything is spent, that `--skip-judge`
bypasses it, and that a missing key still does not abort — the e2e path has
never blocked on absence, unlike the unit path.
"""

from __future__ import annotations

import anthropic
import httpx

import harness.auth
from e2e import run_e2e
from e2e.result import E2eResult


def _record_run(monkeypatch):
    """Replace `_run_one` with an async stub that records being reached.

    Not an exception sentinel: `main` wraps the run in `except Exception` and
    turns it into exit 1, which would swallow one and make these tests pass for
    the wrong reason.
    """
    calls = {"n": 0}

    async def _fake_run_one(fixture_dir, **kwargs):
        calls["n"] += 1
        return E2eResult(
            test_id="fx", captured_at="2026-05-26_14-30-45",
            verdict="pass", stop_reason="completed",
        )

    monkeypatch.setattr(run_e2e, "_run_one", _fake_run_one)
    return calls


def _fixture_root(tmp_path):
    root = tmp_path / "fixtures"
    (root / "fx").mkdir(parents=True)
    return root


def _argv(root):
    return ["--test", "fx", "--fixtures-root", str(root)]


def _no_env_file(monkeypatch):
    """Neutralise eval/.env so a developer's real key never reaches these."""
    monkeypatch.setattr(run_e2e, "load_env_file", lambda *a, **k: None)


def _stub_key_check(monkeypatch, rejected_status):
    """Stub `verify_judge_key` on `harness.auth`, which is where `run_e2e.main`'s
    late `from harness.auth import verify_judge_key` resolves it."""
    monkeypatch.setattr(
        harness.auth, "verify_judge_key", lambda key, model: rejected_status
    )


def _forbid_key_check(monkeypatch):
    def _boom(key, model):
        raise AssertionError("verify_judge_key must not be called here")

    monkeypatch.setattr(harness.auth, "verify_judge_key", _boom)


def test_preflight_aborts_before_spending_when_key_is_rejected(
    tmp_path, monkeypatch, capsys
):
    """The whole point: exit 2 before the agent runs, not after $7 is spent."""
    root = _fixture_root(tmp_path)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-bad-key")
    _no_env_file(monkeypatch)
    _stub_key_check(monkeypatch, 401)

    def _must_not_run(*a, **k):
        raise AssertionError("preflight must abort before the agent runs")

    monkeypatch.setattr(run_e2e, "_run_one", _must_not_run)

    rc = run_e2e.main(_argv(root))

    assert rc == 2
    err = capsys.readouterr().err
    assert "rejected it (401)" in err
    assert "--skip-judge" in err, "the operator needs the way out in the message"


def test_skip_judge_bypasses_the_preflight(tmp_path, monkeypatch):
    """`--skip-judge` means no grading is wanted, so a bad key is irrelevant —
    and the liveness call itself must not be spent."""
    root = _fixture_root(tmp_path)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-bad-key")
    _no_env_file(monkeypatch)
    _forbid_key_check(monkeypatch)
    calls = _record_run(monkeypatch)

    assert run_e2e.main(_argv(root) + ["--skip-judge"]) == 0
    assert calls["n"] == 1


def test_missing_key_does_not_abort(tmp_path, monkeypatch):
    """The e2e path has never blocked on an absent key — `--skip-judge` owns
    that contract. Only a present-but-rejected key aborts."""
    root = _fixture_root(tmp_path)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    _no_env_file(monkeypatch)
    _forbid_key_check(monkeypatch)
    calls = _record_run(monkeypatch)

    assert run_e2e.main(_argv(root)) == 0
    assert calls["n"] == 1


def test_transient_failure_lets_the_run_proceed(tmp_path, monkeypatch):
    """A 429/529/connection error returns None from `verify_judge_key`; the
    judge has its own retry loop, so an Anthropic outage must not block a paid
    run that would otherwise have graded fine."""
    root = _fixture_root(tmp_path)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-live-key")
    _no_env_file(monkeypatch)
    _stub_key_check(monkeypatch, None)
    calls = _record_run(monkeypatch)

    assert run_e2e.main(_argv(root)) == 0
    assert calls["n"] == 1


def test_verify_judge_key_maps_a_401_to_its_status(monkeypatch):
    """Through the real `verify_judge_key` body with only the Anthropic client
    stubbed, so the exception→status mapping the e2e path depends on is covered
    here and not only through `test_cli.py`'s unit-CLI route."""

    class _FakeMessages:
        def create(self, **kwargs):
            raise anthropic.AuthenticationError(
                message="invalid x-api-key",
                response=httpx.Response(
                    401,
                    request=httpx.Request(
                        "POST", "https://api.anthropic.com/v1/messages"
                    ),
                ),
                body=None,
            )

    class _FakeClient:
        def __init__(self, **kwargs):
            self.messages = _FakeMessages()

    monkeypatch.setattr(anthropic, "Anthropic", _FakeClient)

    assert harness.auth.verify_judge_key("sk-bad", "claude-haiku-4-5-20251001") == 401
