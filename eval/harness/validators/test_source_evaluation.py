"""Skill-specific validators for the source-evaluation skill.

source-evaluation is a read-only audit skill: it enumerates the sources
already attached to a person, reads each one, classifies what disagrees
with the profile, and reports. It writes nothing.

The rubric (rubric.md) keeps the prose-judgment dimensions — whether a
classification's cue is convincing, whether the report reads as triaged.
What lives here is the one rule that is a literal property of the text
and must not be left to a judge's mood: on a test that declares an index
discrepancy, the remedy must be a re-read and must not be a detach. That
is doctrine point 1 of issue #1606, and it is the thing the live agent
got wrong in feedback case #1536.

The check is gated on the `index-discrepancy` tag rather than inferred
from the transcript. `validator_runner.py`'s `text_response` contract is
explicit that a validator may assert a literal, falsifiable property of
the text but must not re-grade prose quality; deciding for itself which
finding is an index error would be exactly that. The tests declare the
situation; the validator asserts the rule.

Tool-usage enforcement is the universal `test_tool_allowlist`'s job — it
validates calls against the skill's own `allowed-tools` frontmatter, which
is where the absence of `image_read` and `image_transcribe` is enforced.

See test_universal.py module docstring for the full validator
function-signature contract.
"""

from __future__ import annotations

import re

import pytest

# Phrases that recommend severing the source from the person. Matched
# case-insensitively as whole words so "detached" and "detaching" count
# while an unrelated substring does not.
_DETACH_TERMS = ("detach", "detaching", "detached", "unlink", "unlinking", "unlinked")

# Phrases that recommend going back to the original image. "re-read",
# "reread" and "read the original" are all live in the skill body and in
# a genealogist's own vocabulary.
# The rule is "send the researcher back to what the index was made from", not
# the literal word "re-read". The corpus's index error sits on the Minnesota
# Death Index — "database, FamilySearch", index-only, no scan — so a correct
# report must NOT say "re-read the image" there, and SKILL.md says so. A
# pattern that only matched re-read phrasings would fail that behaviour.
#
# WIDENED 2026-09-08 from the run log, not from imagination. On
# `v1_2026-09-08_14-22-00.json`, `ut_source_evaluation_m8q` failed this guard
# with a reply that followed the doctrine *better* than the pattern
# anticipated. It said, of the index-only death index: "there is no scan to
# open behind this index entry. The source of truth is the underlying
# Minnesota death certificate", then "Submit a correction to this index entry
# through FamilySearch's correction process ... locate the original Minnesota
# death certificate". Every clause of that is the rule, and the pattern matched
# none of it — it wanted "correction path" (the reply said "correction
# process"), "correct the index" (the reply said "submit a correction to this
# index entry"), and "read/check the original" (the reply said "locate the
# original ... certificate").
#
# So the enumeration was the defect. The remedy is one of three moves, and the
# alternatives below are grouped that way rather than as a flat list of
# phrasings: go back to the document the index was made from, go back to the
# underlying document under any verb, or use the index's own correction route.
# A reply that recommends only detaching still matches nothing here.
_GO_TO_SOURCE_PATTERN = re.compile(
    # Re-reading, in any spelling.
    r"re-?read"
    # Any verb applied to "the original ..." — the earlier pattern fixed the
    # verb (read/check) and the noun (image/record/page), so "locate the
    # original certificate" and "obtain the original register" both missed.
    r"|the original\s+\w+"
    # The document the index derives from, named as such.
    r"|underlying\s+\w+"
    r"|source of truth"
    r"|go(ing)? back to"
    r"|derive[sd]? from"
    r"|was made from"
    # FamilySearch's correction route on the index entry itself — the only
    # remedy available where the collection is index-only and no scan exists.
    r"|correction (path|process|route)"
    r"|correct the index"
    r"|correction to (the|this) index"
    r"|submit a correction"
    r"|index correction",
    re.IGNORECASE,
)

