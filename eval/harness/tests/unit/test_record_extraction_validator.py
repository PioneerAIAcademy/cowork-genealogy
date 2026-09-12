"""Direct tests for record-extraction's classification-refinement
validators (issue #2021, F12).

Same reason as `test_research_plan_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and its real pass/fail set would otherwise appear only
inside a paid per-skill run.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_record_extraction import (  # noqa: E402
    report_a_multi_record_batch_announces_each_record_position as check_batch_progress,
    test_expected_classifications as check_classifications,
    test_refinement_preserves_extraction_fields_and_avoids_duplication as check_refinement,
)


def _assertion(**overrides):
    base = {
        "id": "a_002",
        "source_id": "src_001",
        "record_id": "ark:/61903/1:1:M6QK-HRD",
        "record_role": "head",
        "fact_type": "birth",
        "value": "Ireland",
        "structured_value": None,
        "date": None,
        "date_certainty": None,
        "place": "Ireland",
        "information_quality": "primary",
        "informant": "household head (self)",
        "informant_proximity": "self",
        "informant_bias_notes": "assumed self-reported",
        "evidence_type": "direct",
        "log_entry_id": "log_001",
        "extracted_for_question_ids": ["q_001"],
    }
    base.update(overrides)
    return base


def _sibling(**overrides):
    base = {
        "id": "a_001",
        "source_id": "src_001",
        "record_id": "ark:/61903/1:1:M6QK-HRD",
        "record_role": "head",
        "fact_type": "name",
        "value": "Thomas Doyle",
        "structured_value": {"given": "Thomas", "surname": "Doyle"},
        "date": None,
        "date_certainty": None,
        "place": None,
        "information_quality": "primary",
        "informant": "household head (self)",
        "informant_proximity": "self",
        "informant_bias_notes": "assumed self-reported",
        "evidence_type": "direct",
        "log_entry_id": "log_001",
        "extracted_for_question_ids": ["q_001"],
    }
    base.update(overrides)
    return base


# --- test_expected_classifications, widened to "new-or-updated" -----------

def test_classifications_matcher_fires_on_updated_assertion_with_wrong_value():
    """The widened matcher must actually check an UPDATED assertion, not
    just a newly-created one -- this is the exact gap #2021 found."""
    before = {"research_json": {"assertions": [_assertion(informant_proximity="self")]}}
    after = {"research_json": {"assertions": [_assertion(informant_proximity="self")]}}  # unchanged
    test = {
        "expected_classifications": [
            {"record_role": "head", "fact_type": "birth", "informant_proximity": "unknown"}
        ]
    }
    with pytest.raises(AssertionError, match="no new assertion"):
        check_classifications(before, after, test)


def test_classifications_matcher_passes_on_correctly_updated_assertion():
    before = {"research_json": {"assertions": [_assertion(informant_proximity="self")]}}
    after = {"research_json": {"assertions": [_assertion(informant_proximity="unknown")]}}
    test = {
        "expected_classifications": [
            {"record_role": "head", "fact_type": "birth", "informant_proximity": "unknown"}
        ]
    }
    check_classifications(before, after, test)  # does not raise


def test_classifications_matcher_still_works_on_newly_created_assertion():
    """Proves the widening didn't break the original (pre-#2021) semantics."""
    before = {"research_json": {"assertions": []}}
    after = {"research_json": {"assertions": [_assertion(informant_proximity="unknown")]}}
    test = {
        "expected_classifications": [
            {"record_role": "head", "fact_type": "birth", "informant_proximity": "unknown"}
        ]
    }
    check_classifications(before, after, test)  # does not raise


# --- test_refinement_preserves_extraction_fields_and_avoids_duplication ---

BEFORE_STATE = {
    "research_json": {"assertions": [_sibling(), _assertion(informant_proximity="self")]}
}


def test_skipped_when_no_refinement_targets():
    with pytest.raises(pytest.skip.Exception):
        check_refinement(BEFORE_STATE, BEFORE_STATE, {})


def test_passes_on_a_clean_in_place_refinement():
    after = {
        "research_json": {
            "assertions": [
                _sibling(),
                _assertion(informant_proximity="unknown", information_quality="indeterminate"),
            ]
        }
    }
    check_refinement(BEFORE_STATE, after, {"refinement_targets": ["a_002"]})  # does not raise


