"""Skill-specific validators for the record-extraction skill.

These check structural invariants that should hold for every
record-extraction test, regardless of the specific test case.

See `validators/test_universal.py` module docstring for the full
validator function-signature contract. Briefly: `before_state`,
`after_state`, `tool_calls`, `skill_frontmatter`, and `test` are each
separate parameters supplied by the harness — pull the one you need by
declaring it in your function signature.

This file is intended as a second worked example for junior devs.
Compared to test_conflict_resolution.py, record-extraction:
  - Writes to TWO sections (assertions and sources), not one.
  - DOES call MCP tools (record_search, image_transcribe, etc.).
  - Has richer field-level invariants on each new assertion.

Pattern: ownership check, append-only check on assertions/sources,
foreign-key integrity, and per-assertion required-field checks.

Tag-gated regression checks (e.g., pre-1880-census-creates-no-relationship-
assertions) sit at the bottom; they gate on `test["tags"]` so they only fire
on the specific scenario they describe.
"""

import re

import pytest

from validators_lib import (
    assert_foreign_keys_valid,
    assert_no_section_deletions,
)


# Ownership enforcement is centralised in test_universal.py, driven by
# docs/specs/schemas/ownership.json. Per-skill copies were removed to prevent
# drift between two sources of truth.
#
# Diff / append-only / foreign-key patterns delegate to
# `validators_lib.py` — adding the next 21 skill validator files should
# call those helpers rather than re-implementing the patterns.


# --- Append-only / no-delete on owned sections ---

def test_assertions_are_append_only(before_state, after_state):
    """Existing assertions must not be deleted."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_no_section_deletions(before, after, "assertions")


def test_sources_are_append_only(before_state, after_state):
    """Existing sources must not be deleted."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_no_section_deletions(before, after, "sources")


# --- Foreign-key integrity for new assertions ---

def test_new_assertions_reference_valid_source(before_state, after_state):
    """Every new assertion's source_id must point at a real source entry."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_foreign_keys_valid(
        after,
        [("assertions", "source_id", "sources")],
        before=before,
    )


def test_new_assertions_reference_valid_log_entry(before_state, after_state):
    """log_entry_id is optional (null OK); when set, must resolve."""
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert_foreign_keys_valid(
        after,
        [("assertions", "log_entry_id", "log")],
        before=before,
    )


# --- Per-assertion structural rules ---

def test_new_assertions_have_required_classification(before_state, after_state):
    """Every new assertion must carry the three GPS classification fields.

    Per research-schema-spec.md §5.6, every assertion requires:
      - information_quality (primary | secondary | indeterminate)
      - informant_proximity (self, witness, household_member, ...)
      - evidence_type (direct | indirect | negative)

    Missing these silently breaks downstream skills (conflict-resolution
    weighs by informant_proximity; proof-conclusion needs evidence_type).
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        aid = a.get("id", "?")
        for field in ("information_quality", "informant_proximity", "evidence_type"):
            if not a.get(field):
                errors.append(f"assertions[{aid}]: missing {field}")

    assert not errors, "Incomplete new assertions:\n" + "\n".join(errors)


def _normalize_classification_token(s):
    """Strip non-alphanumerics and casefold, so open, model-chosen spellings
    of the same concept compare equal: `CauseOfDeath` ≡ `cause_of_death`,
    `BirthPlace` ≡ `birthplace`. record_role and fact_type are open strings
    (recommended enums, not closed), so a doctrine-perfect run may persist
    PascalCase GedcomX-style fact types where a matcher says snake_case."""
    return "".join(ch for ch in str(s or "") if ch.isalnum()).casefold()


def _fact_type_matches(got, want):
    return _normalize_classification_token(got) == _normalize_classification_token(want)


def _record_role_matches(got, want):
    """Normalized equality, plus a prefix relationship in either direction
    when the longer form continues with 'of': `father` matches
    `father_of_deceased` (and vice versa), but `deceased` does NOT match
    `father_of_deceased` (the longer form doesn't continue with 'of' after
    the shorter), and `father` does NOT match `father_in_law`."""
    got_n = _normalize_classification_token(got)
    want_n = _normalize_classification_token(want)
    if got_n == want_n:
        return True
    if not got_n or not want_n:
        return False
    longer, shorter = (got_n, want_n) if len(got_n) > len(want_n) else (want_n, got_n)
    return longer.startswith(shorter) and longer[len(shorter):].startswith("of")


def _attribute_matches(assertion, attribute):
    """Optional facet filter for event facts whose date and place are separate
    attributes of ONE event type. A birthplace is a `birth` assertion with the
    `place` set; a computed birth year is a `birth` assertion with the `date`
    set. When a matcher declares `attribute: "place"` (or `"date"`), only
    assertions with that attribute populated match — so a `birth` place-claim
    (`direct`) and a `birth` date-claim (`indirect`) stay independently
    checkable even though they now share the `birth` fact_type. No `attribute`
    on the matcher → no facet constraint (matches regardless of population)."""
    if not attribute:
        return True
    if attribute == "place":
        return bool(assertion.get("place")) or bool(assertion.get("standard_place"))
    if attribute == "date":
        return bool(assertion.get("date"))
    return True


