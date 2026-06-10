"""Tests for harness.judge — prompt rendering and response parsing.

The actual API call lives in the e2e test. These tests check the prompt
assembly, hash stability, and response decoding without spending a cent.
"""

from pathlib import Path
from types import SimpleNamespace

import pytest

from harness import judge
from harness.rubric import parse_rubric


REPO_ROOT = Path(__file__).resolve().parents[4]
# Use citation/ as the rubric fixture — it stays after the search-familysearch-wiki
# rubric deletion (citation is pure GPS craft, see phase-2 triage).
CITATION_RUBRIC = REPO_ROOT / "eval/tests/unit/citation/rubric.md"


@pytest.fixture
def sample_rubric():
    return parse_rubric(CITATION_RUBRIC.read_text())


def test_prompt_hash_is_sha256_hex():
    h = judge.judge_prompt_hash()
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)


def test_render_prompt_includes_all_slots(sample_rubric):
    prompt = judge.render_prompt(
        rubric=sample_rubric,
        judge_context=["Should save to a file"],
        scenario_readme="(stateless test)",
        user_message="Look up Ohio.",
        skills_invoked=["search-familysearch-wiki"],
        text_response="I saved the summary to ohio.md.",
        file_changes_summary="(no research.json changes)",
        tool_calls=[
            {
                "tool": "mcp__genealogy__wikipedia_search",
                "args": {"query": "Ohio"},
                "matched": {"kind": "predicate", "index": None},
                "response": {"title": "Ohio"},
            }
        ],
    )
    assert "Look up Ohio." in prompt
    assert "search-familysearch-wiki" in prompt
    assert "Should save to a file" in prompt
    assert "wikipedia_search" in prompt
    assert "Evidence Explained compliance" in prompt  # from citation rubric.md


def test_render_prompt_handles_empty_criteria(sample_rubric):
    prompt = judge.render_prompt(
        rubric=sample_rubric,
        judge_context=[],
        scenario_readme="",
        user_message="hi",
        skills_invoked=[],
        text_response="",
        file_changes_summary="",
        tool_calls=[],
    )
    assert "(none)" in prompt
    assert "(stateless test)" in prompt
    assert "(empty)" in prompt
    assert "(no file changes)" in prompt


def _base_dims_with_tool_arguments_null():
    """All three required base dimensions, Tool Arguments null (the
    no-MCP-calls happy path)."""
    return [
        {"source": "base", "name": "Correctness", "score": 3,
         "rationale": "everything checks out fine"},
        {"source": "base", "name": "Completeness", "score": 3,
         "rationale": "everything addressed cleanly"},
        {"source": "base", "name": "Tool Arguments", "score": None,
         "rationale": "no tool calls — N/A for this test"},
    ]


def test_extract_dimensions_happy_path():
    tool_block = SimpleNamespace(
        type="tool_use",
        name="submit_grading",
        input={"dimensions": _base_dims_with_tool_arguments_null()},
    )
    response = SimpleNamespace(content=[tool_block])
    dims = judge._extract_dimensions(response)
    names = [d["name"] for d in dims]
    assert names == ["Correctness", "Completeness", "Tool Arguments"]


def test_extract_dimensions_rejects_missing_tool_arguments():
    """Adding Tool Arguments as a required base dimension means the
    judge can no longer omit it."""
    bad = _base_dims_with_tool_arguments_null()[:2]  # drop Tool Arguments
    tool_block = SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": bad},
    )
    response = SimpleNamespace(content=[tool_block])
    with pytest.raises(judge.JudgeError, match="Tool Arguments"):
        judge._extract_dimensions(response)


def test_extract_dimensions_rejects_null_score_on_correctness():
    """Only Tool Arguments may be null. A null on Correctness signals
    the judge dodged a substantive dimension and is rejected."""
    dims = _base_dims_with_tool_arguments_null()
    dims[0]["score"] = None  # null Correctness
    tool_block = SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": dims},
    )
    response = SimpleNamespace(content=[tool_block])
    with pytest.raises(judge.JudgeError, match="null"):
        judge._extract_dimensions(response)


