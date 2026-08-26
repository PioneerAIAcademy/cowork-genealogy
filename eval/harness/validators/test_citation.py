"""Skill-specific validators for the citation skill.

citation keeps its `rubric.md` — all three dimensions (Evidence
Explained compliance, Replication test, Source vs information
distinction) are pure GPS craft and stay graded by the LLM judge.

This file holds structural invariants: the append-only source-section
check, creator-vs-custody slot validation (V5), informant-not-in-who
(V10), invented-locator detection (V3), example-value leak (V4),
negative-search fidelity (V11), and framework-walkthrough detection
(V12). Tool-allowlist and write-then-validate enforcement are delegated
to universal validators.

See test_universal.py module docstring for the validator function-
signature contract.
"""

from __future__ import annotations

import re

import pytest


# --- Helpers shared by V3 / V4 -------------------------------------------

# Locator pattern: matches concrete locator references with a numeral.
# Bracketed markers ([VOLUME NOT RECORDED], Will Book [volume]) are the
# mandated correct form and are excluded before matching.
_LOCATOR_RE = re.compile(
    r'\b(?:Will\s+Book|Deed\s+Book|Vol\.?|Volume|roll|p\.|pp\.|col\.|'
    r'no\.|certificate)\s*(\d+)',
    re.IGNORECASE,
)

# Pattern for bracketed unknown-value markers — these are correct and must
# never be flagged by V3.
_BRACKETED_MARKER_RE = re.compile(r'\[[^\]]*\]')


def _extract_on_file_numerals(research_json, tree_json=None):
    """Extract all numerals that appear in locator-shaped contexts in the
    scenario's existing data. Returns a set of numeral strings."""
    numerals = set()
    text_blob = ""
    if research_json:
        for src in research_json.get("sources", []):
            for field in ("citation", "notes", "repository"):
                text_blob += " " + (src.get(field) or "")
            cd = src.get("citation_detail") or {}
            for field in ("who", "what", "when_created", "when_accessed",
                          "where", "where_within"):
                text_blob += " " + (cd.get(field) or "")
        for entry in research_json.get("log", []):
            text_blob += " " + (entry.get("notes") or "")
            q = entry.get("query") or {}
            for v in q.values():
                if isinstance(v, str):
                    text_blob += " " + v
    if tree_json:
        for src in tree_json.get("sources", []):
            text_blob += " " + (src.get("author") or "")
            text_blob += " " + (src.get("title") or "")
            text_blob += " " + (src.get("citation") or "")
    for m in _LOCATOR_RE.finditer(text_blob):
        numerals.add(m.group(1))
    # Also grab bare numbers from the text (for things like record IDs,
    # certificate numbers, etc.)
    for m in re.finditer(r'\b(\d{3,})\b', text_blob):
        numerals.add(m.group(1))
    return numerals


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
        before_src = before_sources[sid]
        cd = src.get("citation_detail", {}) or {}
        who = cd.get("who", "") or ""
        citation = src.get("citation", "") or ""
        before_who = (before_src.get("citation_detail", {}) or {}).get("who", "") or ""
        before_citation = before_src.get("citation", "") or ""
        if "informant" in who.lower() and who != before_who:
            violations.append(
                f"{sid}: citation_detail.who contains 'informant': {who!r}"
            )
        if "informant" in citation.lower() and citation != before_citation:
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


# --- V10: Informant name from notes (report half) -----------------------

def report_informant_name_in_who(before_state, after_state, test):
    """V10 report half: if notes identify a personal name as the informant,
    that name must not appear in citation_detail.who or the citation string.

    The literal 'informant' substring is checked by test_informant_not_in_who
    above (tier 1). This report half extracts the actual name from notes and
    checks for it — tier 2 because free-text name extraction is approximate.
    """
    if test.get("type") == "negative":
        pytest.skip("negative test")
    before_rj = before_state.get("research_json")
    after_rj = after_state.get("research_json")
    if before_rj is None or after_rj is None:
        pytest.skip("missing research.json")
    before_sources = {s["id"]: s for s in before_rj.get("sources", [])}
    violations = []
    # Pattern: "informant: <Name>" or "informant was <Name>" or
    # "informant, <Name>," — extract the name following the keyword.
    informant_name_re = re.compile(
        r'informant[:\s]+(?:was\s+)?([A-Z][a-z]+'
        r'(?:\s+[A-Z][a-z]+){0,3})',
        re.IGNORECASE,
    )
    for src in after_rj.get("sources", []):
        sid = src.get("id")
        if sid not in before_sources:
            continue
        before_src = before_sources[sid]
        notes = before_src.get("notes") or ""
        m = informant_name_re.search(notes)
        if not m:
            continue
        informant_name = m.group(1).strip()
        if len(informant_name) < 3:
            continue
        cd = src.get("citation_detail", {}) or {}
        who = cd.get("who", "") or ""
        citation = src.get("citation", "") or ""
        name_lower = informant_name.lower()
        if name_lower in who.lower():
            violations.append(
                f"{sid}: informant name {informant_name!r} (from notes) "
                f"appears in citation_detail.who: {who!r}"
            )
        if name_lower in citation.lower():
            violations.append(
                f"{sid}: informant name {informant_name!r} (from notes) "
                f"appears in citation string: {citation[:100]!r}"
            )
    if violations:
        raise AssertionError(
            "a name identified as the informant in the source's notes "
            "appears in citation_detail.who or the citation string:\n  "
            + "\n  ".join(violations)
        )


