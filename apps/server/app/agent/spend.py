"""What a session has cost, and the bound on it (research-as-a-job 1e).

ONE copy for two planes, for the same reason ``continue_policy`` is: the prototype's cap
and the alpha's must fire at the same dollar, and two hand-kept price tables is the one
arrangement that cannot guarantee it.

**Why this is not in ``continue_policy``.** That module is lifted into a clean namespace
by ``tests/test_continue_policy_parity.py``, which evaluates its module-level constants
with nothing else in scope -- so a constant that is a function CALL rather than a literal
turns that test into a collection error. ``PRICE_PER_MTOK`` is exactly that (four
``env_float`` calls). Keeping spend here also keeps the parity module to what it is
actually pinned against: the predicate the harness's ``stop_checker`` mirrors, which has
no opinion about money.

``eval/harness/e2e/pricing.py`` stays a third, genuinely separate copy -- the worker image
carries no ``eval/`` -- pinned against this one by
``test_the_two_price_tables_are_the_same_four_rates``.
"""

from __future__ import annotations

from .continue_policy import env_float

# USD per 1M tokens. One table for both planes, for the same reason CONTINUE_REASON is
# one string: the prototype's cap and the alpha's must fire at the same dollar, and two
# hand-kept copies is the one arrangement that cannot guarantee it. `eval/harness`'s
# `e2e/pricing.py` stays a third, genuinely separate copy -- the worker image carries no
# `eval/` -- pinned against this one by
# `test_the_two_price_tables_are_the_same_four_rates`.
#
# Env-overridable so an operator can re-price without a rebuild, and guarded so a typo
# cannot crash-loop the reader (`env_float`).
PRICE_PER_MTOK = {
    "input": env_float("PRICE_INPUT_PER_MTOK", 3.0),
    "cache_write": env_float("PRICE_CACHE_WRITE_PER_MTOK", 6.0),
    "cache_read": env_float("PRICE_CACHE_READ_PER_MTOK", 0.30),
    "output": env_float("PRICE_OUTPUT_PER_MTOK", 15.0),
}

# The session bound. Per SESSION, not per run or per project: a project spans many
# sessions, so this caps one sitting and never the research. Sized against the committed
# e2e corpus (re-measured 2026-09-23: 161 runs, median $7.85, p90 $14.26, max $25.24), so
# $35 is about four median runs in one sitting and above the costliest ever recorded.
# `test_the_spend_cap_clears_the_costliest_run_in_the_corpus` re-derives that.
SPEND_CAP_USD = env_float("SESSION_SPEND_CAP_USD", 35.0)

TOKEN_CLASSES = ("input", "cache_write", "cache_read", "output")


def price_usd(tokens) -> float:
    """Tokens (input, cache_write, cache_read, output) priced at PRICE_PER_MTOK."""
    return sum(
        (t or 0) / 1_000_000 * PRICE_PER_MTOK[name]
        for name, t in zip(TOKEN_CLASSES, tokens)
    )


def usage_tokens(usage) -> tuple:
    """The four token counts out of one SDK/transcript usage block, in TOKEN_CLASSES
    order. Accepts a dict or an attribute-carrying object, because the SDK has shipped
    both shapes; an absent field is 0, never None, so the tuple is always priceable."""
    def get(name):
        value = usage.get(name) if isinstance(usage, dict) else getattr(usage, name, None)
        return value or 0

    return (
        get("input_tokens"),
        get("cache_creation_input_tokens"),
        get("cache_read_input_tokens"),
        get("output_tokens"),
    )
