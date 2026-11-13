# search-records-ugo-stella-thin-subject

Ugo Stella, known only by his name: the alpha-feedback case behind issue #2213 d29.

- **Objective:** the researcher's own words: a Cavaliere, apparently from Milan, who
  founded A.L.F.A. (Alfa Romeo) in 1910.
- **Questions:** 1 — q_001 (`in_progress`).
- **Plans:** 1 — pl_001 (`active`), one `planned` item: pli_001, Milan civil
  registration, 1866-1942.
- **Log / sources / assertions / person evidence:** 0.
- **GedcomX persons:** I1 (Ugo Stella) — a name and nothing else. No facts, no
  relationships.

I1 is too thin in the `subjectTooThin` sense (`docs/specs/rank-search-matches-tool-spec.md`,
"subjectTooThin"): no date narrower than a year, and no named spouse, parent or child.

## What the skill must do

The Milan search returns a 1942 marriage naming an Ugo Stella as the bride's father, with
the bride (Mafalda, born Sassoferrato 1908) and her mother (Giuseppa Bilancioni). Every
`matchScore` is near zero (top 0.023) and `ranked` carries `subjectTooThin` and its note.
In the session this comes from, the agent told the tester that Ugo Stella's wife was
Giuseppa Bilancioni and his daughter Mafalda. The record is a candidate: no wife or child
in it is reported as his, and the reply names what would settle identity (a precise date,
or a named spouse, parent or child) and the record likely to state it, such as the 1910
A.L.F.A. founding deed or the gazette notice of his Cavaliere appointment.

Reconstructed from the Ugo Stella alpha feedback as issue #2213 records it (bundle feedback-2026-09-22T15-34-02-839294Z.zip): the record's ids, collection id and the groom are hand-authored.