# --- V3: No invented sample locators (persisted half) -------------------

def test_no_invented_locators_persisted(before_state, after_state, test):
    """V3 persisted half: concrete locator values in persisted citation fields
    must come from the on-file data, not be invented.

    Tier 1 — gates. Checks file_changes (after-state vs before-state).
    Bracketed markers ([VOLUME NOT RECORDED]) are the mandated correct form
    and are never flagged.
    """
    if test.get("type") == "negative":
        pytest.skip("negative test")
    before_rj = before_state.get("research_json")
    after_rj = after_state.get("research_json")
    tree = before_state.get("tree_gedcomx_json")
    if before_rj is None or after_rj is None:
        pytest.skip("missing research.json")
    on_file = _extract_on_file_numerals(before_rj, tree)
    # Also add numerals from the user's message (test input) — mirrors the
    # response half (report_no_invented_locators_response).
    user_msg = (test.get("input", {}) or {}).get("user_message", "") or ""
    for m in re.finditer(r'\b(\d+)\b', user_msg):
        on_file.add(m.group(1))
    before_sources = {s["id"]: s for s in before_rj.get("sources", [])}
    violations = []
    for src in after_rj.get("sources", []):
        sid = src.get("id")
        if sid not in before_sources:
            continue
        # Check citation, citation_detail fields, and notes
        for field_path, text in _citation_text_fields(src):
            # Strip bracketed markers before matching
            cleaned = _BRACKETED_MARKER_RE.sub('', text)
            for m in _LOCATOR_RE.finditer(cleaned):
                numeral = m.group(1)
                if numeral not in on_file:
                    # Check this numeral wasn't in the before-state for this source
                    before_text = ""
                    for _, bt in _citation_text_fields(before_sources[sid]):
                        before_text += " " + bt
                    if numeral in {
                        bm.group(1) for bm in _LOCATOR_RE.finditer(before_text)
                    }:
                        continue
                    violations.append(
                        f"{sid}.{field_path}: {m.group(0)!r} — numeral "
                        f"{numeral!r} does not appear in the on-file data"
                    )
    assert not violations, (
        "concrete locator values in persisted fields are absent from the "
        "on-file data — illustrative values are easily mistaken for data:\n  "
        + "\n  ".join(violations)
    )


def report_invented_locators_response(before_state, text_response, test):
    """V3 response half: concrete locator values in the text response must
    come from the on-file data.

    Tier 2 — reports. Observation text is neutral.
    """
    if test.get("type") == "negative":
        pytest.skip("negative test")
    before_rj = before_state.get("research_json")
    tree = before_state.get("tree_gedcomx_json")
    if before_rj is None:
        pytest.skip("missing research.json")
    response = text_response or ""
    if not response.strip():
        pytest.skip("no response text to check")
    on_file = _extract_on_file_numerals(before_rj, tree)
    # Also add numerals from the user's message (test input)
    user_msg = (test.get("input", {}) or {}).get("user_message", "") or ""
    for m in re.finditer(r'\b(\d+)\b', user_msg):
        on_file.add(m.group(1))
    # Strip code blocks (JSON blocks are the sanctioned form)
    stripped = re.sub(r'```[\s\S]*?```', '', response)
    # Strip bracketed markers
    stripped = _BRACKETED_MARKER_RE.sub('', stripped)
    matches = []
    for m in _LOCATOR_RE.finditer(stripped):
        numeral = m.group(1)
        if numeral not in on_file:
            matches.append(m.group(0))
    if matches:
        raise AssertionError(
            "the response contains locator values whose numerals are absent "
            "from the on-file data: "
            + ", ".join(f"'{v}'" for v in matches[:5])
        )


