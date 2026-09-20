# citation-authored-sources

A citation scenario for issue #2542, carrying the source shapes the existing
`mid-research-flynn` fixture does not: a **published/authored work** and a
**Find a Grave memorial with its reliability half**, plus one **original
record** for the negative direction.

Synthetic — no PII. Invented persons, works, and identifiers; not drawn from any
real profile. A separate directory (not an edit to `mid-research-flynn`, which is
referenced by 155 unit-test files) so these before-state sources change no other
skill's inputs.

Three before-state sources, each a rough working citation to be refined:

- **`src_001` (S1) — compiled county history, `source_classification: authored`.**
  Carries author, full title, place of publication, publisher, year, page, and a
  stated source of the source. Used by `ut_citation_019` — the skill must produce
  the authored-work citation (author, italic title, place: publisher, year, page,
  and the "citing …" tail), recognisable as a publication rather than a record.
- **`src_002` (S2) — Find a Grave memorial, `source_classification: authored`.**
  Carries the contributor, the last-modified date, and a stated source of the
  source (an obituary). Used by `ut_citation_020` — the skill must carry the
  reliability half (contributor, date, source of the source).
- **`src_003` (S3) — Iowa death certificate, `source_classification: original`.**
  Used by `ut_citation_021` (negative direction) — an original record must still
  cite as a record via the vital-records template, and the authored-work template
  must not fire.

Example values in the SKILL.md templates are deliberately distinct from this
scenario's before-state values, so the `test_no_skill_example_values_persisted`
deny-list stays meaningful.
