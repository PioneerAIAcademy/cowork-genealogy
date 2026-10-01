"""Unit tests for the sqsd shim's pure decision function (apps/server/proto/shim/decide.py).

The shim imports ``decide`` as a top-level module from its own directory (that is
how the container runs it), so the tests put that directory on sys.path rather
than treating ``proto/`` as a package.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "proto" / "shim"))

from decide import (  # noqa: E402
    BACKOFF_BASE_S,
    BACKOFF_MAX_S,
    READ_TIMEOUT,
    Decision,
    backoff_for,
    decide,
    should_dead_letter,
)


@pytest.mark.parametrize("status", [200, 201, 204, 299])
def test_2xx_deletes(status: int) -> None:
    assert decide(status, None, 1) == Decision("delete", 0, False)
    assert decide(status, None, 5) == Decision("delete", 0, False)


@pytest.mark.parametrize(
    ("receive_count", "expected"),
    [(1, 5), (2, 10), (3, 20), (4, 40), (5, 80), (6, 160)],
)
def test_500_backs_off_doubling_per_receive(receive_count: int, expected: int) -> None:
    assert decide(500, None, receive_count) == Decision("requeue_backoff", expected, False)


@pytest.mark.parametrize("receive_count", [7, 8, 30, 100, 10_000])
def test_backoff_caps_at_max(receive_count: int) -> None:
    assert decide(500, None, receive_count).backoff_s == BACKOFF_MAX_S == 300


def test_receive_count_1_vs_5() -> None:
    first = decide(503, None, 1)
    fifth = decide(503, None, 5)
    assert first.backoff_s == BACKOFF_BASE_S == 5
    assert fifth.backoff_s == 80
    assert first.action == fifth.action == "requeue_backoff"
    assert not first.kill_worker and not fifth.kill_worker


@pytest.mark.parametrize("status", [100, 301, 400, 404, 409, 429, 500, 502, 503, 504])
def test_every_non_2xx_backs_off_without_kill(status: int) -> None:
    d = decide(status, None, 1)
    assert d.action == "requeue_backoff"
    assert d.backoff_s == 5
    assert d.kill_worker is False


@pytest.mark.parametrize("error", ["connection_refused", "connection_reset", "connect_timeout", "connection_error"])
def test_connection_failures_requeue_now_without_kill(error: str) -> None:
    assert decide(None, error, 1) == Decision("requeue", 0, False)
    assert decide(None, error, 5) == Decision("requeue", 0, False)


def test_read_timeout_requeues_now_and_kills_worker() -> None:
    assert decide(None, READ_TIMEOUT, 1) == Decision("requeue", 0, True)
    # Still a kill on a redelivery: the ceiling binds every delivery, not just the first.
    assert decide(None, READ_TIMEOUT, 5) == Decision("requeue", 0, True)


def test_receive_count_below_one_is_treated_as_first_delivery() -> None:
    assert decide(500, None, 0).backoff_s == 5
    assert decide(500, None, -3).backoff_s == 5


def test_exactly_one_of_status_or_error_is_required() -> None:
    with pytest.raises(ValueError):
        decide(None, None, 1)
    with pytest.raises(ValueError):
        decide(500, READ_TIMEOUT, 1)


def test_custom_base_and_max() -> None:
    assert decide(500, None, 1, backoff_base_s=2, backoff_max_s=7).backoff_s == 2
    assert decide(500, None, 2, backoff_base_s=2, backoff_max_s=7).backoff_s == 4
    assert decide(500, None, 3, backoff_base_s=2, backoff_max_s=7).backoff_s == 7
    assert backoff_for(1, 10, 1000) == 10
    assert backoff_for(8, 10, 1000) == 1000


# ── sqsd emulation (U5, docker-compose.sqsd.yml) ────────────────────────────────


def test_read_timeout_abandons_without_kill_when_disabled() -> None:
    """sqsd at InactivityTimeout: no kill, no requeue; the message waits out its visibility."""
    assert decide(None, READ_TIMEOUT, 1, kill_on_read_timeout=False) == Decision("abandon", 0, False)
    assert decide(None, READ_TIMEOUT, 4, kill_on_read_timeout=False) == Decision("abandon", 0, False)
    # Only the read timeout: a refused or reset connection still requeues at once
    # (without error_visibility_s; test_fixed_error_visibility_replaces_backoff has the rest).
    assert decide(None, "connection_reset", 1, kill_on_read_timeout=False) == Decision("requeue", 0, False)
    assert decide(None, READ_TIMEOUT, 1, kill_on_read_timeout=True) == Decision("requeue", 0, True)


def test_fixed_error_visibility_replaces_backoff() -> None:
    for receive_count in (1, 2, 5, 100):
        assert decide(500, None, receive_count, error_visibility_s=300) == Decision("requeue_backoff", 300, False)
    assert decide(503, None, 3, error_visibility_s=0).backoff_s == 0, "0 is a value, not unset"
    assert decide(500, None, 3, error_visibility_s=None).backoff_s == 20, "unset keeps the doubling backoff"
    assert decide(200, None, 3, error_visibility_s=300) == Decision("delete", 0, False)
    # A refused or reset connection waits it out too, as sqsd does; the read timeout does not.
    for error in ("connection_refused", "connection_reset", "connect_timeout", "connection_error"):
        assert decide(None, error, 3, error_visibility_s=300) == Decision("requeue_backoff", 300, False)
        assert decide(None, error, 3) == Decision("requeue", 0, False), "the base profile requeues at once"
    assert decide(None, READ_TIMEOUT, 3, error_visibility_s=300) == Decision("requeue", 0, True)
    assert decide(None, READ_TIMEOUT, 3, error_visibility_s=300, kill_on_read_timeout=False) == Decision(
        "abandon", 0, False
    )


@pytest.mark.parametrize(("receive_count", "max_retries", "expected"), [
    (1, 1, False),
    (2, 1, True),
    (5, 5, False),
    (6, 5, True),
    (60, 5, True),
])
def test_receive_past_max_retries_dead_letters(receive_count: int, max_retries: int, expected: bool) -> None:
    """sqsd delivers receives 1..MaxRetries; the one after goes to the DLQ unPOSTed."""
    assert should_dead_letter(receive_count, max_retries) is expected


@pytest.mark.parametrize("receive_count", [0, 1, 2, 10_000])
def test_max_retries_zero_never_dead_letters(receive_count: int) -> None:
    assert should_dead_letter(receive_count, 0) is False
    assert should_dead_letter(receive_count, -1) is False