def _value_matches(assertion, attribute, expected):
    """The assertion's value for the matcher's attribute CONTAINS `expected`
    (case-insensitive). #1108 — pins the fact value, not just its layers.

    Which assertion field is read follows the matcher's `attribute`: `place`
    OR `standard_place` for attribute "place", `date` for "date", else the
    human-readable `value`. The check is a case-insensitive substring so
    place standardization is tolerated ("Pennsylvania" -> "Pennsylvania,
    United States" still matches "Pennsylvania") while a genuinely wrong
    value still fails ("Ireland" is not in "Pennsylvania") — which is exactly
    the ut_013 leak this exists to catch deterministically."""
    want = str(expected).strip().casefold()
    if not want:
        return True
    if attribute == "place":
        fields = (assertion.get("place"), assertion.get("standard_place"))
    elif attribute == "date":
        fields = (assertion.get("date"),)
    else:
        fields = (assertion.get("value"),)
    return any(f and want in str(f).casefold() for f in fields)


def test_expected_classifications(before_state, after_state, test):
    """Fixture-gated: deterministic per-fixture classification ground truth.

    Gated on the test JSON's optional top-level `expected_classifications`
    block (threaded into `test` by the orchestrator; see
    unit-test-spec.md §5.10). Each matcher names a (record_role, fact_type)
    pair plus expected values for any of `evidence_type`,
    `informant_proximity`, `information_quality`. Semantics:

      1. At least one NEW assertion (created by this run) with the
         matcher's record_role + fact_type must exist.
      2. EVERY new assertion with that record_role + fact_type must carry
         each classification value the matcher declares.

    record_role / fact_type matching is normalized (see the helpers above)
    because both are open, model-chosen strings; the classification values
    themselves (`evidence_type`, `informant_proximity`,
    `information_quality`) are closed enums and compare exactly. Failure
    messages always show the ORIGINAL strings, not the normalized forms.

    This makes classification doctrine mechanically checkable per fixture —
    the LLM judge still grades the dimensions, but these results are the
    mechanical reference during annotation (they don't invert with judge
    phrasing).
    """
    matchers = test.get("expected_classifications") or []
    if not matchers:
        pytest.skip("test declares no expected_classifications")

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}
    new = [
        a for a in after.get("assertions", []) if a.get("id") not in before_ids
    ]

    classification_fields = (
        "evidence_type",
        "informant_proximity",
        "information_quality",
    )

    errors = []
    for m in matchers:
        role = m.get("record_role")
        fact = m.get("fact_type")
        attribute = m.get("attribute")  # optional facet: "date" | "place"
        # `optional`: do NOT hard-require the assertion to EXIST — only check its
        # classification IF it is present. Use for a fact whose *existence* is
        # completeness the skill produces unreliably (so gating on it flaps), but
        # whose *classification* (when present) is still worth verifying. Grading
        # unreliable existence as a hard fail is what makes a test flappy; the
        # judge's soft Completeness dimension covers the omission instead.
        optional = bool(m.get("optional", False))
        attr_desc = f" attribute='{attribute}'" if attribute else ""
        matching = [
            a
            for a in new
            if _record_role_matches(a.get("record_role"), role)
            and _fact_type_matches(a.get("fact_type"), fact)
            and _attribute_matches(a, attribute)
        ]
        if not matching:
            if optional:
                continue  # existence not required — nothing present to classify
            errors.append(
                f"no new assertion with record_role='{role}' "
                f"fact_type='{fact}'{attr_desc} (expected at least one)"
            )
            continue
        for a in matching:
            aid = a.get("id", "?")
            for field in classification_fields:
                if field not in m:
                    continue
                got = a.get(field)
                # A matcher value may be a LIST of defensible alternatives for a
                # genuinely-ambiguous classification (e.g. a death event's
                # informant_proximity is defensibly `official_duty` OR `witness`).
                # A list means "any of these is acceptable"; the check still has
                # teeth — a third, clearly-wrong value (e.g. `self`) still fails.
                # A plain string keeps the exact-match semantics.
                expected = m[field]
                allowed = expected if isinstance(expected, list) else [expected]
                if got not in allowed:
                    want = (
                        "one of " + ", ".join(f"'{v}'" for v in allowed)
                        if isinstance(expected, list)
                        else f"'{expected}'"
                    )
                    errors.append(
                        f"assertions[{aid}] (record_role='{role}', "
                        f"fact_type='{fact}'{attr_desc}): {field}='{got}' — "
                        f"expected {want}"
                    )
            # `value` pins the fact VALUE, not a classification layer (#1108) —
            # checked against the attribute-relevant field, case-insensitive
            # substring. This is what makes the ut_013 "Ireland vs Pennsylvania"
            # leak deterministic; the layer facets above would pass either way.
            if "value" in m and not _value_matches(a, attribute, m["value"]):
                got_val = (
                    a.get("place") or a.get("standard_place")
                    if attribute == "place"
                    else a.get("date")
                    if attribute == "date"
                    else a.get("value")
                )
                errors.append(
                    f"assertions[{aid}] (record_role='{role}', "
                    f"fact_type='{fact}'{attr_desc}): value='{got_val}' — "
                    f"expected to contain '{m['value']}'"
                )

    assert not errors, (
        "expected_classifications violations:\n  - " + "\n  - ".join(errors)
    )


