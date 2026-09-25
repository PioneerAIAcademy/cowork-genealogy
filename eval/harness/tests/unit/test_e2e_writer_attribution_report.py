"""Unit tests for e2e.writer_attribution_report — observed writers vs the manifest.

The three verdicts are the whole point of the module, so each gets a test that
can only pass for the right reason: a listed caller, an unlisted one (the #2575
gap), and an `agent_type` that is not a shipped unit at all (#939's
`general-purpose`, which no manifest edit can ever close).
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from e2e.agent_tool_usage_report import scan
from e2e.writer_attribution_report import (
    classify,
    format_report,
    identifier_for,
    listed_writers,
    main,
    shipped_units,
    writer_tools,
)


def _write(dir_: Path, name: str, payload: dict) -> Path:
    path = dir_ / name
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _capture(agent_type, tools):
    """A `subagents[]` entry that called `tools` (each as one turn block)."""
    return {
        "agent_type": agent_type,
        "turns": [{"blocks": [f"tool_use:{t}" for t in tools]}],
    }


def _run(tmp_path: Path, slug: str, name: str, payload: dict) -> Path:
    d = tmp_path / slug
    d.mkdir(parents=True, exist_ok=True)
    return _write(d, name, payload)


# ── the manifest side ────────────────────────────────────────────────────────


def test_writer_tools_are_read_from_the_manifest_and_non_empty():
    tools = writer_tools()
    # Non-emptiness first: every way this reading can break returns a clean
    # empty set, which would make `classify` drop every pair and report nothing.
    assert tools
    assert "research_log_append" in tools
    assert "extraction_append" in tools
    # A reader, not a writer — it must not have leaked in from the tool list.
    assert "research_query" not in tools


def test_listed_writers_reads_all_three_caller_fields():
    listed = listed_writers()
    # `callers` — the five search/extraction skills on research.json#log.
    assert "skill:record-extraction" in listed["research_log_append"]
    # `agentCallers` — the direction #2575 added, paired with its tool.
    assert "agent:record-extractor" in listed["research_log_append"]
    # `hookCallers` — proof-conclusion is named there on proof_summaries.
    assert "agent:proof-conclusion" in listed["research_append"]


def test_shipped_units_carries_both_kinds():
    units = shipped_units()
    assert "agent:record-extractor" in units
    assert "skill:record-extraction" in units
    assert "agent:general-purpose" not in units
    assert "skill:general-purpose" not in units


def test_identifier_for_strips_a_namespaced_agent_type():
    units = shipped_units()
    assert identifier_for("record-extractor", units) == "agent:record-extractor"
    assert (
        identifier_for("genealogy-research:record-extractor", units)
        == "agent:record-extractor"
    )
    assert identifier_for("general-purpose", units) is None


# ── the three verdicts ───────────────────────────────────────────────────────


def test_a_listed_caller_is_classified_listed(tmp_path: Path):
    p = _run(tmp_path, "ferber-death", "run-1.json", {
        "subagents": [_capture("record-extractor", ["research_log_append"])],
    })
    pairs = classify(scan([p]), listed_writers(), shipped_units())
    assert [(x.identifier, x.tool, x.verdict) for x in pairs] == [
        ("agent:record-extractor", "research_log_append", "listed")
    ]
    assert pairs[0].calls == 1 and pairs[0].runs == 1


def test_an_unlisted_caller_is_classified_unlisted(tmp_path: Path):
    """The gap #2575 is about, forced with a listed set that omits the caller.

    Stubbing the manifest side rather than the plugin side is deliberate: the
    live manifest has no unlisted writer after this PR, so a test reading it
    could only ever assert the empty case — which passes just as well when
    `classify` is broken.
    """
    p = _run(tmp_path, "ferber-death", "run-1.json", {
        "subagents": [_capture("record-extractor", ["research_log_append"])],
    })
    narrowed = {"research_log_append": {"skill:record-extraction"}}
    pairs = classify(scan([p]), narrowed, shipped_units())
    assert [(x.identifier, x.verdict) for x in pairs] == [
        ("agent:record-extractor", "unlisted")
    ]


def test_general_purpose_is_its_own_finding_not_a_manifest_gap(tmp_path: Path):
    p = _run(tmp_path, "antonio-lucas-spouse", "run-1.json", {
        "subagents": [_capture("general-purpose", ["extraction_append"])],
    })
    pairs = classify(scan([p]), listed_writers(), shipped_units())
    assert [(x.caller, x.identifier, x.verdict) for x in pairs] == [
        ("general-purpose", None, "unbound")
    ]


def test_non_writer_tools_are_dropped(tmp_path: Path):
    p = _run(tmp_path, "ferber-death", "run-1.json", {
        "subagents": [_capture("record-extractor", ["record_read", "place_search"])],
    })
    assert classify(scan([p]), listed_writers(), shipped_units()) == []


# ── counting ─────────────────────────────────────────────────────────────────


def test_calls_and_runs_count_separately(tmp_path: Path):
    """Two runs, three invocations — the pair is one row, not three."""
    a = _run(tmp_path, "ferber-death", "run-1.json", {
        "subagents": [_capture("record-extractor", ["research_log_append"] * 2)],
    })
    b = _run(tmp_path, "mcaloney-mother", "run-1.json", {
        "subagents": [_capture("record-extractor", ["research_log_append"])],
    })
    pairs = classify(scan([a, b]), listed_writers(), shipped_units())
    assert len(pairs) == 1
    assert pairs[0].calls == 3
    assert pairs[0].runs == 2


def test_two_runs_of_one_fixture_count_as_two(tmp_path: Path):
    """Both runs in ONE slug directory, which is the shape that caught a bug.

    39 of the 108 committed fixture directories hold more than one run (up to 9),
    so keying run identity on the parent directory counts FIXTURES and reports
    them as runs. The sibling test above puts its two runs in two different slug
    dirs, so it passes under either meaning and cannot see this.
    """
    a = _run(tmp_path, "ferber-death", "run-2026-09-01_00-00-00.json", {
        "subagents": [_capture("record-extractor", ["research_log_append"])],
    })
    b = _run(tmp_path, "ferber-death", "run-2026-09-02_00-00-00.json", {
        "subagents": [_capture("record-extractor", ["research_log_append"])],
    })
    pairs = classify(scan([a, b]), listed_writers(), shipped_units())
    assert len(pairs) == 1
    assert pairs[0].calls == 2
    assert pairs[0].runs == 2


def test_a_toolcalls_only_pair_has_runs_and_no_calls(tmp_path: Path):
    """The #1027 attribution path carries no invocation count of its own.

    A pair recovered only there reports 0 calls and 1 run, which is the honest
    reading — not a gap. Pinned because the obvious "fix" is to sum the two
    sources, which double-counts every capture `tool_calls` also attributed.
    """
    p = _run(tmp_path, "ferber-death", "run-1.json", {
        "subagents": [],
        "tool_calls": [
            {
                "tool": "mcp__genealogy__research_log_append",
                "agent_type": "record-extractor",
            }
        ],
    })
    pairs = classify(scan([p]), listed_writers(), shipped_units())
    assert len(pairs) == 1
    assert pairs[0].calls == 0
    assert pairs[0].runs == 1


# ── output + CLI ─────────────────────────────────────────────────────────────


def test_format_report_names_each_pair_and_says_when_there_are_none(tmp_path: Path):
    p = _run(tmp_path, "antonio-lucas-spouse", "run-1.json", {
        "subagents": [
            _capture("record-extractor", ["research_log_append"]),
            _capture("general-purpose", ["extraction_append"]),
        ],
    })
    s = scan([p])
    out = format_report(classify(s, listed_writers(), shipped_units()), s)
    assert "UNLISTED" in out and "(none)" in out
    assert "general-purpose -> extraction_append" in out
    assert "agent:record-extractor -> research_log_append" in out
    # The unbound note has to say it is not waivable, or the next reader files a
    # manifest row for `general-purpose` that can never resolve.
    assert "cannot be listed in any row" in out


def test_main_returns_1_and_names_the_branch_scope_on_an_empty_corpus(capsys):
    assert main(["--test", "no-such-fixture-slug-exists"]) == 1
    assert "No committed runs found" in capsys.readouterr().err


def test_main_reads_the_whole_corpus_by_default(tmp_path: Path, monkeypatch, capsys):
    """`--since` defaults to `all` here, unlike every other e2e reader.

    On a tmp corpus, not the committed one, and with a run dated years back: a
    run whose filename carries no date passes any window, so an undated fixture
    would pass under the 14-day default too and pin nothing.
    """
    import e2e.runlog_selection as selection

    payload = {"subagents": [_capture("record-extractor", ["research_log_append"])]}
    _run(tmp_path, "old-fixture", "run-2020-01-01_00-00-00.json", payload)
    _run(tmp_path, "new-fixture", f"run-{date.today().isoformat()}_00-00-00.json", payload)
    monkeypatch.setattr(selection, "E2E_RUNLOGS", tmp_path)

    assert main([]) == 0
    assert "entire corpus (2 run(s))" in capsys.readouterr().out
    # The negative control: the house window on the same corpus drops the old run.
    assert main(["--since", "14"]) == 0
    assert "1 of 2 run(s)" in capsys.readouterr().out


def test_an_agent_caller_counts_only_for_the_tools_its_entry_names():
    # `agent:record-extractor` is an `agentCallers` entry on tree `persons`,
    # whose `writerTools` lists all eight tree writers. Paired with
    # `extraction_append` alone, it must not come out listed for the others.
    listed = listed_writers()
    assert "agent:record-extractor" in listed["extraction_append"]
    assert "agent:record-extractor" not in listed["tree_forget"]
    # A permission field still counts for every writer tool on its row.
    assert "skill:tree-edit" in listed["tree_forget"]


def test_two_spellings_of_one_agent_are_one_pair(tmp_path: Path):
    """Production reports `genealogy-research:<name>` beside the bare name."""
    p = _run(tmp_path, "ferber-death", "run-1.json", {
        "subagents": [
            _capture("record-extractor", ["research_log_append"]),
            _capture("genealogy-research:record-extractor", ["research_log_append"]),
        ],
    })
    pairs = [
        pr for pr in classify(scan([p]), listed_writers(), shipped_units())
        if pr.tool == "research_log_append"
    ]
    assert len(pairs) == 1
    assert pairs[0].identifier == "agent:record-extractor"
    assert pairs[0].calls == 2
    assert pairs[0].runs == 1


def test_an_unbound_name_other_than_general_purpose_gets_no_939_explanation(tmp_path: Path):
    # A retired agent is not the #939 fallback; saying it is sends the reader
    # chasing a delegation-resolution bug that is not there.
    p = _run(tmp_path, "ferber-death", "run-1.json", {
        "subagents": [_capture("retired-extractor", ["research_log_append"])],
    })
    s = scan([p])
    out = format_report(classify(s, listed_writers(), shipped_units()), s)
    assert "retired-extractor -> research_log_append" in out
    assert "#939" not in out
    assert "renamed, retired, or never shipped" in out
