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


def counts():
    return rfr.compute_production_counts(FIXTURES, cutoff=None)


def test_counts_are_exactly_the_hand_count():
    assert counts() == {
        "logs_seen": 5,
        "logs_too_old_schema": 1,
        "logs_no_narration": 0,
        "agent_calls": 4,
        "returns_truncated": 1,
        "eligible": 3,
        "exact": 1,
        "normalized": 1,
        "dropped": 2,
    }


def test_a_subagents_own_words_are_not_credited_to_the_relay():
    """The over-fire direction, and the whole point of the `thread` tag.

    In 12-00-00 the agent's tail appears verbatim in narration -- but in a
    `thread: "sub"` entry, i.e. the subagent's own message surfacing on the
    main stream. Selecting on `kind == "assistant"` alone scores it `exact`.
    """
    c = counts()
    assert c["exact"] == 1, "only 10-00-00 is a real verbatim relay"
    assert c["dropped"] == 2, "12-00-00 must land here, not in exact"


def test_a_log_truncated_return_is_excluded_not_scored():
    """Scoring it would measure the LOG's cut as the relay dropping content --
    this report's own failure mode pointed backwards."""
    c = counts()
    assert c["returns_truncated"] == 1
    assert c["eligible"] == 3, "the truncated one is not in the denominator"


def test_a_pre_v8_log_is_unscorable_rather_than_clean():
    c = counts()
    assert c["logs_too_old_schema"] == 1
    assert c["agent_calls"] == 4, "the v7 log's Agent call is not counted"


def test_sibling_files_are_not_mistaken_for_run_logs():
    """`run-*.json` also matches `run-<ts>.ann.json` and `run-<ts>.final-*.json`.
    A substring filter on `.ann.` leaves the finals in; on the real corpus that
    reported 611 logs against 203."""
    assert counts()["logs_seen"] == 5


def test_an_empty_result_reports_why_rather_than_a_clean_zero():
    empty = {
        "logs_seen": 9, "logs_too_old_schema": 9, "logs_no_narration": 0,
        "agent_calls": 0, "returns_truncated": 0, "eligible": 0,
        "exact": 0, "normalized": 0, "dropped": 0,
    }
    out = rfr.format_production_report(empty)
    assert "Nothing scored" in out
    assert "NOT a clean result" in out
    assert "0%" not in out, "a 0% figure would read as a measured rate"


def test_a_scored_result_reports_percentages():
    """The other direction: with a non-zero denominator it does print rates."""
    out = rfr.format_production_report({
        "logs_seen": 2, "logs_too_old_schema": 0, "logs_no_narration": 0,
        "agent_calls": 2, "returns_truncated": 0, "eligible": 2,
        "exact": 1, "normalized": 1, "dropped": 1,
    })
    assert "Nothing scored" not in out
    assert "50%" in out


def test_a_missing_root_raises_rather_than_printing_zeros():
    import pytest

    with pytest.raises(FileNotFoundError):
        rfr.compute_production_counts(FIXTURES / "nope")