_EMBEDDED_YEAR_RE = re.compile(r"\b(1[5-9]\d{2}|20\d{2})\b")


def test_birth_place_value_has_no_embedded_year(before_state, after_state):
    """A place-keyed `birth` assertion must not smuggle a birth YEAR into its
    `value` string (#1407).

    The defect this catches is atomicity, not classification: a run that
    persists

        {"fact_type": "birth", "value": "born about 1845, Ohio",
         "place": "Ohio, United States", "date": null,
         "evidence_type": "direct"}

    has put TWO facts in one assertion. The birthplace is `direct` (stated)
    while a year derived from a stated age is `indirect`, so one assertion
    cannot carry a correct `evidence_type` for both — and every structured
    matcher is blind to it, because the year lives in free text where
    `expected_classifications` never looks (ut_022 scored a false pass on
    `Assertion atomicity` eight times over).

    The defect is **information loss**, so the rule fires only when the year
    is recoverable from nowhere but that free-text string. Two exemptions,
    both measured rather than guessed:

    1. **The assertion carries its own structured `date`.** ut_026
       `"January 1845"`, ut_016 `"Born 11 July 1817, Stavanger…"`, ut_005
       `"born Ireland, circa 1845"` and ut_006 `"born ca. 1845, Ireland"` all
       populate `date`, so the year in `value` mirrors a structured fact.
    2. **A sibling `birth` assertion for the same `record_role` carries the
       year in its `date`.** This is the ut_028 case, and it is why the
       first exemption alone is not enough: the run persists TWO atomic
       assertions per party — `place='Cincinnati, Ohio'` / `date=None`
       (`direct`) beside `date='~1887'` / `place=None` (`indirect`) — so
       atomicity is correct and only the place assertion's human-readable
       label is redundant. The year is not smuggled; it is stated twice.
       Failing that shape reddens a structurally-correct extraction.

    So a `value` naming a year is graded against the assertion **set**, not
    the assertion alone. What survives both exemptions is the real defect:
    a year that exists only inside a birthplace's prose.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}
    new = [a for a in after.get("assertions", []) if a.get("id") not in before_ids]

    # Exemption 2: which (record, role) pairs already state a birth date
    # structurally. A date on a sibling means the year is captured and the
    # assertion set is atomic — the verbose label is noise, not smuggling.
    #
    # Keyed on (record_id, record_role), NOT role alone: `child_1` on one
    # record must not vouch for `child_1` on another, which would suppress a
    # genuine leak in any multi-record project.
    #
    # Scans the WHOLE after-state, not just new rows: a scenario that seeded a
    # birth date (every `mid-research-flynn` fixture does) already states the
    # year, so a run adding only the birthplace has smuggled nothing.
    #
    # Deliberately EXISTENCE-based rather than year-matching. Matching the
    # exact year read strictly better until it met a real label: a value like
    # "1870 census: born in Ohio" carries the enumeration year, `search` takes
    # the FIRST year it finds, and no structured field states 1870 — so a
    # doctrine-correct run with its birth year properly on a sibling got
    # flagged. Since a validator failure suppresses the judge, that false
    # positive costs the test's entire grade. Year-matching only ever bought
    # the contrived "sibling states the wrong year" case, which occurs nowhere
    # in the corpus; extra years in a human-readable label are common. Fewer
    # false positives is the right trade for a guard whose true-positive count
    # is zero.
    dated_siblings = set()
    for a in after.get("assertions", []):
        if not _fact_type_matches(a.get("fact_type"), "birth"):
            continue
        if a.get("date"):
            dated_siblings.add(
                (
                    a.get("record_id"),
                    _normalize_classification_token(a.get("record_role")),
                )
            )

    errors = []
    for a in new:
        if not _fact_type_matches(a.get("fact_type"), "birth"):
            continue
        if a.get("evidence_type") != "direct":
            continue
        if not (a.get("place") or a.get("standard_place")):
            continue
        if a.get("date"):
            continue  # exemption 1 — this assertion states a date itself
        # Exemption 2 — a sibling birth assertion for this same record+role
        # states one, so the year is captured structurally.
        if (
            a.get("record_id"),
            _normalize_classification_token(a.get("record_role")),
        ) in dated_siblings:
            continue
        value = str(a.get("value") or "")
        years = _EMBEDDED_YEAR_RE.findall(value)
        if not years:
            continue
        errors.append(
            f"assertions[{a.get('id', '?')}] (record_role="
            f"'{a.get('record_role')}'): direct birth/place assertion has "
            f"{'years' if len(years) > 1 else 'the year'} "
            f"{', '.join(years)} embedded in value={value!r}, and NO birth "
            f"assertion for this record+role states a date — a birth year "
            f"belongs in its own indirect assertion, not recoverable only "
            f"from the birthplace's prose"
        )

    assert not errors, (
        "Compound birth assertions (year smuggled into a birthplace "
        "value):\n  - " + "\n  - ".join(errors)
    )


# Only the PARENTHESISED part of a name value is scanned. Both observed
# collapse shapes put the relation inside brackets —
# `John Becker (father of Frank Becker)` and
# `Linda (given name only; spouse of Robert Whitaker)` — while every known
# false positive is a relation word that is really a surname or a title, sitting
# in the bare part of the name:
#
#     Joseph Parent of Quebec      (Parent is a common surname)
#     Julia Child of Boston        (Child is a surname)
#     Mary, Mother of Sorrows      (a devotional name)
#
# All three fired under the first version of this rule (caught in review), and a
# false positive is expensive: a failing validator suppresses the judge, so it
# costs the test's whole grade, not one dimension. Scoping to brackets removes
# them and is what makes the wider vocabulary below safe.
#
# The cost is a miss on a comma-form collapse (`John Becker, father of Frank`).
# That is the safer direction to err, and the per-fixture `record_role` matchers
# catch the collapse independently.
_PAREN_SEGMENT_RE = re.compile(r"\(([^)]*)\)")

_RELATION_PHRASE_RE = re.compile(
    # optional step-/grand- prefix, the relation, optional -in-law, then of/to
    r"\b(?:(?:step|grand|great[-\s]?grand)[-\s]?)?"
    r"(?:father|mother|parent|wife|husband|spouse|widow|widower|son|daughter|"
    r"child|brother|sister|sibling|niece|nephew|aunt|uncle|cousin)"
    r"(?:[-\s]?in[-\s]?law)?\s+(?:of|to)\b"
    # plus the abbreviated genealogical forms: son/daughter/wife of
    r"|\b[sdw]/o\b",
    re.IGNORECASE,
)


def _relational_name_hit(value):
    """The relation phrase found inside a bracketed segment, or None."""
    for segment in _PAREN_SEGMENT_RE.findall(str(value or "")):
        m = _RELATION_PHRASE_RE.search(segment)
        if m:
            return m.group(0)
    return None


# `structured_value.relationship_type` and the human-readable `value` must agree
# about WHICH relation and in WHICH direction. They are compared by category, not
# literally, because `rt: "spouse"` beside `value: "wife of George Bennett"` is
# correct — wife IS a spouse — and a literal comparison flags 39 assertions in the
# committed corpus of which only 7 are real.
_RELATION_CATEGORY = {
    "father": "parent", "mother": "parent", "parent": "parent",
    "son": "child", "daughter": "child", "child": "child",
    "wife": "spouse", "husband": "spouse", "spouse": "spouse",
    "widow": "spouse", "widower": "spouse",
    "brother": "sibling", "sister": "sibling", "sibling": "sibling",
}

_RELATION_WORD_IN_VALUE = re.compile(
    r"\b(" + "|".join(_RELATION_CATEGORY) + r")\b", re.IGNORECASE
)


def _relationship_category(relationship_type):
    """Category for a `relationship_type`, ignoring an `_inferred` suffix.
    Returns None for a spelling this table does not know (`stepfather`,
    `father_in_law`, …) so the check SKIPS rather than guesses — an unknown
    type is not evidence of disagreement."""
    base = str(relationship_type or "").lower().replace("_inferred", "").strip()
    return _RELATION_CATEGORY.get(base)


def test_relationship_type_agrees_with_its_value(before_state, after_state):
    """A relationship assertion's machine-readable `relationship_type` must not
    contradict its own human-readable `value`.

    Found by a genealogist annotating `v1_2026-08-17_18-57-51`: Grace Tolman
    persisted as `relationship_type: "child"` where the obituary calls her
    Harold's SISTER. Two shapes occur in the committed corpus, 7 instances
    across ut_017 and ut_027 in three separate run logs:

      category swap        rt=child   value='sister of Harold Dean Whitaker'
      direction inversion  rt=parent  value='child of Louise Becker'

    This is the most dangerous classification defect of its family because the
    two layers disagree SILENTLY. Downstream materialisation reads
    `structured_value`, so a wrong `relationship_type` writes a wrong family
    edge into the tree — or one pointing the wrong way — while the assertion
    still reads correctly to a human checking `value`. The LLM judge reads the
    prose and passes it; a `value`-only matcher passes it too. Nothing else in
    the harness looks at both fields at once.

    Compared by CATEGORY (parent / child / spouse / sibling), so `spouse` beside
    "wife of …" agrees. A value naming several relations passes if the type
    matches any of them, and a value naming none is skipped — there is nothing
    to disagree with.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        if not _fact_type_matches(a.get("fact_type"), "relationship"):
            continue
        rel_type = (a.get("structured_value") or {}).get("relationship_type")
        value = str(a.get("value") or "")
        want = _relationship_category(rel_type)
        if not want or not value:
            continue
        found = {
            _RELATION_CATEGORY[w.lower()]
            for w in _RELATION_WORD_IN_VALUE.findall(value)
        }
        if found and want not in found:
            errors.append(
                f"assertions[{a.get('id', '?')}] (record_role="
                f"'{a.get('record_role')}'): relationship_type="
                f"{rel_type!r} is a {want} relation, but value={value!r} "
                f"states a {'/'.join(sorted(found))} relation. The two layers "
                f"must agree — materialisation reads structured_value, so this "
                f"writes the wrong family edge (or the right one backwards) "
                f"while the value still reads correctly"
            )

    assert not errors, (
        "relationship_type contradicts its own value:\n  - " + "\n  - ".join(errors)
    )


