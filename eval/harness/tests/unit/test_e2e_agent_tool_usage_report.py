"""Unit tests for e2e.agent_tool_usage_report — declared-vs-called per plugin agent."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from e2e.agent_tool_usage_report import (
    BUILTIN_TOOLS,
    bare_tool_name,
    declared_tools_by_agent,
    diff_agents,
    format_report,
    main,
    scan,
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


# ── the used side: two sources, unioned ──────────────────────────────────────


def test_scan_unions_tools_from_capture_turn_blocks(tmp_path: Path):
    _write(tmp_path, "run-1.json", {
        "subagents": [
            _capture("record-extractor", ["record_read", "project_context"]),
            _capture("record-extractor", ["extraction_append"]),
        ],
    })
    s = scan([tmp_path / "run-1.json"])
    assert s.used["record-extractor"] == {
        "record_read", "project_context", "extraction_append"
    }
    assert s.captures["record-extractor"] == 2
    assert s.with_captures == 1


def test_used_set_unions_toolcalls_when_capture_is_empty(tmp_path: Path):
    """A run with `subagents: []` whose `tool_calls` still attribute (#1027) —
    the reason both sources are unioned rather than trusting the capture alone."""
    _write(tmp_path, "run-1.json", {
        "subagents": [],
        "tool_calls": [
            {"tool": "mcp__genealogy__research_query", "agent_type": "gps-mentor"},
            {"tool": "mcp__genealogy__project_context", "agent_type": "gps-mentor"},
            {"tool": "mcp__genealogy__record_read"},  # unattributed — main thread
        ],
    })
    s = scan([tmp_path / "run-1.json"])
    # tool_calls attribution bare-names and collapses the mcp__ prefix.
    assert s.used["gps-mentor"] == {"research_query", "project_context"}
    assert "record_read" not in s.used.get("gps-mentor", set())
    # This is an empty-capture run recovered purely by tool_calls.
    assert s.with_captures == 0
    assert s.empty_captures == 1
    assert s.recovered_by_toolcalls == 1


def test_capture_with_no_agent_type_is_skipped_not_crashed_on(tmp_path: Path):
    """A capture the SDK wrote without an agent_type can't be attributed — it must
    be dropped, not raise, and not inflate any agent's used set."""
    _write(tmp_path, "run-1.json", {
        "subagents": [
            {"turns": [{"blocks": ["tool_use:record_read"]}]},  # no agent_type
            _capture("record-extractor", ["project_context"]),
        ],
    })
    s = scan([tmp_path / "run-1.json"])
    assert s.used == {"record-extractor": {"project_context"}}


def test_scan_reports_unreadable_files_instead_of_crashing(tmp_path: Path):
    good = _write(tmp_path, "run-1.json", {"subagents": [_capture("gps-mentor", ["x"])]})
    bad = tmp_path / "run-2.json"
    bad.write_text("{not json", encoding="utf-8")
    s = scan([good, bad])
    assert s.runs == 1
    assert len(s.problems) == 1 and "run-2.json" in s.problems[0]


def test_scan_tolerates_malformed_shapes_without_killing_the_report(tmp_path: Path):
    """`subagents: [null]` and a non-list `tool_calls` are handled in-line (the
    per-entry `isinstance` guards skip them), so those runs still count — better
    than the pre-fix behavior where the reads sat outside the try and one bad file
    aborted the whole corpus (finding 2)."""
    good = _write(tmp_path, "run-1.json", {"subagents": [_capture("gps-mentor", ["x"])]})
    null_sub = _write(tmp_path, "run-2.json", {"subagents": [None]})
    bad_tc = _write(tmp_path, "run-3.json", {"subagents": [], "tool_calls": "oops"})
    s = scan([good, null_sub, bad_tc])
    assert s.runs == 3 and s.problems == []  # none fatal
    assert s.used == {"gps-mentor": {"x"}}  # the null/str shapes contribute nothing


def test_scan_try_catches_a_shape_the_guards_do_not_cover(tmp_path: Path):
    """The try is the backstop for a shape the in-line guards miss — a turn that
    is not a dict makes `_tools_from_capture` raise `AttributeError`. It must skip
    one file and land in `problems`, not abort. `TypeError` is in the `except`
    for the same reason `corpus_report` includes it."""
    good = _write(tmp_path, "run-1.json", {"subagents": [_capture("gps-mentor", ["x"])]})
    bad = _write(tmp_path, "run-2.json", {
        "subagents": [{"agent_type": "gps-mentor", "turns": [42]}],  # 42.get(...) raises
    })
    s = scan([good, bad])
    assert s.runs == 1 and s.used == {"gps-mentor": {"x"}}
    assert len(s.problems) == 1 and "run-2.json" in s.problems[0]


def test_errored_toolcall_does_not_count_as_used(tmp_path: Path):
    """A `tool_calls` entry the runlog marked `is_error` did not work — it must
    not read as `used`, or a failed/denied call masks a never-worked tool and a
    denied write surfaces as "allow-list not binding" (finding 1)."""
    _write(tmp_path, "run-1.json", {
        "subagents": [],
        "tool_calls": [
            {"tool": "mcp__genealogy__wiki_search", "agent_type": "gps-mentor",
             "is_error": True},
            {"tool": "mcp__genealogy__research_query", "agent_type": "gps-mentor"},
        ],
    })
    s = scan([tmp_path / "run-1.json"])
    assert s.used["gps-mentor"] == {"research_query"}  # the errored wiki_search dropped


def test_captures_without_agent_type_still_count_as_a_delegation(tmp_path: Path):
    """A run whose only captures lack an agent_type (a missing .meta.json sibling)
    is a captured delegation, not `subagents: []`. Bucketing it as empty misreports
    a delegation as none (finding 3)."""
    _write(tmp_path, "run-1.json", {
        "subagents": [{"turns": [{"blocks": ["tool_use:record_read"]}]}],  # no agent_type
    })
    s = scan([tmp_path / "run-1.json"])
    assert (s.with_captures, s.empty_captures, s.no_field) == (1, 0, 0)


def test_scan_counts_the_three_coverage_buckets(tmp_path: Path):
    paths = [
        _write(tmp_path, "run-1.json", {"subagents": [_capture("gps-mentor", ["x"])]}),
        _write(tmp_path, "run-2.json", {"subagents": []}),
        _write(tmp_path, "run-3.json", {"verdict": "pass"}),  # no subagents field
    ]
    s = scan(paths)
    assert (s.runs, s.with_captures, s.empty_captures, s.no_field) == (3, 1, 1, 1)


# ── the declared side: dual spellings collapse ───────────────────────────────


def test_declared_tools_collapse_dual_spellings(tmp_path: Path):
    (tmp_path / "demo.md").write_text(
        "---\n"
        "name: demo\n"
        "tools:\n"
        "  - Read\n"
        "  - mcp__genealogy__record_read\n"
        "  - mcp__remote-devices__Genealogy_Research__record_read\n"
        "---\nbody\n",
        encoding="utf-8",
    )
    declared = declared_tools_by_agent(agents_dir=tmp_path)
    # Both server spellings collapse to one bare `record_read`; `Read` passes through.
    assert declared == {"demo": {"Read", "record_read"}}


def test_bare_tool_name_strips_only_the_mcp_prefix():
    assert bare_tool_name("mcp__genealogy__record_read") == "record_read"
    assert bare_tool_name("mcp__remote-devices__Genealogy_Research__x") == "x"
    assert bare_tool_name("Read") == "Read"


def test_declared_matches_the_real_committed_agents():
    """The frontmatter `name` values must be the exact `agent_type` strings the
    corpus records, or every diff silently misses. Pins the real four."""
    declared = declared_tools_by_agent()
    assert {"gps-mentor", "record-extractor", "image-reader", "image-reader-opus"} <= set(
        declared
    )
    assert {"wiki_place_page", "wiki_search"} <= declared["gps-mentor"]


# ── the diff: three-way split + the non-plugin carve-out ──────────────────────


def test_declared_never_used_is_named_individually(tmp_path: Path):
    _write(tmp_path, "run-1.json", {
        "subagents": [_capture("gps-mentor", ["research_query"])],
    })
    s = scan([tmp_path / "run-1.json"])
    declared = {"gps-mentor": {"research_query", "wiki_search", "wiki_place_page"}}
    diffs, _ = diff_agents(declared, s)
    (d,) = diffs
    assert d.declared_and_used == ["research_query"]
    # Named, sorted — not a count. This is the deliverable (#1084 candidates).
    assert d.declared_never_used == ["wiki_place_page", "wiki_search"]


def test_general_purpose_is_not_in_the_diff(tmp_path: Path):
    """`general-purpose` has no `tools:` frontmatter. Folding it into the diff
    makes its whole tool set "used-but-not-declared" and reads as *the allow-list
    is not binding at all* — false. It belongs in the separate section."""
    _write(tmp_path, "run-1.json", {
        "subagents": [
            _capture("record-extractor", ["record_read"]),
            _capture("general-purpose", ["tree_edit", "research_append"]),
        ],
    })
    s = scan([tmp_path / "run-1.json"])
    declared = {"record-extractor": {"record_read", "extraction_append"}}
    diffs, unattributed = diff_agents(declared, s)
    assert [d.agent for d in diffs] == ["record-extractor"]  # only the plugin agent
    assert unattributed == {"general-purpose": {"tree_edit", "research_append"}}


def test_builtin_used_not_declared_is_filtered(tmp_path: Path):
    """A built-in (`Read`) bypasses the MCP allow-list, so calling one an agent did
    not declare is NOT evidence of a non-binding grant. It must not surface in the
    used-but-not-declared column, or the invariant fires falsely. A real
    undeclared MCP call still surfaces."""
    _write(tmp_path, "run-1.json", {
        "subagents": [_capture("record-extractor", ["Read", "place_population"])],
    })
    s = scan([tmp_path / "run-1.json"])
    declared = {"record-extractor": {"record_read"}}
    diffs, _ = diff_agents(declared, s)
    (d,) = diffs
    assert "Read" not in d.used_not_declared  # built-in filtered
    assert d.used_not_declared == ["place_population"]  # real undeclared MCP call kept
    assert "Read" in BUILTIN_TOOLS


def test_agent_never_seen_in_a_run_is_reported_as_such(tmp_path: Path):
    """A declared agent absent from the whole window must not have its entire
    tools: list printed as "never called" — that reads as a defect when it is
    just no data."""
    _write(tmp_path, "run-1.json", {"subagents": [_capture("gps-mentor", ["x"])]})
    s = scan([tmp_path / "run-1.json"])
    declared = {"gps-mentor": {"x"}, "image-reader": {"image_transcribe"}}
    diffs, _ = diff_agents(declared, s)
    out = format_report(diffs, {}, s)
    assert "image-reader  (0 capture(s))" in out
    assert "nothing to diff" in out
    # image_transcribe must NOT be listed as declared-never-called.
    assert "declared, NEVER called (1): image_transcribe" not in out


# ── output + windowing ────────────────────────────────────────────────────────


def test_format_report_surfaces_never_called_and_the_unattributed_section(tmp_path: Path):
    _write(tmp_path, "run-1.json", {
        "subagents": [
            _capture("gps-mentor", ["research_query"]),
            _capture("general-purpose", ["tree_edit"]),
        ],
    })
    s = scan([tmp_path / "run-1.json"])
    declared = {"gps-mentor": {"research_query", "wiki_search"}}
    diffs, unattributed = diff_agents(declared, s)
    out = format_report(diffs, unattributed, s)
    assert "declared, NEVER called (1): wiki_search" in out
    assert "Unattributed delegations" in out
    assert "general-purpose" in out and "tree_edit" in out
    assert "Attribution coverage:" in out


def test_coverage_line_states_the_skipped_count_on_stdout(tmp_path: Path, capsys):
    """`describe_window` counts every windowed file; the coverage line counts only
    readable ones. Without naming the skipped count on stdout the two run totals
    silently disagree (finding 4) — the skip detail itself is on stderr."""
    import e2e.agent_tool_usage_report as r

    fixture = tmp_path / "fx"
    fixture.mkdir()
    good = _write(fixture, "run-2026-07-30_10-00-00.json",
                  {"subagents": [_capture("gps-mentor", ["research_query"])]})
    bad = fixture / "run-2026-07-30_11-00-00.json"
    bad.write_text("{not json", encoding="utf-8")

    orig = r.all_result_jsons
    r.all_result_jsons = lambda: [good, bad]
    try:
        assert main(["--since", "all"]) == 0
    finally:
        r.all_result_jsons = orig
    out = capsys.readouterr()
    assert "entire corpus (2 run(s))" in out.out  # describe_window: both files
    assert "of 1 readable run(s)" in out.out  # coverage: readable only
    assert "1 unreadable, excluded" in out.out  # reconciles the two
    assert "skip" in out.err


def test_since_rejects_a_malformed_window(capsys):
    for bad in ("2026-07-27_20:00:00", "07-27-2026", "yesterday"):
        with pytest.raises(SystemExit) as e:
            main(["--since", bad])
        assert e.value.code == 2
    assert "'all', a number of days, or YYYY-MM-DD" in capsys.readouterr().err


def test_since_windows_the_corpus(tmp_path: Path, capsys):
    import e2e.agent_tool_usage_report as r

    fixture = tmp_path / "fx"
    fixture.mkdir()
    early = _write(fixture, "run-2026-07-01_10-00-00.json",
                   {"subagents": [_capture("gps-mentor", ["research_query"])]})
    late = _write(fixture, "run-2026-07-30_10-00-00.json",
                  {"subagents": [_capture("gps-mentor", ["project_context"])]})

    orig = r.all_result_jsons
    r.all_result_jsons = lambda: [early, late]
    try:
        assert main(["--since", "2026-07-15"]) == 0
    finally:
        r.all_result_jsons = orig
    out = capsys.readouterr().out
    assert "Window: runs on/after 2026-07-15 — 1 of 2 run(s)" in out


def test_empty_corpus_is_a_failure_exit(tmp_path: Path, capsys):
    import e2e.agent_tool_usage_report as r

    orig = r.all_result_jsons
    r.all_result_jsons = lambda: []
    try:
        assert main(["--since", "all"]) == 1
    finally:
        r.all_result_jsons = orig
    assert "No committed runs found." in capsys.readouterr().err
