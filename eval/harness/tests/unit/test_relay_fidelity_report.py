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
           ut_fx_norm    conforming, tail, normalized (bold + em dash differ)
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
        "conforming": 6,
        "with_tail": 5,
        "exact": 3,
        "normalized": 3,
        "non_conforming": 1,
        "lines_found": 2,
        "lines_total": 4,
    }


def test_routed_arm_is_counted_separately():
    alpha, _ = counts()
    assert alpha["routed"]["conforming"] == 1
    assert alpha["routed"]["exact"] == 1
    assert alpha["direct"]["conforming"] == 6  # not folded together


def test_normalized_includes_exact():
    """The issue counts "in 6 ... and in 15 after normalizing" inclusively."""
    alpha, _ = counts()
    assert alpha["direct"]["normalized"] >= alpha["direct"]["exact"]
    assert alpha["direct"]["normalized"] == 3


def test_is_error_is_excluded_before_any_bucket():
    """Its text is the harness's stub denial, not the agent's."""
    alpha, _ = counts()
    assert alpha["excluded_is_error"] == 1
    assert alpha["direct"]["conforming"] == 6  # ut_fx_err is not among them


def test_an_orphan_test_is_counted_and_its_returns_excluded():
    """Counted per TEST and per RETURN: both orphans on main carry zero
    returns, so a per-return counter alone reports 0 and looks like a clean
    scan."""
    alpha, _ = counts()
    assert alpha["orphan_tests"] == 1
    assert alpha["no_test_json"] == 1


def test_the_canonical_selector_beats_a_filename_sort():
    """`sorted()` picks v9 over v10, and a candidate over a release.

    The decoys are empty, so a wrong pick also zeroes every count -- the
    selector is proven by the resolved filename AND by the numbers.
    """
    alpha, _ = counts()
    assert alpha["log"] == "v10.json"
    assert alpha["direct"]["conforming"] == 6


def test_a_suite_with_only_scratch_logs_is_reported_not_skipped():
    _, allsuites = counts()
    assert allsuites["beta"] == {"log": None}


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
    assert rfr.tail_after_final_rule(text) == "real tail"


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
