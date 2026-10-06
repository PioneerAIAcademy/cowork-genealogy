"""`scripts/relay_fidelity_report.py` over a frozen fixture corpus.

Asserted as a COMPUTED STRUCTURE, not a golden string. A golden string would
red for every break at once, so no case could be shown to red only its own --
and it accepts nothing but itself, so a reflowed label or a reordered suite
reds it with no change in computation, which is how a check gets `skip`ped
within a month. The labels get one small assertion of their own.

The corpus is frozen because the live one moves: the issue's own figures could
not be reproduced days later, and a live baseline cannot tell a corpus change
from a miscomputation -- which is the failure this report exists to catch.

Hand-counted, from `fixtures/relay_fidelity/runlogs/alpha/v10.json`:

  direct   ut_fx_direct  conforming, tail, exact      (relay adds a preamble)
           ut_fx_norm    conforming, tail, normalized (emphasis + smart quotes
                         differ -- NOT dashes: normalize does not reconcile
                         `--` with an em dash, so a dash-only difference
                         scores a drop and leaves this branch unentered)
           ut_fx_drop    conforming, tail, neither
           ut_fx_notail  conforming, NO tail          (return has no rule)
           ut_fx_deep    conforming, tail, exact      (#### heading)
           ut_fx_stale   conforming, tail, exact
           ut_fx_fenced  NON-conforming               (heading only in a fence)
  routed   ut_fx_routed  conforming, tail, exact
  neither  ut_fx_err     is_error -> excluded first
           ut_fx_orphan  no test JSON -> orphan, and its return is not bucketed
"""

import importlib.util
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent / "fixtures" / "relay_fidelity"
SCRIPT = HERE.parent.parent / "scripts" / "relay_fidelity_report.py"


