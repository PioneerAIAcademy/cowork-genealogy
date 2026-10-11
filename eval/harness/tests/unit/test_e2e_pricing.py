"""Tests for the per-model price table (T1.11) beside the flat corpus estimator.

The flat table stays the corpus estimator, so the first thing pinned is that a
Sonnet-4.6 spawn prices exactly as before. The second is the failure that would
hide a saving: a model the table does not know must price to None, never to the
Sonnet figure.
"""

from __future__ import annotations

import pytest

from e2e import pricing

BLOCKS = [
    {"input_tokens": 10, "output_tokens": 1_000, "cache_read_input_tokens": 50_000,
     "cache_creation_input_tokens": 2_000},
    {"input_tokens": 3, "output_tokens": 12_345, "cache_read_input_tokens": 1_234_567,
     "cache_creation_input_tokens": 98_765},
    {"output_tokens": 7},  # a missing field counts as 0, as in the flat estimator
]


@pytest.mark.parametrize("block", BLOCKS)
def test_sonnet_4_6_prices_exactly_as_the_flat_table(block):
    assert pricing.estimate_cost_for_model(block, "claude-sonnet-4-6") == pricing.estimate_cost_usd(block)


@pytest.mark.parametrize("block", BLOCKS)
def test_cheaper_models_price_at_their_own_fraction_of_sonnet_4_6(block):
    sonnet = pricing.estimate_cost_usd(block)
    assert pricing.estimate_cost_for_model(block, "claude-haiku-4-5") == pytest.approx(sonnet / 3)
    assert pricing.estimate_cost_for_model(block, "claude-sonnet-5") == pytest.approx(sonnet * 2 / 3)
    assert pricing.estimate_cost_for_model(block, "claude-sonnet-5-5") == pytest.approx(sonnet * 2 / 3)
    assert pricing.estimate_cost_for_model(block, "claude-opus-4-8") == pytest.approx(sonnet * 5 / 3)


def test_a_dated_model_id_prices_as_its_undated_name():
    assert pricing.canonical_model("claude-haiku-4-5-20251001") == "claude-haiku-4-5"
    assert pricing.canonical_model("claude-sonnet-4-6") == "claude-sonnet-4-6"
    block = BLOCKS[0]
    assert pricing.estimate_cost_for_model(block, "claude-haiku-4-5-20251001") == \
        pricing.estimate_cost_for_model(block, "claude-haiku-4-5")


@pytest.mark.parametrize("model", ["claude-unknown-9", "", None])
def test_an_unknown_model_prices_to_none_not_to_sonnet(model):
    assert pricing.estimate_cost_for_model(BLOCKS[0], model) is None


@pytest.mark.parametrize("block", [None, {}, {"input_tokens": 0, "output_tokens": 0}, "x"])
def test_a_block_with_no_tokens_is_unrecoverable_on_every_model(block):
    assert pricing.estimate_cost_for_model(block, "claude-haiku-4-5") is None
