"""Outcome aggregation — the runs[] -> test rule from unit-test-spec.md §7.

**Stdlib only, and that is the whole reason this module exists.** It was lifted
out of `runlog.py` for issue #2684's rule 6: `scripts/check_runlogs.py` promises
in its own docstring to be self-contained, and the CI step that runs it
(`.github/workflows/check-runlogs.yml`, "Run runlog discipline checks") does
`actions/setup-python` and then invokes it directly — no `uv sync`, no pip
install, no dependency step at all. `runlog.py` imports `jsonschema` and
`referencing` at module level, so importing the aggregation from there would
have reded every PR in the repo with a ModuleNotFoundError.

`make harness-test` cannot catch that: it runs under `uv` with those packages
present and loads the script in-process. The failure only appears on a bare
interpreter, which is the one place CI uses.

`runlog.py` re-exports every name here, so there is still exactly one definition
and existing `from harness.runlog import ...` call sites are unaffected.
"""

from __future__ import annotations


class RunlogAssemblyError(Exception):
    pass


# Tie-break DOWN: when two outcomes are equally modal the worse one wins, so a
# 1-pass/1-fail test reads `fail` rather than being rounded up to green.
_OUTCOME_RANK = {"fail": 0, "partial": 1, "pass": 2}


def aggregate_per_run_outcome(per_run: list[str]) -> str:
    """Aggregate per-run outcomes per unit-test-spec.md §7.

    Operates on the strings `_compute_outcome` already produced, so the
    validator-dominates-cap-abort demotion (issue #1866 V7) is baked in
    upstream: a run that failed a validator under a deterministic cap
    arrives here as "fail", never "aborted". This abort-precedence branch
    therefore only fires on a genuinely ungradeable run, and the two sites
    agree by construction.
    """
    if not per_run:
        raise RunlogAssemblyError("no per-run outcomes to aggregate")
    if "aborted" in per_run:
        return "aborted"
    return _modal_with_tiebreak_down(per_run, _OUTCOME_RANK)


# ---- Suppression predicates ----------------------------------------------
#
# `outcome` is the real aggregate (pass/partial/fail/aborted); suppression is
# read from the `expected_outcome` marker beside it (issue #2842). These two
# predicates name the two rows an `expected_outcome: "xfail"` marker used to
# relabel, so exit code, the console mark and mandatory-annotation selection all
# decide the same way from one place instead of re-deriving it. They live here,
# not in `runlog.py`, so a bare-interpreter consumer (`review_sample.py`, which
# `check_runlogs.py` imports) can read them without pulling in `jsonschema`.


def suppressed_failure(outcome: str, expected_outcome: str | None) -> bool:
    """A declared-xfail test that failed as declared — non-failing, exit 0."""
    return expected_outcome == "xfail" and outcome == "fail"


def unexpected_pass(outcome: str, expected_outcome: str | None) -> bool:
    """A declared-xfail test that passed — a regression / stale marker, exit 1."""
    return expected_outcome == "xfail" and outcome == "pass"


def _modal_with_tiebreak_down(values, rank):
    if not values:
        raise ValueError("empty values list")
    counts: dict = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    max_count = max(counts.values())
    winners = [v for v, c in counts.items() if c == max_count]
    if len(winners) == 1:
        return winners[0]
    return min(winners, key=lambda v: rank.get(v, 999))
