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

_SKILL_SNAPSHOT_KEY = "packages/engine/plugin/skills/record-extraction/SKILL.md"

# Returned when a log carries no snapshot entry for SKILL.md — a renamed or
# moved skill, not a real hash. Spelled distinctly so an all-missing breakdown
# cannot be read as "one surviving hash", which is the opposite diagnosis.
_NO_SNAPSHOT = "<no-snapshot-entry>"

# log name -> SKILL.md snapshot hash, filled by `_corpus_runs()`.
_SKILL_HASH_BY_LOG: dict[str, str] = {}


def _source(source_id):
    """A source as `research.schema.json` `$defs.source` allows it.

    Complete against `$defs.source`: all seven required keys, no eighth. The
    schema sets `additionalProperties: false`, so an invented key describes a
    shape the writer tools would reject, and two got in before this: `title`
    (never a source field) and `source_type` (the field is
    `source_classification`, and `derivative` is one of its three enum
    values). The count keys on `id`, so neither moved a figure - but a fixture
    that would not validate is not a fixture (#2390 review).
    """
    return {
        "id": source_id,
        "gedcomx_source_description_id": f"sd_{source_id}",
        "citation": "1850 U.S. census, Kings County, New York, population schedule.",
        "citation_detail": {
            "who": "United States Bureau of the Census",
            "what": "1850 U.S. census, population schedule",
            "when_created": "1850",
            "when_accessed": "2026-09-16",
            "where": "FamilySearch",
            "where_within": "Kings County, New York, dwelling 214",
        },
        "source_classification": "derivative",
        "repository": "FamilySearch",
        "access_date": "2026-09-16",
    }


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
    reply = (
        "Two documents. Now delegating — **1 of 2: the 1880 census.**\n"
        "Now delegating — **2 of 2: the parish register.**"
    )
    _checked(reply, before, after, POSITIVE)


# --- legitimate variants the check must NOT reject ------------------------
#
# Every string below is verbatim from `v1_2026-09-11_18-49-21`, the first run
# made with the SKILL.md rule (PR #2391). Synthetic phrasings were what let the
# previous anchor look calibrated while matching none of them (#2390 review).


def test_batch_progress_accepts_the_emphasised_spelling():
    """`**1 of 1: <record>`, the skill's most common shape. The previous
    anchor required a bare digit against a keyword or a colon, so every
    emphasised marker read as an accident."""
    before, after = _states(1)
    _checked(
        "Log entry `log_001` created. Now delegating — **1 of 1: Vine Street "
        "Hill Cemetery burial register**",
        before,
        after,
        POSITIVE,
    )


def test_batch_progress_accepts_emphasis_closing_before_the_colon():
    """`**1 of 1:** <record>` - the emphasis closes between the digits and the
    colon, which the colon branch of the previous anchor could not reach."""
    before, after = _states(1)
    _checked(
        "Log entry **log_001** created. **1 of 1:** Delegating the 1850 US "
        "Federal Census",
        before,
        after,
        POSITIVE,
    )


def test_batch_progress_accepts_a_marker_with_no_colon_at_all():
    """`delegating **1 of 1** to the record-extractor` carries no colon and no
    keyword from the old list, so it matched nothing before."""
    before, after = _states(1)
    _checked(
        "Logged as `log_001`. Now delegating **1 of 1** to the "
        "record-extractor agent.",
        before,
        after,
        POSITIVE,
    )


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
    reply = (
        "Now delegating — **2 of 2: the register.**\n"
        "Now delegating — **2 of 2: again.**"
    )
    with pytest.raises(AssertionError, match=r"position\(s\) \[1\] were never"):
        _checked(reply, before, after, POSITIVE)


def test_batch_progress_ignores_a_denominator_below_the_record_count():
    """Dies without the `int(total) >= n` filter. "1 of 2" in a three-record
    run names a batch that is not the one being run, so it must not satisfy
    position 1.

    The reply carries a delegation verb deliberately. The earlier fixture read
    "Record 1 of 2: the census." with no verb, so the proximity anchor rejected
    the marker before the denominator filter was ever reached, and relaxing
    `>= n` to `>= 0` left the whole file green (#2390 review). A test for an
    inner filter has to get past the outer one first.
    """
    before, after = _states(3)
    with pytest.raises(AssertionError, match=r"position\(s\) \[1, 2, 3\] were never"):
        _checked(
            "Now delegating — **1 of 2: the census.**", before, after, POSITIVE
        )


