"""Skill-specific validators for the research-exhaustiveness skill.

research-exhaustiveness evaluates whether research on an existing
question is reasonably exhaustive and either writes the
`exhaustive_declaration` on the question or declines and names what's
missing. The skill modifies only existing questions — it never creates
them (that's question-selection).

Ownership enforcement (research-exhaustiveness can write `questions`
alongside question-selection) is in
`test_universal.py::test_ownership_table`, driven by
`docs/specs/schemas/ownership.json`. FK integrity for `log_entry_ids` is covered by
`test_universal.py::test_id_references_resolve`.

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.
"""

from __future__ import annotations

import re

import pytest

from validators_lib import bare_tool_name


# --- Helpers ---------------------------------------------------------

REQUIRED_STOP_CRITERIA_KEYS = {
    "goal_alignment",
    "repository_breadth",
    "original_substitution",
    "independent_verification",
    "evidence_class",
    "conflict_resolution",
    "overturn_risk",
}


def _questions_by_id(state: dict) -> dict[str, dict]:
    return {q.get("id"): q for q in (state or {}).get("questions") or [] if q.get("id")}


def _questions_with_changed_declaration(before: dict, after: dict) -> list[dict]:
    """Return after-state question dicts whose exhaustive_declaration
    or status changed."""
    before_by_id = _questions_by_id(before)
    changed: list[dict] = []
    for q in (after.get("questions") or []):
        qid = q.get("id")
        if not qid or qid not in before_by_id:
            continue
        prev = before_by_id[qid]
        if (q.get("exhaustive_declaration") != prev.get("exhaustive_declaration")
                or q.get("status") != prev.get("status")):
            changed.append(q)
    return changed


# --- Never create new questions ---------------------------------------

def test_no_new_questions(before_state, after_state):
    """research-exhaustiveness modifies the `exhaustive_declaration` /
    `status` on existing questions. Creating a new question is
    question-selection's job; doing it here would violate single-writer
    semantics on the question creation event."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    before_ids = {q.get("id") for q in (before.get("questions") or [])}
    new_ids = [
        q.get("id")
        for q in (after.get("questions") or [])
        if q.get("id") and q.get("id") not in before_ids
    ]
    assert not new_ids, (
        f"research-exhaustiveness created a new question {new_ids}; "
        f"only question-selection may create questions"
    )


# --- Declaration / status consistency ---------------------------------

def test_declared_implies_exhaustive_declared_status(before_state, after_state):
    """When `exhaustive_declaration.declared` flips to true, the
    question's `status` must be `exhaustive_declared` (not still
    `in_progress` or `open`). Out-of-sync declared/status leaves a
    question that looks declared in the data but still appears unfinished
    to downstream skills."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    bad: list[str] = []
    for q in _questions_with_changed_declaration(before, after):
        decl = (q.get("exhaustive_declaration") or {}).get("declared")
        status = q.get("status")
        if decl is True and status != "exhaustive_declared":
            bad.append(f"{q.get('id')}: declared=true but status={status!r}")
    assert not bad, "Declared/status inconsistency:\n  - " + "\n  - ".join(bad)


def test_declared_has_log_entry_ids(before_state, after_state):
    """When `declared` is true, `log_entry_ids` must be non-empty — the
    declaration is unfalsifiable without the log entries it claims to
    rest on (research-schema-spec §6 `exhaustive_declaration`)."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    bad: list[str] = []
    for q in _questions_with_changed_declaration(before, after):
        ed = q.get("exhaustive_declaration") or {}
        if ed.get("declared") is True and not ed.get("log_entry_ids"):
            bad.append(f"{q.get('id')}: declared=true with empty log_entry_ids")
    assert not bad, "Declared without log entries:\n  - " + "\n  - ".join(bad)


def test_declared_has_full_stop_criteria(before_state, after_state):
    """When `declared` is true, `stop_criteria` must include all seven
    keys from GPS Step 1's 7-Point Stop Criteria. Missing keys leak
    through universal schema validation if the schema marks them
    optional, but the skill contract requires all seven."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    bad: list[str] = []
    for q in _questions_with_changed_declaration(before, after):
        ed = q.get("exhaustive_declaration") or {}
        if ed.get("declared") is not True:
            continue
        sc = ed.get("stop_criteria") or {}
        missing = REQUIRED_STOP_CRITERIA_KEYS - set(sc.keys())
        if missing:
            bad.append(f"{q.get('id')}: missing stop_criteria keys {sorted(missing)}")
    assert not bad, "Incomplete stop_criteria:\n  - " + "\n  - ".join(bad)


