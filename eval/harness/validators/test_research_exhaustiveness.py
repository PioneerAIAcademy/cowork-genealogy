"""Skill-specific validators for the research-exhaustiveness skill.

research-exhaustiveness evaluates whether research on an existing
question is reasonably exhaustive and either writes the
`search_stop` on the question or declines and names what's
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
from urllib.parse import unquote

import pytest

from harness.skill_runner import subject_reply_text
from validators_lib import (
    _questions_by_id,
    bare_tool_name,
    check_no_gate_stop,
)


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

_STOP_GATE_VALUES = frozenset({"question_answered", "record_exhausted", "nothing_further_reachable"})


def _questions_with_changed_declaration(before: dict, after: dict) -> list[dict]:
    """Return after-state question dicts whose search_stop or status changed."""
    before_by_id = _questions_by_id(before)
    changed: list[dict] = []
    for q in (after.get("questions") or []):
        qid = q.get("id")
        if not qid or qid not in before_by_id:
            continue
        prev = before_by_id[qid]
        if (q.get("search_stop") != prev.get("search_stop")
                or q.get("status") != prev.get("status")):
            changed.append(q)
    return changed


def _is_gate_value(q: dict) -> bool:
    """Return True when search_stop.stopped_because is a stop-gate value."""
    ss = q.get("search_stop") or {}
    return ss.get("stopped_because") in _STOP_GATE_VALUES


# --- Never create new questions ---------------------------------------

def test_no_new_questions(before_state, after_state):
    """research-exhaustiveness modifies `search_stop` /
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
    """When search_stop.stopped_because is a stop-gate value, the
    question's `status` must be `exhaustive_declared` (not still
    `in_progress` or `open`). Out-of-sync stopped_because/status leaves a
    question that looks declared in the data but still appears unfinished
    to downstream skills."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    bad: list[str] = []
    for q in _questions_with_changed_declaration(before, after):
        status = q.get("status")
        if _is_gate_value(q) and status != "exhaustive_declared":
            sb = (q.get("search_stop") or {}).get("stopped_because")
            bad.append(f"{q.get('id')}: stopped_because={sb!r} but status={status!r}")
    assert not bad, "Declared/status inconsistency:\n  - " + "\n  - ".join(bad)


def test_declared_has_log_entry_ids(before_state, after_state):
    """When stopped_because is a stop-gate value, `log_entry_ids` must be
    non-empty — the declaration is unfalsifiable without the log entries it
    claims to rest on (research-schema-spec §6 `search_stop`)."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    bad: list[str] = []
    for q in _questions_with_changed_declaration(before, after):
        ss = q.get("search_stop") or {}
        if _is_gate_value(q) and not ss.get("log_entry_ids"):
            bad.append(f"{q.get('id')}: stopped_because={ss.get('stopped_because')!r} with empty log_entry_ids")
    assert not bad, "Declared without log entries:\n  - " + "\n  - ".join(bad)