def test_fires_when_extraction_field_changes():
    """The refinement must not touch extraction fields -- only classification."""
    after = {
        "research_json": {
            "assertions": [
                _sibling(),
                _assertion(informant_proximity="unknown", place="England"),  # extraction field moved
            ]
        }
    }
    with pytest.raises(AssertionError, match="extraction field 'place' changed"):
        check_refinement(BEFORE_STATE, after, {"refinement_targets": ["a_002"]})


def test_fires_when_target_deleted_instead_of_updated():
    after = {"research_json": {"assertions": [_sibling()]}}  # a_002 gone
    with pytest.raises(AssertionError, match="no longer exists"):
        check_refinement(BEFORE_STATE, after, {"refinement_targets": ["a_002"]})


def test_fires_when_nothing_actually_changed():
    with pytest.raises(AssertionError, match="nothing about it changed"):
        check_refinement(BEFORE_STATE, BEFORE_STATE, {"refinement_targets": ["a_002"]})


def test_fires_when_untargeted_sibling_changes():
    """Proves scope: reclassifying a_002 must not touch a_001, which the
    refinement request never named."""
    after = {
        "research_json": {
            "assertions": [
                _sibling(informant_proximity="unknown"),  # a_001 changed, not asked for
                _assertion(informant_proximity="unknown", information_quality="indeterminate"),
            ]
        }
    }
    with pytest.raises(AssertionError, match="not a named refinement target"):
        check_refinement(BEFORE_STATE, after, {"refinement_targets": ["a_002"]})


def test_fires_on_duplicate_via_append_instead_of_update():
    """The exact failure mode this validator exists to catch: a second
    assertion for the same (source_id, record_role, fact_type) appended
    rather than the original updated in place."""
    after = {
        "research_json": {
            "assertions": [
                _sibling(),
                _assertion(informant_proximity="self"),  # original untouched
                _assertion(id="a_003", informant_proximity="unknown"),  # duplicate
            ]
        }
    }
    with pytest.raises(AssertionError, match="duplicates a refinement target"):
        check_refinement(BEFORE_STATE, after, {"refinement_targets": ["a_002"]})


# --- Batch progress narration (issue #1998, candidate 3) ---------------
#
# Both directions per check, because nothing in CI runs a validator against a
# real run - it executes only inside a paid `make eval-skill`. A validator
# that silently always skips is green forever and reads as coverage.
#
# Shapes are reduced inline. NOT because a path-reading test would age out
# under the newest-five retention - `test_conflict_resolution_validator.py:61`
# globs `v1_*.json` and survives rotation fine, since a glob picks up whichever
# logs are present. The corpus replay at the bottom of this section does
# exactly that, and is what would have caught the 128-of-132 gating rate the
# first version shipped with (#2390 review).

import glob  # noqa: E402
import json  # noqa: E402

POSITIVE = {"type": "positive", "tags": []}

# parents[2] is eval/harness (matching _VALIDATORS_DIR above); the runlogs
# live one level up under eval/. An earlier draft used parents[3] and globbed
# eval/eval/runlogs, so the replay silently skipped - the exact defect it exists
# to catch, in the replay itself.
_RUNLOGS = Path(__file__).resolve().parents[2].parent / "runlogs" / "unit"
_REPO_SKILL = (
    Path(__file__).resolve().parents[4]
    / "packages/engine/plugin/skills/record-extraction/SKILL.md"
)
_RECORD_EXTRACTION_LOGS = sorted(
    p
    for p in glob.glob(str(_RUNLOGS / "record-extraction" / "v1_*.json"))
    if not p.endswith(".ann.json")
)


def _source(source_id):
    """A source as `research.schema.json` `$defs.source` allows it.

    No `title` key: the schema sets `additionalProperties: false` and carries
    no such field. An earlier draft invented one, and its docstring spoke of
    "counting distinct source titles" for a field sources do not have. The
    count keys on `id`, so the figure was unaffected - but the fixture was
    describing a shape the writer tools would reject (#2390 review).
    """
    return {"id": source_id, "source_type": "derivative", "citation": "1850 census"}


def _states(n_new_sources, n_before=0):
    """Before/after pair differing by `n_new_sources` newly-created sources."""
    before = [_source(f"src_{i:03d}") for i in range(1, n_before + 1)]
    after = before + [
        _source(f"src_{n_before + i:03d}") for i in range(1, n_new_sources + 1)
    ]
    return {"research_json": {"sources": before}}, {"research_json": {"sources": after}}