def test_name_value_is_a_bare_name(before_state, after_state):
    """A `name` assertion's value is the NAME, not the name plus the person's
    tie to someone else (#1627).

    The observed failure fuses two things into one value while filing the
    assertion under the wrong persona:

        record_role='groom'  fact_type='name'
        value='John Becker (father of Frank Becker)'

    Both halves are wrong. The tie belongs in its own `relationship`
    assertion, and the name belongs to `father_of_groom` — filed under
    `groom`, no parent persona exists at all, and `person-evidence` binds by
    record_id + record_role, so nothing downstream can ever reach it.

    This rule catches the value half deterministically and corpus-wide. The
    role half is only reachable per fixture, via an existence-gated
    `expected_classifications` matcher on the third-party role (ut_025 has
    them, which is how this surfaced).

    Scoped to `name` assertions, and to a relation word followed by `of`/`to`,
    so a maiden-name parenthetical ("Mary (Johnson) Smith") and a
    negative-evidence value describing an absence are both untouched.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        if not _fact_type_matches(a.get("fact_type"), "name"):
            continue
        if a.get("record_role") == "absent":
            continue  # negative evidence describes what was expected
        value = str(a.get("value") or "")
        hit = _relational_name_hit(value)
        if hit:
            errors.append(
                f"assertions[{a.get('id', '?')}] (record_role="
                f"'{a.get('record_role')}'): name value={value!r} carries the "
                f"relational phrase '{hit}' — a name assertion's "
                f"value is the bare name, the tie is its own `relationship` "
                f"assertion, and the named third party needs their OWN "
                f"record_role rather than this one"
            )

    assert not errors, (
        "Name assertions fusing identity with relationship:\n  - "
        + "\n  - ".join(errors)
    )


def test_new_assertions_attached_to_record_role(before_state, after_state):
    """Every new assertion must have both record_id and record_role.

    Per research-schema-spec.md §5.6 design decision: assertions attach
    to record_id + record_role, NOT to a person. Person attachment is
    person-evidence's job. record-extraction must produce assertions
    with both fields populated so person-evidence has something to bind.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        aid = a.get("id", "?")
        if not a.get("record_id"):
            errors.append(f"assertions[{aid}]: missing record_id")
        if not a.get("record_role"):
            errors.append(f"assertions[{aid}]: missing record_role")

    assert not errors, "Assertions not attached to record_role:\n" + "\n".join(errors)