def test_batch_progress_accepts_a_denominator_above_the_record_count():
    """Announcing three and extracting two is a dropped record - a different
    defect, which this validator must not also fail for."""
    before, after = _states(2)
    reply = (
        "Now delegating — **1 of 3: the census.**\n"
        "Now delegating — **2 of 3: the register.**"
    )
    _checked(reply, before, after, POSITIVE)


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
    _checked(
        "Now delegating — **1 of 1:** the 1850 census.", before, after, POSITIVE
    )


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

    Also populates `_SKILL_HASH_BY_LOG` as it goes, so the replay can group
    runs by the SKILL.md a run was actually made against without re-reading
    and re-parsing multi-megabyte logs once per log name.
    """
    for path in _RECORD_EXTRACTION_LOGS:
        log = json.loads(Path(path).read_text(encoding="utf-8"))
        name = Path(path).name
        _SKILL_HASH_BY_LOG[name] = str(
            (log.get("snapshot") or {}).get(_SKILL_SNAPSHOT_KEY, _NO_SNAPSHOT)
        )
        for t in log.get("tests", []):
            for r in t.get("runs", []):
                out = r.get("output") or {}
                rj = (out.get("file_changes") or {}).get("research.json") or {}
                added = ((rj.get("diff") or {}).get("sources") or {}).get("added") or []
                before = {"research_json": {"sources": []}}
                after = {"research_json": {"sources": list(added)}}
                yield name, t.get("test_id"), before, after, out.get("text_response") or ""


def test_the_corpus_replay_tracks_whether_the_skill_states_the_rule():
    """Replay over every committed run log, keyed on whether the rule exists.

    This is the test the first version lacked, and its absence is why a
    128-of-132 gating rate shipped unnoticed (#2390 review).

    #2391 has merged, so `SKILL.md` states the rule and the branch this test
    used to carry - "rule absent, so every run must fire" - is unreachable.
    It is asserted directly instead: if the rule is reworded out of the body,
    this says so by name rather than through a failure message about the
    marker pattern.

    The corpus is **not** uniform, and an earlier draft of this docstring said
    it was ("every committed run predates #2391"). That was wrong, and wrong in
    the way that matters: the passes are not spread across the corpus, they are
    all in one log. Measured per run log, 2026-09-17:

        log                       evaluated  fired  passed
        v1_2026-09-10_18-31-13           27     27       0
        v1_2026-09-10_19-13-32           27     27       0
        v1_2026-09-10_21-29-20           27     27       0
        v1_2026-09-11_18-49-21           27      2      25   <- the only passes
        TOTAL                           108     83      25

    `v1_2026-09-11_18-49-21` landed with #2391 (`7b836f499`) and is the first
    run made *with* the rule; the other three share one SKILL.md snapshot hash
    and predate it. So the two assertions below pin different populations:
    `fired` rests on the pre-rule logs, `passed` rests entirely on the with-rule
    one.

    That split is why this test partitions by the snapshot's SKILL.md hash and
    prints it on failure. Retention keeps a bounded number of logs, so the
    pre-rule three will rotate out. `fired` does not go to zero when they do —
    the with-rule log fires twice on its own, `ut_record_extraction_020` and
    `_028`, both genuine non-announcements — but the margin thins from 83 to 2,
    and a red then means something quite different from a broken matcher.
    Counting distinct SKILL.md hashes is what separates the two readings, and
    both failure messages say which one applies. The numbers above will drift
    as logs rotate — the shape is the claim, not the arithmetic.
    """
    if not _RECORD_EXTRACTION_LOGS:
        pytest.skip("no committed record-extraction run logs to replay")

    body = _REPO_SKILL.read_text(encoding="utf-8") if _REPO_SKILL.exists() else ""
    assert "Announce before delegating" in body, (
        "record-extraction/SKILL.md no longer states the announce-before-"
        "delegating rule (#2391). This check gates runs against it, so either "
        "restore the wording or retire the validator."
    )

    fired, passed, skipped = [], [], 0
    by_log: dict[str, list[int]] = {}
    for name, test_id, before, after, reply in _corpus_runs():
        row = by_log.setdefault(name, [0, 0])
        try:
            check_batch_progress(reply, before, after, POSITIVE)
        except pytest.skip.Exception:
            skipped += 1
            continue
        except AssertionError:
            fired.append((name, test_id))
            row[0] += 1
        else:
            passed.append((name, test_id))
            row[1] += 1

    breakdown = "\n".join(
        f"      {log:32} fired={row[0]:3} passed={row[1]:3}"
        f"  skill={_SKILL_HASH_BY_LOG.get(log, _NO_SNAPSHOT)[:12]}"
        for log, row in sorted(by_log.items())
    )
    distinct_skills = {_SKILL_HASH_BY_LOG.get(log, _NO_SNAPSHOT) for log in by_log}

    evaluated = len(fired) + len(passed)
    assert evaluated, (
        f"the check evaluated no committed run at all ({skipped} skipped) - "
        f"it is dormant, which reads as coverage while asserting nothing"
    )

    assert passed, (
        f"the check fired on every one of the {evaluated} evaluated runs, so "
        f"nothing the skill actually emits satisfies it. Look at the with-rule "
        f"log first - the passes have always come from there alone:\n{breakdown}"
    )
    assert fired, (
        f"the check passed all {evaluated} evaluated runs, so nothing in the "
        f"corpus is a non-announcement. Read the SKILL.md hashes below before "
        f"blaming the marker pattern: {len(distinct_skills)} distinct value(s) "
        f"across {len(by_log)} log(s). More than one means both populations "
        f"are still present and the pattern really has started matching "
        f"everything. Exactly one means the pre-#2391 baseline has rotated "
        f"out, and what remains is with-rule runs, which mostly announce "
        f"correctly - a thinner signal, not a broken matcher:\n{breakdown}"
    )


# --- the anchor, pinned in both directions (#2390 round-2 review) ---------


def test_position_marker_rejects_ratio_accidents():
    """@Praise-Enato's round-2 list, in one place. Delete the proximity
    requirement and every one of these dies.

    The previous keyword-or-colon anchor accepted all six - `page`, `file`,
    `doc` and `item` were keywords, and `Step 1 of 3:` reached the colon
    branch.

    Every numerator here is 1, and that is the whole point: the run has one
    record, so the check fires unless position **1** is announced. A string
    like `confidence 4/5` leaves position 1 missing whatever the anchor does,
    so it would pass with the anchor deleted and pin nothing. Six such strings
    were in this list until the #2390 round-3 review; the ratio family they
    came from is covered above, each rewritten to a 1 numerator.
    """
    before, after = _states(1)
    for reply in (
        "The household spans page 1 of 2 of the 1850 schedule.",
        "Step 1 of 3: read the project context.",
        "Checklist item 1 of 4: log the record.",
        "Citation: NARA microfilm M432, roll 444, file 1 of 2.",
        "the entry is on doc 1 of 2 in the packet",
        "Coverage of the stated questions is 1 of 3: q_001 only.",
    ):
        with pytest.raises(AssertionError, match=r"were never"):
            _checked(reply, before, after, POSITIVE)


# An ARK-beside-extraction-language case was here until the #2390 round-3
# review. It claimed to pin the `of`-as-a-word separator and the digit guards,
# and pinned neither: `ark:/61903/1:1:CRYM-V53Z` is silent under the shipped
# pattern, under `/` as a separator, with both guards removed, and under the
# original `(?<!\d)…(?:of|/)…` this branch started from. The leading `61903`
# is five digits, so the only pair `\d{1,3}` can reach is `903/1` - numerator
# 903, never 1. The test could not fail under any pattern this branch has had,
# which is the shape CLAUDE.md calls worse than no check at all.


def test_position_marker_digit_guards_are_pinned_separately():
    """`(?<![\\d/])` and `(?![\\d/])` each do real work, and each is pinned here.

    The deleted ARK test claimed this coverage and never had it, so retiring it
    removed a false claim rather than a real check - but that left the guards
    unpinned by any mutation (#2390 round-4 review). These two strings close it,
    and they fail on *different* halves, so no single-guard mutation survives:

        "...record 1 of 2/3..."      the TRAILING guard; drop it and `1 of 2`
                                     matches inside `2/3`, yielding position 1
        "...frame 12/1 of 2..."      the LEADING guard; drop it and `1 of 2`
                                     matches inside `12/1`, yielding position 1

    Both carry a delegation verb deliberately, so the proximity anchor admits
    them and the digit guards are the only thing standing between the string
    and a false position 1.
    """
    before, after = _states(1)
    for reply in (
        "Delegating record 1 of 2/3 in the bundle.",
        "Extracting from frame 12/1 of 2 of the film.",
    ):
        with pytest.raises(AssertionError, match=r"were never"):
            _checked(reply, before, after, POSITIVE)


def test_a_marker_with_no_delegation_verb_is_not_counted():
    """The anchor itself: a ratio with no delegation verb anywhere is not a
    position marker, at any window."""
    before, after = _states(1)
    reply = (
        "No open questions, no prior sources. Log entry: **log_001**.  "
        "**1 of 1:** 1870 U.S. Census, household of Patrick Flynn"
    )
    with pytest.raises(AssertionError, match=r"were never"):
        _checked(reply, before, after, POSITIVE)


def test_anchor_window_is_calibrated():
    """`_ANCHOR_WINDOW` from both sides, because a number argued in a comment
    is not a number a test can tell from its opposite (#2390 review).

    The first reply is `ut_record_extraction_022`'s shape, verbatim: the verb
    trails the marker past an ARK, roughly 90 characters away. It is a real
    announcement and must count, which is what rules out a window below ~100.

    The second puts the verb far enough out that no plausible narration would
    connect the two. It must NOT count, which is what rules out an unbounded
    window - without an upper bound any run mentioning extraction anywhere
    would satisfy any ratio anywhere.

    Lower the window to 60 and the first fails; remove the bound and the
    second fails.
    """
    before, after = _states(1)

    near = (
        "Log entry: **log_001**.  **1 of 1:** 1870 U.S. Census, household of "
        "John Baker — ark:/61903/1:1:M62F-BST. Delegating to record-extractor."
    )
    _checked(near, before, after, POSITIVE)  # counts

    far = (
        "**1 of 1:** 1870 U.S. Census, household of John Baker. "
        + ("Census pages were read in order and the household transcribed. " * 5)
        + "Delegating to the record-extractor now."
    )
    with pytest.raises(AssertionError, match=r"were never"):
        _checked(far, before, after, POSITIVE)


def test_batch_progress_stays_reporting_only():
    """The `report_` tier, held by a test rather than by the function's name.

    `validator_runner` decides the tier from the prefix alone, so renaming this
    to `test_` would silently promote it into a gate - and a gate whose subject
    is narration would fail runs the rubric deliberately does not grade. The
    previous round's promotion left the whole file green (#2390 review).
    """
    from harness.validator_runner import run_validators  # noqa: E402

    before, after = _states(1)
    results = run_validators(
        skill="record-extraction",
        validators_dir=_VALIDATORS_DIR,
        before_state=before,
        after_state=after,
        tool_calls=[],
        test=POSITIVE,
        text_response="Now delegating — **1 of 1:** the 1850 census.",
    )
    rows = [
        r
        for r in results
        if r.name == "report_a_multi_record_batch_announces_each_record_position"
    ]
    assert rows, "the batch-progress validator did not run at all"
    assert rows[0].reporting_only is True, (
        "batch progress is report_ tier by design - it grades narration, which "
        "the rubric excludes from scoring. Promoting it to test_ makes it gate "
        "the run outcome."
    )