def _citation_text_fields(source):
    """Yield (field_path, text) for all citation-related text in a source."""
    for field in ("citation", "notes"):
        val = source.get(field) or ""
        if val:
            yield field, val
    cd = source.get("citation_detail") or {}
    for field in ("who", "what", "when_created", "when_accessed",
                  "where", "where_within"):
        val = cd.get(field) or ""
        if val:
            yield f"citation_detail.{field}", val


# --- V4: Skill's own example values not emitted -------------------------

def test_no_skill_example_values_persisted(before_state, after_state, test, skill_frontmatter):
    """V4 persisted half: example values from the SKILL.md body must not
    appear in persisted citation fields unless on file in the scenario.

    Tier 1 — gates. Harvests deny-list from the skill body's fenced Example
    blocks and parenthetical counter-examples, then subtracts anything
    present in the before-state.
    """
    if test.get("type") == "negative":
        pytest.skip("negative test")
    if (skill_frontmatter or {}).get("name") != "citation":
        pytest.skip("not the citation skill")
    before_rj = before_state.get("research_json")
    after_rj = after_state.get("research_json")
    if before_rj is None or after_rj is None:
        pytest.skip("missing research.json")
    deny_list = _harvest_skill_examples()
    if not deny_list:
        pytest.skip("could not extract example values from SKILL.md")
    # Subtract values present in the before-state
    on_file = _extract_on_file_numerals(before_rj, before_state.get("tree_gedcomx_json"))
    before_text = ""
    for src in before_rj.get("sources", []):
        for _, t in _citation_text_fields(src):
            before_text += " " + t
    deny_list = {
        v for v in deny_list
        if v.lower() not in before_text.lower()
    }
    if not deny_list:
        return  # all example values are on file — nothing to flag
    before_sources = {s["id"]: s for s in before_rj.get("sources", [])}
    violations = []
    for src in after_rj.get("sources", []):
        sid = src.get("id")
        if sid not in before_sources:
            continue
        for field_path, text in _citation_text_fields(src):
            text_lower = text.lower()
            for example_val in deny_list:
                if example_val.lower() in text_lower:
                    violations.append(
                        f"{sid}.{field_path}: contains skill example "
                        f"value {example_val!r}"
                    )
    assert not violations, (
        "example values from SKILL.md appear in persisted citation fields "
        "but are absent from the on-file data — these are illustrative, "
        "not data:\n  "
        + "\n  ".join(violations)
    )


def report_skill_example_values_in_response(before_state, text_response, test, skill_frontmatter):
    """V4 response half: example values from the SKILL.md body must not
    appear in the text response unless on file in the scenario.

    Tier 2 — reports.
    """
    if test.get("type") == "negative":
        pytest.skip("negative test")
    if (skill_frontmatter or {}).get("name") != "citation":
        pytest.skip("not the citation skill")
    response = text_response or ""
    if not response.strip():
        pytest.skip("no response text to check")
    before_rj = before_state.get("research_json")
    if before_rj is None:
        pytest.skip("missing research.json")
    deny_list = _harvest_skill_examples()
    if not deny_list:
        pytest.skip("could not extract example values from SKILL.md")
    # Subtract values present in the before-state
    before_text = ""
    for src in before_rj.get("sources", []):
        for _, t in _citation_text_fields(src):
            before_text += " " + t
    deny_list = {
        v for v in deny_list
        if v.lower() not in before_text.lower()
    }
    if not deny_list:
        return
    # Strip code blocks (JSON blocks are the sanctioned form)
    stripped = re.sub(r'```[\s\S]*?```', '', response)
    matches = []
    for example_val in deny_list:
        if example_val.lower() in stripped.lower():
            matches.append(example_val)
    if matches:
        raise AssertionError(
            "the response contains example values from SKILL.md that are "
            "absent from the on-file data: "
            + ", ".join(f"'{v}'" for v in matches[:5])
        )


def _harvest_skill_examples():
    """Extract example locator values from the citation SKILL.md body.

    Every locator-shaped literal in the skill body is illustrative. The
    templates carry theirs outside quotes and outside an "Example:"
    prefix (Will Book 9, p. 113; Deed Book 41, pp. 88-90), which the
    three narrower scans missed. On-file values are subtracted by the
    caller, so a wider harvest costs nothing.
    """
    from pathlib import Path
    skill_md = (
        Path(__file__).resolve().parents[3]
        / "packages" / "engine" / "plugin" / "skills"
        / "citation" / "SKILL.md"
    )
    if not skill_md.exists():
        return set()
    text = skill_md.read_text(encoding="utf-8")
    return {m.group(0).strip() for m in _LOCATOR_RE.finditer(text)}


