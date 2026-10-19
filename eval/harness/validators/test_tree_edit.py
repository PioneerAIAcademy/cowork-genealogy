"""Validators for the tree-edit agent (a skill until issue #2805).

tree-edit applies direct edits to tree.gedcomx.json — adding facts,
correcting values, creating persons and relationships, and merging
two persons. The ownership-table check in `test_universal.py` already
enforces that tree-edit may only modify the persons/relationships/sources
sections of tree.gedcomx.json (and may not touch research.json at all),
so this file focuses on cross-file referential integrity and tag-gated
no-op-edit regression checks.

See `test_universal.py` module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.

Migrated from `rubric.md` + per-test `additional_criteria` in the
criteria-demotion rollout.
"""

from __future__ import annotations

import re

import pytest


# --- Cross-file referential integrity ---------------------------------

def _person_ids_in_tree(tree: dict) -> set[str]:
    return {
        p.get("id")
        for p in (tree.get("persons") or [])
        if isinstance(p, dict) and p.get("id")
    }


def test_cross_file_person_references_resolve(after_state):
    """research.json's person references must point at persons that
    actually exist in tree.gedcomx.json. tree-edit can delete or merge
    persons; this check catches the failure mode where research.json
    referrers (person_evidence.person_id, timelines.person_ids,
    project.subject_person_ids) point at IDs no longer in the tree.

    Universal id-reference check only validates *within* research.json
    — cross-file checks live here so tree-edit's merge/delete path is
    actually guarded."""
    research = after_state.get("research_json")
    tree = (
        after_state.get("tree_gedcomx_json")
        or after_state.get("tree_gedcomx")
    )
    if research is None or tree is None:
        pytest.skip("missing research.json or tree.gedcomx.json")

    persons = _person_ids_in_tree(tree)
    errors: list[str] = []

    # project.subject_person_ids → tree.persons
    project = research.get("project") or {}
    for ref in project.get("subject_person_ids") or []:
        if ref and ref not in persons:
            errors.append(f"project.subject_person_ids: '{ref}' not in tree.persons")

    # person_evidence.person_id → tree.persons
    for pe in research.get("person_evidence", []):
        ref = pe.get("person_id")
        if ref and ref not in persons:
            errors.append(
                f"person_evidence[{pe.get('id')}].person_id '{ref}' not in tree.persons"
            )

    # timelines.person_ids → tree.persons
    for tl in research.get("timelines", []):
        for ref in tl.get("person_ids") or []:
            if ref and ref not in persons:
                errors.append(
                    f"timelines[{tl.get('id')}].person_ids '{ref}' not in tree.persons"
                )

    assert not errors, "Broken cross-file references after tree-edit:\n  - " + "\n  - ".join(errors)


# --- No-op edit enforcement (tag-gated) -------------------------------

def _trees_equal(before: dict | None, after: dict | None) -> bool:
    """Deep equality on the two GedcomX dicts."""
    return before == after


def test_tree_edit_noop(before_state, after_state, test):
    """Tag-gated: when the requested edit is already satisfied by the
    existing tree, tree-edit must make NO modifications. Touching a
    file just to overwrite it with identical content churns diffs and
    violates edit-minimality."""
    if "tree-edit-noop" not in test.get("tags", []):
        pytest.skip("not a tree-edit-noop scenario")
    before = (
        before_state.get("tree_gedcomx_json")
        or before_state.get("tree_gedcomx")
    )
    after = (
        after_state.get("tree_gedcomx_json")
        or after_state.get("tree_gedcomx")
    )
    if before is None or after is None:
        pytest.skip("missing tree.gedcomx.json on one side")
    assert _trees_equal(before, after), (
        "tree-edit modified tree.gedcomx.json on a no-op scenario; "
        "expected byte-identical content before and after"
    )


# --- Guardianship: which kin reading leads (issue #2449) --------------

_LEAD_MARKER = re.compile(
    r"favou?red|favou?r\b|leading|\bleads\b|stronger|more likely|"
    r"most likely|primary|preferred",
    re.I,
)
_UNCLE = re.compile(r"uncle", re.I)
_STEP = re.compile(r"step", re.I)
_CONDITIONAL_BRANCH = re.compile(
    r"^[\s*_>-]*(?:if|should|were|assuming)\b[^,.;:!?|→]*"
    r"\b(?:maiden|married|widow\w*|prior)\b",
    re.I,
)
_SENTENCE_END = re.compile(r"[.;!?](?=\s|$)")


def _weighting_units(text: str):
    """Sentences, with table rows and list items kept whole.

    The observed violation weighted the readings twice, once in a
    comparison table and once in prose. A row keeps its own cells together:
    sentence-splitting inside a row can cut "not favoured" away from the
    "the step reading leads" that qualifies it, leaving a fragment that
    names uncle beside a lead marker with no step in sight. That is a
    spurious fire on a correct row, not a missed one -- the row is held
    whole to prevent it.
    """
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if line[:1] in "|-*":
            yield line
            continue
        sentences = [s.strip() for s in re.split(r"(?<=[.;:!?])\s+", line) if s.strip()]
        i = 0
        while i < len(sentences):
            s = sentences[i]
            if (s.endswith(":") and i + 1 < len(sentences)
                    and _CONDITIONAL_BRANCH.match(s)):
                s = f"{s} {sentences[i + 1]}"
                i += 1
            yield s
            i += 1


