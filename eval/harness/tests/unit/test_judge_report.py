"""Tests for judge_report — the offline non-discrimination scan of the unit judge.

Three of these are synthetic. The fourth reads a real committed run log on purpose:
a synthetic fixture cannot catch a wrong field path, because the fixture would be
hand-written to the same wrong shape and pass. Scores live at
`tests[].outcome_summary.aggregated_dimensions[]`, NOT `tests[].dimensions[]`, and a
reader pointed at the latter prints zeros for every suite while looking healthy.
"""

import json

import judge_report
from judge_report import (
    MIN_GRADED_INSTANCES,
    apply_annotation,
    collect_dimensions,
)


def _runlog(dimension_scores: dict[str, list], skill: str = "demo") -> dict:
    """A run log whose Nth test carries the Nth score of every named dimension.

    Built at the real field path so these fixtures cannot drift into agreeing with
    a broken extractor.
    """
    n = max(len(v) for v in dimension_scores.values())
    tests = []
    for i in range(n):
        dims = [
            {"source": "rubric", "name": name, "score": scores[i], "rationale": "x"}
            for name, scores in dimension_scores.items()
            if i < len(scores)
        ]
        tests.append(
            {
                "test_id": f"ut_{skill}_{i:03d}",
                "outcome_summary": {"aggregated_dimensions": dims},
            }
        )
    return {"skill": skill, "tests": tests}


def test_flags_exactly_the_flat_dimension_not_the_varying_one():
    """The core discrimination: a dimension that never moves carries no signal."""
    flat = [3] * MIN_GRADED_INSTANCES
    varying = [3] * (MIN_GRADED_INSTANCES - 1) + [2]
    dims = collect_dimensions(
        _runlog({"Flat dimension": flat, "Varying dimension": varying}), "demo"
    )
    flagged = [d.name for d in dims if d.non_discriminating]

    assert flagged == ["Flat dimension"], (
        "exactly the flat dimension must flag; a detector that also flags the "
        "varying one is not measuring discrimination"
    )


def test_a_dimension_below_the_instance_threshold_is_not_flagged():
    """One distinct score over too few gradings says more about the sample.

    Also pins that N/A does NOT count toward the threshold: this dimension has
    MIN_GRADED_INSTANCES + 2 *instances* but only MIN_GRADED_INSTANCES - 1 numeric
    ones, so counting nulls would push it over the bar and flag it. That is not
    hypothetical — `init-project`'s `Place standardization` has this exact shape.
    """
    scores = [3] * (MIN_GRADED_INSTANCES - 1) + [None, None, None]
    dims = collect_dimensions(_runlog({"Barely graded": scores}), "demo")
    (dim,) = dims

    assert dim.graded == MIN_GRADED_INSTANCES - 1
    assert dim.na == 3
    assert dim.instances > MIN_GRADED_INSTANCES  # enough instances, too few graded
    assert not dim.non_discriminating


def test_an_always_na_dimension_is_reported_separately_never_flagged_flat():
    """Always-N/A is a different defect from always-3 and must not be conflated."""
    dims = collect_dimensions(
        _runlog({"Never applies": [None] * (MIN_GRADED_INSTANCES + 3)}), "demo"
    )
    (dim,) = dims

    assert dim.always_na
    assert not dim.non_discriminating
    assert dim.graded == 0


def test_a_sparse_annotation_does_not_inflate_the_reviewed_denominator():
    """A missing correction entry means NOT REVIEWED — never 'agreed'.

    Also pins the null-safe direction bucket: a correction where either side is
    N/A has no direction, and comparing it would raise TypeError on `None > 3`.
    """
    dims = collect_dimensions(
        _runlog({"Reviewed dim": [3, 3, 3, 3], "Unreviewed dim": [3, 3, 3, 3]}), "demo"
    )
    annotation = {
        "corrections": [
            # one agreement, one real disagreement, one N/A-vs-numeric
            {"dimension_source": "rubric", "dimension_name": "Reviewed dim",
             "llm_score": 3, "corrected_score": 3},
            {"dimension_source": "rubric", "dimension_name": "Reviewed dim",
             "llm_score": 2, "corrected_score": 3},
            {"dimension_source": "rubric", "dimension_name": "Reviewed dim",
             "llm_score": None, "corrected_score": 3},
        ]
    }
    apply_annotation(dims, annotation)
    reviewed = next(d for d in dims if d.name == "Reviewed dim")
    untouched = next(d for d in dims if d.name == "Unreviewed dim")

    assert reviewed.reviewed == 3
    assert reviewed.agreements == 1
    assert reviewed.judge_harsher == 1  # corrected 3 > llm 2
    assert reviewed.n_a_disagreement == 1  # never compared with < / >
    assert reviewed.unreviewed == 1  # 4 gradings, 3 reviewed

    # The dimension nobody reviewed contributes nothing to any numerator OR
    # denominator — the whole point of "sparse".
    assert untouched.reviewed == 0
    assert untouched.agreements == 0
    assert untouched.unreviewed == 4