# Identifies a closing summary or recap, which carries SEVERAL sources' remedies
# in one sentence and so is the wrong unit to judge whole. `_passages` splits one
# on clause boundaries; it does not skip it. That distinction is the whole point
# of this constant, and getting it wrong once is why the comment is this long.
#
# It exists because of a FALSE POSITIVE: `ut_source_evaluation_r4k` failed the
# detach guard on a passage that is correct — "**Summary:** One index correction
# needed (the 1945 death year in the Minnesota Death Index) and one detachment
# warranted (the 1885 Otter Tail County census, which belongs to an older
# Christian Hole)." Two sources, two different remedies, each attached to the
# right one, and blank-line blocks put them in one passage.
#
# Sectioning on markdown headings does NOT fix that, which is worth recording so
# it is not retried: in that reply the summary sits inside the "### No finding —
# United States Census, 1900" section, so a heading-scoped guard puts the
# protected name and "detachment" in one section anyway.
#
# SKIPPING the recap block was the first fix and it was WRONG — a false negative
# in the one guard that stops an unrecoverable action, which is strictly worse
# than the false positive it removed. The skill puts its real recommendation in
# the recap routinely: 2 of 10 tests in `v1_2026-09-08_15-53-39` did, and
# "**Conclusion:** Detach the Minnesota Death Index" passed silently. Clause
# splitting separates the two remedies without dropping either.
_SUMMARY_LEAD_RE = re.compile(
    r"^\W{0,4}(summary|recap|in short|in summary|overall|conclusion|"
    r"bottom line|net)\b",
    re.IGNORECASE,
)

_TABLE_ROW_RE = re.compile(r"^\s*\|")

# Clause boundaries inside a recap sentence. A recap reads "correct the death
# year on X (Finding 1), detach the 1885 census (Finding 2), and the rest are
# fine" — each remedy is its own clause naming its own source, so splitting
# here attributes them separately. The `(?<=\))\s*,` arm splits only on a comma
# that follows a closing paren, which is what separates those parenthesised
# findings without also splitting a source's own comma'd title ("Minnesota
# Death Index, 1908-2002").
_CLAUSE_RE = re.compile(r"(?:;|\s+and\s+|(?<=\))\s*,\s*|\.\s+)")


def _passages(text: str) -> list[str]:
    """Split a report into the units that carry ONE source's remedy.

    The guard's premise is that a passage recommending a detach names the
    source it is detaching, so co-occurrence within a passage is attribution.
    Blank-line blocks are a poor unit for that, and the corpus has now produced
    two different report shapes where they fail — both of them CORRECT reports:

    - A closing recap naming two sources and their two different remedies in
      one sentence (`ut_source_evaluation_r4k`, `v1_2026-09-08_14-22-00.json`).
      Handled by `_SUMMARY_LEAD_RE` at the call site.
    - A per-source verdict TABLE (`ut_source_evaluation_x6b`,
      `v1_2026-09-08_15-25-07.json`). Markdown tables carry no blank lines, so
      every row lands in one block: the Minnesota Death Index row read
      "Belongs, but the indexed death year reads 1954 — correct it to 1945 via
      the original certificate" and the row below it read "Detach — it is about
      a different Christian Hole". Exactly right, and flagged.

    A table row is the per-source unit the guard wants, so rows are split out
    and judged individually. Everything else keeps the blank-line block.

    Three shapes needing bespoke handling, each found inside a paid run, is the
    signal worth recording: this guard is lexical and attribution is not, so
    the shape of the report decides whether it is right. Handle a new shape
    here rather than loosening the rule that fires, and keep `rubric.md`'s
    Remediation doctrine bars as the judgment-based backstop. **Issue #2382**
    owns the durable fix — narrowing to object-adjacency so shape stops
    mattering — and records the measured constraint that passage-scoping
    `_GO_TO_SOURCE_PATTERN` breaks 23 of 24 committed positive runs.
    """
    out: list[str] = []
    for block in re.split(r"\n\s*\n", text):
        rows = [ln for ln in block.splitlines() if _TABLE_ROW_RE.match(ln)]
        if rows:
            # A table's rows are separately attributed; its prose lead-in (if
            # any) is still one passage.
            out.extend(rows)
            prose = "\n".join(
                ln for ln in block.splitlines() if not _TABLE_ROW_RE.match(ln)
            )
            if prose.strip():
                out.append(prose)
        elif _SUMMARY_LEAD_RE.match(block.strip()):
            # A recap is one sentence carrying several sources' remedies, so
            # the block is the wrong unit — but SKIPPING it is worse than
            # judging it whole, because the skill routinely puts its real
            # recommendation only in the recap. Split on clause boundaries and
            # judge each clause, so "correct the death index, detach the 1885
            # census" attributes each remedy to its own source while
            # "Conclusion: detach the Minnesota Death Index" still fires.
            out.extend(c for c in _CLAUSE_RE.split(block) if c and c.strip())
        else:
            out.append(block)
    return out


