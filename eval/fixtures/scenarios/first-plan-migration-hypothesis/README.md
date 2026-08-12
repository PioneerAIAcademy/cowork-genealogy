# first-plan-migration-hypothesis

Michael Sheahan migration research, first plan for q_001. Reuses
`flynn-first-plan-surveyed`'s place and `localities` entry (Schuylkill
County, Pennsylvania) verbatim — the place is infrastructure, not the
substance under test.

- **Objective:** Determine why Michael Sheahan relocated to Schuylkill
  County, Pennsylvania around 1882.
- **Questions:** q_001 (`open`, **no plan yet**) — testing a family-tradition
  hypothesis that the move was for anthracite coal-mining work.
- **Plans:** none — `plans: []`. This is the FIRST plan for the question.
- **Hypotheses:** h_001 (active) — the coal-mining-employment hypothesis,
  supported so far only by an occupation change visible across two census
  years, no direct record of the move's cause.
- **Log:** 2 entries establishing the "before" (1870, farming, a different
  county) and "after" (1882 city directory, miner, Schuylkill County) that
  motivate the hypothesis and the question.
- **GedcomX persons:** I1 (Michael Sheahan).

## Source and scrub note

Carved (from-scratch reconstruction, not an edited copy) from a real alpha
feedback case (`feedback-2026-07-31T19-31-55-537Z.zip`, PID redacted,
referenced by issue #1319): a tester asked for a timeline, hypotheses, and a
research plan for a subject who moved across several jurisdictions. The
first-pass plans came back looking "thorough" at a glance (each hit the
skill's own "4-10 items" size guidance) but were narrow in record-type
diversity — one plan was all-census, another skipped census entirely and
went straight to two out-of-state archival requests plus newspaper and tax
items. Only after the tester asked "was anything missed?" (twice) did
probate, church, and land/tax items get added. Live `collections_search` /
`volume_search` calls against the real case's jurisdictions during
reproduction confirmed those additional record types were discoverable at
first-plan time — the gap was not tool coverage.

This scenario re-derives that shape with **entirely invented names, no real
FamilySearch identifiers, and decade-level dates** — the real case involved
a private individual's actual family history and a real FamilySearch person
ID, which do not belong in a committed test. The specific record types
available at this scenario's place (Schuylkill County, PA) are church,
probate, naturalization, land/deed, marriage, and tax (per the reused
`collections-search-schuylkill`, `volume-search-schuylkill`, and
`external-links-search-schuylkill` fixtures) — deliberately chosen because
several of them (land/deed, tax, church) are exactly the types a
migration-for-work hypothesis should reach for and a census-only or
newspaper-only plan would miss.

**First-cut caveat — verify before committing:** confirm the two log
entries plausibly establish the hypothesis without over-determining the
answer (the plan, not the log, should do the exhaustive work).

## Used by

- `research-plan` tests asserting that a FIRST plan for a migration/
  hypothesis-testing question already clears a record-type breadth
  self-check (BCG Standard 14/17) — not just census, and not requiring the
  user to ask "did I miss anything?" before the breadth appears.
