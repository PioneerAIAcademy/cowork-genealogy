"""Tests for `make e2e-agent-spend` — per-agent spend from `subagents[].usage`.

Both directions matter here. The report must refuse to print a number when its
input is absent (every run committed before #2582 carries no `subagents[].usage`,
and a cheerful `$0.00` there would be read as "this agent is free"), and it must
still print a real table the moment one priced spawn exists.
"""

from __future__ import annotations

from e2e.agent_spend_report import collect, format_report


def _usage(output_tokens=1000, cache_read=50_000):
    return {
        "input_tokens": 10,
        "output_tokens": output_tokens,
        "cache_read_input_tokens": cache_read,
        "cache_creation_input_tokens": 2_000,
    }


def _run(tmp_path, slug, subagents, name="run-2026-10-02_00-00-00.json"):
    import json

    d = tmp_path / slug
    d.mkdir(parents=True, exist_ok=True)
    p = d / name
    p.write_text(json.dumps({"subagents": subagents}), encoding="utf-8")
    return p


def test_reports_nothing_rather_than_zero_when_no_spawn_carries_usage(tmp_path):
    """The pre-#2582 corpus. A `$0.00` row here would be a lie about a real cost."""
    paths = [_run(tmp_path, "fx", [{"agent_type": "record-extractor", "turns": [{}]}])]
    text = format_report(*collect(paths))

    assert "NONE of the 1 spawn(s) carries" in text
    assert "0.00" not in text


def test_reports_nothing_when_the_corpus_itself_is_empty():
    """A report that cannot see its input must say so, not print a clean pass."""
    text = format_report(*collect([]))
    assert "NO SUBAGENT SPAWNS FOUND" in text
    assert "proves nothing" in text


def test_prices_each_agent_once_a_spawn_carries_usage(tmp_path):
    paths = [
        _run(
            tmp_path,
            "fx",
            [
                {"agent_type": "record-extractor", "usage": _usage(), "num_assistant_turns": 9},
                {"agent_type": "image-reader", "usage": _usage(100, 1_000), "num_assistant_turns": 2},
            ],
        )
    ]
    per_agent, counters = collect(paths)
    text = format_report(per_agent, counters)

    assert counters["subagents_with_usage"] == 2
    assert "record-extractor" in text and "image-reader" in text
    # The dearer agent sorts first — that ordering IS the report's purpose.
    assert text.index("record-extractor") < text.index("image-reader")
    assert per_agent["record-extractor"]["costs"][0] > per_agent["image-reader"]["costs"][0]


def test_counts_a_pre_change_spawn_as_uncovered_not_as_zero(tmp_path):
    """A mixed corpus must say what share it could price, so a partial number is
    never read as a whole one."""
    paths = [
        _run(tmp_path, "fx", [
            {"agent_type": "record-extractor", "usage": _usage()},
            {"agent_type": "record-extractor"},
        ])
    ]
    text = format_report(*collect(paths))
    assert "COVERAGE: 1/2 spawns priced (50%)" in text


def test_never_claims_a_violation_is_attributed_to_an_agent(tmp_path):
    """Violations are tallied by RULE; some rule names merely match an agent's.
    Presenting that as attribution is how a confident wrong number gets quoted."""
    paths = [_run(tmp_path, "fx", [{"agent_type": "proof-conclusion", "usage": _usage()}])]
    text = format_report(*collect(paths))
    assert "NOT joined here" in text


def test_surfaces_the_per_agent_trouble_flags_that_are_a_real_join(tmp_path):
    paths = [
        _run(tmp_path, "fx", [
            {"agent_type": "record-extractor", "usage": _usage(),
             "runaway_thinking": True, "hit_output_cap": True},
        ])
    ]
    text = format_report(*collect(paths))
    assert "runaway" in text
    assert "none — no spawn" not in text


def test_an_unreadable_run_log_is_counted_not_swallowed(tmp_path):
    bad = tmp_path / "fx" / "run-2026-10-02_00-00-01.json"
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_text("{not json", encoding="utf-8")
    _, counters = collect([bad])
    assert counters["unreadable"] == 1
