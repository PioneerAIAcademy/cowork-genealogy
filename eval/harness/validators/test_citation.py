"""Skill-specific validators for the citation skill.

citation keeps its `rubric.md` — all three dimensions (Evidence
Explained compliance, Replication test, Source vs information
distinction) are pure GPS craft and stay graded by the LLM judge.

This file holds structural invariants: the append-only source-section
check, creator-vs-custody slot validation (V5), unknown-marker
vocabulary (V6), and informant-not-in-who (V10). Tool-allowlist and
write-then-validate enforcement are delegated to universal validators.

See test_universal.py module docstring for the validator function-
signature contract.
"""

from __future__ import annotations

import re

import pytest


# --- No-new-sources enforcement ---------------------------------------

def test_does_not_add_new_source_entries(before_state, after_state, test):
    """citation refines existing source entries — it must not create new
    ones. New record discovery is search-records / record-extraction's job.

    Per SKILL.md: "This skill never creates new source entries — it only
    refines entries created by record-extraction."
    """
    # Runs on every positive citation test, and on negative tests tagged
    # `no-new-source` (e.g. ut_citation_012): those negatives DO run a
    # skill body — record-extraction, or a citation trigger-then-decline —
    # so the never-create-a-source invariant must be enforced
    # deterministically here, independent of which skill routed.
    if test.get("type") != "positive" and "no-new-source" not in test.get("tags", []):
        pytest.skip("negative test without the no-new-source invariant")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    before_ids = {s.get("id") for s in before.get("sources", [])}
    after_ids = {s.get("id") for s in after.get("sources", [])}
    new = after_ids - before_ids
    assert not new, (
        f"citation added new source entries {sorted(new)} — it must only "
        f"refine existing ones, never create new sources."
    )


# --- Tag-gated assertions on specific source fields -------------------

def test_preserves_src001_original_classification(after_state, test):
    """For the refine-census-citation test, source_classification on
    src_001 must remain 'original' — the 1850 census image IS the
    original (digital image of microfilm of the original schedule).
    Down-classifying it to 'derivative' or 'authored' would be wrong.
    """
    if "preserves-src001-original" not in test.get("tags", []):
        pytest.skip("not a preserves-src001-original scenario")
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")
    src = next(
        (s for s in after.get("sources", []) if s.get("id") == "src_001"),
        None,
    )
    assert src is not None, "src_001 not found in after_state.sources"
    assert src.get("source_classification") == "original", (
        f"src_001 source_classification should be 'original'; "
        f"got {src.get('source_classification')!r}"
    )


# --- V5: Creator not in custody position --------------------------------

def test_creator_not_in_custody(before_state, after_state, test):
    """Author (creator) must not appear in the custody position.

    The `author` of the matching tree.gedcomx.json source description is
    the record's creator. If that name appears inside a parenthetical in
    the after-state `citation_detail.where`, it has been placed in the
    custody slot — who *holds* the record — which is a different fact.
    It is NOT a violation for the name to appear in `citation_detail.who`
    (that is the creator slot, where it belongs).
    """
    if test.get("type") == "negative":
        pytest.skip("negative test")
    before_rj = before_state.get("research_json")
    after_rj = after_state.get("research_json")
    tree = before_state.get("tree_gedcomx_json")
    if before_rj is None or after_rj is None:
        pytest.skip("missing research.json")
    if not tree:
        pytest.skip("no tree.gedcomx.json")

    tree_sources = {s["id"]: s.get("author", "") for s in tree.get("sources", [])}

    before_sources = {s["id"]: s for s in before_rj.get("sources", [])}
    violations = []
    for src in after_rj.get("sources", []):
        sid = src.get("id")
        if sid not in before_sources:
            continue
        sd_id = src.get("gedcomx_source_description_id")
        if not sd_id:
            continue
        author = tree_sources.get(sd_id, "")
        if not author:
            continue
        cd = src.get("citation_detail", {}) or {}
        where = cd.get("where", "") or ""
        for paren_match in re.finditer(r'\(([^)]+)\)', where):
            paren_content = paren_match.group(1)
            if author.lower() in paren_content.lower():
                violations.append(
                    f"{sid}: author {author!r} from tree source {sd_id} "
                    f"appears in the custody parenthetical of "
                    f"citation_detail.where: {where!r}"
                )
    assert not violations, (
        "record creator appears in the custody position — who created a "
        "record and who holds it are different facts:\n  "
        + "\n  ".join(violations)
    )


