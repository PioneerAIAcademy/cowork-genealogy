# record-extraction-refine-informant

Carries a **previously extracted** 1900 U.S. Census record (Thomas Doyle
household, Carbon County, Pennsylvania) with two assertions already
persisted from a prior session: `a_001` (Thomas's name) and `a_002`
(Thomas's birthplace, "Ireland"). Both were classified at initial
extraction as `informant_proximity: "self"` / `information_quality:
"primary"` — an assumption that Thomas answered the enumerator's
questions himself, which the census schedule itself never actually
states (no informant column).

- **GedcomX persons:** I1 (Thomas Doyle), matching `a_002`'s subject.
- **Sources:** `src_001` / tree `S1`, the same 1900 census, already
  cited — not an unverified import.
- **Log:** one prior `record_search` entry (`log_001`) the original
  extraction cited.

## Why this scenario exists

Issue #2021 (F12 in `docs/deep-dives/record-extraction-findings-2026-08-28.md`):
every existing record-extraction test scenario is either
`empty-project-just-created` or `mid-research-flynn`, so no test ever
exercises `record-extraction`'s **classification-refinement** path —
`SKILL.md:203-208`'s "find the record from `record_id`/`source_id`,
delegate per record, never re-classify inline" and
`record-extractor.md:947-964`'s `update`-op path. This scenario is
built specifically to carry a pre-existing, already-sourced assertion a
refinement request can target.

The intended test asks the skill to reclassify `a_002` after new context
(a naturalization petition placing Thomas away from home on census day)
undermines the original self-reported assumption. The correct
reclassification is `informant_proximity: "self"` → `"unknown"` and
`information_quality: "primary"` → `"indeterminate"` — mirroring the
existing corpus's own precedent for a census fact whose actual informant
can no longer be assumed (`mid-research-flynn`'s `a_001`: "unknown
informant... most likely a household member, possibly a neighbor").
`evidence_type` does **not** change: the birthplace is still *stated*
content on the census (someone told the enumerator), only the identity
and reliability of who reported it is now in doubt — evidence_type is
stated-vs-inferred, not a proxy for informant confidence.

`a_001` (the name assertion) is a deliberate **distractor**: it shares
the same original (arguably-wrong) informant assumption but is not named
in the refinement request, so a correct run leaves it untouched. This is
what lets a test tell "reclassified only what was asked" apart from
"reclassified everything with a similar profile."

## First-cut caveat — verify before committing

This is an invented scenario (no real FamilySearch identifiers), built
to match the corpus's existing informant-doctrine conventions rather
than carved from an observed failure — there is no live run to check it
against. Confirm the doctrine call (self → unknown, primary →
indeterminate, evidence_type unchanged) reads as correct GPS practice
before relying on it as the refinement's expected outcome.

## Used by

- `record-extraction` tests asserting that a classification-refinement
  request updates the named assertion's classification fields in place
  (via an `update` op), leaves its extraction fields and any
  un-named sibling assertion untouched, and creates no duplicate —
  issue #2021 / F12.