def _load():
    """Load by path, as `test_check_runlogs.py` does -- `scripts/` is not a package."""
    sys.path.insert(0, str(SCRIPT.parent))
    spec = importlib.util.spec_from_file_location("relay_fidelity_report", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


rfr = _load()


def counts(suite="alpha"):
    got = rfr.compute_counts(
        runlogs_root=FIXTURES / "runlogs",
        tests_root=FIXTURES / "tests",
        agents_root=FIXTURES / "agents",
    )
    return got[suite], got


def test_direct_arm_counts_are_exactly_the_hand_count():
    alpha, _ = counts()
    assert alpha["direct"] == {
        "conforming": 7,
        "with_tail": 6,
        "exact": 4,
        "normalized": 5,
        "non_conforming": 1,
        "lines_found": 2,
        "lines_total": 4,
    }


def test_routed_arm_is_counted_separately():
    alpha, _ = counts()
    assert alpha["routed"]["conforming"] == 1
    assert alpha["routed"]["exact"] == 1
    assert alpha["direct"]["conforming"] == 7  # not folded together


def test_normalized_includes_exact():
    """The issue counts "in 6 ... and in 15 after normalizing" inclusively."""
    alpha, _ = counts()
    assert alpha["direct"]["normalized"] >= alpha["direct"]["exact"]
    assert alpha["direct"]["normalized"] == 5


def test_a_normalized_only_survivor_is_counted_but_is_not_exact():
    """Pins the `elif` branch itself.

    Without this, a fixture that merely FAILS to match normalized is
    indistinguishable from one that was never evaluated: deleting the branch
    entirely left the whole suite green, because every survivor was exact and
    `normalized == exact` held trivially.
    """
    alpha, _ = counts()
    assert alpha["direct"]["exact"] == 4
    assert alpha["direct"]["normalized"] == 5  # the extra one is ut_fx_norm


def test_is_error_is_excluded_before_any_bucket():
    """Its text is the harness's stub denial, not the agent's."""
    alpha, _ = counts()
    assert alpha["excluded_is_error"] == 2
    assert alpha["direct"]["conforming"] == 7  # ut_fx_err is not among them


def test_is_error_is_checked_before_the_orphan_branch():
    """The ONLY shape that proves the order: a return that is BOTH.

    `ut_fx_err_orphan` is an is_error return on a test with no test JSON.
    Swapping the two blocks reclassifies it as an orphan return -- which is
    what makes the "FIRST." comment in the source enforceable rather than
    decorative. Two orphan TESTS, but only one orphan RETURN.
    """
    alpha, _ = counts()
    assert alpha["excluded_is_error"] == 2
    assert alpha["orphan_tests"] == 2
    assert alpha["no_test_json"] == 1


def test_a_runtime_trailer_is_stripped_before_the_tail_is_taken():
    """`ut_fx_trailer` carries `<usage>...</usage>` after its summary.

    Without the strip every real return's tail carries it and never
    substring-matches the relay, collapsing exact/norm to 0 corpus-wide with
    the suite green and the drop looking like a relay regression.
    """
    alpha, _ = counts()
    assert alpha["direct"]["exact"] == 4


def test_an_orphan_test_is_counted_and_its_returns_excluded():
    """Counted per TEST and per RETURN: both orphans on main carry zero
    returns, so a per-return counter alone reports 0 and looks like a clean
    scan."""
    alpha, _ = counts()
    assert alpha["orphan_tests"] == 2
    assert alpha["no_test_json"] == 1


def test_the_canonical_selector_beats_a_filename_sort():
    """`sorted()` picks v9 over v10, and a candidate over a release.

    The decoys are empty, so a wrong pick also zeroes every count -- the
    selector is proven by the resolved filename AND by the numbers.
    """
    alpha, _ = counts()
    assert alpha["log"] == "v10.json"
    assert alpha["direct"]["conforming"] == 7


def test_a_suite_with_only_scratch_logs_is_reported_not_skipped():
    """Same shape as any other suite, with a null log.

    This used to pin a bare `{"log": None}`, which meant every consumer had to
    re-derive the guard and `suites[x]["direct"]` raised KeyError here.
    """
    _, allsuites = counts()
    beta = allsuites["beta"]
    assert beta["log"] is None
    assert beta["direct"]["conforming"] == 0  # the shape is uniform
    assert beta["routed"]["conforming"] == 0


def test_a_missing_root_raises_rather_than_printing_zeros():
    """A moved root printed a plausible all-zeros report and exited 0 --
    indistinguishable from "no agent carries the contract any more"."""
    import pytest as _pytest

    with _pytest.raises(FileNotFoundError):
        rfr.conforming_agents(FIXTURES / "nope")
    with _pytest.raises(FileNotFoundError):
        rfr.arm_index(FIXTURES / "nope")


def test_an_agent_absent_from_the_snapshot_is_reported_unverifiable():
    """`body_changed: 0` otherwise conflates "nothing stale" with "nothing
    checkable"."""
    alpha, _ = counts()
    # alpha's snapshot carries only `good`; deep and fenced returns cannot be
    # staleness-checked.
    assert alpha["unverifiable_body"] >= 1


def test_body_changed_is_additive_not_subtractive():
    """A stale hash is counted on its own line AND left in its bucket."""
    gamma, _ = counts("gamma")
    assert gamma["body_changed"] == 1
    assert gamma["direct"]["conforming"] == 1
    assert gamma["direct"]["exact"] == 1


def test_a_matching_hash_is_not_reported_as_changed():
    """The other direction."""
    alpha, _ = counts()
    assert alpha["body_changed"] == 0


# --- the pure helpers, where the ambiguities were ---------------------------


def test_normalization_does_not_collapse_runs_of_hyphens():
    """Collapsing them too scores 16 where this scores 13 on the live corpus:
    agents write an em dash as `--` and relays render it as one character, so
    collapsing makes `--` and `-` interchangeable and over-counts survival."""
    assert rfr.normalize("a -- b") == "a -- b"
    assert rfr.normalize("a — b") == "a - b"


def test_normalization_strips_emphasis_and_smart_quotes():
    assert rfr.normalize("**bold** “q”") == 'bold "q"'


def test_normalization_does_not_casefold():
    """Over-normalizing inflates survival."""
    assert rfr.normalize("Done") != rfr.normalize("done")


def test_the_final_rule_is_a_line_of_exactly_three_dashes():
    assert rfr.tail_after_final_rule("a\n---\nb\n---\nc") == "c"
    assert rfr.tail_after_final_rule("no rule here") == ""
    assert rfr.tail_after_final_rule("a\n----\nb") == ""


def test_a_rule_inside_a_fence_does_not_move_the_tail():
    """Zero instances on today's corpus, so a guard rather than a fix."""
    text = "a\n---\nreal tail\n\n```\n---\n```"
    tail = rfr.tail_after_final_rule(text)
    assert tail.startswith("real tail")


def test_the_tail_is_returned_verbatim_including_any_fence():
    """It is matched against an UNSTRIPPED `text_response`.

    Returning a fence-stripped tail made a summary containing a code block
    impossible to match even when the relay reproduced it exactly.
    """
    text = "head\n---\nSummary para\n\n```\ncode\n```"
    tail = rfr.tail_after_final_rule(text)
    assert "```" in tail and "code" in tail
    # ...and a verbatim relay of that summary matches.
    relayed = f"Hand-back\n\n---\n\n{tail}"
    assert tail in relayed


@pytest.mark.parametrize("name,expected", [("good", True), ("deep", True),
                                           ("fenced", False), ("plain", False)])
def test_conformance_is_read_off_the_agent_body(name, expected):
    """Both directions, including a heading that exists only inside a fence."""
    assert (name in rfr.conforming_agents(FIXTURES / "agents")) is expected


def test_labels_say_the_direct_arm_is_the_dispatcher():
    """Separate from the count assertions, so a reflowed label cannot red them."""
    out = rfr.format_report(
        rfr.compute_counts(
            runlogs_root=FIXTURES / "runlogs",
            tests_root=FIXTURES / "tests",
            agents_root=FIXTURES / "agents",
        )
    )
    assert "DISPATCHER fidelity, not production" in out
    assert rfr.ROUTED_LABEL in out
    assert rfr.EXCLUDED_LABEL in out