# --- V11: Negative-search citation quotes log verbatim ------------------

def report_negative_search_quotes_log(before_state, text_response, test):
    """V11: phrases presented as drawn from the research log must be
    verbatim substrings of the log entry's notes.

    Tier 2 — reports. Checks quoted phrases in the response against
    log[].notes. Also flags birth years from query presented without
    an estimate marker (c., circa, about).
    """
    if test.get("type") == "negative":
        pytest.skip("negative test")
    response = text_response or ""
    if not response.strip():
        pytest.skip("no response text to check")
    before_rj = before_state.get("research_json")
    if before_rj is None:
        pytest.skip("missing research.json")
    log_entries = before_rj.get("log", [])
    if not log_entries:
        pytest.skip("no log entries in before-state")

    # Collect all notes text and query data from log
    all_notes = " ".join(
        (e.get("notes") or "") for e in log_entries
    )
    all_queries = []
    for e in log_entries:
        q = e.get("query") or {}
        all_queries.append(q)

    violations = []

    # Check quoted phrases that claim to be from the log/notes
    # Pattern: phrases in quotes preceded by log/notes language
    log_quote_re = re.compile(
        r'(?:(?:from|in|per|from the|the)\s+(?:log|notes|research log|search log)'
        r'[^"]*?"([^"]{8,})")',
        re.IGNORECASE,
    )
    for m in log_quote_re.finditer(response):
        quoted = m.group(1).strip()
        if quoted.lower() not in all_notes.lower():
            violations.append(
                f"quoted as from the log: \"{quoted[:80]}\" — "
                f"not found as a substring in any log[].notes"
            )

    # Check birth years presented without estimate markers
    # A birth_year from a query is a search estimate, not an established date
    birth_year_re = re.compile(r'\bborn\s+(\d{4})\b', re.IGNORECASE)
    estimate_markers = re.compile(r'\b(?:c\.|ca\.|circa|about|approximately|est\.?)\b', re.IGNORECASE)
    query_birth_years = set()
    for q in all_queries:
        by = q.get("birth_year")
        if by:
            query_birth_years.add(str(by))
    for m in birth_year_re.finditer(response):
        year = m.group(1)
        if year in query_birth_years:
            # Check if an estimate marker appears near this mention
            start = max(0, m.start() - 30)
            context = response[start:m.end()]
            if not estimate_markers.search(context):
                violations.append(
                    f"'born {year}' — this year comes from a search query's "
                    f"birth_year (a search estimate); the response presents "
                    f"it without an estimate marker (c., circa, about)"
                )

    if violations:
        raise AssertionError(
            "phrases presented as from the research log do not match the "
            "log content, or search estimates are presented as established "
            "facts:\n  "
            + "\n  ".join(violations)
        )


# --- V12: No framework walkthrough in the response ----------------------

def report_no_framework_walkthrough(text_response, test):
    """V12: the response must not walk through citation fields as headings.

    Tier 2 — reports. Flags responses that present 3+ of the 6
    Who/What/When/Where field labels as bolded or list-item headings
    outside JSON code blocks. The citation_detail JSON block is the
    sanctioned form.
    """
    if test.get("type") == "negative":
        pytest.skip("negative test")
    response = text_response or ""
    if not response.strip():
        pytest.skip("no response text to check")
    # Strip fenced code blocks (JSON blocks are the sanctioned form)
    stripped = re.sub(r'```[\s\S]*?```', '', response)
    # The six field labels (case-insensitive)
    field_labels = [
        "who", "what", "when created", "when accessed",
        "where", "where within",
    ]
    # Also match "wherein" as an alias for "where within"
    field_labels_with_alias = field_labels + ["wherein"]
    # Look for these as bolded headings (**Who**) or list items (- Who:)
    # or numbered items (1. Who:)
    heading_re = re.compile(
        r'(?:^|\n)\s*(?:\*\*|#{1,3}\s*|[-*]\s+|\d+\.\s+)('
        + "|".join(re.escape(l) for l in field_labels_with_alias)
        + r')(?:\*\*|:|\s)',
        re.IGNORECASE,
    )
    found_labels = set()
    for m in heading_re.finditer(stripped):
        found_labels.add(m.group(1).lower())
    # Normalize "wherein" → "where within"
    if "wherein" in found_labels:
        found_labels.discard("wherein")
        found_labels.add("where within")
    if len(found_labels) >= 3:
        raise AssertionError(
            f"the response presents {len(found_labels)} of the 6 "
            f"citation-detail field labels as headings outside a code "
            f"block: {sorted(found_labels)}; the JSON block is the "
            f"sanctioned form"
        )