def _verdict_units(text: str):
    """`_weighting_units` minus the surname-branch sentences.

    A unit opening with a condition on the surname premise ("If Watts was
    her maiden name, ...") is exempt only up to its first sentence end;
    whatever follows it in the same bullet is split and checked like prose.
    Table rows are never exempt.
    """
    for u in _weighting_units(text):
        if not _CONDITIONAL_BRANCH.match(u):
            yield u
            continue
        end = _SENTENCE_END.search(u)
        rest = u[end.end():] if end else ""
        for s in re.split(r"(?<=[.;:!?])\s+", rest):
            if s.strip():
                yield s.strip()


def test_step_reading_leads_when_the_surname_is_unresolved(text_response, test, agent_returns=None):
    """`references/relationship-accuracy.md`, "Guardianship shortly after a
    remarriage": when the record does not say whether the wife's shared
    surname is her maiden or a prior married name, the STEP reading leads
    and uncle-by-marriage is named as unresolved.

    Observed violation: `ut_tree_edit_014`, run `v1_2026-09-15_05-34-57`.
    The run decided the surname was a maiden name on no evidence and
    inverted the weighting -- "**Uncle by marriage** (favoured)" in a
    comparison table, then "That makes the **uncle-by-marriage reading the
    favoured one**". The human annotation upheld Correctness 1 and
    Completeness 1: "That reverses the required determination."

    That run was following the reference, which branched on maiden-vs-
    married and gave no default for the unresolved case the record actually
    presents. The reference now states the default and the reason -- the
    step reading explains the timing of the appointment, the uncle reading
    has to treat the bond and the marriage as coincidental. This is the
    deterministic half of that fix; issue #2449 records why the judge could
    not be relied on for it (`Tool Arguments` alone was scored 1, null and 3
    on identical behaviour across five runs).

    Asserted narrowly: no unit of text may mark the UNCLE reading as the
    favoured one WITHOUT naming the step reading in the same breath. A run
    that weighs both together, or that names uncle with no lead marker at
    all, passes. Measured over every captured `_014` response -- the five
    committed runs plus three scratch runs of 2026-09-22 -- this fires on
    exactly the one inverted run and is clean on the other seven, including
    the two that failed for the unrelated `Tool Arguments` reason.

    A sentence conditioned on the surname premise is a hypothesis branch,
    not a verdict: "If Watts was her maiden name, the children are more
    likely her brother's orphans" says what follows from the premise, not
    which premise leads. Scratch run `scratch_2026-09-28_11-00-31` run 2
    wrote its step and uncle branches as two such bullets, led with step in
    prose, and was red on the uncle bullet alone (issue #2449). The opener
    must name the premise (maiden, married, widow, prior) before its first
    comma, so "If so, the uncle reading is favoured" -- the premise settled
    in the sentence before -- is still a verdict.
    """
    if "guardianship" not in (test.get("tags") or []):
        pytest.skip("only applies to guardianship tests")
    from harness.skill_runner import subject_reply_text
    text_response = subject_reply_text(agent_returns, text_response, "tree-edit", test)
    if not (text_response or "").strip():
        pytest.skip("no reply to weigh")
    offenders = [
        u for u in _verdict_units(text_response)
        if _LEAD_MARKER.search(u) and _UNCLE.search(u) and not _STEP.search(u)
    ]
    assert not offenders, (
        "the uncle-by-marriage reading is marked as the favoured one without "
        "the step reading weighed alongside it. When the record does not "
        "settle whose surname it is, the step reading leads and uncle is "
        "named as unresolved (references/relationship-accuracy.md, "
        "\"Guardianship shortly after a remarriage\"). Offending text: "
        + " || ".join(u[:160] for u in offenders)
    )


def test_uncle_reading_is_named_at_all(text_response, test, agent_returns=None):
    """The other half of the same sentence in
    `references/relationship-accuracy.md`: "Lead with the step reading, name
    the uncle-by-marriage reading as unresolved, and say what would settle
    it."

    `test_step_reading_leads_when_the_surname_is_unresolved` only fires on a
    unit that marks UNCLE as favoured without STEP beside it. A reply naming
    neither reading produces zero offenders and passes it vacuously, so the
    "name the uncle reading as unresolved" clause had no enforcement at all.

    That is not hypothetical. Telling the model the step reading leads is
    pressure to drop the alternative, and the first run taken after the
    reference said so did exactly that. Across every captured `_014` reply,
    `uncle` appears 2, 2, 1, 3 and 5 times in the five runs predating the
    change and 0 times in `v1_2026-09-22_17-41-42`, the first run after it --
    which the judge nevertheless scored Completeness 3, on a rationale
    asserting the reply "names the competing reading (uncle by marriage via
    maiden name)" about a text containing neither word. `_014` drew no
    review_sample slot that run, so no human correction caught it either.
    """
    if "guardianship" not in (test.get("tags") or []):
        pytest.skip("only applies to guardianship tests")
    from harness.skill_runner import subject_reply_text
    text_response = subject_reply_text(agent_returns, text_response, "tree-edit", test)
    if not (text_response or "").strip():
        pytest.skip("no reply to weigh")
    assert _UNCLE.search(text_response), (
        "the reply never names the uncle-by-marriage reading. When the record "
        "does not settle whose surname it is, the step reading leads AND the "
        "uncle reading is named as unresolved -- leading with step is only "
        "half the instruction (references/relationship-accuracy.md, "
        "\"Guardianship shortly after a remarriage\"). A reply that weighs "
        "neither reading passes the lead-marker check vacuously, which is "
        "why this arm exists."
    )
