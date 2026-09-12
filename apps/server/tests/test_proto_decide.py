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

from decide import BACKOFF_BASE_S, BACKOFF_MAX_S, READ_TIMEOUT, Decision, backoff_for, decide  # noqa: E402


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