def test_negative_evidence_uses_absent_role(before_state, after_state):
    """Assertions with evidence_type='negative' must have record_role='absent'.

    Per research-schema-spec.md §5.6 negative-evidence convention:
    when the absence of information is the finding, the role is `absent`
    and the value describes what was expected. Catches the common
    mistake of using evidence_type='negative' on a regular role.
    """
    after = after_state.get("research_json")
    if after is None:
        pytest.skip("No research.json in output")

    errors = []
    for a in after.get("assertions", []):
        if a.get("evidence_type") == "negative" and a.get("record_role") != "absent":
            errors.append(
                f"assertions[{a.get('id')}]: evidence_type=negative but "
                f"record_role='{a.get('record_role')}' (expected 'absent')"
            )

    assert not errors, "Negative-evidence role mismatch:\n" + "\n".join(errors)


# --- New sources structural rules ---

def test_new_sources_have_citation_detail(before_state, after_state):
    """Every new source must have the citation_detail object populated.

    record-extraction creates the source with a working citation; the
    citation skill later refines it. But the structure must exist from
    creation so downstream skills have something to read.
    """
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {s.get("id") for s in before.get("sources", [])}

    required_detail_keys = {"who", "what", "when_created", "when_accessed", "where", "where_within"}

    errors = []
    for s in after.get("sources", []):
        if s.get("id") in before_ids:
            continue
        sid = s.get("id", "?")
        detail = s.get("citation_detail") or {}
        missing = required_detail_keys - set(detail.keys())
        if missing:
            errors.append(f"sources[{sid}]: citation_detail missing {sorted(missing)}")

    assert not errors, "Incomplete new sources:\n" + "\n".join(errors)


