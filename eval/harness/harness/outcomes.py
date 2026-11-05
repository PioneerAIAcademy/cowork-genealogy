"""Outcome aggregation — rebuilding a test entry's outcome and summary from its runs[].

The §7 runs[] -> test rule (unit-test-spec.md), the dimension aggregation, and
`consequential`, the one definition of "this summary disagrees with its runs"
that `judge_regrade --reaggregate` and `check_runlogs.py` rule 12 share.

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

`runlog.py` re-exports the names its callers import, so there is still exactly
one definition and existing `from harness.runlog import ...` call sites are
unaffected. The private views (`_RunView`, `_JudgeView`, `_ValidatorsView`) and
`_scores` are not re-exported.
"""

from __future__ import annotations

from typing import Any


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


# ---- Aggregation helpers -------------------------------------------------


# None (N/A) ranks above pass so it never wins a tie against a real score.
# All-null buckets are handled separately in aggregate_dimensions and don't
# rely on this rank.
_DIMENSION_RANK = {1: 1, 2: 2, 3: 3, None: 4}


def aggregate_dimensions(
    runs: list[Any], *, include_validator_failed: bool = False
) -> list[dict[str, Any]]:
    """Modal per-dimension score across runs (ties resolve down).

    A dimension may have score=None (N/A): the Tool Arguments base
    dimension on a run with zero MCP tool calls, any rubric dimension the
    fixture never exercised, and since #2196 Correctness/Completeness on a
    correctly-routed negative test, where the harness usually truncates the
    transcript at the hand-off (measured: not on 4 of the 47 runs it fires
    on, where the 1 is real - see flag_routing_negative_judge_fail). All-None buckets aggregate to None; mixed
    buckets fall back to standard modal logic with None ranking above pass
    so a real score wins any tie.

    Runs that FAILED a validator are excluded (#2057): they are graded now,
    but their scores stay out of the modal so committed baselines do not
    shift. Their per-run scores remain in `runs[].judge.dimensions`.

    `include_validator_failed=True` lifts that exclusion. It exists for ONE
    caller — `assemble_test_entry` building `review_dimensions`, the rows a
    human annotates — and must never feed `aggregated_dimensions`, which is
    what the baseline readers (`skill_gate`, the dashboards) consume.
    """
    if not runs:
        return []
    bucket: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in runs:
        # A validator-failing run is now GRADED (#2057) but stays out of the
        # modal: letting defective runs into the aggregate would move every
        # committed baseline at once, so the next gate-skill comparison would
        # be against a shifted goalpost. The per-run scores remain in
        # runs[].judge.dimensions. On committed data this disjunct is a no-op
        # (every validator-failing run there was already judge-skipped), so
        # test_aggregate_excludes_a_validator_failing_run is what pins it.
        #
        # `is False`, not `not r.validators.passed` as issue #2057 words it:
        # ValidatorResult.passed is `bool | None`, and None means validators
        # never reached a verdict (the _aborted_entry path) rather than that
        # one failed. Truthiness would drop an unknown-but-graded run from the
        # aggregate too, which is wider than the ruling. Unreachable today —
        # compute_validators_passed returns a bool, and every None-valued run
        # is aborted and so already excluded by judge.skipped — so this is
        # about intent surviving the next reader, and
        # test_aggregate_still_counts_a_run_whose_validators_are_unknown fails
        # if it is ever simplified back.
        if r.judge.skipped:
            continue
        if r.validators.passed is False and not include_validator_failed:
            continue
        for d in r.judge.dimensions:
            key = (d.get("source", ""), d.get("name", ""))
            bucket.setdefault(key, []).append(d)

    aggregated: list[dict[str, Any]] = []
    for key, dims in bucket.items():
        scores = [d.get("score") for d in dims]
        if all(s is None for s in scores):
            modal = None
        else:
            modal = _modal_with_tiebreak_down(scores, _DIMENSION_RANK)
        modal_dim = next(d for d in dims if d.get("score") == modal)
        aggregated.append(
            {
                "source": key[0],
                "name": key[1],
                "score": modal,
                "rationale": modal_dim.get("rationale", ""),
            }
        )
    return aggregated


# ---- Rebuilding a committed entry from its runs --------------------------


class _JudgeView:
    __slots__ = ("skipped", "dimensions")

    def __init__(self, skipped: bool, dimensions: list[dict[str, Any]]) -> None:
        self.skipped = skipped
        self.dimensions = dimensions


class _ValidatorsView:
    __slots__ = ("passed",)

    def __init__(self, passed: bool | None) -> None:
        self.passed = passed