def test_extract_dimensions_accepts_integer_score_on_tool_arguments():
    """The null is permissive, not required — when MCP calls happened
    Tool Arguments should be 1/2/3 like any other dimension."""
    dims = _base_dims_with_tool_arguments_null()
    dims[2]["score"] = 2
    dims[2]["rationale"] = "one call had a wrong query phrasing"
    tool_block = SimpleNamespace(
        type="tool_use", name="submit_grading", input={"dimensions": dims},
    )
    response = SimpleNamespace(content=[tool_block])
    out = judge._extract_dimensions(response)
    ta = next(d for d in out if d["name"] == "Tool Arguments")
    assert ta["score"] == 2


def test_extract_dimensions_rejects_zero_tool_uses():
    response = SimpleNamespace(content=[SimpleNamespace(type="text", text="foo")])
    with pytest.raises(judge.JudgeError):
        judge._extract_dimensions(response)


def test_extract_dimensions_rejects_multiple_tool_uses():
    tu = SimpleNamespace(type="tool_use", name="submit_grading", input={"dimensions": []})
    response = SimpleNamespace(content=[tu, tu])
    with pytest.raises(judge.JudgeError):
        judge._extract_dimensions(response)


def test_extract_dimensions_rejects_wrong_tool_name():
    bad = SimpleNamespace(type="tool_use", name="other_tool", input={})
    response = SimpleNamespace(content=[bad])
    with pytest.raises(judge.JudgeError):
        judge._extract_dimensions(response)


def test_compute_cost_for_known_model():
    usage = SimpleNamespace(
        input_tokens=1000,
        cache_read_input_tokens=800,
        output_tokens=500,
    )
    response = SimpleNamespace(usage=usage)
    cost = judge._compute_cost(response, "claude-haiku-4-5-20251001")
    # 200 fresh input * $1/M + 800 cached * $0.10/M + 500 output * $5/M
    expected = (200 * 1.0 + 800 * 0.10 + 500 * 5.0) / 1_000_000
    assert cost == pytest.approx(expected)


def test_compute_cost_unknown_model_falls_back_to_default_and_warns(capsys):
    # Reset the per-process warn-once cache so this test is independent.
    judge._warned_about_pricing.discard("never-heard-of-it")
    usage = SimpleNamespace(
        input_tokens=1000,
        cache_read_input_tokens=0,
        output_tokens=500,
    )
    response = SimpleNamespace(usage=usage)
    cost = judge._compute_cost(response, "never-heard-of-it")
    # Default fallback is Sonnet-class rates.
    expected = (1000 * 3.0 + 500 * 15.0) / 1_000_000
    assert cost == pytest.approx(expected)
    err = capsys.readouterr().err
    assert "never-heard-of-it" in err
    assert "JUDGE_PRICING" in err


def test_known_extra_models_priced_nonzero():
    """Sonnet 4.6 and Opus 4.7 should have entries so explicit judge-model
    overrides produce non-zero cost."""
    for model in ("claude-sonnet-4-6", "claude-opus-4-7"):
        assert model in judge.JUDGE_PRICING
        assert judge.JUDGE_PRICING[model]["input"] > 0


def test_summarize_response_truncates_long_strings():
    long = "x" * (judge._RESPONSE_STRING_MAX + 100)
    out = judge._summarize_response(long)
    assert "truncated by harness" in out
    assert str(len(long)) in out  # full length surfaced


def test_summarize_response_short_string_unchanged():
    """A typical Wikipedia extract (~300 chars) must NOT be truncated."""
    assert judge._summarize_response("short") == "short"
    medium = "x" * 1500  # under the cap
    assert judge._summarize_response(medium) == medium


def test_summarize_response_dict_recurses():
    out = judge._summarize_response(
        {"a": "x" * (judge._RESPONSE_STRING_MAX + 1), "b": 42}
    )
    assert "truncated by harness" in out["a"]
    assert out["b"] == 42


def test_summarize_response_small_array_passed_through():
    """Arrays at or under the sample size are returned intact."""
    assert judge._summarize_response([1, 2, 3]) == [1, 2, 3]


def test_summarize_response_large_array_keeps_length_and_sample():
    arr = list(range(20))
    out = judge._summarize_response(arr)
    assert out["_summary_truncated"] is True
    assert out["_full_length"] == 20
    assert out["_first_n"] == [0, 1, 2]


def test_summarize_response_nested_array_in_dict():
    out = judge._summarize_response({"hits": [{"title": "X" * 5000}] * 10})
    assert out["hits"]["_full_length"] == 10
    assert "truncated by harness" in out["hits"]["_first_n"][0]["title"]


