"""Regression tests for the judge before-state summary.

`_summarize_before_state` exists so the judge can mechanically check
"references an id that isn't on file" / "fabricated a source" claims. That
check is only sound if the block shows *every* source id that was on file.

The generic `_summarize_response` samples any list longer than
`_RESPONSE_ARRAY_SAMPLE` (=3) down to its first three entries. Feeding the
before-state `sources` array through it unmodified silently dropped the 4th+
source, so the judge (and human annotators reading the same block) flagged a
correctly-cited later source — `src_004` / `S4` — as fabricated and failed
base Correctness. That was the root cause of flaky ut_validate_schema_007 /
ut_validate_schema_008. These tests pin the fix: the full id list must survive
regardless of how many sources exist.
"""

from harness.judge import _RESPONSE_ARRAY_SAMPLE
from harness.orchestrator import (
    _summarize_before_state,
    _summarize_before_state_sources,
)


def _sources(prefix: str, n: int) -> list[dict]:
    # Give each source a long field so the per-string cap could plausibly bite;
    # the ids must survive regardless.
    return [
        {"id": f"{prefix}{i:03d}", "citation": "x" * 100, "notes": "y" * 100}
        for i in range(1, n + 1)
    ]


def test_all_ids_survive_beyond_array_sample():
    n = _RESPONSE_ARRAY_SAMPLE + 1  # the boundary that used to drop the last id
    summary = _summarize_before_state_sources(_sources("src_", n))
    assert summary["count"] == n
    assert summary["all_ids"] == [f"src_{i:03d}" for i in range(1, n + 1)]
    # The last id — the one the array-sampler dropped — is present.
    assert f"src_{n:03d}" in summary["all_ids"]


def test_full_id_list_present_for_large_project():
    summary = _summarize_before_state_sources(_sources("src_", 25))
    assert summary["count"] == 25
    assert len(summary["all_ids"]) == 25


def test_before_state_block_shows_fourth_source_id():
    # The exact ut_validate_schema_007/008 shape: research.json has 4 src_ ids,
    # tree.gedcomx.json has 4 S ids. The 4th of each must be visible to the
    # judge or it will call a correct citation a fabrication.
    before = {
        "research_json": {"sources": _sources("src_", 4)},
        "tree_gedcomx_json": {"sources": _sources("S", 4)},
    }
    rendered = _summarize_before_state(before)
    assert "src_004" in rendered
    assert "S004" in rendered


def test_short_lists_still_complete():
    summary = _summarize_before_state_sources(_sources("src_", 2))
    assert summary["count"] == 2
    assert summary["all_ids"] == ["src_001", "src_002"]


def test_non_list_and_empty_are_safe():
    assert _summarize_before_state_sources([]) == {
        "count": 0,
        "all_ids": [],
        "detail": [],
    }
    # Defensive: a malformed (non-list) sources value must not raise, and every
    # field must agree — count/all_ids/detail all derive from the type-guarded
    # `items`, so a non-list yields an internally consistent empty block (not
    # count:0 with a populated detail).
    weird = _summarize_before_state_sources({"unexpected": "shape"})
    assert weird == {"count": 0, "all_ids": [], "detail": []}


def test_sources_without_ids_are_counted_not_listed():
    summary = _summarize_before_state_sources([{"citation": "no id here"}])
    assert summary["count"] == 1
    assert summary["all_ids"] == []


def test_none_before_state_returns_none_sentinel():
    assert _summarize_before_state(None) == "(none)"
    assert _summarize_before_state({}) == "(none)"


def test_ids_render_before_detail():
    before = {"research_json": {"sources": _sources("src_", 4)}}
    rendered = _summarize_before_state(before)
    # The complete id list must come before the (clippable) heavy detail sample.
    assert rendered.index("all_ids") < rendered.index("sample detail")


def test_all_ids_survive_when_detail_blows_the_prompt_budget(monkeypatch):
    # The prompt-size cap must trim the heavy detail, never the ids — otherwise
    # a late source id gets stranded and the fabrication misgrade returns. Shrink
    # the cap so the detail section overruns it while the ids stay complete.
    from harness import orchestrator

    monkeypatch.setattr(orchestrator, "_BEFORE_STATE_MAX_CHARS", 200)
    before = {
        "research_json": {"sources": _sources("src_", 10)},
        "tree_gedcomx_json": {"sources": _sources("S", 10)},
    }
    rendered = orchestrator._summarize_before_state(before)
    for i in range(1, 11):
        assert f"src_{i:03d}" in rendered
        assert f"S{i:03d}" in rendered
    assert "detail truncated by harness" in rendered
    assert "ids above are complete" in rendered