# --- Tag-gated: declaration must NOT have been written ----------------

def test_no_exhaustive_declaration(before_state, after_state, test):
    """Tag-gated: when the test expects the skill to decline (e.g.,
    record types unsearched, plan items still in progress), no question
    should transition to `exhaustive_declared` or flip `declared` to
    true."""
    if "no-exhaustive-declaration" not in test.get("tags", []):
        pytest.skip("not a no-exhaustive-declaration scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    before_by_id = _questions_by_id(before)
    bad: list[str] = []
    for q in (after.get("questions") or []):
        qid = q.get("id")
        prev = before_by_id.get(qid, {})
        prev_decl = (prev.get("exhaustive_declaration") or {}).get("declared")
        new_decl = (q.get("exhaustive_declaration") or {}).get("declared")
        if prev_decl is not True and new_decl is True:
            bad.append(f"{qid}: flipped declared false→true when decline expected")
        if prev.get("status") != "exhaustive_declared" and q.get("status") == "exhaustive_declared":
            bad.append(f"{qid}: status set to exhaustive_declared when decline expected")
    assert not bad, "Unexpected declaration:\n  - " + "\n  - ".join(bad)


# --- The registration start date is fetched, not carried as prose ----------

def test_fetches_registration_start_date(tool_calls, test):
    """The agent must READ the jurisdiction's registration start date.

    Issue #2257 / ADR-0012 removed the two hardcoded facts (Ireland 1864,
    Pennsylvania 1906) from the agent body and replaced them with a `wiki_read`
    named unconditionally in `## 1. Gather evidence`. Nothing else proves the
    fetch happened: the judge grades the conclusion, and a conclusion reached
    from the model's own memory of a start date is indistinguishable from one
    read off the page.

    Gated off two populations that never reach Step 1, measured on
    v1_2026-09-08_06-48-40 where this check failed all three:

    - the four near-miss negatives (ut_002/_007/_008/_011) route away before the
      agent is spawned, so they make no MCP calls at all;
    - a run that correctly returns at a Step 0 precondition — `refuse-in-progress`
      (an in-flight plan item) and `already-declared` ("stop before any other
      check") — never reaches `## 1. Gather evidence`, so it owes no fetch.
      ut_005 made 4 calls and ut_006 made 5, both correctly.

    Demanding the fetch from those is a defect in this check, not in the agent.
    """
    tags = test.get("tags") or []
    if "near-miss" in tags:
        pytest.skip("negative routing test — the agent is never spawned")
    if "refuse-in-progress" in tags or "already-declared" in tags:
        pytest.skip("returns at a Step 0 precondition — Step 1 is never reached")
    called = [bare_tool_name(c.get("tool", "")) for c in (tool_calls or [])]
    assert "wiki_read" in called, (
        "the agent did not fetch the jurisdiction's registration start date — "
        "no wiki_read call. `## 1. Gather evidence` names it unconditionally. "
        f"Tools called: {sorted(set(called)) or 'none'}"
    )


# A sentence boundary for this check is punctuation followed by whitespace and
# a capital, a hard line break, or end of text. A naive `[.!?]+` split breaks on
# abbreviations — reviewed on PR #2613, where it cut `d. 1908` in
# "a death certificate search for Patrick Flynn, d. 1908, Schuylkill County, PA)
# is still `in_progress`" and failed a correct refusal that had been graded pass.
# `U.S.` and a decimal version break a naive split the same way.
#
# KNOWN CONSERVATIVE MISS, pinned in the offline tests: a refusal that puts the
# item on one list line and its status on the next fails, because a line break
# is a hard boundary and that is what closes the neighbouring-sentence hole. No
# response in the committed corpus is shaped that way. If one ever is, the fix
# is to name the status on the same line, not to widen the window — a window
# that spans lines lets a marker from an unrelated bullet carry.
_SENTENCE_SPLIT = re.compile(
    r"(?<![A-Z])[.!?]+(?=\s+[\"'(\[]?[A-Z])"
    r"|[.!?]+\s*$"
    r"|[\r\n]+"
    r"|(?<=[.!?])\s*[-*•]\s+"
)

# Words marking the named item as STILL OPEN. Widened on the PR #2613 review:
# seven ordinary refusals the first list missed — "remains open", "is open",
# "we are waiting on it", "has not come back", "is unresolved", "is running",
# and "has not been completed", the last missing only because `been` sat
# between `not` and `completed`. The acceptance set is the corpus, not this
# vocabulary: see the offline tests, which run all eight recorded responses.
_STILL_OPEN = re.compile(
    r"in[\s_\-]?progress|in[\s\-]?flight"
    r"|(?:still|currently)\s+\w{0,12}\s?(?:open|running|out|pending|going|active|underway|under\s?way)"
    r"|(?:is|are|was|were|remains?|stays?|sits?)\s+(?:still\s+)?"
    r"(?:open|running|outstanding|unresolved|incomplete|unfinished|pending|ongoing|active)"
    r"|not\s+(?:yet\s+)?(?:been\s+)?"
    r"(?:finished|complete|completed|done|returned|back|come\s+back|closed|resolved)"
    r"|(?:has|have|had|hasn't|haven't|hasnt|havent|is|was)\s+not\s+(?:yet\s+)?(?:been\s+)?"
    r"(?:finished|completed|complete|returned|come\s+back|done|closed|resolved)"
    r"|unfinished|incomplete|outstanding|unresolved|ongoing|under\s?way|awaiting"
    r"|waiting\s+(?:on|for)|pending|not\s+yet|yet\s+to\s+\w+|still\s+\w+ing"
    r"|before\s+(?:it|that|this|they)\s+(?:returns?|finishes|completes)",
    re.I,
)

_BLOCKER_TOKEN = re.compile(r"pli_005|death\s+certificate", re.I)


def test_refusal_names_the_blocking_plan_item(text_response, test):
    """A refusal must say what is blocking it, and that it is still open.

    `no-exhaustive-declaration` asserts only that no declaration was
    written, which a null response satisfies. Probing ut_005 with a
    sabotage rule in the routing skill produced the single word
    "BLOCKED" — no tool calls, nothing written — and it scored pass:
    Correctness 3, Completeness 3, Declaration honesty 3. A refusal test
    whose pass condition is met by doing nothing cannot distinguish a
    correct refusal from a dead run.

    `judge_context` already asks the judge to check this ("Claude should
    specifically identify pli_005 as the in-progress plan item blocking
    the declaration") and the judge scored it 3 anyway, so the positive
    assertion has to be deterministic.

    **Naming the item is not enough, and a bare substring is the wrong
    check.** Reviewed on PR #2613, where two responses passed an
    earlier version that only looked for the token anywhere in the text:

        "I cannot declare exhaustive because the 1860 census has not been
         checked. Separately, the death certificate we already hold is a
         fine source."

        "Declaration withheld: you have run out of budget. The death
         certificate search was completed last week, so that is not the
         issue."

    The first refuses for the wrong reason. The second asserts the death
    certificate search is COMPLETE — the opposite of the blocker — and
    still satisfied a guard whose only job is to confirm the agent
    identified it as blocking. A substring cannot tell "is blocking"
    from "is done".

    So the item and a still-open marker must appear in the SAME sentence.
    Either spelling of the item still counts — `pli_005` IS the
    death-certificate plan item in `flynn-plan-in-progress` — which keeps
    the phrasing freedom that pinning to the literal id would cost.

    **The acceptance check is the corpus, not the vocabulary.** A marker
    list can only be measured against phrasings it was not written from,
    so the offline tests run this over all eight `_005`/`_d1a` responses
    in the committed run logs — every one graded pass — and require all
    eight, while both counterexamples above and a marker in a
    neighbouring sentence still fail. The first tightening was checked
    against seven of the eight and reported as the whole corpus; it
    failed the eighth on an abbreviation. Re-derive from the run logs
    rather than from a hand-written list.
    """
    tags = test.get("tags") or []
    if "refuse-in-progress" not in tags:
        pytest.skip("not a refuse-in-progress test — no blocking item to name")
    text = text_response or ""
    named = [
        seg for seg in re.split(_SENTENCE_SPLIT, text) if _BLOCKER_TOKEN.search(seg)
    ]
    assert named, (
        "the refusal did not name what is blocking the declaration — "
        "neither `pli_005` nor the death certificate search appears in the "
        "response. A refusal that names nothing is indistinguishable from a "
        f"dead run. Response: {text[:200]!r}"
    )
    assert any(_STILL_OPEN.search(seg) for seg in named), (
        "the refusal names the blocking item but never says it is still "
        "open — no in-progress marker appears in the same sentence. A "
        "response that mentions the death certificate in passing, or says "
        "that search is finished, must not satisfy this check. Sentences "
        f"naming it: {[seg.strip()[:120] for seg in named]!r}"
    )