def _checked(reply, before, after, test):
    """Run the validator, converting a skip into a failure.

    Every test below that asserts a VERDICT must go through this. Calling the
    validator directly lets a skip propagate, and pytest reports that as
    SKIPPED rather than failed - so a gate that silently stopped opening would
    leave this file green while checking nothing, the failure mode this
    validator exists to prevent. Measured: mutating the gate closed turns the
    firing tests into skips and the suite stays green.
    """
    try:
        check_batch_progress(reply, before, after, test)
    except pytest.skip.Exception as exc:  # noqa: PT012
        raise AssertionError(f"validator skipped instead of checking: {exc}") from exc


# --- fires / stays quiet -----------------------------------------------


def test_batch_progress_fires_when_the_only_record_is_not_announced():
    """The live case: on v1_2026-09-09_17-11-04, ut_record_extraction_003 and
    _023 extract a record and never state a count. _023 gets as far as "I'll
    log it now, then delegate extraction" without doing it."""
    before, after = _states(1)
    with pytest.raises(AssertionError, match=r"position\(s\) \[1\] were never"):
        _checked("Good, tools are loaded. Let me read the project context.", before, after, POSITIVE)


def test_batch_progress_quiet_on_the_single_record_announcement():
    """Verbatim from ut_record_extraction_006 on that same log."""
    before, after = _states(1)
    reply = "**1 record to extract - delegating now.**\n\n**1 of 1:** United States Census, 1850"
    _checked(reply, before, after, POSITIVE)


def test_batch_progress_quiet_when_each_of_two_is_announced():
    before, after = _states(2)
    reply = "Two documents.\nRecord 1 of 2: the 1880 census.\nRecord 2 of 2: the register."
    _checked(reply, before, after, POSITIVE)


def test_batch_progress_accepts_the_slash_spelling():
    """A legitimate variant the check must not reject, or it gets `skip`ped
    within a month."""
    before, after = _states(2)
    _checked("Extracting.\n1/2: the census.\n2/2: the register.", before, after, POSITIVE)


# --- the anchor: ratios this skill narrates are not position markers ----


def test_batch_progress_does_not_count_a_confidence_score():
    """`record_person_matches` returns confidence scores, so `N/M` is routine
    narration here. Numerator deliberately 1: a ratio like `4/5` would leave
    position 1 missing and fire anyway, pinning nothing. Under the unanchored pattern ut_record_extraction_008 and
    _007 "passed" on `confidence 4/5` and `5/5` (#2390 review)."""
    before, after = _states(1)
    with pytest.raises(AssertionError, match="never"):
        _checked("Match found with confidence 1/5. Extraction complete.", before, after, POSITIVE)


def test_batch_progress_does_not_count_ages_or_roles():
    """ut_record_extraction_022 passed on `two adults ~48/45`; _020 on
    `child_1/2/3` roles."""
    before, after = _states(1)
    with pytest.raises(AssertionError, match="never"):
        _checked("Household: two adults ~48/45, roles child_1/2/3.", before, after, POSITIVE)


def test_batch_progress_does_not_count_census_mortality_prose():
    """The one that lands hardest for a genealogy tool: `2 of 3 children
    survived` is ordinary census prose, not a progress marker."""
    before, after = _states(1)
    with pytest.raises(AssertionError, match="never"):
        _checked("The schedule records 1 of 3 children survived.", before, after, POSITIVE)


def test_batch_progress_does_not_count_an_american_date():
    before, after = _states(1)
    with pytest.raises(AssertionError, match="never"):
        _checked("Enumerated 1/14/1880 in district 12/3.", before, after, POSITIVE)


# --- which positions appeared, not how many markers ---------------------


def test_batch_progress_fires_when_a_middle_position_is_skipped():
    """Dies without `assert not missing`. Counting markers instead would see
    two markers for two records and pass, even though record 1 was never
    announced (#2390 review)."""
    before, after = _states(2)
    reply = "Record 2 of 2: the register.\nRecord 2 of 2: again."
    with pytest.raises(AssertionError, match=r"position\(s\) \[1\] were never"):
        _checked(reply, before, after, POSITIVE)


def test_batch_progress_ignores_a_denominator_below_the_record_count():
    """Dies without the `int(total) >= n` filter. "1 of 2" in a three-record
    run names a batch that is not the one being run, so it must not satisfy
    position 1. The existing test only exercised the permissive direction."""
    before, after = _states(3)
    with pytest.raises(AssertionError, match=r"position\(s\) \[1, 2, 3\] were never"):
        _checked("Record 1 of 2: the census.", before, after, POSITIVE)


