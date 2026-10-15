"""`relay_fidelity_report.py`'s production arm over a frozen e2e fixture tree.

Hand-counted from `tests/fixtures/relay_fidelity_e2e/alpha/`:

  10-00-00  v8, relay repeats the agent's tail verbatim        -> exact
  11-00-00  v8, relay says only "Done."                        -> dropped
  12-00-00  v8, the tail appears ONLY in a `thread: "sub"`
            narration entry, main says "Done."                 -> dropped
  13-00-00  v8, the log truncated the return                   -> excluded
  14-00-00  v7                                                 -> unscorable

plus a `.ann.json` and a `.final-tree.gedcomx.json` sibling, which are NOT
run logs and must not be counted.

12-00-00 is the one that matters most: it is the over-fire case. A reader that
selects narration on `kind` alone, or that treats an untagged entry as main,
scores it `exact` -- crediting the relay with words only the subagent said,
which is the defect #3188 exists to catch, measuring itself.
"""

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent / "fixtures" / "relay_fidelity_e2e"
SCRIPT = HERE.parent.parent / "scripts" / "relay_fidelity_report.py"


def _load():
    spec = importlib.util.spec_from_file_location("relay_fidelity_report", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


rfr = _load()


AGENTS = HERE.parent / "fixtures" / "relay_fidelity_e2e_agents"


def counts():
    return rfr.compute_production_counts(FIXTURES, cutoff=None, agents_root=AGENTS)


def test_counts_are_exactly_the_hand_count():
    c = counts()
    assert {k: v for k, v in c.items() if k != "window"} == {
        "logs_seen": 10,
        "logs_excluded_by_window": 0,
        "excluded_is_error": 1,
        "excluded_no_agent_type": 0,
        "excluded_non_conforming": 1,
        "no_usable_return": 0,
        "no_tail": 1,
        "no_main_narration_for_call": 0,
        "logs_too_old_schema": 2,
        "logs_no_narration": 0,
        "agent_calls": 9,
        "returns_truncated": 1,
        "eligible": 5,
        "exact": 2,
        "normalized": 2,
        "dropped": 3,
    }


def test_every_agent_call_lands_in_exactly_one_line():
    """The report's headline promise. An uncounted residual is the defect this
    exists to prevent, and the first cut had one: 893 of the corpus's 1,738
    Agent calls fell through `continue` with nothing incremented."""
    c = counts()
    accounted = (
        c["excluded_is_error"] + c["excluded_non_conforming"]
        + c["excluded_no_agent_type"] + c["no_usable_return"]
        + c["returns_truncated"] + c["no_tail"]
        + c["no_main_narration_for_call"] + c["eligible"]
    )
    assert accounted == c["agent_calls"]


def test_a_subagents_own_words_are_not_credited_to_the_relay():
    """The over-fire direction, and the whole point of the `thread` tag.

    In 12-00-00 the agent's tail appears verbatim in narration -- but in a
    `thread: "sub"` entry. Selecting on `kind == "assistant"` alone scores it
    `exact`, crediting the relay with words only the subagent said.
    """
    c = counts()
    assert c["exact"] == 2, "10-00-00, and 19-00-00's first call"
    assert c["dropped"] == 3, "12-00-00 must land here, not in exact"


def test_an_errored_spawn_is_excluded_first():
    """Its text is the harness's denial, not the agent's -- charging the relay
    for a spawn that produced no return measures nothing."""
    assert counts()["excluded_is_error"] == 1


def test_an_agent_with_no_summary_section_is_not_scored():
    """Conformance is read off the AGENT BODY, never off the return text.
    807 of the corpus's Agent calls go to agents with no `summary_for_user`
    (image-reader, gps-mentor, research-exhaustiveness); scoring a
    transcription for verbatim presence measures contract coverage, not
    relay fidelity."""
    assert counts()["excluded_non_conforming"] == 1


def test_a_return_with_no_final_rule_is_not_scored_against_its_whole_body():
    """The unit arm counts a tailless return `conforming` but never scores it
    (`ut_fx_notail`). Falling back to the whole body would make a multi-KB
    return the string that must appear verbatim -- a guaranteed false
    `dropped`."""
    c = counts()
    assert c["no_tail"] == 1
    assert c["eligible"] == 5, "the tailless return is not in the denominator"


def test_a_log_truncated_return_is_excluded_not_scored():
    c = counts()
    assert c["returns_truncated"] == 1
    assert c["eligible"] == 5


def test_a_non_integer_schema_version_does_not_abort_the_run():
    """One malformed log must not cost the other eight -- the same policy the
    parse guard above it states."""
    c = counts()
    assert c["logs_too_old_schema"] == 2, "the v7 log and the 'v8' string one"
    assert c["logs_seen"] == 10


def test_sibling_files_are_not_mistaken_for_run_logs():
    """`run-*.json` also matches `run-<ts>.ann.json` and `run-<ts>.final-*.json`.
    Now delegated to `runlog_selection.is_result_json` rather than re-derived;
    the re-derived version reported 611 logs against the real 203."""
    assert counts()["logs_seen"] == 10


def test_the_window_line_is_reported():
    """eval/CLAUDE.md: aggregating e2e readers "window to 14 days and print the
    window plus how many runs they excluded"."""
    c = rfr.compute_production_counts(
        FIXTURES, cutoff=rfr.filter_since.__globals__["date"].today(), agents_root=AGENTS
    )
    assert "Window:" in c["window"]
    assert c["logs_excluded_by_window"] >= 0


def test_an_empty_result_reports_why_rather_than_a_clean_zero():
    empty = {k: 0 for k in counts() if k != "window"}
    empty["logs_seen"] = 9
    empty["logs_too_old_schema"] = 9
    empty["window"] = "Window: entire corpus (9 run(s))."
    out = rfr.format_production_report(empty)
    assert "Nothing scored" in out
    assert "NOT a clean result" in out
    assert "0%" not in out, "a 0% figure would read as a measured rate"


def test_a_scored_result_says_the_percentages_are_not_a_partition():
    """`normalized` includes `exact`, so the three figures can sum past 100%.
    Without the note a reader totals the columns and concludes the counts are
    inconsistent."""
    c = {k: 0 for k in counts() if k != "window"}
    c.update(agent_calls=2, eligible=2, exact=1, normalized=1, dropped=1)
    out = rfr.format_production_report(c)
    assert "Nothing scored" not in out
    assert "50%" in out
    assert "not" in out and "partition" in out


def test_an_unaccounted_residual_is_surfaced_not_hidden():
    """The other direction on the accounting: if a call ever stops landing in a
    line, the report says so rather than letting it vanish."""
    c = {k: 0 for k in counts() if k != "window"}
    c.update(agent_calls=5, eligible=1, exact=1, normalized=1, dropped=0)
    assert "UNACCOUNTED" in rfr.format_production_report(c)


def test_a_missing_root_raises_rather_than_printing_zeros():
    import pytest

    with pytest.raises(FileNotFoundError):
        rfr.compute_production_counts(FIXTURES / "nope", agents_root=AGENTS)


def test_a_long_return_is_kept_AND_scored_end_to_end():
    """The acceptance check joined rather than proved in halves.

    `test_agent_return_is_not_cut_at_the_500_char_bound` proves the orchestrator
    keeps a long return; this proves one flows all the way through to a score.
    Before the fixture was lengthened, every fixture return was ~200 chars, so
    the two halves were each proven and never met.
    """
    import json

    log = FIXTURES / "alpha" / "run-2026-10-13_10-00-00.json"
    data = json.loads(log.read_text(encoding="utf-8"))
    raw = json.loads(data["tool_calls"][0]["response_summary"])[0]["text"]
    assert len(raw) > 500, "fixture must exercise a return past the old bound"
    assert "[truncated by harness" not in raw

    c = counts()
    assert c["exact"] == 2, "the long return is among those scored verbatim"


def test_a_slug_filter_narrows_the_corpus():
    """`TEST=<slug>` matches the siblings (`e2e-corpus`, `e2e-latency`, …).
    Without it `make e2e-relay-fidelity TEST=x` silently reported everything."""
    assert rfr.compute_production_counts(
        FIXTURES, cutoff=None, agents_root=AGENTS, test_slug="alpha"
    )["logs_seen"] == 10
    assert rfr.compute_production_counts(
        FIXTURES, cutoff=None, agents_root=AGENTS, test_slug="no-such-fixture"
    )["logs_seen"] == 0


def test_each_call_is_scored_against_its_own_window_not_the_whole_run():
    """19-00-00: two Agent calls returning the SAME formulaic tail. The main
    thread relays the first faithfully and says only "All done." after the
    second.

    Pooling the run's narration scores BOTH `exact` -- 100% verbatim fidelity
    where the truth is 50% -- because the first relay's words are still in the
    blob when the second call is scored. Measured at exactly that before the
    fix. The body says a busy run carries 20-30 Agent calls, so this is the
    normal shape, not an edge case, and it fails in the direction that HIDES
    the defect the report exists to find.
    """
    c = counts()
    assert c["agent_calls"] == 9, "the two-call log adds two"
    assert c["exact"] == 2, "one from 10-00-00, one from 19-00-00's first call"
    assert c["dropped"] == 3, "19-00-00's second call must land here"


def test_since_and_test_are_refused_when_they_would_do_nothing():
    """They apply to `--production` only; accepting and ignoring one is the
    "exit 0 having done nothing" shape this report exists to remove.

    Pinned because it was wrong twice. Comparing `args.since` against the RAW
    default errors on every bare invocation (`add_since_arg` converts its
    string default, so a date never equals "14"). Comparing against the
    CONVERTED default misses `--since 14` and `--since=14` — 14 IS the default,
    so they compare equal and the flag is silently ignored at exactly the value
    the Makefile help lists first. Only argv distinguishes supplied-and-equal
    from not-supplied.

    Driven through explicit argv, never a shell loop: a shell loop reported
    `--since 14` as exit 2 while the program exited 0, and that false reading
    reached a commit message.
    """
    import subprocess
    import sys

    script = SCRIPT

    def run(*argv):
        return subprocess.run(
            [sys.executable, str(script), *argv],
            capture_output=True, text=True, encoding="utf-8",
        ).returncode

    assert run() == 0, "the bare unit arm must still work"
    for argv in (
        ("--since", "14"),
        ("--since=14"),
        ("--since", "all"),
        ("--test", "alpha"),
    ):
        argv = (argv,) if isinstance(argv, str) else argv
        assert run(*argv) == 2, f"{argv} should be refused without --production"


def test_the_writer_emits_a_version_this_report_will_score():
    """Reverting the bump while keeping the capture leaves every new run log
    below the floor, and an empty denominator is exactly today's expected
    state, so nothing else notices."""
    from e2e.result import HARNESS_SCHEMA_VERSION

    assert HARNESS_SCHEMA_VERSION >= rfr.MIN_PRODUCTION_SCHEMA_VERSION


def test_an_untagged_assistant_entry_is_not_credited_to_the_relay(tmp_path):
    """Selection is on `thread == "main"`, never on the absence of `thread`."""
    import json

    src = FIXTURES / "alpha" / "run-2026-10-13_10-00-00.json"
    log = json.loads(src.read_text(encoding="utf-8"))
    for n in log["narration"]:
        n.pop("thread")
    (tmp_path / "beta").mkdir()
    (tmp_path / "beta" / src.name).write_text(json.dumps(log), encoding="utf-8")
    c = rfr.compute_production_counts(tmp_path, cutoff=None, agents_root=AGENTS)
    assert c["exact"] == 0 and c["eligible"] == 0, c
