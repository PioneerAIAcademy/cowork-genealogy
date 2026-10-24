"""What a session has cost, and the bound on it (PR #2870 item 1e).

The search-agent prototype's worker reads it for its cap (via ``proto/worker/options.py``):
the alpha's spend limit was removed in PR #2870, since the prototype replaces it. The
alpha's credential proxy reads only the prices, to record what each call cost
(``anthropic_proxy``). It lives in ``app.agent`` beside ``continue_policy`` so a second
reader takes this table rather than hand-keeping another.

**Why this is not in ``continue_policy``.** That module is lifted into a clean namespace
by ``tests/test_continue_policy_parity.py``, which evaluates its module-level constants
with nothing else in scope -- so a constant that is a function CALL rather than a literal
turns that test into a collection error. ``PRICE_PER_MTOK`` is exactly that (four
``env_float`` calls). Keeping spend here also keeps the parity module to what it is
actually pinned against: the predicate the harness's ``stop_checker`` mirrors, which has
no opinion about money.

``eval/harness/e2e/pricing.py`` stays a second, genuinely separate copy -- the worker image
carries no ``eval/`` -- pinned against this one by
``test_the_two_price_tables_share_three_rates_and_differ_by_cache_ttl``, which lets the
cache-write rate differ by TTL (see ``PRICE_PER_MTOK``).
"""

from __future__ import annotations

import json
import re
import sys

from .continue_policy import env_float


def _bad_env(name: str, raw: str, default: float) -> None:
    """A malformed value is logged, not silently replaced (U23): this module loads before
    the worker's ``log`` exists, so the line goes to stderr in the same JSON shape."""
    print(json.dumps({"ev": "bad_env", "name": name, "value": raw[:40], "using": default}),
          file=sys.stderr, flush=True)


def _spend_env(name: str, default: float) -> float:
    return env_float(name, default, on_error=_bad_env)


# USD per 1M tokens. `eval/harness`'s `e2e/pricing.py` stays a second, genuinely separate
# copy -- the worker image carries no `eval/` -- pinned against this one by
# `test_the_two_price_tables_share_three_rates_and_differ_by_cache_ttl`.
#
# Cache writes are the 5-minute rate (1.25x input), not the harness's 1-hour one (2x).
# The PROTOTYPE worker writes only 5-minute entries: it authenticates with an API key, its
# anthropic arm sets no TTL, and on the FamilySearch path agentgateway discards the TTL
# (upstream agentgateway #3670; handoff U23: 149k 5-minute write tokens metered $1.05 at
# the 1-hour rate where the CLI billed $0.72; at this rate they come to $0.71). The ALPHA
# writes 1-hour entries on its main thread when `Settings.prompt_cache_ttl_main` is "1h"
# (CLI >= 2.1.294); its credential proxy prices those by the response's own 5m/1h split
# (`price_usd(..., cache_write_1h=)`), so this default stays right for every other write.
# The e2e corpus runs on a subscription, where the CLI writes 1-hour entries, which is why
# the harness keeps $6.
#
# Env-overridable so an operator can re-price without a rebuild (compose passes each
# through), and guarded so a typo can neither crash-loop the reader (`env_float`) nor pass
# unseen (`_bad_env`).
PRICE_PER_MTOK = {
    "input": _spend_env("PRICE_INPUT_PER_MTOK", 3.0),
    "cache_write": _spend_env("PRICE_CACHE_WRITE_PER_MTOK", 3.75),
    "cache_read": _spend_env("PRICE_CACHE_READ_PER_MTOK", 0.30),
    "output": _spend_env("PRICE_OUTPUT_PER_MTOK", 15.0),
}