def _requires_index_discrepancy(test) -> None:
    """Skip unless this test declares an index discrepancy in its tags."""
    if "index-discrepancy" not in (test.get("tags") or []):
        pytest.skip("test does not declare an index discrepancy")
    if test.get("type") != "positive":
        pytest.skip("negative tests route away and produce no audit")


def test_index_discrepancy_recommends_reread(text_response, test):
    """Doctrine point 1: re-read the record, do not detach the source.

    On a fact conflict that looks like a transcription or indexing error,
    the first-line remedy is re-reading the original image and correcting
    the index. Feedback case #1536: the agent effectively advised
    detaching, and the tester instead re-read the image, corrected the
    index, and kept the source attached.
    """
    _requires_index_discrepancy(test)
    assert _GO_TO_SOURCE_PATTERN.search(text_response), (
        "source-evaluation reported on an index discrepancy without "
        "recommending a re-read of the original record. Doctrine point 1 "
        "of issue #1606: for a fact conflict that looks like a "
        "transcription or indexing error, the first-line remedy is to "
        "re-read the original image and correct the index."
    )


def test_index_discrepancy_does_not_recommend_detaching(text_response, test):
    """The other half of doctrine point 1, and the one that actually failed.

    Detaching is reserved for a source genuinely about a different person.
    Recommending it for a mis-transcribed field discards good evidence and
    leaves the bad field in the index for the next researcher.

    Scoped to the ONE source the test declares as the index error, via
    `index_error_source`. An earlier version asked only whether the reply
    mentioned a misattribution anywhere before allowing the word "detach"
    anywhere — and since this corpus always contains a genuinely
    misattributed source (HOLE-003), a correct report always granted that
    licence, so the assertion could never fail: a reply hedging "re-read the
    original and correct the index, or detach the source if you prefer" on
    the index error passed, while rubric.md grades that hedge `partial`.
    Scoping to the declared source keeps the module's contract — the test
    declares the situation, the validator asserts the rule.
    """
    _requires_index_discrepancy(test)
    protected = test.get("index_error_source")
    assert protected, (
        "this test is tagged `index-discrepancy` but no `index_error_source` "
        "reached the validator, so the detach guard has nothing to scope to "
        "and asserts nothing. Either the test JSON is missing the top-level "
        "`index_error_source` field, or the orchestrator stopped threading it "
        "into the validator-facing `test` dict — the whitelist literal in "
        "`orchestrator.py`'s `run_validators(... test={...})` call. Skipping "
        "here is what let this guard run on zero tests once already."
    )
    hits = [
        block
        for block in _passages(text_response)
        if protected.lower() in block.lower()
        and any(term in block.lower() for term in _DETACH_TERMS)
    ]
    assert not hits, (
        f"source-evaluation recommended detaching or unlinking in the same "
        f"passage as {protected!r}, which this test declares to be an "
        f"indexing error. Doctrine point 1 of issue #1606 reserves detaching "
        f"for genuinely misattributed sources; an index error is fixed by "
        f"going back to what the index was made from and correcting it. "
        f"Offending passage: {hits[0][:300] if hits else ''!r}"
    )


def test_research_json_unmodified(before_state, after_state, test):
    """source-evaluation is read-only — it reports, it does not write.

    Skipped on negative tests: the run is expected to route away to
    another skill, which may legitimately write as part of its own
    contract. Mirrors the same guard in test_check_warnings.py and
    test_project_status.py.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert before == after, (
        "source-evaluation modified research.json — this skill is read-only. "
        "Findings are reported as narrative; recording a conflict is the "
        "researcher's next step through conflict-resolution, not this "
        "skill's write."
    )


def test_tree_gedcomx_unmodified(before_state, after_state, test):
    """source-evaluation must not modify the tree either.

    Skipped on negative tests (see test_research_json_unmodified).
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx")
    after = after_state.get("tree_gedcomx_json") or after_state.get("tree_gedcomx")
    if before is None or after is None:
        pytest.skip("Missing tree.gedcomx.json for diff")
    assert before == after, (
        "source-evaluation modified tree.gedcomx.json — this skill is "
        "read-only. Correcting an index happens on FamilySearch, by the "
        "researcher; detaching a source is a tree-edit decision the "
        "researcher makes after reading the report."
    )
