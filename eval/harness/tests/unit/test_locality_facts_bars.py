"""`e2e.locality_facts bars`: the recall bars pass and fail on what a run's entry, its stored link
rows and its survey answer carry, with years kept apart."""

import json

from e2e.locality_facts import bars, survey_calls

FACTS = {
    "fx::Place": {
        "fixture": "fx",
        "facts": {"collection:1473014": 2, "name:County Record Office": 1, "url:https://bmd.example.org": 1, "year:1837": 1},
    }
}


def _run(tmp_path, locality, stored=None, survey_args=None):
    d = tmp_path / "runs" / "fx"
    d.mkdir(parents=True, exist_ok=True)
    doc = {
        "final_research": {"localities": [locality]},
        "final_external_collections": stored,
        "tool_calls": [{"tool": "mcp__genealogy__locality_survey", "args": survey_args or {"standardPlace": "P"}}],
    }
    (d / "run-2026-11-20_10-00-00.json").write_text(json.dumps(doc), encoding="utf-8")
    return tmp_path / "runs"


def _capture(tmp_path, inline, full):
    c = tmp_path / "cap"
    c.mkdir(exist_ok=True)
    (c / "0.json").write_text(json.dumps({"inline": inline, "full": full}), encoding="utf-8")
    return c


def test_passes_when_the_entry_carries_every_non_year_fact(tmp_path):
    loc = {"id": "loc_001", "collections": [{"id": "1473014"}],
           "repositories": [{"name": "County Record Office", "url": "https://bmd.example.org"}]}
    assert bars(FACTS, _run(tmp_path, loc), None, None)


def test_a_missing_year_does_not_count_against_the_bars(tmp_path):
    loc = {"id": "loc_001", "collections": [{"id": "1473014"}],
           "repositories": [{"name": "County Record Office", "url": "https://bmd.example.org"}]}
    assert "1837" not in json.dumps(loc)
    assert bars(FACTS, _run(tmp_path, loc), None, None)


def test_fails_when_the_entry_lacks_them(tmp_path):
    assert not bars(FACTS, _run(tmp_path, {"id": "loc_001"}), None, None)


def test_the_stored_link_rows_count_as_available(tmp_path):
    loc = {"id": "loc_001", "collections": [{"id": "1473014"}], "repositories": [{"name": "County Record Office"}]}
    stored = {"places": {"P": {"rows": [{"url": "https://bmd.example.org"}]}}}
    assert not bars(FACTS, _run(tmp_path, loc), None, None)
    assert bars(FACTS, _run(tmp_path, loc, stored), None, None)


def test_a_fact_fetched_but_cut_from_the_agent_view_fails_the_cut_bar(tmp_path):
    runs = _run(tmp_path, {"id": "loc_001", "collections": [{"id": "1473014"}]})
    calls = survey_calls(FACTS, runs)
    assert len(calls) == 1
    full = {"wikiPages": {"online_records": {"content": "County Record Office https://bmd.example.org 1473014"}}}
    cap = _capture(tmp_path, inline={"collections": "1473014"}, full=full)
    assert not bars(FACTS, runs, calls, cap)
