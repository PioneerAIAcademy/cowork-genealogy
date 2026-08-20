"""Flat per-token price table + a cost estimator for abort-path e2e runs.

Issue #1484 (b): every aborted run (`_fallback_usage`) stores
`total_cost_usd: None`, so the corpus ledger reads as if the null-cost runs were
free and hides real spend, non-randomly, since every `timeout` run is among
them. The hidden figure is not pinned here because it drifts with the corpus:
`make e2e-corpus SINCE=all` prints it live (recorded / estimated / unrecoverable),
which is this module's whole point. `total_cost_usd` itself stays null (a run spans several models, so one
authoritative price lookup would be wrong; see `_fallback_usage`'s docstring and
e2e-test-spec.md §8.1.2). This module produces a *separately-named, clearly-
approximate* figure instead: `total_cost_usd_estimated`.

**Lead ruling (2026-08-10, issue #1484 comment):** publish an estimated cost and
print its measured error next to it. A figure that is somewhat off and labelled
so beats no figure. The label is not optional — the tail is wide.

**Why a flat sonnet-rate table, and why the 1-hour cache-write price.** The
accuracy is free to measure offline: committed runs carrying BOTH a recorded
`total_cost_usd` and a token block let `--calibrate-cost` report
estimated/recorded across them. Measured 2026-08-10: a flat table with the
5-minute cache-write price gives median 0.77x; with the 1-hour cache-write price,
median 0.90x. So `cache_creation_input_tokens` is priced at the 1-hour rate.
Anything materially worse than ~0.90x median means this table is wrong, not the
corpus — re-measure with `--calibrate-cost`, do not reword.

**Stdlib-only, no `claude_agent_sdk` import**, deliberately: `corpus_report` is
pure analysis over committed data and must not gain an SDK dependency by
importing the estimator (it cannot import `e2e.orchestrator` for the same
reason). `orchestrator` imports this too, so the rates live in one place.

Rates are Claude Sonnet standard tier, US dollars per million tokens.
"""

from __future__ import annotations

# USD per 1M tokens (Claude Sonnet, standard tier). Cache write is the 1-hour
# ephemeral rate (see module docstring: it is what calibrates to ~0.90x).
_PER_MTOK = {
    "input_tokens": 3.00,
    "output_tokens": 15.00,
    "cache_read_input_tokens": 0.30,
    "cache_creation_input_tokens": 6.00,
}

# The token fields this table prices — also the presence test for "has a token
# block at all". A usage block carrying none of these (the 13 pre-fallback runs
# with no token counts) is unrecoverable and must estimate to None, never 0.
PRICED_FIELDS = tuple(_PER_MTOK)


def estimate_cost_usd(usage_tokens: dict | None) -> float | None:
    """Flat-rate dollar estimate over a token block, or None when unrecoverable.

    `usage_tokens` is the inner token dict — the `usage["usage"]` block, shaped
    like `_USAGE_FIELDS` (`input_tokens`, `output_tokens`,
    `cache_read_input_tokens`, `cache_creation_input_tokens`). Returns None when
    that block is absent, non-dict, or carries NO POSITIVE token count — a run
    that recorded no usable token signal (an abort that captured no assistant
    message zero-fills every field). A null is honest there; a 0.0 would read as
    a free run and re-introduce exactly the hidden-spend defect this fixes, and it
    would understate a run that did spend input/cache tokens before it went
    silent. A missing individual field counts as 0 tokens.
    """
    if not isinstance(usage_tokens, dict):
        return None
    counts = {
        field: (raw if isinstance((raw := usage_tokens.get(field)), int) else 0)
        for field in _PER_MTOK
    }
    if sum(counts.values()) <= 0:
        return None
    return sum(counts[field] * per_mtok / 1_000_000 for field, per_mtok in _PER_MTOK.items())