def test_batch_progress_accepts_a_denominator_above_the_record_count():
    """Announcing three and extracting two is a dropped record - a different
    defect, which this validator must not also fail for."""
    before, after = _states(2)
    _checked("Record 1 of 3: the census.\nRecord 2 of 3: the register.", before, after, POSITIVE)


# --- counting records ---------------------------------------------------


def test_batch_progress_counts_a_retry_as_one_record():
    """The regression that cost a paid run. The first version counted
    `extraction_append` calls; two identical calls against one Agent
    delegation is a retry, and it failed two runs that had complied. Counting
    sources is immune: a retry writes the same source."""
    before, after = _states(1)
    _checked("**1 record to extract.** **1 of 1:** the 1850 census.", before, after, POSITIVE)


def test_batch_progress_ignores_sources_that_already_existed():
    before, after = _states(1, n_before=3)
    _checked("**1 of 1:** the 1850 census.", before, after, POSITIVE)


def test_batch_progress_skips_when_nothing_was_extracted():
    """The gate, asserted rather than left to propagate."""
    before, after = _states(0)
    with pytest.raises(pytest.skip.Exception, match="no record extracted"):
        check_batch_progress("I could not read the record.", before, after, POSITIVE)


def test_batch_progress_skips_a_negative_test():
    before, after = _states(1)
    with pytest.raises(pytest.skip.Exception, match="only positive tests"):
        check_batch_progress("", before, after, {"type": "negative", "tags": []})


# --- corpus replay ------------------------------------------------------


def _corpus_runs():
    """(log name, test id, before_state, after_state, text_response) per run.

    States are reconstructed from each run's own committed `file_changes`
    record, which is what the harness diffs.
    """
    for path in _RECORD_EXTRACTION_LOGS:
        log = json.loads(Path(path).read_text(encoding="utf-8"))
        for t in log.get("tests", []):
            for r in t.get("runs", []):
                out = r.get("output") or {}
                rj = (out.get("file_changes") or {}).get("research.json") or {}
                added = ((rj.get("diff") or {}).get("sources") or {}).get("added") or []
                before = {"research_json": {"sources": []}}
                after = {"research_json": {"sources": list(added)}}
                yield Path(path).name, t.get("test_id"), before, after, out.get("text_response") or ""


def test_the_corpus_replay_tracks_whether_the_skill_states_the_rule():
    """Replay over every committed run log, keyed on whether the rule exists.

    This is the test the first version lacked, and its absence is why a
    128-of-132 gating rate shipped unnoticed (#2390 review).

    The expected result depends on something outside this file: the rule lives
    in `record-extraction/SKILL.md` on PR #2391. So the assertion branches on
    whether the shipped body states it, which turns the merge dependency from a
    sentence in a PR body into something that fails if it is got wrong.

      - Rule absent (this branch): every evaluated run must fire. If some
        passed, the check is matching narration that is not a position marker
        - the false-positive family that made four runs "pass" on `4/5`
        confidence scores and `2 of 3 children survived`.
      - Rule present (once #2391 lands): some must pass, or the skill is being
        failed for a rule it was given and cannot follow.

    Either way it must evaluate something: a dormant check reads as coverage.
    """
    if not _RECORD_EXTRACTION_LOGS:
        pytest.skip("no committed record-extraction run logs to replay")

    body = _REPO_SKILL.read_text(encoding="utf-8") if _REPO_SKILL.exists() else ""
    rule_is_shipped = "Announce before delegating" in body

    fired, passed, skipped = [], [], 0
    for name, test_id, before, after, reply in _corpus_runs():
        try:
            check_batch_progress(reply, before, after, POSITIVE)
        except pytest.skip.Exception:
            skipped += 1
        except AssertionError:
            fired.append((name, test_id))
        else:
            passed.append((name, test_id))

    evaluated = len(fired) + len(passed)
    assert evaluated, (
        f"the check evaluated no committed run at all ({skipped} skipped) - "
        f"it is dormant, which reads as coverage while asserting nothing"
    )

    if rule_is_shipped:
        assert passed, (
            f"SKILL.md states the rule, yet the check fired on all {evaluated} "
            f"evaluated runs. Either the instruction does not hold at all, or "
            f"the marker pattern does not match what the skill emits."
        )
    else:
        assert not passed, (
            f"SKILL.md does not state the rule on this branch, yet "
            f"{len(passed)} of {evaluated} runs satisfied the check: "
            f"{passed[:5]}. Those are false positives - the pattern is "
            f"matching narration that is not a position marker."
        )