# NOTE (2026-07-11, record-extraction consolidation PR 3): the per-skill
# `test_only_allowed_mcp_tools` check was removed. It duplicated the
# universal `test_tool_allowlist` in test_universal.py — which, unlike the
# local copy, unions the frontmatter `tools:` of every plugin agent the
# skill delegates to via `@plugin:<name>` (record-extraction now delegates
# persistence to the record-extractor agent, whose extraction_append /
# tree_edit / place_search calls land in the same session tool_calls log).
# Same removal was already applied to conflict-resolution and
# proof-conclusion for the same redundancy reason.


# --- Tag-gated regression checks ---

def _census_year_before_1880(test):
    """True when the test's tags mark it a census record whose year predates
    the 1880 relationship column. Year is DERIVED from the tags rather than
    matched against a hardcoded list, so a future 1840 fixture is covered the
    day it lands. Tags carry the year either bare (`"1870"`) or suffixed
    (`"1850-census"`)."""
    tags = [str(t) for t in (test.get("tags") or [])]
    is_census = any(t == "census" or t.endswith("-census") for t in tags)
    if not is_census:
        return False
    years = [int(t[:4]) for t in tags if t[:4].isdigit() and len(t[:4]) == 4]
    return bool(years) and max(years) < 1880


def test_pre_1880_census_creates_no_relationship_assertions(
    before_state, after_state, test
):
    """A pre-1880 census extraction must create NO parent-child or spousal
    relationship assertions — in any form, including `indirect` /
    `_inferred`.

    The ruling this enforces is recorded on issue #1626 — quoted in full, with
    its author and date, rather than asserted here. This docstring previously
    read "Decided 2026-08-15 (issue #1626)" while that issue held no record of
    any decision, which a reviewer correctly refused to accept as authorisation
    for a reversal spanning the agent body, the reference doc, the rubric, eight
    fixtures, this validator and the schema spec.

    The 1790–1870 censuses have no
    relationship column, so the record states only that these people shared
    a dwelling. Extraction records each person's stated facts and the
    co-residence; deducing family links from household position is a
    hypothesis, and hypotheses belong to downstream correlation.

    This REPLACES `test_1850_census_uses_inferred_suffix`, which enforced the
    opposite policy (relationships must exist and carry `_inferred`). Both
    readings were defensible from the old prompt, so the model arbitrated per
    run — ut_022 emitted 14, 13, 1 and 0 relationship assertions across
    successive runs of the same fixture. Determinism is the point of the
    rule, not merely tidiness.

    Gated on census tags with a derived year < 1880, so 1880+ fixtures (where
    the column exists and the relationship IS stated) are untouched.
    """
    if not _census_year_before_1880(test):
        pytest.skip("not a pre-1880 census scenario")

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        if not _fact_type_matches(a.get("fact_type"), "relationship"):
            continue
        sv = a.get("structured_value") or {}
        rel_type = sv.get("relationship_type") or "?"
        errors.append(
            f"assertions[{a.get('id')}] (record_role="
            f"'{a.get('record_role')}', relationship_type='{rel_type}', "
            f"evidence_type='{a.get('evidence_type')}'): a pre-1880 census "
            f"has no relationship column, so no relationship assertion may "
            f"be written — not even `indirect`/`_inferred`. Record the "
            f"people and their co-residence; the family links are "
            f"downstream correlation's to infer"
        )

    assert not errors, (
        "pre-1880 census wrote relationship assertions:\n  - "
        + "\n  - ".join(errors)
    )


def test_negative_evidence_assertion_created(
    before_state, after_state, test
):
    """For negative-evidence scenarios, the skill must create at least
    one NEW assertion with `evidence_type: \"negative\"` and
    `record_role: \"absent\"`. Otherwise the absence wasn't recorded.

    Tag-gated on `negative-evidence`.
    """
    if "negative-evidence" not in test.get("tags", []):
        pytest.skip("not a negative-evidence scenario")

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}
    new_neg = [
        a for a in after.get("assertions", [])
        if a.get("id") not in before_ids
        and a.get("evidence_type") == "negative"
        and a.get("record_role") == "absent"
    ]
    assert new_neg, (
        "negative-evidence scenario produced no new assertion with "
        "evidence_type='negative' and record_role='absent'"
    )