# --- V6: Unknown-marker vocabulary --------------------------------------

_CUSTODY_KEYWORDS = frozenset({
    "repository",
    "microfilm",
    "microfiche",
    "call number",
    "accession",
    "fhl",
    "catalog number",
})

_MARKER_RE = re.compile(r'\[([A-Z_ ]+?)(?:\s+NOT RECORDED)\]', re.IGNORECASE)


def _marker_names_custody_element(element_text: str) -> str | None:
    """Return the matched custody keyword if the marker names a custody or
    physical-media element, else None."""
    lowered = element_text.lower()
    for kw in _CUSTODY_KEYWORDS:
        if kw in lowered:
            return kw
    return None


def test_unknown_marker_vocabulary(after_state, test):
    """[...NOT RECORDED] markers must not name custody or physical-media elements.

    Markers for elements outside the citation framework — physical custody,
    microfilm number, call number — belong in `notes`, not in the citation.
    Legitimate citation-element markers (page, volume, date, creator, etc.)
    are allowed.
    """
    if test.get("type") == "negative":
        pytest.skip("negative test")
    after_rj = after_state.get("research_json")
    if after_rj is None:
        pytest.skip("missing research.json")
    violations = []
    for src in after_rj.get("sources", []):
        sid = src.get("id", "?")
        fields_to_check = [("citation", src.get("citation", "") or "")]
        cd = src.get("citation_detail", {}) or {}
        for field_name in ("who", "what", "when_created", "when_accessed",
                           "where", "where_within"):
            fields_to_check.append(
                (f"citation_detail.{field_name}", cd.get(field_name, "") or "")
            )
        for field_label, value in fields_to_check:
            for m in _MARKER_RE.finditer(value):
                raw = m.group(1).strip()
                matched_kw = _marker_names_custody_element(raw)
                if matched_kw is not None:
                    violations.append(
                        f"{sid}.{field_label}: marker {m.group(0)} names "
                        f"a custody/physical-media element (matched "
                        f"{matched_kw!r}) — this belongs in notes, not "
                        f"in the citation"
                    )
    assert not violations, (
        "[...NOT RECORDED] markers must not name custody or physical-media "
        "elements — those belong in notes, not in the citation:\n  "
        + "\n  ".join(violations)
    )


# --- V10: Informant never reaches `who` (literal half) -----------------

def test_informant_not_in_who(before_state, after_state, test):
    """citation_detail.who and citation string must not contain 'informant'.

    The informant is a person who supplied information within the record;
    their proximity to the event determines whether that information is
    primary or secondary. `who` is the record's creator. Collapsing the
    two destroys the distinction the evidence-classification layer rests on.
    """
    if test.get("type") == "negative":
        pytest.skip("negative test")
    before_rj = before_state.get("research_json")
    after_rj = after_state.get("research_json")
    if before_rj is None or after_rj is None:
        pytest.skip("missing research.json")
    before_sources = {s["id"]: s for s in before_rj.get("sources", [])}
    violations = []
    for src in after_rj.get("sources", []):
        sid = src.get("id")
        if sid not in before_sources:
            continue
        cd = src.get("citation_detail", {}) or {}
        who = cd.get("who", "") or ""
        citation = src.get("citation", "") or ""
        if "informant" in who.lower():
            violations.append(
                f"{sid}: citation_detail.who contains 'informant': {who!r}"
            )
        if "informant" in citation.lower():
            violations.append(
                f"{sid}: citation string contains 'informant': {citation!r}"
            )
    assert not violations, (
        "the informant is not the record creator — 'informant' must not "
        "appear in citation_detail.who or the citation string. The "
        "informant belongs in notes (proximity to the event determines "
        "whether information is primary or secondary):\n  "
        + "\n  ".join(violations)
    )
