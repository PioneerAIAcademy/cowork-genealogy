"""RealAgent cost/usage accounting.

The Claude Agent SDK's ResultMessage reports total_cost_usd and token usage as
CUMULATIVE session totals (they grow every turn). The web cost meter sums the
usage events it receives, so RealAgent must emit the per-turn *delta*, not the
running total — otherwise a long session's cost is over-counted by roughly
(turns+1)/2 (the bug that showed a ~$150 meter for a ~$15 session).
"""

import pytest

from app.agent.real_agent import RealAgent


def test_usage_delta_emits_per_turn_increments(tmp_path):
    agent = RealAgent(tmp_path)
    # Cumulative snapshots as the SDK reports them across three turns.
    snapshots = [(0.10, 1000, 200), (0.25, 2500, 500), (0.45, 4000, 900)]
    deltas = [agent._usage_delta(*snap) for snap in snapshots]

    # First turn's delta equals the first cumulative snapshot.
    assert deltas[0] == (0.10, 1000, 200)
    # Later deltas are increments, not the running total.
    assert deltas[1][1] == 1500 and deltas[2][1] == 1500
    assert deltas[1][2] == 300 and deltas[2][2] == 400

    # Summing the emitted deltas reconstructs the true session total — the
    # property the client relies on. (Summing the raw cumulative snapshots
    # would have given cost 0.80 / input 7500 — the over-count.)
    assert round(sum(d[0] for d in deltas), 6) == 0.45
    assert sum(d[1] for d in deltas) == 4000
    assert sum(d[2] for d in deltas) == 900


def test_usage_delta_passes_through_none_without_advancing_baseline(tmp_path):
    agent = RealAgent(tmp_path)
    assert agent._usage_delta(None, None, None) == (None, None, None)
    assert agent._usage_delta(0.10, 1000, 200) == (0.10, 1000, 200)
    # A None field emits None and leaves its baseline untouched, so the next
    # real snapshot still deltas against the last real value.
    assert agent._usage_delta(None, 1500, None) == (None, 500, None)


def test_usage_delta_floors_negative_at_zero(tmp_path):
    agent = RealAgent(tmp_path)
    agent._usage_delta(1.00, 5000, 900)
    # A lower snapshot (e.g. a cumulative counter that reset on resume) must
    # not emit a negative increment; it rebaselines instead.
    assert agent._usage_delta(0.20, 1000, 100) == (0.0, 0, 0)
    d_cost, d_in, d_out = agent._usage_delta(0.50, 1400, 250)
    assert d_cost == pytest.approx(0.30)
    assert (d_in, d_out) == (400, 150)
