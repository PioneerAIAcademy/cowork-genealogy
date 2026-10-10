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

**Per-model rates (T1.11).** `MODEL_RATES` prices a token block at the model that
actually produced it, so a helper moved to a cheaper model shows a cheaper row.
It sits beside the flat table rather than replacing it: `estimate_cost_usd` stays
the corpus estimator and its calibration above is untouched, and
`estimate_cost_for_model` calls it for Sonnet 4.6, so a Sonnet-4.6 figure is the
flat figure by construction. Cache writes are priced at each model's 1-hour rate,
the same corpus basis as the flat table. A model not in the table prices to None,
never to the Sonnet figure: CLI 2.1.139 falls back silently for a model it does
not know, which is how some unit logs came to price Sonnet 5 at 4.6's rates.
"""

from __future__ import annotations

import re

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


# USD per 1M tokens, each model's own standard rate, cache write at the 1-hour
# rate (2x input on every tier). Source: Anthropic's published price list
# (claude-api skill, cached 2026-09-25); Sonnet 4.6 and Haiku 4.5 also agree with
# the bundled CLI catalogs and reproduce 2,358 / 724 unit `costUSD` entries.
MODEL_RATES = {
    "claude-sonnet-4-6": {"input_tokens": 3.00, "output_tokens": 15.00,
                          "cache_read_input_tokens": 0.30, "cache_creation_input_tokens": 6.00},
    "claude-sonnet-5": {"input_tokens": 2.00, "output_tokens": 10.00,
                        "cache_read_input_tokens": 0.20, "cache_creation_input_tokens": 4.00},
    "claude-sonnet-5-5": {"input_tokens": 2.00, "output_tokens": 10.00,
                          "cache_read_input_tokens": 0.20, "cache_creation_input_tokens": 4.00},
    "claude-haiku-4-5": {"input_tokens": 1.00, "output_tokens": 5.00,
                         "cache_read_input_tokens": 0.10, "cache_creation_input_tokens": 2.00},
    "claude-opus-4-8": {"input_tokens": 5.00, "output_tokens": 25.00,
                        "cache_read_input_tokens": 0.50, "cache_creation_input_tokens": 10.00},
}

_DATE_SUFFIX = re.compile(r"-\d{8}$")


def canonical_model(model: str) -> str:
    """`claude-haiku-4-5-20251001` -> `claude-haiku-4-5`: transcripts carry the
    dated id, the price list the undated one. Anything else passes through."""
    return _DATE_SUFFIX.sub("", model)


def estimate_cost_for_model(usage_tokens: dict | None, model: str | None) -> float | None:
    """Dollar estimate at `model`'s own rate, or None when unrecoverable.

    None for the same "no positive token count" rule as `estimate_cost_usd`, and
    None for a model the table does not know — never the Sonnet figure, which
    would hide exactly the saving (or cost) this exists to show.
    """
    if not isinstance(model, str):
        return None
    key = canonical_model(model)
    if key == "claude-sonnet-4-6":
        return estimate_cost_usd(usage_tokens)
    rates = MODEL_RATES.get(key)
    if rates is None or estimate_cost_usd(usage_tokens) is None:
        return None
    return sum(
        (raw if isinstance((raw := usage_tokens.get(field)), int) else 0) * per_mtok / 1_000_000
        for field, per_mtok in rates.items()
    )


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