def test_negative_evidence_value_describes_expectation(
    before_state, after_state, test
):
    """For negative-evidence extractions, the assertion's `value` field
    must describe what was expected — not be empty or just the literal
    'absent'.

    Per the negative-evidence convention, `value` carries the
    expected-but-missing information so downstream skills (and the
    genealogist) know what was searched for.

    Tag-gated on `negative-evidence`.
    """
    if "negative-evidence" not in test.get("tags", []):
        pytest.skip("not a negative-evidence scenario")

    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")

    before_ids = {a.get("id") for a in before.get("assertions", [])}

    errors = []
    for a in after.get("assertions", []):
        if a.get("id") in before_ids:
            continue
        if a.get("evidence_type") != "negative":
            continue
        value = (a.get("value") or "").strip()
        if not value or value.lower() in {"absent", "missing", "n/a", "none"}:
            errors.append(
                f"assertions[{a.get('id')}]: negative-evidence value is "
                f"'{value}' — should describe what was expected"
            )

    assert not errors, (
        "Negative-evidence assertions missing expectation in value:\n  - "
        + "\n  - ".join(errors)
    )


# --- Sidecar-gated: record_persona_id on record_search assertions ----

def _staged_sidecar_record_ids(state):
    """Collect the record ids staged in the scenario's search sidecars
    (results/<log_id>.json in the workspace `files` snapshot), normalized
    to their `ark:/...` tail so any accepted record_id form matches.
    Returns a set (empty when the scenario staged no sidecar)."""
    import json

    ids = set()
    for rel_path, content in (state.get("files") or {}).items():
        if not (rel_path.startswith("results/") and rel_path.endswith(".json")):
            continue
        try:
            sidecar = json.loads(content)
        except (ValueError, TypeError):
            continue  # malformed sidecar fixtures have their own tests
        payload = sidecar.get("payload") or {}
        for result in payload.get("results") or []:
            for key in ("recordId", "arkUrl"):
                rid = result.get(key)
                if rid:
                    ids.add(_normalize_record_id(rid))
    return ids


def _normalize_record_id(rid):
    """Reduce a record id to its `ark:/...` tail when present (full arkUrl,
    bare ark, and entity-prefixed forms all compare equal); non-ark ids
    compare verbatim."""
    idx = rid.find("ark:/")
    return rid[idx:] if idx != -1 else rid


def _staged_sidecar_persona_counts(state):
    """Map each staged sidecar record's normalized id -> the number of
    personas in its `gedcomx.persons[]` (0 when the result carries no
    gedcomx). Used to gate the shared-persona corruption check on
    multi-persona records only."""
    import json

    counts = {}
    for rel_path, content in (state.get("files") or {}).items():
        if not (rel_path.startswith("results/") and rel_path.endswith(".json")):
            continue
        try:
            sidecar = json.loads(content)
        except (ValueError, TypeError):
            continue  # malformed sidecar fixtures have their own tests
        payload = sidecar.get("payload") or {}
        for result in payload.get("results") or []:
            personas = (result.get("gedcomx") or {}).get("persons") or []
            for key in ("recordId", "arkUrl"):
                rid = result.get(key)
                if rid:
                    norm = _normalize_record_id(rid)
                    counts[norm] = max(counts.get(norm, 0), len(personas))
    return counts


def test_record_persona_id_set(before_state, after_state, test):
    """Sidecar-gated: when the scenario staged a search sidecar
    (results/<log_id>.json), EVERY new assertion whose record_id matches a
    record staged in that sidecar must carry a non-null record_persona_id
    — per-assertion coverage, EXPLICITLY INCLUDING the focus persona (the
    searched person, id = the result's primaryId). "The primary is
    implied" is the known failure mode; "at least one assertion has it" is
    not coverage. Those assertions must also carry record_id in full
    arkUrl form — so person-evidence can later resolve the record and call
    same_person. Sidecar-less scenarios (record_read / image / PDF
    extractions) skip: supplying record_persona_id there is a hard error
    by contract."""
    sidecar_ids = _staged_sidecar_record_ids(before_state)
    if not sidecar_ids:
        pytest.skip("scenario staged no search sidecar")

    before = before_state.get("research_json") or {}
    after = after_state.get("research_json") or {}
    before_ids = {a.get("id") for a in before.get("assertions", [])}
    new = [a for a in after.get("assertions", []) if a.get("id") not in before_ids]

    matched = [
        a for a in new
        if _normalize_record_id(a.get("record_id") or "") in sidecar_ids
    ]
    if "record-persona-id" in test.get("tags", []):
        assert new, "expected new assertions extracted from the record"
        assert matched, (
            "no new assertion's record_id matches the staged sidecar record "
            "— either nothing was extracted from the staged record or every "
            "record_id is malformed beyond recognition"
        )
    elif not matched:
        pytest.skip("no new assertions from the staged sidecar record")

    errors = []
    for a in matched:
        aid = a.get("id", "?")
        if not a.get("record_persona_id"):
            errors.append(
                f"{aid}: missing record_persona_id (per-assertion coverage "
                f"— the focus persona is NOT implied; its id is the "
                f"result's primaryId)"
            )
        rid = a.get("record_id") or ""
        if not rid.startswith("http"):
            errors.append(f"{aid}: record_id {rid!r} is not a full arkUrl")

    # Corruption signature (ut_006): one persona id stamped across DIFFERENT
    # record_roles of a multi-persona record — the focus persona's id leaked
    # onto other household members' / relatives' assertions. Gated on records
    # the sidecar shows to hold 2+ personas (a single-persona record cannot
    # cross-contaminate). Role comparison reuses _record_role_matches so
    # `father` vs `father_of_deceased` (one role, two spellings) is not a
    # false positive.
    persona_counts = _staged_sidecar_persona_counts(before_state)
    by_record = {}
    for a in matched:
        by_record.setdefault(
            _normalize_record_id(a.get("record_id") or ""), []
        ).append(a)
    for rid_norm, group in by_record.items():
        if persona_counts.get(rid_norm, 0) < 2:
            continue
        by_persona = {}
        for a in group:
            pid = a.get("record_persona_id")
            if pid:
                by_persona.setdefault(pid, []).append(a)
        for pid, holders in by_persona.items():
            distinct = []  # (role, example assertion id), pairwise-distinct roles
            for a in holders:
                role = a.get("record_role")
                if not any(_record_role_matches(role, seen) for seen, _ in distinct):
                    distinct.append((role, a.get("id", "?")))
            if len(distinct) > 1:
                detail = ", ".join(
                    f"{aid}: record_role='{role}'" for role, aid in distinct
                )
                errors.append(
                    f"record_persona_id '{pid}' is shared by assertions with "
                    f"different record_roles on multi-persona record "
                    f"'{rid_norm}' ({detail}) — one persona cannot fill "
                    f"different roles; the focus persona's id was likely "
                    f"stamped onto other personas' assertions"
                )

    assert not errors, (
        "record_search assertions wrongly shaped:\n  - " + "\n  - ".join(errors)
    )