def test_reads_dimension_keys_from_a_real_committed_run_log():
    """The field-path guard — the only test a wrong path cannot survive.

    Asserts a FLOOR, never an exact count: the corpus moves every time a PR lands a
    new run log, and a report pinned to a total would fail on unrelated work. What
    must hold is that the extractor finds dimensions at all, keyed per skill.

    Keying is `(skill, source, name)`: `(source, name)` alone merges seven names
    across suites (all three base dimensions plus Jurisdiction accuracy, Result
    triage, Actionability, Accuracy) and collapses the corpus below this floor.
    """
    skills = judge_report.all_skills()
    assert skills, "no unit run-log directories found — corpus missing?"

    keys: set[tuple[str, str, str]] = set()
    for skill in skills:
        logs = judge_report.releasable_runlogs_for(skill)
        if not logs:
            continue
        runlog = json.loads(logs[-1].read_text(encoding="utf-8"))
        for dim in collect_dimensions(runlog, skill):
            keys.add((dim.skill, dim.source, dim.name))

    assert len(keys) > 100, (
        f"found only {len(keys)} dimension keys across {len(skills)} skills — "
        "the extractor is reading the wrong field path (scores live at "
        "tests[].outcome_summary.aggregated_dimensions[], not tests[].dimensions[]) "
        "or is keying without the skill"
    )


def test_the_annotation_join_actually_pairs_against_the_real_corpus():
    """The guard for the OTHER half — `build_skill_report`'s `.ann.json` pairing.

    The real-corpus test above guards the score path. Nothing guarded this one, and
    it fails in exactly the same silent way: break the sibling lookup and every
    suite reports `0 reviewed / 0 disagreements`, the footer reads like a clean
    result, and all the synthetic tests stay green — because they hand
    `apply_annotation` a dict directly and never exercise the pairing.

    Floors, not exact counts: the corpus grows as PRs land. Today it is 25 of 25
    suites paired and 2263 reviewed entries.
    """
    skills = judge_report.all_skills()
    paired, reviewed = 0, 0
    for skill in skills:
        logs = judge_report.releasable_runlogs_for(skill)
        if not logs:
            continue
        report = judge_report.build_skill_report(skill, logs[-1])
        if not report.annotation_missing:
            paired += 1
        reviewed += sum(d.reviewed for d in report.dimensions)

    assert paired >= 10, (
        f"only {paired} suites paired with a .ann.json — the sibling lookup is "
        "broken (build_skill_report/ann_filename_for), not the corpus"
    )
    assert reviewed > 200, (
        f"only {reviewed} correction entries joined — the annotation keying is "
        "wrong (corrections key on dimension_source/dimension_name)"
    )


def test_a_lone_disagreement_is_not_called_systematic():
    """`rubric-critic` defines the flag as recurring across tests in one direction.

    Guards against reintroducing "any correction at all" as the trigger, which
    would make every one of the corpus's two disagreements a false positive.
    """
    dims = collect_dimensions(_runlog({"Dim": [3] * 6}), "demo")
    (dim,) = dims

    dim.reviewed, dim.agreements, dim.judge_harsher = 6, 5, 1
    assert not dim.systematic_divergence, "one correction is a judgement call"

    dim.judge_harsher = 2
    assert dim.systematic_divergence, "two in the same direction is a pattern"

    # Opposite directions are not a pattern either — they cancel, not accumulate.
    dim.judge_harsher, dim.judge_softer = 1, 1
    assert not dim.systematic_divergence


def test_a_malformed_score_is_not_silently_counted_as_na():
    """A float 2.0 is a real partial, not "not applicable".

    Folding it into N/A both hides the partial and can flip the dimension into
    looking flat — the exact opposite of what this report is for. `bool` is an
    `int` subclass in Python, so True must not grade as 1 either.
    """
    dims = collect_dimensions(_runlog({"Dim": [2.0, 3, 3, 3, 3, 3]}), "demo")
    (dim,) = dims

    assert dim.malformed == 1
    assert dim.na == 0
    assert dim.graded == 5
    assert not dim.non_discriminating, (
        "a malformed score must not be laundered into a flat verdict"
    )

    bools = collect_dimensions(_runlog({"Dim": [True, 3, 3]}), "demo")[0]
    assert bools.malformed == 1 and bools.graded == 2
