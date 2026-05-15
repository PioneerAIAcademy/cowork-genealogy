"""Tests for harness.fixtures — manifest building and predicate matching."""

import json
from pathlib import Path

import pytest

from harness.fixtures import (
    InvalidFixtureError,
    build_manifest,
    load_fixtures,
    matches,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURE_DIR = REPO_ROOT / "eval/fixtures/mcp"


# --- matches() ------------------------------------------------------------


def test_matches_no_predicate_keys():
    # Empty predicate: trivially matches anything.
    assert matches({}, {"any": "args"})


def test_matches_top_level_key():
    assert matches({"args.q": "Ohio"}, {"q": "Ohio"})
    assert not matches({"args.q": "Ohio"}, {"q": "Texas"})


def test_matches_missing_key():
    assert not matches({"args.q": "Ohio"}, {})
    assert not matches({"args.q": "Ohio"}, {"other": "value"})


def test_matches_nested_path():
    assert matches({"args.payload.id": 42}, {"payload": {"id": 42}})
    assert not matches({"args.payload.id": 42}, {"payload": {"id": 43}})


def test_matches_substring_with_tilde_prefix():
    assert matches({"args.q": "~Ohio"}, {"q": "Cincinnati, Ohio"})
    # Case-insensitive
    assert matches({"args.q": "~OHIO"}, {"q": "cincinnati, ohio"})
    assert not matches({"args.q": "~Iowa"}, {"q": "Cincinnati, Ohio"})


def test_matches_multi_key_all_must_match():
    pred = {"args.q": "Ohio", "args.year": 1860}
    assert matches(pred, {"q": "Ohio", "year": 1860})
    assert not matches(pred, {"q": "Ohio", "year": 1850})
    assert not matches(pred, {"q": "Texas", "year": 1860})


def test_matches_handles_args_prefix_correctly():
    # The dotted path may or may not start with "args." — spec strips it.
    assert matches({"q": "Ohio"}, {"q": "Ohio"})
    assert matches({"args.q": "Ohio"}, {"q": "Ohio"})


def test_matches_non_dict_intermediate_returns_false():
    # args.foo.bar against args = {foo: "string"} should fail gracefully.
    assert not matches({"args.foo.bar": 1}, {"foo": "scalar"})


# --- build_manifest() -----------------------------------------------------


def test_build_manifest_groups_by_tool():
    fixtures = [
        {"tool": "wikipedia_search", "response": {"title": "A"}},
        {"tool": "wikipedia_search", "response": {"title": "B"}},
        {"tool": "places", "response": {"results": []}},
    ]
    m = build_manifest(fixtures)
    assert set(m.keys()) == {"wikipedia_search", "places"}
    assert len(m["wikipedia_search"]["queue"]) == 2
    assert len(m["places"]["queue"]) == 1


def test_build_manifest_splits_predicated_and_queue():
    fixtures = [
        {"tool": "search", "when": {"args.q": "Ohio"}, "response": {"hits": 1}},
        {"tool": "search", "response": {"hits": 0}},  # fallback
    ]
    m = build_manifest(fixtures)
    assert len(m["search"]["predicated"]) == 1
    assert len(m["search"]["queue"]) == 1


def test_build_manifest_rejects_fixture_without_tool():
    with pytest.raises(InvalidFixtureError):
        build_manifest([{"response": {}}])


def test_build_manifest_rejects_fixture_without_response():
    with pytest.raises(InvalidFixtureError):
        build_manifest([{"tool": "x"}])


# --- load_fixtures() ------------------------------------------------------


def test_load_real_seed_fixture():
    fixtures = load_fixtures(["wikipedia-schuylkill-county"], FIXTURE_DIR)
    assert len(fixtures) == 1
    assert fixtures[0]["tool"] == "wikipedia_search"
    assert "extract" in fixtures[0]["response"]


def test_load_missing_fixture_raises():
    with pytest.raises(InvalidFixtureError):
        load_fixtures(["does-not-exist"], FIXTURE_DIR)


def test_load_multiple_fixtures_preserves_order():
    fixtures = load_fixtures(
        ["wikipedia-schuylkill-county", "places-schuylkill-county"], FIXTURE_DIR
    )
    assert fixtures[0]["tool"] == "wikipedia_search"
    assert fixtures[1]["tool"] == "places"