def test_render_prompt_uses_summarized_responses(sample_rubric):
    prompt = judge.render_prompt(
        rubric=sample_rubric,
        judge_context=[],
        scenario_readme="",
        user_message="x",
        skills_invoked=[],
        text_response="",
        file_changes_summary="",
        tool_calls=[
            {
                "tool": "mcp__genealogy__record_search",
                "args": {"q": "Flynn"},
                "matched": {"kind": "predicate", "index": None},
                "response": {"results": ["A" * 5000] * 50},  # huge
            }
        ],
    )
    # The 50-element array should be condensed with an explicit marker.
    assert "_summary_truncated" in prompt
    assert "_full_length" in prompt
    # The 5000-char string inside should also be flagged truncated.
    assert "truncated by harness" in prompt


def test_tool_calls_size_guard_drops_oldest_when_over_cap():
    """The total-size guard drops oldest tool calls when the rendered JSON
    exceeds _TOOL_CALLS_MAX_CHARS."""
    # Build many calls; each has a large response that survives the
    # per-response summariser (under 2KB strings), so the total grows linearly.
    calls = [
        {
            "tool": f"mcp__genealogy__tool_{i}",
            "args": {"q": f"call-{i}"},
            "matched": {"kind": "predicate", "index": None},
            "response": {"data": "x" * 1500},  # ~1500 chars per call
        }
        for i in range(100)  # ~150K chars total
    ]
    rendered = judge._render_tool_calls_with_size_guard(calls)
    assert "_dropped_for_size" in rendered
    # Should fit under the cap after dropping.
    assert len(rendered) <= judge._TOOL_CALLS_MAX_CHARS + 500  # +marker overhead


def test_tool_calls_no_drop_when_under_cap():
    calls = [
        {"tool": "mcp__genealogy__x", "args": {"q": "y"},
         "matched": {"kind": "predicate", "index": None},
         "response": {"title": "small"}}
    ]
    rendered = judge._render_tool_calls_with_size_guard(calls)
    assert "_dropped_for_size" not in rendered


def test_tool_calls_empty_returns_none_marker():
    assert judge._render_tool_calls_with_size_guard([]) == "(none)"


def test_render_prompt_parts_splits_at_context_boundary(sample_rubric):
    """The stable prefix ends at the per-test context boundary so the
    rubric (constant per skill) is cacheable."""
    prefix, suffix = judge.render_prompt_parts(
        rubric=sample_rubric,
        judge_context=["save to file"],
        scenario_readme="readme",
        user_message="look up X",
        skills_invoked=["citation"],
        text_response="text",
        file_changes_summary="changes",
        tool_calls=[],
    )
    # Prefix must contain rubric (stable) but NOT the per-test context (varying).
    assert "Evidence Explained compliance" in prefix  # rubric content
    assert "save to file" not in prefix
    # Suffix has the per-test content and starts at the context boundary.
    assert suffix.startswith("# Per-test context")
    assert "save to file" in suffix
    assert "look up X" in suffix


def test_render_prompt_concatenation_matches_parts(sample_rubric):
    """render_prompt() must equal prefix + suffix from render_prompt_parts."""
    kwargs = dict(
        rubric=sample_rubric,
        judge_context=[],
        scenario_readme="",
        user_message="x",
        skills_invoked=[],
        text_response="",
        file_changes_summary="",
        tool_calls=[],
    )
    prompt = judge.render_prompt(**kwargs)
    prefix, suffix = judge.render_prompt_parts(**kwargs)
    assert prompt == prefix + suffix


def test_grading_tool_schema_matches_spec():
    """The spec §7 defines the submit_grading schema; this test pins it."""
    schema = judge.GRADING_TOOL["input_schema"]
    assert schema["required"] == ["dimensions"]
    item_schema = schema["properties"]["dimensions"]["items"]
    assert set(item_schema["required"]) == {"source", "name", "score", "rationale"}
    assert set(item_schema["properties"]["source"]["enum"]) == {"base", "rubric"}
    # Score is `anyOf` — {1,2,3} integer OR null. Null is permitted only on
    # Tool Arguments; the per-name enforcement lives in _extract_dimensions.
    score_schema = item_schema["properties"]["score"]
    options = score_schema["anyOf"]
    enum_branch = next(b for b in options if "enum" in b)
    null_branch = next(b for b in options if b.get("type") == "null")
    assert set(enum_branch["enum"]) == {1, 2, 3}
    assert null_branch == {"type": "null"}
    assert item_schema["properties"]["rationale"]["minLength"] == 20