def test_declared_has_full_stop_criteria(before_state, after_state):
    """When stopped_because is a stop-gate value, `stop_criteria` must
    include all seven keys from GPS Step 1's 7-Point Stop Criteria.
    Missing keys leak through universal schema validation if the schema
    marks them optional, but the skill contract requires all seven."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    bad: list[str] = []
    for q in _questions_with_changed_declaration(before, after):
        if not _is_gate_value(q):
            continue
        ss = q.get("search_stop") or {}
        sc = ss.get("stop_criteria") or {}
        missing = REQUIRED_STOP_CRITERIA_KEYS - set(sc.keys())
        if missing:
            bad.append(f"{q.get('id')}: missing stop_criteria keys {sorted(missing)}")
    assert not bad, "Incomplete stop_criteria:\n  - " + "\n  - ".join(bad)


# --- Tag-gated: declaration must NOT have been written ----------------

def test_no_exhaustive_declaration(before_state, after_state, test):
    """Tag-gated: when the test expects the skill to decline (e.g.,
    record types unsearched, plan items still in progress), no question
    should transition to `exhaustive_declared` or set a stop-gate
    stopped_because value."""
    if "no-exhaustive-declaration" not in test.get("tags", []):
        pytest.skip("not a no-exhaustive-declaration scenario")
    if before_state.get("research_json") is None or after_state.get("research_json") is None:
        pytest.skip("missing research.json for diff")
    bad = check_no_gate_stop(before_state, after_state)
    assert not bad, "Unexpected stop-gate write:\n  - " + "\n  - ".join(bad)


def test_open_conflict_writes_blocked_by_conflict(before_state, after_state, test):
    """Tag-gated: Step 0's open-conflict block writes `blocked_by_conflict`
    (issue #4323). `test_no_exhaustive_declaration` catches only a stop-gate
    value; this catches a `resources_spent` decline in its place and a run
    that writes no stop at all."""
    if "blocked-by-conflict" not in test.get("tags", []):
        pytest.skip("not a blocked-by-conflict scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    stops = [
        (q.get("id"), (q.get("search_stop") or {}).get("stopped_because"))
        for q in _questions_with_changed_declaration(before, after)
        if q.get("search_stop")
    ]
    assert stops, (
        "no question's search_stop was written: an unresolved conflict that "
        "lists the question owes a `blocked_by_conflict` stop"
    )
    bad = [f"{qid}: stopped_because={sb!r}" for qid, sb in stops if sb != "blocked_by_conflict"]
    assert not bad, (
        "an unresolved conflict that lists the question owes a "
        "`blocked_by_conflict` stop, not:\n  - " + "\n  - ".join(bad)
    )


# --- Tag-gated: not_reached is built from what the project holds ------------

_LOCALITY_PAGE_SECTIONS = frozenset({"home", "getting_started", "online_records", "research_tips"})


def _plan_item_ids_for(research: dict, question_id: str) -> set[str]:
    return {
        item.get("id")
        for plan in (research.get("plans") or [])
        if plan.get("question_id") == question_id
        for item in (plan.get("items") or [])
        if item.get("id")
    }


def _handoff_scan(research: dict, question_id: str) -> tuple[list[str], set[str]]:
    """Return (open hand-off ids, ids of the later uncaptured entries for them).

    A hand-off is an `external_site` entry on the question's plan items with
    `outcome: "partial"` and `capture_received: false`. A LATER entry (by
    position in `log[]`) on those plan items with the same non-null
    `url_generated` and `capture_received: true` closes it; a later entry
    without a capture (an agent-written `negative`) does not, and is returned
    as a closer id that no `not_reached` entry may cite (issue #2539, lead
    2026-10-16). A later entry that is itself a hand-off of the same URL is a
    hand-off, not a closer. Plan-item scope is what `research_query`
    `questionId` returns to the agent."""
    items = _plan_item_ids_for(research, question_id)
    log = [e for e in (research.get("log") or []) if e.get("plan_item_id") in items]

    def is_handoff(e: dict) -> bool:
        site = e.get("external_site") or {}
        return (e.get("tool") == "external_site"
                and e.get("outcome") == "partial"
                and site.get("capture_received") is False
                and bool(site.get("url_generated")))

    open_ids: list[str] = []
    closers: set[str] = set()
    for i, entry in enumerate(log):
        if not is_handoff(entry):
            continue
        url = entry["external_site"]["url_generated"]
        later = [e for e in log[i + 1:] if (e.get("external_site") or {}).get("url_generated") == url]
        if any((e.get("external_site") or {}).get("capture_received") is True for e in later):
            continue
        open_ids.append(entry.get("id"))
        closers.update(e.get("id") for e in later if e.get("id") and not is_handoff(e))
    return open_ids, closers


def uncaptured_handoff_ids(research: dict, question_id: str) -> list[str]:
    return _handoff_scan(research, question_id)[0]


def _norm_wiki_title(title: str) -> str:
    return unquote(re.split(r"[#?]", title, maxsplit=1)[0]).replace("_", " ").strip().casefold()


def held_wiki_titles(research: dict) -> set[str]:
    """Normalised page titles from every locality's `pages_read[].url`."""
    titles: set[str] = set()
    for loc in (research.get("localities") or []):
        for page in (loc.get("pages_read") or []):
            url = page.get("url") or ""
            if "/wiki/" in url:
                titles.add(_norm_wiki_title(url.split("/wiki/", 1)[1]))
    return titles


def _written_questions(before_state, after_state) -> list[dict]:
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    written = [q for q in _questions_with_changed_declaration(before, after) if q.get("search_stop")]
    assert written, "No question's search_stop was written, so not_reached was never built"
    return written


def test_not_reached_lists_uncaptured_handoffs(before_state, after_state, test):
    """Tag-gated: every uncaptured hand-off is a `handed_to_user` entry under
    the hand-off's own log id, never the id of the entry that closed it."""
    if "not-reached-handoff" not in test.get("tags", []):
        pytest.skip("not a not-reached-handoff scenario")
    before = before_state.get("research_json") or {}
    bad: list[str] = []
    for q in _written_questions(before_state, after_state):
        expected, closers = _handoff_scan(before, q.get("id"))
        listed = {
            e.get("log_entry_id")
            for e in (q["search_stop"].get("not_reached") or [])
            if e.get("kind") == "handed_to_user"
        }
        bad += [f"{q.get('id')}: hand-off {hid} has no handed_to_user entry" for hid in expected if hid not in listed]
        bad += [f"{q.get('id')}: handed_to_user cites {lid}, which is not an uncaptured hand-off"
                for lid in sorted(x for x in listed if x is not None) if lid not in expected]
        bad += [f"{q.get('id')}: {e.get('kind')} entry cites {e.get('log_entry_id')}, a later entry that did not capture the hand-off"
                for e in (q["search_stop"].get("not_reached") or []) if e.get("log_entry_id") in closers]
    assert not bad, "not_reached hand-off entries wrong:\n  - " + "\n  - ".join(bad)


_DECLINED_SKIP_CATEGORIES = frozenset({"user_declined", "no_coverage", "inaccessible"})


def declined_skip_items(research: dict, question_id: str) -> list[dict]:
    """Items on the question's plans skipped `user_declined`, `no_coverage` or
    `inaccessible`, minus any item an uncaptured hand-off already lists as
    `handed_to_user` (issue #4551)."""
    handoff_ids = set(uncaptured_handoff_ids(research, question_id))
    handed_items = {e.get("plan_item_id") for e in (research.get("log") or []) if e.get("id") in handoff_ids}
    return [
        item
        for plan in (research.get("plans") or [])
        if plan.get("question_id") == question_id
        for item in (plan.get("items") or [])
        if item.get("status") == "skipped"
        and item.get("skip_category") in _DECLINED_SKIP_CATEGORIES
        and item.get("id") not in handed_items
    ]


def _names_item(description: str, item: dict) -> bool:
    text = (description or "").casefold()
    record_type = (item.get("record_type") or "").replace("_", " ").casefold()
    item_id = (item.get("id") or "").casefold()
    return bool(item_id and re.search(rf"\b{re.escape(item_id)}\b", text)) or bool(record_type and record_type in text)


def test_not_reached_lists_declined_skips(before_state, after_state, test):
    """Tag-gated: every plan item skipped `user_declined` or `no_coverage` has a
    `skipped_plan_item` entry, and every item skipped `inaccessible` has an
    entry of any kind — on a declaration §3's exception may list it as
    `privacy_sealed`, `browse_only` and the like. Every `skipped_plan_item`
    entry carries `log_entry_id: null` and `wiki_title: null`.

    Entries carry no `plan_item_id`, so an entry matches an item when its
    description names the item id as a whole word or its record type; two
    skipped items of one record type can share an entry, and a variant
    spelling of the record type does not match."""
    if "not-reached-skipped-item" not in test.get("tags", []):
        pytest.skip("not a not-reached-skipped-item scenario")
    before = before_state.get("research_json") or {}
    bad: list[str] = []
    for q in _written_questions(before_state, after_state):
        entries = q["search_stop"].get("not_reached") or []
        skipped_entries = [e for e in entries if e.get("kind") == "skipped_plan_item"]
        bad += [f"{q.get('id')}: skipped_plan_item entry carries log_entry_id "
                f"{e.get('log_entry_id')!r} / wiki_title {e.get('wiki_title')!r}; both must be null"
                for e in skipped_entries
                if e.get("log_entry_id") is not None or e.get("wiki_title") is not None]
        for item in declined_skip_items(before, q.get("id")):
            pool = entries if item.get("skip_category") == "inaccessible" else skipped_entries
            if not any(_names_item(e.get("description") or "", item) for e in pool):
                wanted = "not_reached" if pool is entries else "skipped_plan_item"
                bad.append(f"{q.get('id')}: {item.get('id')} ({item.get('record_type')}, "
                           f"{item.get('skip_category')}) has no {wanted} entry")
    assert not bad, "not_reached skipped-item entries wrong:\n  - " + "\n  - ".join(bad)


def test_not_reached_wiki_title_is_page_title(before_state, after_state, test):
    """Tag-gated: a `wiki_named_untouched` entry names a page the project
    read, by its title from `pages_read[].url` — never the section enum,
    which the schema validator also accepts."""
    if "not-reached-wiki" not in test.get("tags", []):
        pytest.skip("not a not-reached-wiki scenario")
    held = held_wiki_titles(before_state.get("research_json") or {})
    bad: list[str] = []
    for q in _written_questions(before_state, after_state):
        entries = [e for e in (q["search_stop"].get("not_reached") or []) if e.get("kind") == "wiki_named_untouched"]
        if not entries:
            bad.append(f"{q.get('id')}: no wiki_named_untouched entry")
        for e in entries:
            title = e.get("wiki_title") or ""
            if not title.strip() or title.strip() in _LOCALITY_PAGE_SECTIONS:
                bad.append(f"{q.get('id')}: wiki_title {title!r} is not a page title")
            elif _norm_wiki_title(title) not in held:
                bad.append(f"{q.get('id')}: wiki_title {title!r} is not a page the project read {sorted(held)}")
    assert not bad, "not_reached wiki entries wrong:\n  - " + "\n  - ".join(bad)


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

    - the near-miss negatives route away before the agent is spawned, so they
      make no MCP calls at all. The gate was written for four
      (ut_002/_007/_008/_011); `ut_002` and `ut_011` went with earlier agent
      conversions and only `_007` and `_008` carry the tag now. The skip is
      keyed on the tag rather than on that list, so it still binds — the list
      read as current and was not;
    - a run that correctly returns at a Step 0 precondition — `refuse-in-progress`
      (an in-flight plan item), `refuse-planned` (an undisposed one, issue
      #1830), `already-declared` ("stop before any other check") and
      `tentative-value-sweep` (a tentative value an alternative record could
      resolve) — never reaches `## 1. Gather evidence`, so it owes no fetch.
      ut_005 made 4 calls and ut_006 made 5, both correctly.

    Demanding the fetch from those is a defect in this check, not in the agent.

    `refuse-planned` joined that list for issue #1830, which made a `planned`
    item block the gate alongside an `in_progress` one — a third member of the
    same population, not a new rule. It was added after ut_d6f failed here on
    `v1_2026-09-30_18-26-29` having made only `project_context` and
    `research_query` calls: the judge scored every dimension 3, because
    stopping there is what the agent body prescribes — "A run that ends at a
    Step 0 precondition owes nothing below, the `wiki_read` included". The
    check was contradicting the spec it grades against.

    `tentative-value-sweep` is the fourth member, added the same way: ut_016
    failed here on `v1_2026-10-06_09-22-36` with only `project_context` and
    `research_query` calls while the judge scored all six dimensions 3. Its
    agent return reasons the stop out loud — "the tentative-value sweep IS a
    Step 0 block. Step 1's wiki_read is reached only when Step 0 neither stops
    nor refuses" — which is the body's own rule. It passed four earlier runs
    only because the agent happened to fetch anyway before stopping, so this
    was a latent contradiction surfaced by sampling, not a regression.

    `blocked-by-conflict` is the fifth member (issue #4323): an unresolved
    conflict that lists the question in `blocks_question_ids` is a Step 0 hard
    block, because the `blocked_by_conflict` write it produces carries
    `stop_criteria: null` and no start date can change it. ut_d3c failed here
    3/3 on Sonnet 5 medium with every judge dimension 3 before the block moved
    into Step 0.

    Step 0 declares six hard blocks. The five tags named above cover four of
    them — `refuse-in-progress` and `refuse-planned` are both the active-plan
    check. The classification and person_evidence blocks have no test today, so
    a test that stops at one will need its tag added here too.

    `wrap-up` is a different population (issue #4551): under `wrapUp: yes` the
    agent records `resources_spent` with `stop_criteria: null` and "nothing
    else", so no criterion reads a start date. ut_020 failed here 3/3 while the
    judge scored its every dimension 3. The skip keys on the tag, not on the
    `resources_spent` it writes — ut_014/ut_015 decline the same way and still
    owe the fetch.
    """
    tags = test.get("tags") or []
    if "near-miss" in tags:
        pytest.skip("negative routing test — the agent is never spawned")
    if "wrap-up" in tags:
        pytest.skip("wrapUp: yes records the stop with no criteria to assess")
    if (
        "refuse-in-progress" in tags
        or "refuse-planned" in tags
        or "already-declared" in tags
        or "tentative-value-sweep" in tags
        or "blocked-by-conflict" in tags
    ):
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
# item on one list line and its status on the next draws
# `report_refusal_marks_the_blocker_open`'s observation, because a line break
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

# Words marking the named item as STILL OPEN, read only by
# `report_refusal_marks_the_blocker_open`. Frozen by issue #3089: this history
# is why it stopped being widened, not a list of places to widen it next.
# Widened on the PR #2613 review:
# seven ordinary refusals the first list missed — "remains open", "is open",
# "we are waiting on it", "has not come back", "is unresolved", "is running",
# and "has not been completed", the last missing only because `been` sat
# between `not` and `completed`. The acceptance set is the corpus, not this
# vocabulary: see the offline tests, which run every recorded
# refuse-in-progress refusal.
#
# Widened again for issue #1830, which made a `planned` item block the gate
# too. Two arms, both derived from a recorded response rather than invented —
# `v1_2026-09-30_18-26-29`'s `_d1a` reply named pli_005 in four sentences and
# matched none of the list above:
#
#   1. The IMPERATIVE. "Complete the death certificate search (`pli_005`)."
#      says the item is open as plainly as any adjective — nobody is told to
#      complete what is done. Anchored to the start of the segment, which is
#      what keeps it from matching the inversion this check exists to catch:
#      "The death certificate search WAS COMPLETED last week" is not
#      segment-initial and still fails.
#   2. `planned` AS A STATUS, and only as a status. `(?:is|are|remains)
#      [still] planned` matches; "was explicitly planned because it may name
#      the parents" does not, and must not — that sentence is the item's
#      RATIONALE, saying why it was ever on the plan, not that it is open.
#      It sits in the same recorded reply, which is what makes it a real
#      counterexample rather than a hypothetical one.
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
    r"|before\s+(?:it|that|this|they)\s+(?:returns?|finishes|completes)"
    # (1) The IMPERATIVE. "Complete X" says X is open as plainly as any
    #     adjective — nobody is told to complete what is done.
    #
    #     Two guards make it safe, and both are load-bearing. The imperative
    #     and the adjective are the SAME WORD, so "Complete the search" and
    #     "Status: complete" differ only in position and in what follows.
    #
    #     a. Segment-initial, optionally behind a short label — the agent
    #        writes "**Recommended action:** Complete or formally skip
    #        `pli_005`." Note the colon sits INSIDE the bold, which is why the
    #        label pattern allows asterisks on either side of it.
    #     b. The verb must be followed by more content (`\s+\S`). That is what
    #        keeps "Status: complete." out: the adjective ends the segment,
    #        the imperative never does.
    r"|^[\s\-*•>#]*(?:[^.!?\n]{0,40}:\**\s+)?"
    r"(?:complete|finish|run|perform|execute|conduct|carry\s+out)\s+\S"
    # (3) The SUBJUNCTIVE COUNTERFACTUAL. "Even if pli_005 were resolved, the
    #     evidence still has weaknesses" presupposes it is NOT resolved, which
    #     is the same claim the adjectives make. A real construction rather
    #     than a patch for one sentence: "even if X were done" cannot be said
    #     of something done. Bounded so it cannot span a clause boundary, and
    #     it requires the `even if`, so the inversions — which assert
    #     completion flatly — are untouched.
    r"|even\s+if\s+[^.!?\n]{0,40}?(?:were|was|is|had\s+been)\s+"
    r"(?:resolved|completed|complete|done|finished|closed|obtained)\b"
    # (2) `planned` as a status, never as a rationale
    r"|(?:is|are|remains?|stays?|sits?)\s+(?:still\s+)?planned\b"
    r"|still\s+planned\b",
    re.I | re.M,
)

_AGENT = "research-exhaustiveness"

_REFUSE_TAGS = frozenset({"refuse-in-progress", "refuse-planned"})

# What else a reply may call the blocking item, keyed on the test id because the
# scenario name never reaches a validator (decided on issue #3089). Test ids are
# unique corpus-wide (check_runlogs rule 4), so a key cannot collide, and a later
# scenario reusing `pli_005` for another record is not false-accepted. A
# refuse-tagged test with no entry accepts only the literal plan-item id, so
# the offline tests fail on any refuse-tagged test in the suite missing here. `\b`
# matters on `st.? patrick`: the scenario's subject is Patrick Flynn, and "the
# earliest Patrick Flynn record" names him, not the marriage register.
_BLOCKER_ALIASES = {
    "ut_research_exhaustiveness_d1a": r"\bdeath\s+certificate",
    "ut_research_exhaustiveness_d6f": r"\bmarriage\s+register|\bst\.?\s+patrick",
}


_DELEGATED_QUESTION = re.compile(r"questionId:\s*(q_\w+)")


def _blocking_items(before_state, test) -> list[str]:
    """Ids of the planned or in-progress items on the active plans for the
    question being declared: the delegation's `questionId` when it names one,
    else every active plan."""
    research = (before_state or {}).get("research_json") or {}
    question = _DELEGATED_QUESTION.search((test or {}).get("delegation") or "")
    blockers = []
    for plan in research.get("plans") or []:
        if plan.get("status") != "active":
            continue
        if question and plan.get("question_id") != question.group(1):
            continue
        for item in plan.get("items") or []:
            if item.get("status") in ("planned", "in_progress") and item.get("id"):
                blockers.append(item["id"])
    return blockers


def _blocker_pattern(blockers: list[str], test) -> re.Pattern:
    arms = [rf"\b{re.escape(b)}\b" for b in blockers]
    alias = _BLOCKER_ALIASES.get(test.get("id"))
    if alias:
        arms.append(alias)
    return re.compile("|".join(arms), re.I)


def test_refusal_names_the_blocking_plan_item(before_state, text_response, test, agent_returns):
    """A refusal must name what is blocking it. That is all this gate asks.

    `no-exhaustive-declaration` asserts only that no declaration was
    written, which a null response satisfies. Probing ut_005 with a
    sabotage rule in the routing skill produced the single word
    "BLOCKED" — no tool calls, nothing written — and it scored pass:
    Correctness 3, Completeness 3, Declaration honesty 3. A refusal test
    whose pass condition is met by doing nothing cannot distinguish a
    correct refusal from a dead run. This gate is that distinction and
    nothing more: the reply names an item that is `planned` or
    `in_progress` on an active plan for the question, read from
    `before_state`, by id or by the test's alias.

    **Whether the reply calls that item still open is not gated.** It used
    to be: the item and a `_STILL_OPEN` marker had to share a sentence. That
    regex failed three correct refusals in two days, each graded 3 on every
    judge dimension, and was widened after each one (issue #3089). The
    property is semantic and a marker list over free prose cannot express
    it. By the lead's ruling of 2026-10-06 (option C) it moved, frozen,
    into `report_refusal_marks_the_blocker_open`, which hands the judge an
    observation instead of failing the run.

    This gate therefore knowingly passes the two PR #2613 counterexamples,
    pinned as passing in the offline tests:

        "I cannot declare exhaustive because the 1860 census has not been
         checked. Separately, the death certificate we already hold is a
         fine source."

        "Declaration withheld: you have run out of budget. The death
         certificate search was completed last week, so that is not the
         issue."

    Neither shape appears in any refusal in the committed run logs, and
    the report still fires on both.

    A refuse-tagged test whose `before_state` yields no blocking item fails
    here rather than skipping: an empty lookup would otherwise switch the
    dead-run check off without a sound.
    """
    tags = test.get("tags") or []
    if not _REFUSE_TAGS.intersection(tags):
        pytest.skip("not a refusal test — no blocking item to name")
    blockers = _blocking_items(before_state, test)
    assert blockers, (
        f"{test.get('id')}: refuse-tagged test with no planned or in-progress "
        "item on an active plan in before_state — the gate cannot run"
    )
    reply = subject_reply_text(agent_returns, text_response, _AGENT, test)
    assert _blocker_pattern(blockers, test).search(reply), (
        "the refusal did not name what is blocking the declaration — none of "
        f"{blockers} appears in the response. A refusal that names nothing is "
        f"indistinguishable from a dead run. Response: {reply[:200]!r}"
    )


def report_refusal_marks_the_blocker_open(before_state, text_response, test, agent_returns):
    """Tier 2 — reports, never gates (issue #3089, lead ruling 2026-10-06).

    The same-sentence check the gate used to make, kept as an observation for
    the judge: the reply names the in-progress item, and some sentence naming
    it marks it as still open. `_STILL_OPEN` and `_SENTENCE_SPLIT` are frozen
    as they stood when this moved; widening them is what issue #3089 stopped.
    How each arm came to be is in the comments above both.

    Scoped to `refuse-in-progress`. On the committed `refuse-planned` refusals
    the marker list fires on every one, because they say the item is "still in
    `planned` status", which no arm matches, while the judge graded each a
    pass. Extending the scope would hand the judge a false observation on every
    correct refusal.

    Skips when the reply names no blocker: the gate fails that run, and the
    same finding twice would read as two. Also skips, saying so, when the
    blocker is named only across a break the frozen split cuts ("death" and
    "certificate" on two lines): the gate passes that reply, and with no
    sentence to read the report has nothing true to say about it.
    """
    tags = test.get("tags") or []
    if "refuse-in-progress" not in tags:
        pytest.skip("not a refuse-in-progress test")
    blockers = _blocking_items(before_state, test)
    if not blockers:
        pytest.skip("no blocking item in before_state — the gate reports it")
    pattern = _blocker_pattern(blockers, test)
    reply = subject_reply_text(agent_returns, text_response, _AGENT, test)
    if not pattern.search(reply):
        pytest.skip("the reply names no blocking item — the gate reports it")
    named = [seg for seg in re.split(_SENTENCE_SPLIT, reply) if seg and pattern.search(seg)]
    if not named:
        pytest.skip(
            "the reply names the blocking item only across a sentence or line "
            "break, so no sentence naming it can be read"
        )
    # Neutral wording on purpose: this reaches the judge as an observation, and
    # a verdict-shaped sentence reads as a rule.
    assert any(_STILL_OPEN.search(seg) for seg in named), (
        "the reply names the in-progress item but no sentence naming it marks "
        f"it as still open. Sentences naming it: {[seg.strip()[:120] for seg in named]!r}"
    )


# --- Tag-gated: the decline names the subject's death record ----------

_DEATH_RECORD_RE = re.compile(
    r"death\s+(certificate|record|registration)|certificate\s+of\s+death|obituar|funeral\s+notice",
    re.IGNORECASE,
)
_BIRTH_CERTIFICATE_RE = re.compile(r"birth\s+certificate", re.IGNORECASE)


def test_decline_names_a_death_record(before_state, after_state, test):
    """Tag-gated: the stop names a death-era record as what is unsearched, and
    does not defer the birth certificate.

    `ut_research_exhaustiveness_022` holds no death-era record, and its judge
    notes call a decline that "names only the sealed birth certificate" a fail.
    The judge passed 26 of 26 runs on 2026-11-17 because each one declined; two
    of them never named a death record. The naming is in `justification` or in
    a `not_reached` description; either is enough.

    A sealed record is listed as `privacy_sealed` or `skipped_plan_item`. A
    `deferred` entry is a search still to run, so one that describes the birth
    certificate recommends obtaining it."""
    if "death-record-gap" not in test.get("tags", []):
        pytest.skip("not a death-record-gap scenario")
    bad: list[str] = []
    for q in _written_questions(before_state, after_state):
        stop = q["search_stop"]
        entries = stop.get("not_reached") or []
        said = " ".join([stop.get("justification") or ""] + [e.get("description") or "" for e in entries])
        if not _DEATH_RECORD_RE.search(said):
            bad.append(f"{q.get('id')}: neither justification nor not_reached names a death certificate, "
                       f"death record or obituary")
        bad += [f"{q.get('id')}: the birth certificate is a `deferred` search: {(e.get('description') or '')[:120]!r}"
                for e in entries
                if e.get("kind") == "deferred" and _BIRTH_CERTIFICATE_RE.search(e.get("description") or "")]
    assert not bad, "Decline does not rest on the death record:\n  - " + "\n  - ".join(bad)


# --- Tag-gated: the declaration MUST have been written -----------------

def test_affirmative_declaration_was_written(before_state, after_state, test):
    """Tag-gated: a test whose project is ready expects the declaration, so a
    question moves to `exhaustive_declared` with a stop-gate `stopped_because`.

    The mirror of `test_no_exhaustive_declaration`. Until 2026-11-17 the
    `affirmative-declaration` tag was read by nothing: a run that declined on a
    ready project was graded by the judge alone, which passed 5 of 54 such
    declines that day (018 three times, 012 twice) with full marks."""
    if "affirmative-declaration" not in test.get("tags", []):
        pytest.skip("not an affirmative-declaration scenario")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("missing research.json for diff")
    declared = [q for q in _questions_with_changed_declaration(before, after)
                if _is_gate_value(q) and q.get("status") == "exhaustive_declared"]
    if declared:
        return
    wrote = [f"{q.get('id')}: stopped_because {(q.get('search_stop') or {}).get('stopped_because')!r}, "
             f"status {q.get('status')!r}"
             for q in _questions_with_changed_declaration(before, after)]
    assert False, ("No question was declared exhaustive on a project the test holds ready. "
                   + ("Written instead:\n  - " + "\n  - ".join(wrote) if wrote else "Nothing was written."))
