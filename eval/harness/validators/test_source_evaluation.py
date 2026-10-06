"""Validators for the source-evaluation agent (a skill until issue #2796).

source-evaluation is a read-only audit agent: it enumerates the sources
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
validates calls against the agent's own `tools:` frontmatter, which is
where the absence of `image_read` and `image_transcribe` is enforced.

The two reply validators grade `subject_reply_text`: on a direct test the
main thread only relays the agent's return, so `text_response` is the
relay's words, not the audit's.

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

# A detach term that is being FORBIDDEN is doctrine, not a violation of it.
# "Do not detach -- the source is good evidence for this person with one wrong
# field" is the rule stated correctly, and the guard flagged it (run
# v1_2026-09-20_13-40-15, ut_source_evaluation_p2v). Matched against the window
# immediately before each occurrence rather than anywhere in the passage: a
# blanket "passage contains a negation" skip would wave through "do not detach
# the death index, but detach the 1885 census" -- one negation and one real
# recommendation in one breath, which is the failure direction that fails
# SILENTLY and is therefore worse than the false positive it fixes.
_NEGATORS = (
    "do not", "don't", "do n't", "never", "not", "no need to", "rather than",
    "instead of", "without", "avoid", "stop short of", "nothing to",
)
# A negator counts only when at most one word separates it from the term. Any
# "not" in the clause was too loose: "the record is not about this man and
# should be detached" read the "not" of "is not about" as covering the detach.
_NEGATED_TERM = re.compile(
    r"(?:" + "|".join(re.escape(n) for n in _NEGATORS) + r")\s+(?:\w+\s+)?$"
)
_NEG_WINDOW = 40


# A negation binds only within its own clause. Without this, "do not detach the
# death index, but detach the 1885 census" reads the leading "do not" as
# covering BOTH terms and the real recommendation escapes -- the silent-failure
# direction. Dashes count: this skill writes in em-dashes, so "the record is not
# about this Christian Hole -- detach it" would otherwise read its "not" as
# covering the detach. Pinned both ways in test_source_evaluation_validator.py.
_CLAUSE_BREAKS = (
    ",", ";", ":", ".", "!", "?", "\u2014", "\u2013", " - ",
    " but ", " however ", " though ",
)


def _is_negated(text: str, at: int) -> bool:
    """True when the detach term at `at` is being ruled out rather than urged.

    Scoped to the term's OWN clause: the window is cut at the nearest preceding
    clause break, so a negation belonging to an earlier clause cannot license a
    recommendation in this one.
    """
    before = text[max(0, at - _NEG_WINDOW):at].lower()
    cut = max((before.rfind(b) + len(b) for b in _CLAUSE_BREAKS if b in before), default=0)
    return bool(_NEGATED_TERM.search(before[cut:]))


def _recommends_detach(block: str) -> bool:
    """A detach term in `block` that is not negated."""
    low = block.lower()
    for term in _DETACH_TERMS:
        start = 0
        while (i := low.find(term, start)) != -1:
            if not _is_negated(low, i):
                return True
            start = i + len(term)
    return False

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

# A list item opens a line: "- ", "* ", "+ " or "1. " / "1) ". A line that does
# not open one, inside a list, continues the item above it.
_LIST_ITEM_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")


def _list_items(block: str) -> list[str] | None:
    """A block holding two or more list items, split one passage per item.

    Each item keeps its continuation lines, so a detach written on the line
    below its source's name still lands in that source's passage. Any prose
    before the first item is a passage of its own. None when the block is not
    a list, so the caller keeps it whole.
    """
    lines = block.splitlines()
    if sum(1 for ln in lines if _LIST_ITEM_RE.match(ln)) < 2:
        return None
    out: list[str] = []
    lead: list[str] = []
    for ln in lines:
        if _LIST_ITEM_RE.match(ln):
            out.append(ln)
        elif out:
            out[-1] += "\n" + ln
        else:
            lead.append(ln)
    if "".join(lead).strip():
        out.insert(0, "\n".join(lead))
    return out

# Clause boundaries inside a recap sentence. A recap reads "correct the death
# year on X (Finding 1), detach the 1885 census (Finding 2), and the rest are
# fine" — each remedy is its own clause naming its own source, so splitting
# here attributes them separately. The `(?<=\))\s*,` arm splits only on a comma
# that follows a closing paren, which is what separates those parenthesised
# findings without also splitting a source's own comma'd title ("Minnesota
# Death Index, 1908-2002").
_CLAUSE_RE = re.compile(r"(?:;|\s+and\s+|(?<=\))\s*,\s*|\.\s+)")


# A capitalised record-title word. Case-sensitive on purpose: a title in the
# reply is capitalised ("the 1885 Minnesota State Census"), while the generic
# noun in "correct the index" is not, and must not count as naming a record.
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z*])")
_TITLE_WORDS = r"(Census|Index|Register|Registration|Collection|Records)"
_DETACH_VERB = r"(?i:detach|unlink)\w*"
# "Detach the 1885 Minnesota State Census": the verb, an optional article, any
# capitalised or digit-led words, then the title word as the verb's object.
_DETACH_ACTIVE_ON_TITLE_RE = re.compile(
    r"\b" + _DETACH_VERB + r"\s+(?:(?i:the|this|that|a|an)\s+)?"
    r"(?:[A-Z0-9][\w.'-]*\s+)*?" + _TITLE_WORDS + r"\b"
)
# "The 1885 Minnesota State Census should be detached": the title word is the
# sentence's subject. Decided by what stands directly before the verb phrase:
# the title phrase itself, or "and" / "and so" ("... and must be detached").
# Anything else there ("entry", "it", a bracket or dash) is a new subject, and
# so is a second record named before the verb ("... while the index does not
# and should be detached"): a determiner-led record word, or a bare "it".
_PASSIVE_VERB_PHRASE = r"(?:should|must|needs\s+to|is(?:\s+to)?)\s+(?:be\s+)?|be\s+"
_SECOND_RECORD = (
    r"\b(?i:(?:the|this|that|a|an|his|her|their|its|my|your|these|those)\s+"
    r"(?:[\w'-]+\s+){0,2}?"
    r"(?:index|entry|entries|records?|census|register|registration|collection"
    r"|certificate|source)|it)\b"
)
_DETACH_PASSIVE_ON_TITLE_RE = re.compile(
    r"^\W*(?:(?i:the|this|that|a|an)\s+)?(?:[A-Z0-9][\w.'-]*\s+)*?"
    + _TITLE_WORDS
    + r"\b(?:\s+|(?:(?!"
    + _SECOND_RECORD
    + r")[^.])*?\sand(?:\s+so)?\s+)(?:"
    + _PASSIVE_VERB_PHRASE
    + r")"
    + _DETACH_VERB
)


def _detach_acts_on_another_title(sentence: str, protected_lower: str) -> bool:
    """True only when the detach verb's grammatical object is a record-title
    word that `protected` does not itself contain."""
    for rx in (_DETACH_ACTIVE_ON_TITLE_RE, _DETACH_PASSIVE_ON_TITLE_RE):
        for m in rx.finditer(sentence.strip()):
            if m.group(1).lower() not in protected_lower:
                return True
    return False


def _detach_names_another_record(block: str, protected: str) -> bool:
    """True when every detach in `block` is attributed, in its own sentence, to
    a record other than `protected`.

    The fifth shape (`ut_source_evaluation_x6b`, `v1_2026-10-01_19-24-15.json`,
    issue #2796): a closing prose paragraph covering every source, with no
    "Summary:" lead and no list, keeping the Minnesota Death Index in one
    sentence and saying "The 1885 Minnesota State Census should be detached"
    in the next. One block, so the guard flagged a correct report.

    Deliberately one-sided. A passage is cleared only if each sentence carrying
    a detach term does not name `protected` and makes a record title the detach
    verb's own object ("Detach the 1885 Census", "The 1885 Census should be
    detached"). A title merely present elsewhere in the sentence ("Detach it
    and rely on the 1900 Census", "Unlike the 1900 Census, it should be
    detached") does not count, nor does a title word `protected` itself
    contains ("Detach the Death Index record."), so those stay attributed.
    """
    sentences = [x for x in _SENTENCE_RE.split(block) if x.strip()]
    detaching = [x for x in sentences if _recommends_detach(x)]
    protected_lower = protected.lower()
    return bool(detaching) and all(
        protected_lower not in x.lower()
        and _detach_acts_on_another_title(x, protected_lower)
        for x in detaching
    )


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

    - A per-source verdict LIST (`ut_source_evaluation_x6b`,
      `v1_2026-10-01_18-58-11.json`, issue #2796): one bullet per source, no
      blank lines, the Minnesota Death Index bullet reading "keep, but the
      indexed death year (1954) needs correction" and the 1885 census bullet
      two lines below it "detach". Exactly right, and flagged.

    A multi-source prose paragraph (x6b, `v1_2026-10-01_19-24-15.json`) is
    handled at the guard by `_detach_names_another_record`, sentence by
    sentence. A table row or a list item is the per-source unit the guard wants, so each
    is split out and judged individually. Everything else keeps the blank-line
    block.

    Five shapes needing bespoke handling, each found inside a paid run, is the
    signal worth recording: this guard is lexical and attribution is not, so
    the shape of the report decides whether it is right. Handle a new shape
    here rather than loosening the rule that fires, and keep `rubric.md`'s
    Remediation doctrine bars as the judgment-based backstop. **Issue #2481**
    (which absorbed #2382) owns the durable fix — narrowing to object-adjacency so shape stops
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
        elif (items := _list_items(block)) is not None:
            out.extend(items)
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


def test_index_discrepancy_recommends_reread(text_response, test, agent_returns=None):
    """Doctrine point 1: re-read the record, do not detach the source.

    On a fact conflict that looks like a transcription or indexing error,
    the first-line remedy is re-reading the original image and correcting
    the index. Feedback case #1536: the agent effectively advised
    detaching, and the tester instead re-read the image, corrected the
    index, and kept the source attached.
    """
    _requires_index_discrepancy(test)
    from harness.skill_runner import subject_reply_text

    text_response = subject_reply_text(agent_returns, text_response, "source-evaluation", test)
    assert _GO_TO_SOURCE_PATTERN.search(text_response), (
        "source-evaluation reported on an index discrepancy without "
        "recommending a re-read of the original record. Doctrine point 1 "
        "of issue #1606: for a fact conflict that looks like a "
        "transcription or indexing error, the first-line remedy is to "
        "re-read the original image and correct the index."
    )


def test_index_discrepancy_does_not_recommend_detaching(text_response, test, agent_returns=None):
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
    from harness.skill_runner import subject_reply_text

    text_response = subject_reply_text(agent_returns, text_response, "source-evaluation", test)
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
        and _recommends_detach(block)
        and not _detach_names_another_record(block, protected)
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


def test_quality_detail_call_carries_detail_flag(tool_calls, test):
    """D3 (#2225): the profile checklist rests on a call that asked for detail.

    Tier 1, tag-gated on `quality-detail`. Deterministic half of
    `ut_source_evaluation_q8p`: the judge grades how the checklist is
    presented, which it cannot do honestly if the call never carried
    `detail: true` -- without the flag the response has no `detail` block at
    all (`PersonQualityDetail` is "present only when the caller passes
    `detail: true`"), so `conflicts[]` is absent and the reply's checklist
    could only have come from the summary `issues[]`.

    Asserted here rather than in `judge_context` because it is a fact about
    the call log, not a judgement about the prose -- unit-test-spec.md:707.

    Two silent-wrong traps, both already paid for elsewhere in this repo:
    - `tool_calls` is the run's resolved call log; reading `test["tool_calls"]`
      returns [] and makes every run look compliant.
    - tool names arrive fully qualified (`mcp__genealogy__person_quality`), so
      equality-matching the bare name never fires -- use endswith().
    """
    if "quality-detail" not in (test.get("tags") or []):
        pytest.skip("test does not declare quality-detail")

    calls = [
        c for c in (tool_calls or [])
        if (c.get("tool") or "").endswith("person_quality")
    ]
    assert calls, (
        "no person_quality call in the run -- the checklist this test grades "
        "cannot have been sourced from the tool"
    )
    with_detail = [c for c in calls if (c.get("args") or {}).get("detail") is True]
    assert with_detail, (
        "person_quality was called without `detail: true`, so the response "
        "carried no `detail` block: "
        f"{[(c.get('args') or {}) for c in calls]}"
    )


#: ARKs that belong to a RELATIVE's own source in the two source-evaluation
#: fixtures, and to nothing else. Deliberately unremarkable: an earlier revision
#: used `1:1:REL-9999` on a person `REL-0001` with source `SD-REL-*`, so a model
#: could skip the entry by reading "REL" in the id and never apply the audit-list
#: rule at all -- and this validator could not tell that apart from the rule
#: working.
RELATIVE_ONLY_ARKS = ("MH7Q-9KZ", "MJ4T-2QB")


def test_a_relatives_source_is_not_audited(tool_calls, test):
    """A relative's attached source must never be `record_read` as the subject's.

    `person_read` returns the relatives' attached sources in the same `sources[]`
    array as the subject's own (issue #1689 Half 3), so "the sources array is the
    audit list" started meaning "audit the whole family". Measured on a real
    profile: 192 `record_read` calls where 17 were the subject's. Step 2 then
    recommends detaching a record that is "about a different person" -- which a
    sibling's record correctly is, so the advice is wrong and confident.

    Each fixture carries one relative-only source (`SD-HOLE-E` / `SD-DRIS-H`),
    whose ARK appears nowhere else. Nothing else grades WHICH sources were
    read, so without this the planted relative tests nothing.
    """
    read_arks = [
        str((c.get("args") or {}).get("url") or (c.get("args") or {}).get("recordId") or "")
        for c in (tool_calls or [])
        if (c.get("tool") or "").rsplit("__", 1)[-1] == "record_read"
    ]
    audited = [a for a in read_arks if any(k in a for k in RELATIVE_ONLY_ARKS)]
    assert not audited, (
        "a RELATIVE's attached source was audited as the subject's: "
        f"{audited}. `person_read`'s `sources[]` carries the relatives' sources too; "
        "the audit list is the entries `persons[0].sources[].ref` names, plus entries "
        "carrying `artifact_url`."
    )


# --- front-door gate: hand back, call nothing (tag-gated) ---

_HANDBACK_TAG_PREFIX = "handback-to-"


def test_scope_handback_calls_no_tool(tool_calls, text_response, test, agent_returns=None):
    """Tag-gated (`scope-handback`): the agent's front-door gate.

    The deterministic verdict for `ut_source_evaluation_b6h`, the direct
    hand-back test that replaced the two description-routing negatives
    deleted in issue #2796. The gate answers an out-of-scope delegation with
    one line, "Hand-back: <name> — <clause>", and calls no tool. The
    destination comes from a `handback-to-<name>` tag. That both project
    files are unchanged is already asserted on every test by the two
    unmodified-state validators above.

    Fails iff the run made any MCP tool call, or the subject's own reply
    (`subject_reply_text`: on a direct test, the agent's return and never the
    relay) names no `Hand-back:` line for the tagged destination.
    """
    tags = test.get("tags") or []
    if "scope-handback" not in tags:
        pytest.skip("not a scope-handback scenario")

    calls = [c.get("tool") for c in (tool_calls or []) if (c.get("tool") or "").startswith("mcp__")]
    assert not calls, (
        f"an out-of-scope delegation must be handed back before any tool call; got {calls}"
    )
    destinations = [t[len(_HANDBACK_TAG_PREFIX):] for t in tags if t.startswith(_HANDBACK_TAG_PREFIX)]
    assert len(destinations) == 1, (
        f"a scope-handback test needs exactly one `{_HANDBACK_TAG_PREFIX}<name>` tag; got {destinations}"
    )
    from harness.skill_runner import subject_reply_text

    reply = subject_reply_text(agent_returns, text_response, "source-evaluation", test)
    named = re.findall(r"Hand-back:\s*`?([a-z][a-z0-9-]*)", reply)
    assert destinations[0] in named, (
        f"expected a `Hand-back: {destinations[0]}` line; the reply named {named or 'no hand-back'}"
    )


def test_checklist_does_not_restate_a_finding(tool_calls, text_response, test, agent_returns=None):
    """Tag-gated (`checklist-overlap`), issue #2796 finding 3.

    A CONSISTENCY sentence from `person_quality` names a profile-vs-source
    mismatch. Where it matches a finding, printing it verbatim in the checklist
    block files that finding under "suggestions, not errors". The test declares
    that every CONSISTENCY issue in its fixture matches a finding, so none may
    appear verbatim in the reply. The sentences are read off the run's own
    `person_quality` response rather than written into this file.
    """
    if "checklist-overlap" not in (test.get("tags") or []):
        pytest.skip("test does not declare checklist-overlap")
    sentences = [
        issue["sentence"]
        for c in (tool_calls or [])
        if (c.get("tool") or "").endswith("person_quality") and isinstance(c.get("response"), dict)
        for issue in c["response"].get("issues") or []
        if issue.get("scoreType") == "CONSISTENCY" and issue.get("sentence")
    ]
    assert sentences, (
        "no CONSISTENCY issue reached the run, so this guard checks nothing: either "
        "person_quality was not called or its fixture lost the overlap issues"
    )
    from harness.skill_runner import subject_reply_text

    reply = " ".join(subject_reply_text(agent_returns, text_response, "source-evaluation", test).split())
    restated = [s for s in sentences if " ".join(s.split()) in reply]
    assert not restated, (
        "the checklist restated a finding instead of pointing to it: "
        f"{restated[0][:160]!r}"
    )


_SCORE_HEADING_RE = re.compile(r"^\W*(COHERENCE|CONSISTENCY|VERIFIABILITY|COMPLETENESS)\W*$")
_POINTER_RE = re.compile(r"\bfinding\s+\d+\s+above\b", re.IGNORECASE)
# Imperatives and modals a pointer has no business carrying. The detach and
# go-to-source vocabularies above cover the two remedies by name; this covers
# the rest ("should be removed", "keep it", "verify the year").
_POINTER_ACTION_RE = re.compile(
    r"\b(?:should|must|needs?\s+to|recommend\w*|correct(?:ed|ion)?|fix|verify|keep|remove)\b",
    re.IGNORECASE,
)


def test_checklist_pointer_carries_no_action(text_response, test, agent_returns=None):
    """Tag-gated (`checklist-overlap`), issue #2796 finding 3.

    The pointer replaces a restated CONSISTENCY sentence so the block files no
    finding twice. A pointer that repeats the finding's remedy ("finding 3 above
    (the record is misattributed and should be detached)", o3c,
    v1_2026-10-02_10-48-01) files it twice anyway, under "suggestions". Reads
    only the CONSISTENCY group, so a finding's own "Next:" line is out of scope,
    and fails when that group holds no pointer, since then it checks nothing.
    """
    if "checklist-overlap" not in (test.get("tags") or []):
        pytest.skip("test does not declare checklist-overlap")
    from harness.skill_runner import subject_reply_text

    reply = subject_reply_text(agent_returns, text_response, "source-evaluation", test)
    group: list[str] | None = None
    for line in reply.splitlines():
        heading = _SCORE_HEADING_RE.match(line.strip())
        if heading:
            if group is not None:
                break
            if heading.group(1) == "CONSISTENCY":
                group = []
        elif group is not None:
            group.append(line)
    pointers = [line for line in group or [] if _POINTER_RE.search(line)]
    assert pointers, (
        "no pointer line under a CONSISTENCY heading, so this guard checks nothing: "
        "the group is missing, unheaded, or carries no 'finding N above'"
    )
    acting = [
        p for p in pointers
        if _recommends_detach(p) or _GO_TO_SOURCE_PATTERN.search(p) or _POINTER_ACTION_RE.search(p)
    ]
    assert not acting, f"a checklist pointer carries an action: {acting[0].strip()[:200]!r}"


#: A FamilySearch person id: four characters, a hyphen, three characters.
_FS_PERSON_ID = re.compile(r"\b[A-Z0-9]{4}-[A-Z0-9]{3}\b")


def test_no_person_is_named_without_being_read(tool_calls, text_response, test, agent_returns=None):
    """Naming another tree person as a record's true subject requires reading them.

    The agent body already says so, twice, at the misattribution branch:
    "`person_read` each one before you name them", and "If you cannot read them,
    say the source is attached elsewhere and stop there -- do not assert whose it
    is." The v1 run of 2026-10-06 shows the rule not binding:
    `ut_source_evaluation_m8q` asserted "the source is also attached to KD96-WX7,
    a different person in the tree named ..." having never called `person_read`
    on KD96-WX7, and the judge scored it a fabrication.

    This is the rule moved off prose and onto a check, which is what ADR-0011
    asks for when a rule can be decided from the run itself. It is deliberately
    narrow: it does not ask whether the identification is CORRECT, only whether
    the agent looked before it spoke. A reply that says the source is attached
    elsewhere without naming anyone passes, because that is the body's own
    fallback.

    Fails iff the reply names a FamilySearch person id that is neither the
    subject's nor the target of a `person_read` call in the same run.
    """
    reply = (agent_returns or [{}])[0].get("text") if agent_returns else text_response
    reply = reply or text_response or ""

    read_ids = {
        str((c.get("args") or {}).get("personId") or "").upper()
        for c in (tool_calls or [])
        if isinstance(c, dict) and (c.get("tool") or "").rsplit("__", 1)[-1] == "person_read"
    }
    read_ids.discard("")
    # The subject is whoever the run read FIRST; anything else named is a claim
    # about a person the agent may not have opened.
    named = {m.upper() for m in _FS_PERSON_ID.findall(reply)}
    unread = sorted(named - read_ids)
    assert not unread, (
        f"the reply names {unread} as tree person(s) but never called `person_read` on "
        f"them. The body requires reading a person before naming them as a record's true "
        f"subject, and says to stop at 'attached elsewhere' when you cannot. person_read "
        f"was called for: {sorted(read_ids) or 'nobody'}"
    )
