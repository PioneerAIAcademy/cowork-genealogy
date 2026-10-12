"""Tests for `make e2e-agent-spend` — per-agent spend from `subagents[].usage`.

Both directions matter here. The report must refuse to print a number when its
input is absent (every run committed before #2582 carries no `subagents[].usage`,
and a cheerful `$0.00` there would be read as "this agent is free"), and it must
still print a real table the moment one priced spawn exists.
"""

from __future__ import annotations

import pytest

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


# T1.3: the busiest moment, the squeezes, and the model. Same doctrine as the
# spend columns — a spawn written before the fields existed is "not measured",
# never a zero, because a 0 peak would read as "this helper is tiny".


def test_shows_each_agents_busiest_moment_and_squeezes(tmp_path):
    paths = [
        _run(tmp_path, "fx", [
            {"agent_type": "record-extractor", "usage": _usage(), "models": ["claude-sonnet-4-6"],
             "peak_window_tokens": 180_000, "compactions": []},
            {"agent_type": "record-extractor", "usage": _usage(), "models": ["claude-sonnet-4-6"],
             "peak_window_tokens": 30_000,
             "compactions": [{"trigger": "auto", "pre_tokens": 167_000, "post_tokens": None}]},
            {"agent_type": "record-extractor", "usage": _usage(), "models": ["claude-sonnet-4-6"],
             "peak_window_tokens": 90_000, "compactions": []},
        ])
    ]
    text = format_report(*collect(paths))
    row = next(line for line in text.splitlines()
               if "record-extractor" in line and "180,000" in line)
    # The typical is the MIDDLE value of 30k / 90k / 180k (90k), not the
    # average (100k) — chosen so the two differ and a swap is caught.
    assert "90,000" in row
    assert "100,000" not in row
    assert "1 of 3" in row  # squeezed


def test_a_pre_change_spawn_is_not_measured_rather_than_a_zero_peak(tmp_path):
    paths = [
        _run(tmp_path, "fx", [
            {"agent_type": "image-reader", "usage": _usage(), "peak_window_tokens": 40_000,
             "compactions": []},
            {"agent_type": "image-reader", "usage": _usage()},
        ])
    ]
    text = format_report(*collect(paths))
    row = next(line for line in text.splitlines() if "image-reader" in line and "40,000" in line)
    assert "0 of 1" in row  # one measured spawn, not two
    assert "MEASURED: 1/2" in text


def test_says_so_when_no_spawn_carries_a_peak(tmp_path):
    """Priced but pre-T1.3: no peak table of zeros, a sentence instead."""
    paths = [_run(tmp_path, "fx", [{"agent_type": "image-reader", "usage": _usage()}])]
    text = format_report(*collect(paths))
    assert "No spawn records its busiest moment" in text
    assert " 0 of " not in text


def test_shows_the_models_each_agent_ran_on(tmp_path):
    paths = [
        _run(tmp_path, "fx", [
            {"agent_type": "gps-mentor", "usage": _usage(), "models": ["claude-sonnet-5"]},
            {"agent_type": "image-reader", "usage": _usage(), "models": ["claude-sonnet-4-6"]},
            {"agent_type": "image-reader", "usage": _usage(), "models": ["claude-haiku-4-5-20251001"]},
        ])
    ]
    text = format_report(*collect(paths))
    mentor = next(line for line in text.splitlines() if line.strip().startswith("gps-mentor"))
    reader = next(line for line in text.splitlines() if line.strip().startswith("image-reader"))
    assert "claude-sonnet-5" in mentor
    assert "claude-sonnet-4-6" in reader and "claude-haiku-4-5-20251001" in reader
    # Priced per model now (T1.11): the flat-rate disclaimer is gone, and the
    # agent that ran on two models gets a sub-row for each.
    assert "ONE flat Sonnet rate" not in text
    assert "its own model's rate" in text
    subrows = [line.split()[0] for line in text.splitlines() if line.startswith("      claude-")]
    assert subrows == ["claude-haiku-4-5", "claude-sonnet-4-6"]


def test_a_spawn_with_no_model_recorded_is_marked_unknown(tmp_path):
    paths = [_run(tmp_path, "fx", [{"agent_type": "image-reader", "usage": _usage()}])]
    text = format_report(*collect(paths))
    reader = next(line for line in text.splitlines() if line.strip().startswith("image-reader"))
    assert "(not recorded)" in reader


def _row(text, agent):
    return next(line.split() for line in text.splitlines() if line.strip().startswith(agent))


def test_a_helper_on_a_cheaper_model_shows_a_cheaper_row(tmp_path):
    """T1.11's done-when: identical tokens, a Haiku spawn costs a third of a
    Sonnet-4.6 one. Before per-model pricing both rows priced at the flat Sonnet
    table, so a model move showed no saving at all."""
    paths = [_run(tmp_path, "fx", [
        {"agent_type": "on-sonnet", "usage": _usage(), "models": ["claude-sonnet-4-6"]},
        {"agent_type": "on-haiku", "usage": _usage(), "models": ["claude-haiku-4-5-20251001"]},
    ])]
    text = format_report(*collect(paths))
    sonnet, haiku = float(_row(text, "on-sonnet")[2]), float(_row(text, "on-haiku")[2])
    assert haiku < sonnet
    assert haiku == pytest.approx(sonnet / 3, abs=0.001)


def test_a_model_without_a_rate_is_unpriced_not_zero_and_not_sonnet(tmp_path):
    paths = [_run(tmp_path, "fx", [
        {"agent_type": "mystery", "usage": _usage(), "models": ["claude-unknown-9"]},
        {"agent_type": "mystery", "usage": _usage(), "models": ["claude-sonnet-4-6"]},
    ])]
    per_agent, _ = collect(paths)
    assert per_agent["mystery"]["unpriced"] == {"no rate for claude-unknown-9": 1}
    assert len(per_agent["mystery"]["costs"]) == 1  # only the Sonnet spawn is priced
    text = format_report(*collect(paths))
    assert "1 spawn(s) — no rate for claude-unknown-9" in text


def test_a_mixed_model_spawn_is_unpriced_rather_than_guessed(tmp_path):
    paths = [_run(tmp_path, "fx", [{"agent_type": "x", "usage": _usage(),
                                     "models": ["claude-sonnet-4-6", "claude-haiku-4-5"]}])]
    assert collect(paths)[0]["x"]["unpriced"] == {"mixed models, not split": 1}


def test_a_spawn_with_no_model_keeps_the_flat_figure(tmp_path):
    """Every committed spawn today: no `models`. Its figure must not move."""
    from e2e import pricing

    paths = [_run(tmp_path, "fx", [{"agent_type": "old", "usage": _usage()}])]
    assert collect(paths)[0]["old"]["costs"] == [pricing.estimate_cost_usd(_usage())]