DESTRUCTIVE_TREE_OPS = {"update_name", "update_person", "remove"}


def test_extraction_makes_no_destructive_tree_ops(tool_calls):
    """Extraction adds evidence; it never renames, rewrites, or removes
    existing tree entities. Since the tree_edit/tree_correct split, the
    correction/removal ops (`update_*` / `remove`) live in `tree_correct`,
    which extraction does not hold — so the primary assertion is simple:
    an extraction run makes ZERO tree_correct calls. Identity resolution
    and correction are owned by person-evidence, hypothesis-tracking, and
    the tree-edit skill. A record persona judged to BE an existing tree
    person under a variant name gets an `add_name` (alternate,
    non-preferred) via tree_edit — never an `update_name`. Structural
    enforcement for the ut_013 rename incident (2026-07-12): prose
    prohibitions do not hold when the model believes it is correcting an
    error. The old-shape check (destructive ops smuggled into a tree_edit
    call) is kept as belt and suspenders."""
    offending = []
    for call in tool_calls:
        tool = (call.get("tool") or "").rsplit("__", 1)[-1]
        if tool == "tree_correct":
            offending.append("tree_correct call")
            continue
        if tool != "tree_edit":
            continue
        args = call.get("args") or {}
        ops = args.get("ops")
        if not isinstance(ops, list):
            ops = [args] if args.get("operation") else []
        for i, op in enumerate(ops):
            name = (op or {}).get("operation")
            if name in DESTRUCTIVE_TREE_OPS:
                offending.append(f"tree_edit ops[{i}]: {name}")
    assert not offending, (
        "extraction run emitted destructive tree ops (identity "
        "resolution belongs to person-evidence/hypothesis-tracking/"
        "tree-edit, not extraction): " + "; ".join(offending)
    )


def test_old_style_date_routes_to_convert_dates(skills_invoked, test):
    """A pre-adoption date must be resolved by invoking `convert-dates`
    BEFORE the record-extractor is spawned — not narrated, and not
    converted inline by the router.

    Graded here rather than by the LLM judge because `skills_invoked` is
    ground truth: the PreToolUse hook fires on the real `Skill` call, so a
    response that only *mentions* the calendar problem ("this may be Old
    Style — shall I convert it?") cannot satisfy it, and a response that
    genuinely delegates cannot be marked down for it. This is the same
    reason test_search_records asserts its escalation hand-off mechanically.

    Why it matters more than a formatting nit: England and its colonies
    began the legal year on 25 March until 1752, so an unresolved January-
    to-March colonial date is wrong by a YEAR, not a day, and the error
    propagates into every conclusion built on the fact.

    Regression guard for #2107 — `convert-dates` had 0 invocations across
    the 159 committed e2e runs, and 0 `convert_calendar` tool calls,
    because nothing on a reachable path named it.

    Tag-gated: only the pre-1752 test asserts this. Ordinary extraction
    tests must NOT reach for convert-dates, and doing so on a modern date
    is over-application, not a pass.
    """
    if "convert-dates-handoff" not in test.get("tags", []):
        pytest.skip("only the pre-1752 Old Style routing test")
    assert "convert-dates" in skills_invoked, (
        "the record's date falls before its jurisdiction adopted the "
        "Gregorian calendar, so the router had to invoke "
        "Skill('convert-dates') before delegating. Narrating the problem "
        "in prose is not resolving it. "
        f"skills_invoked={skills_invoked}"
    )
