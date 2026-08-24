"""Token accounting for one skill run — orchestrator._skill_tokens.

The bug these pin: the harness read its token counts from the SDK
ResultMessage's `usage` block, which the CLI documents as possibly carrying a
per-turn main-loop value, while taking its cost from `total_cost_usd`, which
covers the whole query pipeline. A skill that delegates to a plugin agent
therefore logged the agent's cost and none of its tokens — measured as a 72%
"drop" in output tokens across the `research-exhaustiveness` fold that was
really the subagent going uncounted.
"""

from harness.orchestrator import _skill_tokens


def _ledger(**models):
    return {"model_usage": dict(models)}


def _entry(inp=0, read=0, write=0, out=0):
    return {
        "inputTokens": inp,
        "cacheReadInputTokens": read,
        "cacheCreationInputTokens": write,
        "outputTokens": out,
    }


# --- The delegating case, which is the whole point ----------------------


def test_a_subagents_tokens_are_counted_not_dropped():
    """Two models in the ledger — main thread plus a pinned plugin agent."""
    usage = _ledger(
        **{
            "claude-opus-5": _entry(inp=100, read=1_000, write=500, out=2_000),
            "claude-sonnet-4-6": _entry(inp=50, read=900, write=400, out=8_000),
        }
    )
    inp, read, write, out, per_model = _skill_tokens(usage)
    assert out == 10_000, "the agent's 8,000 output tokens must be in the total"
    assert (inp, read, write) == (150, 1_900, 900)
    assert set(per_model) == {"claude-opus-5", "claude-sonnet-4-6"}


def test_the_ledger_wins_over_the_main_loop_usage_block():
    """Both present and disagreeing: `model_usage` is authoritative.

    Without this the pre-fix reading survives whenever the SDK happens to
    populate both, which is the normal success path.
    """
    usage = {
        "usage": {
            "input_tokens": 5,
            "cache_read_input_tokens": 10,
            "output_tokens": 20,
        },
        "model_usage": {"claude-opus-5": _entry(inp=100, read=1_000, write=7, out=9_000)},
    }
    assert _skill_tokens(usage)[:4] == (100, 1_000, 7, 9_000)


def test_cache_writes_are_reported():
    """Cache writes are priced ~12x cache reads; a log without them cannot be
    reconciled against its own cost."""
    assert _skill_tokens(_ledger(m=_entry(write=4_242)))[2] == 4_242


# --- Fallback, for old CLIs and the abort path --------------------------


def test_falls_back_to_the_usage_block_when_there_is_no_ledger():
    usage = {
        "usage": {
            "input_tokens": 7,
            "cache_read_input_tokens": 8,
            "output_tokens": 9,
        }
    }
    assert _skill_tokens(usage) == (7, 8, 0, 9, {})


def test_the_fallback_reports_zero_cache_writes_rather_than_guessing():
    """`usage` carries no cache-write key at all, so there is nothing to read."""
    assert _skill_tokens({"usage": {"output_tokens": 1}})[2] == 0


def test_an_empty_ledger_is_not_treated_as_authoritative():
    """`model_usage: {}` is the abort path, not a run that used no tokens."""
    usage = {"usage": {"output_tokens": 11}, "model_usage": {}}
    assert _skill_tokens(usage)[3] == 11


def test_a_usageless_run_is_all_zeros():
    assert _skill_tokens({}) == (0, 0, 0, 0, {})


# --- Malformed input must never take down a paid run --------------------


def test_a_junk_ledger_entry_is_skipped_not_crashed_on():
    usage = _ledger(good=_entry(out=5), broken="not-a-dict")
    assert _skill_tokens(usage)[3] == 5


def test_non_integer_and_boolean_token_values_are_ignored():
    """`True` is an int in Python; counting it would silently add 1."""
    usage = _ledger(m={"outputTokens": True, "inputTokens": "12", "cacheReadInputTokens": 3})
    inp, read, _write, out, _ = _skill_tokens(usage)
    assert (inp, read, out) == (0, 3, 0)