# The session bound. Per SESSION, not per run or per project: a project spans many
# sessions, so this caps one sitting and never the research. Sized against the committed
# e2e corpus (re-measured 2026-09-23: 161 runs, median $7.85, p90 $14.26, max $25.24), so
# $35 is about four median runs in one sitting and above the costliest ever recorded.
# `test_the_spend_cap_clears_the_costliest_run_in_the_corpus` re-derives that.
#
# It exists because continuous work removes the human who used to end a run by not
# clicking Continue. The nudge cap does not replace them: it is consulted only at a
# voluntary yield, 31% of runs never yield, and it resets on every attempt. There is
# deliberately no in-session grant flow: a session at the bound stops, and the way on is a
# new session on the same project. 0 switches the cap off.
#
# A trigger, not a ceiling: it is checked before each tool call, and a response is priced
# only once it lands, so a session closes above it by one tool-free stretch (a delegation
# composing its result): $0.05 to $0.56 over a $1 cap (U23, U13, U19; n=1 each).
SPEND_CAP_USD = _spend_env("SESSION_SPEND_CAP_USD", 35.0)

TOKEN_CLASSES = ("input", "cache_write", "cache_read", "output")
# A 1-hour cache write is 2x the input rate on every model (a 5-minute one 1.25x). Derived
# from `input` rather than stored as a rates key, so `rates_for(None) is PRICE_PER_MTOK`
# still holds and no reader can KeyError on a table that lacks it.
CACHE_WRITE_1H_INPUT_MULTIPLE = 2.0

# Each model's own input and output rate, USD per 1M tokens, for pricing a call by the
# model that made it (the alpha's credential proxy). On every model a 5-minute cache write
# is 1.25x input and a cache read 0.1x. The harness's `MODEL_RATES` is the other copy,
# pinned against this one by the same parity test as PRICE_PER_MTOK.
MODEL_RATES = {
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
    # The CLI's own small-model calls from 2.1.308. Prompts over 100K bill 5x; it sends none.
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-opus-4-8": (5.0, 25.0),
}
_DATED = re.compile(r"-\d{8}$")


def rates_for(model: str | None) -> dict[str, float]:
    """``model``'s rates, keyed like PRICE_PER_MTOK; PRICE_PER_MTOK itself for no model or
    one MODEL_RATES does not know. A dated id (``claude-haiku-4-5-20251001``) is its
    undated model."""
    base = MODEL_RATES.get(_DATED.sub("", model or ""))
    if base is None:
        return PRICE_PER_MTOK
    input_rate, output_rate = base
    return {"input": input_rate, "cache_write": 1.25 * input_rate,
            "cache_read": 0.1 * input_rate, "output": output_rate}


def cache_write_1h_rate(rates: dict[str, float]) -> float:
    """The 1-hour cache-write rate for one ``rates_for`` table, USD per 1M tokens."""
    return CACHE_WRITE_1H_INPUT_MULTIPLE * rates["input"]


def price_usd(tokens, model: str | None = None, cache_write_1h: int = 0) -> float:
    """Tokens (input, cache_write, cache_read, output) priced at ``rates_for(model)``:
    with no model, at PRICE_PER_MTOK. The first ``cache_write_1h`` of the cache writes are
    1-hour ones, priced at ``cache_write_1h_rate``; clamped to the write total, as the CLI's
    own cost line clamps it."""
    rates = rates_for(model)
    total = sum(
        (t or 0) / 1_000_000 * rates[name]
        for name, t in zip(TOKEN_CLASSES, tokens)
    )
    one_hour = min(max(cache_write_1h or 0, 0), tokens[1] or 0)
    if one_hour:
        total += one_hour / 1_000_000 * (cache_write_1h_rate(rates) - rates["cache_write"])
    return total


def usage_cache_write_1h(usage) -> int:
    """``cache_creation.ephemeral_1h_input_tokens`` out of one usage block, or 0. A dict or
    an attribute-carrying object, as ``usage_tokens`` accepts."""
    split = usage.get("cache_creation") if isinstance(usage, dict) \
        else getattr(usage, "cache_creation", None)
    value = split.get("ephemeral_1h_input_tokens") if isinstance(split, dict) \
        else getattr(split, "ephemeral_1h_input_tokens", None)
    return value if isinstance(value, int) and value > 0 else 0


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
