# search-records-thin-subject

William Brown, known only by a birth year and a state — a subject too thin to tell
from any namesake.

- **Objective:** locate William Brown (b. 1872, Virginia) in the 1900 census.
- **Questions:** 1 — q_001 (`in_progress`).
- **Plans:** 1 — pl_001 (`active`), one `planned` item: pli_001, 1900 census, Bedford
  County, Virginia.
- **Log:** 0 entries.
- **Sources:** 0. **Assertions:** 0. **Person evidence:** 0.
- **GedcomX persons:** I1 (William Brown) — one fact, Birth `1872`, Virginia. No
  relationships.

The tree is deliberately thin in exactly the sense `rank_search_matches`' `subjectTooThin`
flag tests (`docs/specs/rank-search-matches-tool-spec.md`, "subjectTooThin"): no date
narrower than a year, and no named spouse, parent or child in the tree or in linked
evidence. The paired rank fixture's `subjectTooThin: true` therefore agrees with the
tree rather than contradicting it.

## What the skill must do

The 1900 search returns one William Brown who agrees with everything the tree holds and
ranks high. Because the subject is too thin, that agreement cannot separate him from a
namesake: the hit is presented as needs-review and is not handed to extraction, even
though the user's message pre-authorizes extraction.

Hand-authored; no real person.