class _RunView:
    """The slice of a committed run dict that the aggregators read.

    `assemble_test_entry` aggregates `SingleRun` objects it has just built; a
    regrade only ever holds the committed JSON. Rebuilding a whole `SingleRun`
    from that JSON would mean supplying a dozen fields no aggregator looks at,
    and would raise on any log written before one of them existed. This exposes
    exactly the four attributes `aggregate_dimensions` and the outcome sort
    touch, so a field added to `SingleRun` later cannot silently change what a
    rebuild aggregates.

    Plain attribute views rather than `runlog.JudgeResult`/`ValidatorResult`:
    those live beside `jsonschema`, and `check_runlogs.py` rebuilds entries on a
    bare interpreter (rule 12).
    """

    __slots__ = ("outcome", "judge", "validators")

    def __init__(self, run: dict[str, Any]) -> None:
        judge = run.get("judge") or {}
        validators = run.get("validators") or {}
        self.outcome = run.get("outcome") or ""
        self.judge = _JudgeView(
            bool(judge.get("skipped")), judge.get("dimensions") or []
        )
        # `.get("passed")` absent -> None, not False: `aggregate_dimensions`
        # drops a run only on `is False`, and None means validators never
        # reached a verdict rather than that one failed.
        self.validators = _ValidatorsView(validators.get("passed"))


def refresh_test_entry_outcome(entry: dict[str, Any]) -> str | None:
    """Recompute a committed test entry's derived fields from its own `runs[]`.

    Returns the entry's outcome after the rebuild, or None when it has no runs.

    A regrade rewrites `runs[].judge.dimensions` and `runs[].outcome` and
    everything derived from them goes stale in the same write. Before this
    existed `judge_regrade` refreshed `outcome` alone, so a regraded entry
    could read `outcome: "fail"` beside an `outcome_summary` still reporting
    `per_run_outcomes: ["pass"]` and the pre-regrade dimension scores. That is
    not cosmetic: `skill_gate` and the dashboards read `aggregated_dimensions`,
    so a stale summary scores the suite against the grading it just replaced.

    The derivation mirrors `assemble_test_entry` exactly — same aggregator,
    same outcome-first sort, same `review_dimensions` fallback — because any
    second ranking here would make a regraded entry disagree with a freshly
    run one. `flaky` is included: it is derived from `per_run_outcomes` and
    went stale with it.
    """
    runs = entry.get("runs") or []
    if not runs:
        return None
    views = [_RunView(r) for r in runs]
    per_run_outcomes = [v.outcome for v in views]
    outcome = aggregate_per_run_outcome(per_run_outcomes)

    by_outcome = sorted(views, key=lambda v: v.outcome != outcome)
    aggregated_dims = aggregate_dimensions(by_outcome)
    review_dims = aggregated_dims or aggregate_dimensions(
        by_outcome, include_validator_failed=True
    )

    entry["outcome"] = outcome
    entry["flaky"] = len(set(per_run_outcomes)) > 1
    summary = entry.setdefault("outcome_summary", {})
    summary["per_run_outcomes"] = per_run_outcomes
    summary["aggregated_dimensions"] = aggregated_dims
    summary["review_dimensions"] = review_dims
    return outcome


def consequential(
    entry: dict[str, Any], *, include_review: bool = True
) -> tuple[Any, ...]:
    """The part of a test entry a reader acts on, for change detection.

    Scores, not rationales: `skill_gate` builds its comparison map from
    `aggregated_dimensions[].score` and never looks at the prose beside it.

    One definition for both readers that ask "does this summary disagree with
    its runs": `judge_regrade --reaggregate` (what to write) and
    `check_runlogs.py` rule 12 (what to block). `include_review=False` is for a
    stored entry with no `review_dimensions`, which predates the field and is
    not stale for lacking it.

    Dimension rows are compared in `(source, name)` order, not stored order:
    every reader looks a row up by that key, and a rebuild can reorder rows
    whose scores did not move (`ut_citation_008`, #3936).
    """
    summary = entry.get("outcome_summary") or {}
    return (
        entry.get("outcome"),
        bool(entry.get("flaky", False)),
        tuple(summary.get("per_run_outcomes") or []),
        _scores(summary.get("aggregated_dimensions")),
        _scores(summary.get("review_dimensions")) if include_review else None,
    )


def _scores(rows: list[dict[str, Any]] | None) -> tuple[tuple[str, str, Any], ...]:
    # Sorted on the key alone: a score can be None, which does not order
    # against an int.
    return tuple(
        sorted(
            ((d.get("source", ""), d.get("name", ""), d.get("score")) for d in rows or []),
            key=lambda t: (t[0], t[1]),
        )
    )
